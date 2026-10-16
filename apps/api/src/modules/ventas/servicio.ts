import { schema, type Db } from '@mostrador/db-cloud';
import {
  type Centavos,
  type ConfiguracionImpuestos,
  type LineaVentaEntrada,
  calcularCobro,
  calcularTotales,
  centavos,
  redondear,
} from '@mostrador/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { ErrorDeAplicacion, ErrorNoEncontrado, envolverRegla } from '../../errors.js';
import { siguienteFolioDevolucion, siguienteFolioVenta } from '../../servicios/folio.js';
import { nuevoId } from '../../util/id.js';
import { aplicarMovimiento, stockDeProductos } from '../inventario/servicio.js';

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';

export interface LineaVentaSolicitada {
  productoId: string;
  cantidad: number;
  descuentoPorcentaje?: number | undefined;
  descuentoMonto?: Centavos | undefined;
}

export interface PagoSolicitado {
  metodo: MetodoPago;
  monto: Centavos;
  referencia?: string | undefined;
}

export interface EntradaVenta {
  empresaId: string;
  sucursalId: string;
  usuarioId: string;
  dispositivoId?: string | undefined;
  turnoId?: string | undefined;
  cajaId?: string | undefined;
  clienteId?: string | undefined;
  folio?: string | undefined;
  vendidoEn?: Date | undefined;
  lineas: LineaVentaSolicitada[];
  pagos: PagoSolicitado[];
}

export interface LineaRegistrada {
  productoId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  impuesto: number;
  total: number;
  costoUnitario: number;
}

export interface VentaRegistrada {
  id: string;
  folio: string;
  estado: 'completada';
  vendidoEn: string;
  subtotal: number;
  descuentoTotal: number;
  impuestos: number;
  total: number;
  pagado: number;
  cambio: number;
  articulos: number;
  advertencias: string[];
  lineas: LineaRegistrada[];
  pagos: { metodo: MetodoPago; monto: number; referencia?: string | undefined }[];
}

async function configuracionEmpresa(base: BaseDatos, empresaId: string) {
  const [empresa] = await base
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, empresaId), isNull(schema.companies.deletedAt)))
    .limit(1);

  if (!empresa) {
    throw new ErrorNoEncontrado('La empresa no existe');
  }
  return empresa;
}

/**
 * Registra una venta.
 *
 * El servidor NO confia en los totales que manda el celular: recalcula subtotal,
 * impuestos, total y cambio con las mismas reglas de `@mostrador/domain`. Asi el
 * resultado es identico en el mostrador y en la nube, y nadie puede alterar el cobro.
 *
 * La venta, sus lineas, sus pagos y la salida de inventario se escriben en una sola
 * transaccion: o queda todo, o no queda nada.
 */
