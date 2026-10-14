import { schema, type Db } from '@mostrador/db-cloud';
import type { TipoMovimientoInventario } from '@mostrador/db-cloud/schema';
import { type Centavos, type TipoMovimiento, signoMovimiento } from '@mostrador/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { ErrorNoEncontrado } from '../../errors.js';
import { nuevoId } from '../../util/id.js';

export interface EntradaMovimiento {
  empresaId: string;
  sucursalId: string;
  almacenId?: string | undefined;
  productoId: string;
  tipo: TipoMovimientoInventario;
  /** Cantidad siempre positiva: el tipo determina el signo. */
  cantidad: number;
  costoUnitario?: Centavos | undefined;
  motivo?: string | undefined;
  usuarioId?: string | undefined;
  dispositivoId?: string | undefined;
  documentoTipo?: string | undefined;
  documentoId?: string | undefined;
  documentoFolio?: string | undefined;
  ocurridoEn?: Date | undefined;
}

export interface MovimientoAplicado {
  id: string;
  productoId: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  cantidadConSigno: number;
  saldoResultante: number;
}

/** Almacen principal de la sucursal: donde cae el stock si no se indica otro. */
export async function almacenPrincipal(base: BaseDatos, sucursalId: string): Promise<string> {
  const [almacen] = await base
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.branchId, sucursalId))
    .orderBy(asc(schema.warehouses.createdAt))
    .limit(1);

  if (!almacen) {
    throw new ErrorNoEncontrado('La sucursal no tiene almacen configurado');
  }
  return almacen.id;
}

export async function productoExiste(
  base: BaseDatos,
  empresaId: string,
  productoId: string,
): Promise<{ id: string; nombre: string; costoPromedio: number } | undefined> {
  const [producto] = await base
    .select({
      id: schema.products.id,
      nombre: schema.products.name,
      costoPromedio: schema.products.averageCost,
    })
    .from(schema.products)
    .where(
      and(
        eq(schema.products.id, productoId),
        eq(schema.products.companyId, empresaId),
        isNull(schema.products.deletedAt),
      ),
    )
    .limit(1);

  return producto;
}

/**
 * Aplica un movimiento al kardex y actualiza el saldo.
 *
 * Son dos escrituras que van juntas: el movimiento (la historia) y el saldo
 * (la lectura rapida). Deben vivir en la misma transaccion para que el saldo
 * nunca se despegue de la historia.
 */
export async function aplicarMovimiento(
  base: BaseDatos,
  entrada: EntradaMovimiento,
): Promise<MovimientoAplicado> {
  const almacenId = entrada.almacenId ?? (await almacenPrincipal(base, entrada.sucursalId));
  const signo = signoMovimiento(entrada.tipo as TipoMovimiento);
  const cantidadConSigno = signo * entrada.cantidad;
  const id = nuevoId();

  await base.insert(schema.inventoryMovements).values({
    id,
    companyId: entrada.empresaId,
    branchId: entrada.sucursalId,
    warehouseId: almacenId,
    productId: entrada.productoId,
    type: entrada.tipo,
    quantity: entrada.cantidad,
    unitCost: entrada.costoUnitario ?? null,
    documentType: entrada.documentoTipo ?? null,
    documentId: entrada.documentoId ?? null,
    documentFolio: entrada.documentoFolio ?? null,
    reason: entrada.motivo ?? null,
    userId: entrada.usuarioId ?? null,
    deviceId: entrada.dispositivoId ?? null,
    occurredAt: entrada.ocurridoEn ?? new Date(),
  });

  await base
    .insert(schema.stockBalances)
    .values({
      productId: entrada.productoId,
      branchId: entrada.sucursalId,
      warehouseId: almacenId,
      quantity: cantidadConSigno,
    })
    .onConflictDoUpdate({
      target: [
        schema.stockBalances.productId,
        schema.stockBalances.branchId,
        schema.stockBalances.warehouseId,
      ],
      set: {
        quantity: sql`${schema.stockBalances.quantity} + ${cantidadConSigno}`,
        updatedAt: new Date(),
      },
    });

  const [saldo] = await base
    .select({ cantidad: schema.stockBalances.quantity })
    .from(schema.stockBalances)
    .where(
      and(
        eq(schema.stockBalances.productId, entrada.productoId),
        eq(schema.stockBalances.branchId, entrada.sucursalId),
        eq(schema.stockBalances.warehouseId, almacenId),
      ),
    )
    .limit(1);

  return {
    id,
    productoId: entrada.productoId,
    tipo: entrada.tipo,
    cantidad: entrada.cantidad,
    cantidadConSigno,
    saldoResultante: Number(saldo?.cantidad ?? 0),
  };
}

