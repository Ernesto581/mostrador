import { schema, type Db } from '@mostrador/db-cloud';
import type { EstadoTransferencia, TipoUbicacion } from '@mostrador/db-cloud/schema';
import { centavos, generarFolio } from '@mostrador/domain';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { ErrorDeAplicacion, ErrorNoEncontrado } from '../../errors.js';
import { nuevoId } from '../../util/id.js';
import { aplicarMovimiento, productoExiste } from './servicio.js';

/**
 * Transferencias entre ubicaciones (piso de venta, almacen de un local u otro local).
 *
 * Dentro del mismo local la mercancia se mueve en un solo paso. Entre locales pasa por
 * borrador, transito y recepcion: mientras esta en transito no figura como disponible
 * ni en el origen ni en el destino. Las cantidades recibidas pueden ser menores; la
 * diferencia queda marcada como incidencia en la transferencia.
 */

export interface UbicacionVista {
  id: string;
  sucursalId: string;
  sucursalCodigo: string;
  sucursalNombre: string;
  sucursalActiva: boolean;
  codigo: string;
  nombre: string;
  tipo: TipoUbicacion;
}

export interface LineaTransferencia {
  id: string;
  productoId: string;
  sku: string;
  nombre: string;
  enviada: number;
  recibida: number | null;
}

export interface TransferenciaVista {
  id: string;
  folio: string;
  estado: EstadoTransferencia;
  motivo: string | null;
  hayIncidencia: boolean;
  creadaEn: Date;
  despachadaEn: Date | null;
  recibidaEn: Date | null;
  origen: UbicacionVista;
  destino: UbicacionVista;
  lineas: LineaTransferencia[];
}

type FilaTransferencia = typeof schema.transfers.$inferSelect;

/** Todas las ubicaciones de la empresa, con los datos de su sucursal. */
export async function listarUbicaciones(
  base: BaseDatos,
  empresaId: string,
): Promise<UbicacionVista[]> {
  return base
    .select({
      id: schema.warehouses.id,
      sucursalId: schema.warehouses.branchId,
      sucursalCodigo: schema.branches.code,
      sucursalNombre: schema.branches.name,
      sucursalActiva: schema.branches.active,
      codigo: schema.warehouses.code,
      nombre: schema.warehouses.name,
      tipo: schema.warehouses.kind,
    })
    .from(schema.warehouses)
    .innerJoin(schema.branches, eq(schema.branches.id, schema.warehouses.branchId))
    .where(
      and(
        eq(schema.branches.companyId, empresaId),
        isNull(schema.branches.deletedAt),
        isNull(schema.warehouses.deletedAt),
      ),
    )
    .orderBy(asc(schema.branches.code), asc(schema.warehouses.kind));
}

async function existenciasEnUbicacion(
  base: BaseDatos,
  ubicacionId: string,
  productoIds: readonly string[],
): Promise<Map<string, number>> {
  const filas = await base
    .select({
      productoId: schema.stockBalances.productId,
      cantidad: schema.stockBalances.quantity,
    })
    .from(schema.stockBalances)
    .where(
      and(
        eq(schema.stockBalances.warehouseId, ubicacionId),
        inArray(schema.stockBalances.productId, [...productoIds]),
      ),
    );

  return new Map(filas.map((fila) => [fila.productoId, Number(fila.cantidad)]));
}