export async function registrarVenta(db: Db, entrada: EntradaVenta): Promise<VentaRegistrada> {
  return db.transaction(async (tx) => {
    const empresa = await configuracionEmpresa(tx, entrada.empresaId);
    const config: ConfiguracionImpuestos = {
      preciosConImpuestoIncluido: empresa.pricesIncludeTax,
    };

    const idsProductos = [...new Set(entrada.lineas.map((linea) => linea.productoId))];
    const filasProductos = await tx
      .select({
        id: schema.products.id,
        nombre: schema.products.name,
        sku: schema.products.sku,
        precioVenta: schema.products.salePrice,
        costoPromedio: schema.products.averageCost,
        tasaImpuesto: schema.products.taxRate,
        esServicio: schema.products.isService,
      })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.companyId, entrada.empresaId),
          inArray(schema.products.id, idsProductos),
          isNull(schema.products.deletedAt),
        ),
      );

    const porId = new Map(filasProductos.map((producto) => [producto.id, producto]));

    for (const linea of entrada.lineas) {
      if (!porId.has(linea.productoId)) {
        throw new ErrorNoEncontrado(`El producto ${linea.productoId} no existe`);
      }
    }

    const lineasCalculo: LineaVentaEntrada[] = entrada.lineas.map((linea) => {
      const producto = porId.get(linea.productoId)!;
      return {
        productoId: producto.id,
        nombre: producto.nombre,
        precioUnitario: centavos(producto.precioVenta),
        cantidad: linea.cantidad,
        tasaImpuesto: producto.tasaImpuesto,
        descuentoPorcentaje: linea.descuentoPorcentaje,
        descuentoMonto: linea.descuentoMonto,
      };
    });

    const totales = envolverRegla(() => calcularTotales(lineasCalculo, config));
    const cobro = envolverRegla(() =>
      calcularCobro(
        totales.total,
        entrada.pagos.map((pago) => ({ metodo: pago.metodo, monto: pago.monto })),
      ),
    );

    // No se vende mas de lo que hay: el inventario nunca queda en negativo.
    const stock = await stockDeProductos(tx, entrada.sucursalId, idsProductos);
    const faltantes: string[] = [];
    for (const linea of totales.lineas) {
      const producto = porId.get(linea.productoId)!;
      if (producto.esServicio) {
        continue;
      }
      const disponible = stock.get(linea.productoId) ?? 0;
      if (disponible < linea.cantidad) {
        faltantes.push(
          `${producto.nombre}: hay ${disponible} y se intentan vender ${linea.cantidad}`,
        );
      }
    }

    if (faltantes.length > 0) {
      throw new ErrorDeAplicacion(
        `No hay existencia suficiente. ${faltantes.join('. ')}`,
        409,
        'SIN_EXISTENCIA',
      );
    }

    const advertencias: string[] = [];

    const vendidoEn = entrada.vendidoEn ?? new Date();
    const folio = entrada.folio ?? (await siguienteFolioVenta(tx, entrada.sucursalId, vendidoEn));
    const ventaId = nuevoId();
    const articulos = totales.lineas.reduce((total, linea) => total + linea.cantidad, 0);

    await tx.insert(schema.sales).values({
      id: ventaId,
      companyId: entrada.empresaId,
      branchId: entrada.sucursalId,
      deviceId: entrada.dispositivoId ?? null,
      shiftId: entrada.turnoId ?? null,
      cashRegisterId: entrada.cajaId ?? null,
      folio,
      soldByUserId: entrada.usuarioId,
      customerId: entrada.clienteId ?? null,
      status: 'completada',
      currency: empresa.currency,
      subtotal: totales.base,
      discountTotal: totales.descuentoTotal,
      taxTotal: totales.impuestos,
      total: totales.total,
      paidTotal: cobro.pagado,
      changeGiven: cobro.cambio,
      itemCount: articulos,
      soldAt: vendidoEn,
    });

    const lineasRegistradas: LineaRegistrada[] = totales.lineas.map((linea) => {
      const producto = porId.get(linea.productoId)!;
      return {
        productoId: linea.productoId,
        nombre: linea.nombre,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        descuento: linea.descuento,
        impuesto: linea.impuesto,
        total: linea.total,
        costoUnitario: producto.costoPromedio,
      };
    });

    await tx.insert(schema.saleLines).values(
      totales.lineas.map((linea, indice) => {
        const producto = porId.get(linea.productoId)!;
        return {
          id: nuevoId(),
          saleId: ventaId,
          productId: linea.productoId,
          lineNumber: indice + 1,
          name: linea.nombre,
          sku: producto.sku,
          quantity: linea.cantidad,
          unitPrice: linea.precioUnitario,
          discountAmount: linea.descuento,
          taxRate: linea.tasaImpuesto,
          baseAmount: linea.base,
          taxAmount: linea.impuesto,
          total: linea.total,
          unitCost: producto.costoPromedio,
        };
      }),
    );

    await tx.insert(schema.salePayments).values(
      entrada.pagos.map((pago) => ({
        id: nuevoId(),
        saleId: ventaId,
        method: pago.metodo,
        amount: pago.monto,
        reference: pago.referencia ?? null,
      })),
    );

    for (const linea of totales.lineas) {
      const producto = porId.get(linea.productoId)!;
      if (producto.esServicio) {
        continue;
      }
      await aplicarMovimiento(tx, {
        empresaId: entrada.empresaId,
        sucursalId: entrada.sucursalId,
        productoId: linea.productoId,
        tipo: 'salida_venta',
        cantidad: linea.cantidad,
        costoUnitario: centavos(producto.costoPromedio),
        usuarioId: entrada.usuarioId,
        dispositivoId: entrada.dispositivoId,
        documentoTipo: 'venta',
        documentoId: ventaId,
        documentoFolio: folio,
        ocurridoEn: vendidoEn,
      });
    }

    return {
      id: ventaId,
      folio,
      estado: 'completada',
      vendidoEn: vendidoEn.toISOString(),
      subtotal: totales.base,
      descuentoTotal: totales.descuentoTotal,
      impuestos: totales.impuestos,
      total: totales.total,
      pagado: cobro.pagado,
      cambio: cobro.cambio,
      articulos,
      advertencias,
      lineas: lineasRegistradas,
      pagos: entrada.pagos.map((pago) => ({
        metodo: pago.metodo,
        monto: pago.monto,
        referencia: pago.referencia,
      })),
    };
  });
}