/** Registra un movimiento suelto (compra, ajuste, merma, inventario inicial). */
export async function registrarMovimiento(
  db: Db,
  entrada: EntradaMovimiento,
): Promise<MovimientoAplicado> {
  return db.transaction(async (tx) => aplicarMovimiento(tx, entrada));
}

/** Mueve stock de una sucursal a otra: genera salida y entrada, en una sola operacion. */
export async function transferir(
  db: Db,
  datos: {
    empresaId: string;
    origenSucursalId: string;
    destinoSucursalId: string;
    usuarioId?: string | undefined;
    motivo?: string | undefined;
    lineas: { productoId: string; cantidad: number }[];
  },
): Promise<MovimientoAplicado[]> {
  if (datos.origenSucursalId === datos.destinoSucursalId) {
    throw new ErrorNoEncontrado('El origen y el destino no pueden ser la misma sucursal');
  }

  const folio = `TR-${Date.now()}`;

  return db.transaction(async (tx) => {
    const aplicados: MovimientoAplicado[] = [];

    for (const linea of datos.lineas) {
      const producto = await productoExiste(tx, datos.empresaId, linea.productoId);
      if (!producto) {
        throw new ErrorNoEncontrado(`El producto ${linea.productoId} no existe`);
      }

      const salida = await aplicarMovimiento(tx, {
        empresaId: datos.empresaId,
        sucursalId: datos.origenSucursalId,
        productoId: linea.productoId,
        tipo: 'transferencia_salida',
        cantidad: linea.cantidad,
        costoUnitario: producto.costoPromedio as Centavos,
        motivo: datos.motivo,
        usuarioId: datos.usuarioId,
        documentoTipo: 'transferencia',
        documentoFolio: folio,
      });

      const entrada = await aplicarMovimiento(tx, {
        empresaId: datos.empresaId,
        sucursalId: datos.destinoSucursalId,
        productoId: linea.productoId,
        tipo: 'transferencia_entrada',
        cantidad: linea.cantidad,
        costoUnitario: producto.costoPromedio as Centavos,
        motivo: datos.motivo,
        usuarioId: datos.usuarioId,
        documentoTipo: 'transferencia',
        documentoFolio: folio,
      });

      aplicados.push(salida, entrada);
    }

    return aplicados;
  });
}

export interface FiltroStock {
  empresaId: string;
  sucursalId: string;
  buscar?: string | undefined;
  soloBajoMinimo?: boolean | undefined;
  limite?: number | undefined;
}

export interface FilaStock {
  productoId: string;
  sku: string;
  nombre: string;
  precioVenta: number;
  costoPromedio: number;
  stock: number;
  stockMinimo: number;
  bajoMinimo: boolean;
}

/** Stock de varios productos en una sucursal, sumando todos sus almacenes. */
export async function stockDeProductos(
  base: BaseDatos,
  sucursalId: string,
  productoIds: readonly string[],
): Promise<Map<string, number>> {
  if (productoIds.length === 0) {
    return new Map();
  }

  const filas = await base
    .select({
      productoId: schema.stockBalances.productId,
      cantidad: sql<number>`sum(${schema.stockBalances.quantity})`,
    })
    .from(schema.stockBalances)
    .where(
      and(
        eq(schema.stockBalances.branchId, sucursalId),
        inArray(schema.stockBalances.productId, [...productoIds]),
      ),
    )
    .groupBy(schema.stockBalances.productId);

  return new Map(filas.map((fila) => [fila.productoId, Number(fila.cantidad)]));
}