async function ensamblar(
  base: BaseDatos,
  empresaId: string,
  filas: FilaTransferencia[],
): Promise<TransferenciaVista[]> {
  if (filas.length === 0) {
    return [];
  }

  const ubicaciones = new Map(
    (await listarUbicaciones(base, empresaId)).map((ubicacion) => [ubicacion.id, ubicacion]),
  );

  const lineas = await base
    .select({
      id: schema.transferLines.id,
      transferId: schema.transferLines.transferId,
      productoId: schema.transferLines.productId,
      sku: schema.products.sku,
      nombre: schema.products.name,
      enviada: schema.transferLines.quantitySent,
      recibida: schema.transferLines.quantityReceived,
    })
    .from(schema.transferLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.transferLines.productId))
    .where(
      inArray(
        schema.transferLines.transferId,
        filas.map((fila) => fila.id),
      ),
    )
    .orderBy(asc(schema.transferLines.createdAt));

  return filas.map((fila) => {
    const origen = ubicaciones.get(fila.fromWarehouseId);
    const destino = ubicaciones.get(fila.toWarehouseId);
    if (!origen || !destino) {
      throw new ErrorNoEncontrado('Una ubicacion de la transferencia ya no existe');
    }

    return {
      id: fila.id,
      folio: fila.folio,
      estado: fila.status,
      motivo: fila.reason,
      hayIncidencia: fila.hasDiscrepancy,
      creadaEn: fila.createdAt,
      despachadaEn: fila.dispatchedAt,
      recibidaEn: fila.receivedAt,
      origen,
      destino,
      lineas: lineas
        .filter((linea) => linea.transferId === fila.id)
        .map((linea) => ({
          id: linea.id,
          productoId: linea.productoId,
          sku: linea.sku,
          nombre: linea.nombre,
          enviada: linea.enviada,
          recibida: linea.recibida,
        })),
    };
  });
}

export async function obtenerTransferencia(
  base: BaseDatos,
  empresaId: string,
  transferenciaId: string,
): Promise<TransferenciaVista | undefined> {
  const [fila] = await base
    .select()
    .from(schema.transfers)
    .where(
      and(
        eq(schema.transfers.id, transferenciaId),
        eq(schema.transfers.companyId, empresaId),
        isNull(schema.transfers.deletedAt),
      ),
    )
    .limit(1);

  if (!fila) {
    return undefined;
  }
  const [vista] = await ensamblar(base, empresaId, [fila]);
  return vista;
}

async function cargar(
  base: BaseDatos,
  empresaId: string,
  transferenciaId: string,
): Promise<TransferenciaVista> {
  const vista = await obtenerTransferencia(base, empresaId, transferenciaId);
  if (!vista) {
    throw new ErrorNoEncontrado('La transferencia no existe');
  }
  return vista;
}

export interface FiltroTransferencias {
  empresaId: string;
  /** Solo transferencias que tocan estas sucursales (origen o destino). */
  sucursalIds?: readonly string[] | undefined;
  estado?: EstadoTransferencia | undefined;
  limite?: number | undefined;
}

/** Transferencias que tocan alguna de las sucursales, la mas reciente primero. */
export async function listarTransferencias(
  base: BaseDatos,
  filtro: FiltroTransferencias,
): Promise<TransferenciaVista[]> {
  const condiciones = [
    eq(schema.transfers.companyId, filtro.empresaId),
    isNull(schema.transfers.deletedAt),
  ];

  if (filtro.sucursalIds) {
    if (filtro.sucursalIds.length === 0) {
      return [];
    }
    condiciones.push(
      or(
        inArray(schema.transfers.fromBranchId, [...filtro.sucursalIds]),
        inArray(schema.transfers.toBranchId, [...filtro.sucursalIds]),
      )!,
    );
  }
  if (filtro.estado) {
    condiciones.push(eq(schema.transfers.status, filtro.estado));
  }

  const filas = await base
    .select()
    .from(schema.transfers)
    .where(and(...condiciones))
    .orderBy(desc(schema.transfers.createdAt))
    .limit(filtro.limite ?? 50);

  return ensamblar(base, filtro.empresaId, filas);
}

async function siguienteFolioTransferencia(
  base: BaseDatos,
  sucursalOrigenId: string,
  codigoOrigen: string,
  fecha: Date,
): Promise<string> {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  const siguiente = new Date(inicio);
  siguiente.setDate(siguiente.getDate() + 1);

  const [fila] = await base
    .select({ total: count() })
    .from(schema.transfers)
    .where(
      and(
        eq(schema.transfers.fromBranchId, sucursalOrigenId),
        gte(schema.transfers.createdAt, inicio),
        lt(schema.transfers.createdAt, siguiente),
      ),
    );

  return `TR-${generarFolio({
    codigoSucursal: codigoOrigen,
    fecha,
    consecutivo: Number(fila?.total ?? 0) + 1,
  })}`;
}