export async function obtenerVenta(base: BaseDatos, empresaId: string, ventaId: string) {
  const [venta] = await base
    .select()
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.id, ventaId),
        eq(schema.sales.companyId, empresaId),
        isNull(schema.sales.deletedAt),
      ),
    )
    .limit(1);

  if (!venta) {
    return undefined;
  }

  const lineas = await base
    .select()
    .from(schema.saleLines)
    .where(eq(schema.saleLines.saleId, ventaId))
    .orderBy(asc(schema.saleLines.lineNumber));

  const pagos = await base
    .select()
    .from(schema.salePayments)
    .where(eq(schema.salePayments.saleId, ventaId));

  return { venta, lineas, pagos };
}

/**
 * Cancela una venta.
 *
 * Nunca se borra: se marca como cancelada y se devuelve el stock con movimientos
 * inversos. La historia completa queda registrada y auditable.
 */
export async function cancelarVenta(
  db: Db,
  datos: { empresaId: string; ventaId: string; motivo: string; usuarioId: string },
) {
  return db.transaction(async (tx) => {
    const encontrada = await obtenerVenta(tx, datos.empresaId, datos.ventaId);
    if (!encontrada) {
      throw new ErrorNoEncontrado('La venta no existe');
    }
    if (encontrada.venta.status === 'cancelada') {
      throw new ErrorDeAplicacion('La venta ya estaba cancelada', 409, 'VENTA_YA_CANCELADA');
    }

    const ahora = new Date();

    for (const linea of encontrada.lineas) {
      if (!linea.productId) {
        continue;
      }
      await aplicarMovimiento(tx, {
        empresaId: datos.empresaId,
        sucursalId: encontrada.venta.branchId,
        productoId: linea.productId,
        tipo: 'devolucion_cliente',
        cantidad: linea.quantity,
        costoUnitario: centavos(linea.unitCost),
        motivo: datos.motivo,
        usuarioId: datos.usuarioId,
        documentoTipo: 'cancelacion',
        documentoId: datos.ventaId,
        documentoFolio: encontrada.venta.folio,
        ocurridoEn: ahora,
      });
    }

    await tx
      .update(schema.sales)
      .set({
        status: 'cancelada',
        updatedAt: ahora,
        revision: sql`${schema.sales.revision} + 1`,
      })
      .where(eq(schema.sales.id, datos.ventaId));

    await tx.insert(schema.saleVoids).values({
      id: nuevoId(),
      saleId: datos.ventaId,
      reason: datos.motivo,
      voidedByUserId: datos.usuarioId,
      voidedAt: ahora,
    });

    return { id: datos.ventaId, folio: encontrada.venta.folio, estado: 'cancelada' as const };
  });
}

export interface LineaDevolucion {
  lineaId: string;
  cantidad: number;
  /** true: el producto regresa al inventario. false: esta dañado y se descarta. */
  reingresar?: boolean | undefined;
}