/** Stock por producto en una sucursal, con la alerta de minimo ya resuelta. */
export async function stockPorSucursal(base: BaseDatos, filtro: FiltroStock): Promise<FilaStock[]> {
  const condiciones = [
    eq(schema.products.companyId, filtro.empresaId),
    isNull(schema.products.deletedAt),
    eq(schema.products.active, true),
  ];

  if (filtro.buscar) {
    const comoTexto = `%${filtro.buscar}%`;
    condiciones.push(
      or(
        sql`${schema.products.name} ilike ${comoTexto}`,
        sql`${schema.products.sku} ilike ${comoTexto}`,
      )!,
    );
  }

  const productos = await base
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      nombre: schema.products.name,
      precioVenta: schema.products.salePrice,
      costoPromedio: schema.products.averageCost,
      stockMinimo: schema.products.minStock,
    })
    .from(schema.products)
    .where(and(...condiciones))
    .orderBy(asc(schema.products.name))
    .limit(filtro.limite ?? 200);

  if (productos.length === 0) {
    return [];
  }

  const stockPorProducto = await stockDeProductos(
    base,
    filtro.sucursalId,
    productos.map((producto) => producto.id),
  );

  const resultado: FilaStock[] = productos.map((producto) => {
    const stock = stockPorProducto.get(producto.id) ?? 0;
    return {
      productoId: producto.id,
      sku: producto.sku,
      nombre: producto.nombre,
      precioVenta: producto.precioVenta,
      costoPromedio: producto.costoPromedio,
      stock,
      stockMinimo: producto.stockMinimo,
      bajoMinimo: stock <= producto.stockMinimo,
    };
  });

  return filtro.soloBajoMinimo ? resultado.filter((fila) => fila.bajoMinimo) : resultado;
}

export interface FiltroMovimientos {
  empresaId: string;
  productoId?: string | undefined;
  sucursalId?: string | undefined;
  desde?: Date | undefined;
  hasta?: Date | undefined;
  limite?: number | undefined;
}

/** Kardex: la historia de movimientos, lo mas reciente primero. */
export async function listarMovimientos(base: BaseDatos, filtro: FiltroMovimientos) {
  const condiciones = [eq(schema.inventoryMovements.companyId, filtro.empresaId)];

  if (filtro.productoId) {
    condiciones.push(eq(schema.inventoryMovements.productId, filtro.productoId));
  }
  if (filtro.sucursalId) {
    condiciones.push(eq(schema.inventoryMovements.branchId, filtro.sucursalId));
  }
  if (filtro.desde) {
    condiciones.push(gte(schema.inventoryMovements.occurredAt, filtro.desde));
  }
  if (filtro.hasta) {
    condiciones.push(lte(schema.inventoryMovements.occurredAt, filtro.hasta));
  }

  return base
    .select({
      id: schema.inventoryMovements.id,
      tipo: schema.inventoryMovements.type,
      cantidad: schema.inventoryMovements.quantity,
      costoUnitario: schema.inventoryMovements.unitCost,
      motivo: schema.inventoryMovements.reason,
      documentoTipo: schema.inventoryMovements.documentType,
      documentoFolio: schema.inventoryMovements.documentFolio,
      ocurridoEn: schema.inventoryMovements.occurredAt,
      productoId: schema.inventoryMovements.productId,
      producto: schema.products.name,
      sku: schema.products.sku,
      sucursalId: schema.inventoryMovements.branchId,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.products, eq(schema.products.id, schema.inventoryMovements.productId))
    .where(and(...condiciones))
    .orderBy(desc(schema.inventoryMovements.occurredAt))
    .limit(filtro.limite ?? 100);
}