function exigirEstado(
  vista: TransferenciaVista,
  esperados: readonly EstadoTransferencia[],
  accion: string,
): void {
  if (!esperados.includes(vista.estado)) {
    throw new ErrorDeAplicacion(
      `No se puede ${accion} una transferencia que esta "${vista.estado}"`,
      409,
      'ESTADO_INVALIDO',
    );
  }
}

interface DatosMovimientoTransferencia {
  empresaId: string;
  usuarioId: string;
  transferencia: { id: string; folio: string; motivo: string | null };
  sucursalId: string;
  ubicacionId: string;
  productoId: string;
  tipo: 'transferencia_salida' | 'transferencia_entrada';
  cantidad: number;
  motivo?: string | undefined;
  ahora: Date;
}

async function moverMercancia(tx: BaseDatos, datos: DatosMovimientoTransferencia) {
  const producto = await productoExiste(tx, datos.empresaId, datos.productoId);
  if (!producto) {
    throw new ErrorNoEncontrado(`El producto ${datos.productoId} no existe`);
  }

  return aplicarMovimiento(tx, {
    empresaId: datos.empresaId,
    sucursalId: datos.sucursalId,
    almacenId: datos.ubicacionId,
    productoId: datos.productoId,
    tipo: datos.tipo,
    cantidad: datos.cantidad,
    costoUnitario: centavos(producto.costoPromedio),
    motivo: datos.motivo ?? datos.transferencia.motivo ?? undefined,
    usuarioId: datos.usuarioId,
    documentoTipo: 'transferencia',
    documentoId: datos.transferencia.id,
    documentoFolio: datos.transferencia.folio,
    ocurridoEn: datos.ahora,
  });
}

export interface EntradaTransferencia {
  empresaId: string;
  origenUbicacionId: string;
  destinoUbicacionId: string;
  usuarioId: string;
  motivo?: string | undefined;
  lineas: { productoId: string; cantidad: number }[];
}

/**
 * Crea una transferencia.
 *
 * Dentro del mismo local queda recibida de inmediato. Entre locales queda en borrador:
 * no sale mercancia hasta que se despacha.
 */
export async function crearTransferencia(
  db: Db,
  entrada: EntradaTransferencia,
): Promise<TransferenciaVista> {
  return db.transaction(async (tx) => {
    const ubicaciones = new Map(
      (await listarUbicaciones(tx, entrada.empresaId)).map((ubicacion) => [ubicacion.id, ubicacion]),
    );
    const origen = ubicaciones.get(entrada.origenUbicacionId);
    const destino = ubicaciones.get(entrada.destinoUbicacionId);
    if (!origen || !destino) {
      throw new ErrorNoEncontrado('La ubicacion no existe');
    }
    if (!origen.sucursalActiva || !destino.sucursalActiva) {
      throw new ErrorDeAplicacion(
        'Una de las sucursales esta inactiva',
        409,
        'SUCURSAL_INACTIVA',
      );
    }

    const mismoLocal = origen.sucursalId === destino.sucursalId;

    const pedido = new Map<string, { cantidad: number; nombre: string }>();
    for (const linea of entrada.lineas) {
      const producto = await productoExiste(tx, entrada.empresaId, linea.productoId);
      if (!producto) {
        throw new ErrorNoEncontrado(`El producto ${linea.productoId} no existe`);
      }
      const previo = pedido.get(linea.productoId);
      pedido.set(linea.productoId, {
        cantidad: (previo?.cantidad ?? 0) + linea.cantidad,
        nombre: producto.nombre,
      });
    }

    // Aviso temprano: si el origen no tiene, no se crea. El despacho vuelve a validarlo.
    const existencias = await existenciasEnUbicacion(tx, origen.id, [...pedido.keys()]);
    const faltantes: string[] = [];
    for (const [productoId, { cantidad, nombre }] of pedido) {
      const disponible = existencias.get(productoId) ?? 0;
      if (disponible < cantidad) {
        faltantes.push(`${nombre}: hay ${disponible} y se piden ${cantidad}`);
      }
    }
    if (faltantes.length > 0) {
      throw new ErrorDeAplicacion(
        `No hay existencia suficiente en el origen. ${faltantes.join('. ')}`,
        409,
        'SIN_EXISTENCIA',
      );
    }

    const ahora = new Date();
    const folio = await siguienteFolioTransferencia(
      tx,
      origen.sucursalId,
      origen.sucursalCodigo,
      ahora,
    );
    const id = nuevoId();

    await tx.insert(schema.transfers).values({
      id,
      companyId: entrada.empresaId,
      folio,
      fromWarehouseId: origen.id,
      toWarehouseId: destino.id,
      fromBranchId: origen.sucursalId,
      toBranchId: destino.sucursalId,
      status: mismoLocal ? 'recibida' : 'borrador',
      reason: entrada.motivo ?? null,
      createdByUserId: entrada.usuarioId,
      createdAt: ahora,
      updatedAt: ahora,
      ...(mismoLocal
        ? {
            dispatchedByUserId: entrada.usuarioId,
            dispatchedAt: ahora,
            receivedByUserId: entrada.usuarioId,
            receivedAt: ahora,
          }
        : {}),
    });

    await tx.insert(schema.transferLines).values(
      entrada.lineas.map((linea) => ({
        id: nuevoId(),
        transferId: id,
        productId: linea.productoId,
        quantitySent: linea.cantidad,
        quantityReceived: mismoLocal ? linea.cantidad : null,
      })),
    );

    if (mismoLocal) {
      const transferencia = { id, folio, motivo: entrada.motivo ?? null };
      for (const linea of entrada.lineas) {
        await moverMercancia(tx, {
          empresaId: entrada.empresaId,
          usuarioId: entrada.usuarioId,
          transferencia,
          sucursalId: origen.sucursalId,
          ubicacionId: origen.id,
          productoId: linea.productoId,
          tipo: 'transferencia_salida',
          cantidad: linea.cantidad,
          ahora,
        });
        await moverMercancia(tx, {
          empresaId: entrada.empresaId,
          usuarioId: entrada.usuarioId,
          transferencia,
          sucursalId: destino.sucursalId,
          ubicacionId: destino.id,
          productoId: linea.productoId,
          tipo: 'transferencia_entrada',
          cantidad: linea.cantidad,
          ahora,
        });
      }
    }

    return cargar(tx, entrada.empresaId, id);
  });
}