/** Devuelve productos de una venta: parcial o total, con reingreso de stock. */
export async function registrarDevolucion(
  db: Db,
  datos: {
    empresaId: string;
    ventaId: string;
    motivo: string;
    usuarioId: string;
    metodoReembolso?: MetodoPago | undefined;
    lineas: LineaDevolucion[];
  },
) {
  return db.transaction(async (tx) => {
    const encontrada = await obtenerVenta(tx, datos.empresaId, datos.ventaId);
    if (!encontrada) {
      throw new ErrorNoEncontrado('La venta no existe');
    }
    if (encontrada.venta.status === 'cancelada') {
      throw new ErrorDeAplicacion(
        'No se puede devolver una venta cancelada',
        409,
        'VENTA_CANCELADA',
      );
    }

    const filasDevueltas = await tx
      .select({
        lineaId: schema.returnLines.saleLineId,
        cantidad: sql<number>`sum(${schema.returnLines.quantity})`,
      })
      .from(schema.returnLines)
      .innerJoin(schema.returns, eq(schema.returns.id, schema.returnLines.returnId))
      .where(eq(schema.returns.saleId, datos.ventaId))
      .groupBy(schema.returnLines.saleLineId);

    const devueltoPorLinea = new Map(
      filasDevueltas.map((fila) => [fila.lineaId ?? '', Number(fila.cantidad)]),
    );

    const aInsertar: {
      linea: (typeof encontrada.lineas)[number];
      cantidad: number;
      precioUnitario: Centavos;
      importe: number;
      reingresar: boolean;
    }[] = [];

    for (const pedida of datos.lineas) {
      const linea = encontrada.lineas.find((candidata) => candidata.id === pedida.lineaId);
      if (!linea) {
        throw new ErrorNoEncontrado('La linea no pertenece a esta venta');
      }

      const yaDevuelto = devueltoPorLinea.get(linea.id) ?? 0;
      const disponible = linea.quantity - yaDevuelto;
      if (pedida.cantidad > disponible) {
        throw new ErrorDeAplicacion(
          `Solo quedan ${disponible} piezas por devolver de ${linea.name}`,
          409,
          'CANTIDAD_EXCEDIDA',
        );
      }

      const precioUnitario = redondear(linea.total / linea.quantity);
      aInsertar.push({
        linea,
        cantidad: pedida.cantidad,
        precioUnitario,
        importe: precioUnitario * pedida.cantidad,
        reingresar: pedida.reingresar ?? true,
      });
    }

    const total = aInsertar.reduce((suma, item) => suma + item.importe, 0);
    const fecha = new Date();
    const folio = await siguienteFolioDevolucion(tx, encontrada.venta.branchId, fecha);
    const devolucionId = nuevoId();

    await tx.insert(schema.returns).values({
      id: devolucionId,
      companyId: datos.empresaId,
      branchId: encontrada.venta.branchId,
      saleId: datos.ventaId,
      folio,
      reason: datos.motivo,
      total,
      refundMethod: datos.metodoReembolso ?? null,
      createdByUserId: datos.usuarioId,
      createdAt: fecha,
    });

    await tx.insert(schema.returnLines).values(
      aInsertar.map((item) => ({
        id: nuevoId(),
        returnId: devolucionId,
        saleLineId: item.linea.id,
        productId: item.linea.productId,
        quantity: item.cantidad,
        unitPrice: item.precioUnitario,
        total: item.importe,
        restock: item.reingresar,
      })),
    );

    for (const item of aInsertar) {
      if (!item.reingresar || !item.linea.productId) {
        continue;
      }
      await aplicarMovimiento(tx, {
        empresaId: datos.empresaId,
        sucursalId: encontrada.venta.branchId,
        productoId: item.linea.productId,
        tipo: 'devolucion_cliente',
        cantidad: item.cantidad,
        costoUnitario: centavos(item.linea.unitCost),
        motivo: datos.motivo,
        usuarioId: datos.usuarioId,
        documentoTipo: 'devolucion',
        documentoId: devolucionId,
        documentoFolio: folio,
        ocurridoEn: fecha,
      });
    }

    return { id: devolucionId, folio, total, ventaId: datos.ventaId, lineas: aInsertar.length };
  });
}

export interface FiltroVentas {
  empresaId: string;
  sucursalId?: string | undefined;
  desde?: Date | undefined;
  hasta?: Date | undefined;
  limite?: number | undefined;
}

export async function listarVentas(base: BaseDatos, filtro: FiltroVentas) {
  const condiciones = [
    eq(schema.sales.companyId, filtro.empresaId),
    isNull(schema.sales.deletedAt),
  ];

  if (filtro.sucursalId) {
    condiciones.push(eq(schema.sales.branchId, filtro.sucursalId));
  }
  if (filtro.desde) {
    condiciones.push(gte(schema.sales.soldAt, filtro.desde));
  }
  if (filtro.hasta) {
    condiciones.push(lte(schema.sales.soldAt, filtro.hasta));
  }

  return base
    .select({
      id: schema.sales.id,
      folio: schema.sales.folio,
      estado: schema.sales.status,
      vendidoEn: schema.sales.soldAt,
      total: schema.sales.total,
      impuestos: schema.sales.taxTotal,
      descuentos: schema.sales.discountTotal,
      cambio: schema.sales.changeGiven,
      articulos: schema.sales.itemCount,
      sucursalId: schema.sales.branchId,
      vendidoPor: schema.users.fullName,
    })
    .from(schema.sales)
    .innerJoin(schema.users, eq(schema.users.id, schema.sales.soldByUserId))
    .where(and(...condiciones))
    .orderBy(desc(schema.sales.soldAt))
    .limit(filtro.limite ?? 100);
}