/** Sale la mercancia del origen. Solo para transferencias entre locales. */
export async function despacharTransferencia(
  db: Db,
  datos: { empresaId: string; transferenciaId: string; usuarioId: string },
): Promise<TransferenciaVista> {
  return db.transaction(async (tx) => {
    const vista = await cargar(tx, datos.empresaId, datos.transferenciaId);
    exigirEstado(vista, ['borrador'], 'despachar');

    const ahora = new Date();
    const transferencia = { id: vista.id, folio: vista.folio, motivo: vista.motivo };

    for (const linea of vista.lineas) {
      await moverMercancia(tx, {
        empresaId: datos.empresaId,
        usuarioId: datos.usuarioId,
        transferencia,
        sucursalId: vista.origen.sucursalId,
        ubicacionId: vista.origen.id,
        productoId: linea.productoId,
        tipo: 'transferencia_salida',
        cantidad: linea.enviada,
        ahora,
      });
    }

    await tx
      .update(schema.transfers)
      .set({
        status: 'en_transito',
        dispatchedByUserId: datos.usuarioId,
        dispatchedAt: ahora,
        updatedAt: ahora,
        revision: sql`${schema.transfers.revision} + 1`,
      })
      .where(eq(schema.transfers.id, vista.id));

    return cargar(tx, datos.empresaId, vista.id);
  });
}

export interface LineaRecepcion {
  lineaId: string;
  cantidadRecibida: number;
}

/**
 * Confirma la recepcion en el destino. Las lineas que no se mencionan se reciben
 * completas. Si llega menos de lo enviado, queda una incidencia en la transferencia.
 */
export async function recibirTransferencia(
  db: Db,
  datos: {
    empresaId: string;
    transferenciaId: string;
    usuarioId: string;
    lineas?: LineaRecepcion[] | undefined;
  },
): Promise<TransferenciaVista> {
  return db.transaction(async (tx) => {
    const vista = await cargar(tx, datos.empresaId, datos.transferenciaId);
    exigirEstado(vista, ['en_transito'], 'recibir');

    const recibidas = new Map((datos.lineas ?? []).map((linea) => [linea.lineaId, linea.cantidadRecibida]));
    for (const lineaId of recibidas.keys()) {
      if (!vista.lineas.some((linea) => linea.id === lineaId)) {
        throw new ErrorNoEncontrado('La linea no pertenece a esta transferencia');
      }
    }

    const ahora = new Date();
    const transferencia = { id: vista.id, folio: vista.folio, motivo: vista.motivo };
    let hayIncidencia = false;

    for (const linea of vista.lineas) {
      const recibida = recibidas.get(linea.id) ?? linea.enviada;
      if (!Number.isInteger(recibida) || recibida < 0 || recibida > linea.enviada) {
        throw new ErrorDeAplicacion(
          `De ${linea.nombre} se pueden recibir de 0 a ${linea.enviada} piezas`,
          422,
          'CANTIDAD_INVALIDA',
        );
      }
      if (recibida < linea.enviada) {
        hayIncidencia = true;
      }

      if (recibida > 0) {
        await moverMercancia(tx, {
          empresaId: datos.empresaId,
          usuarioId: datos.usuarioId,
          transferencia,
          sucursalId: vista.destino.sucursalId,
          ubicacionId: vista.destino.id,
          productoId: linea.productoId,
          tipo: 'transferencia_entrada',
          cantidad: recibida,
          ahora,
        });
      }

      await tx
        .update(schema.transferLines)
        .set({ quantityReceived: recibida })
        .where(eq(schema.transferLines.id, linea.id));
    }

    await tx
      .update(schema.transfers)
      .set({
        status: 'recibida',
        hasDiscrepancy: hayIncidencia,
        receivedByUserId: datos.usuarioId,
        receivedAt: ahora,
        updatedAt: ahora,
        revision: sql`${schema.transfers.revision} + 1`,
      })
      .where(eq(schema.transfers.id, vista.id));

    return cargar(tx, datos.empresaId, vista.id);
  });
}

/** El destino no acepta la mercancia: regresa completa al origen. */
export async function rechazarTransferencia(
  db: Db,
  datos: { empresaId: string; transferenciaId: string; usuarioId: string; motivo: string },
): Promise<TransferenciaVista> {
  return db.transaction(async (tx) => {
    const vista = await cargar(tx, datos.empresaId, datos.transferenciaId);
    exigirEstado(vista, ['en_transito'], 'rechazar');

    const ahora = new Date();
    const transferencia = { id: vista.id, folio: vista.folio, motivo: vista.motivo };

    for (const linea of vista.lineas) {
      await moverMercancia(tx, {
        empresaId: datos.empresaId,
        usuarioId: datos.usuarioId,
        transferencia,
        sucursalId: vista.origen.sucursalId,
        ubicacionId: vista.origen.id,
        productoId: linea.productoId,
        tipo: 'transferencia_entrada',
        cantidad: linea.enviada,
        motivo: `Rechazada: ${datos.motivo}`,
        ahora,
      });

      await tx
        .update(schema.transferLines)
        .set({ quantityReceived: 0 })
        .where(eq(schema.transferLines.id, linea.id));
    }

    await tx
      .update(schema.transfers)
      .set({
        status: 'rechazada',
        receivedByUserId: datos.usuarioId,
        receivedAt: ahora,
        updatedAt: ahora,
        revision: sql`${schema.transfers.revision} + 1`,
      })
      .where(eq(schema.transfers.id, vista.id));

    return cargar(tx, datos.empresaId, vista.id);
  });
}

/** Solo se puede cancelar antes de despachar: despues ya salio mercancia. */
export async function cancelarTransferencia(
  db: Db,
  datos: { empresaId: string; transferenciaId: string },
): Promise<TransferenciaVista> {
  return db.transaction(async (tx) => {
    const vista = await cargar(tx, datos.empresaId, datos.transferenciaId);
    exigirEstado(vista, ['borrador'], 'cancelar');

    await tx
      .update(schema.transfers)
      .set({
        status: 'cancelada',
        updatedAt: new Date(),
        revision: sql`${schema.transfers.revision} + 1`,
      })
      .where(eq(schema.transfers.id, vista.id));

    return cargar(tx, datos.empresaId, vista.id);
  });
}
