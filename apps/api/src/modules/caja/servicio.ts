import { schema, type Db } from '@mostrador/db-cloud';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { ErrorDeAplicacion, ErrorNoEncontrado } from '../../errors.js';
import { nuevoId } from '../../util/id.js';

export type TipoMovimientoCaja = 'ingreso' | 'retiro' | 'gasto';

export interface Turno {
  id: string;
  sucursalId: string;
  abiertoPor: string;
  abiertoEn: Date;
  fondoInicial: number;
  estado: string;
  notas: string | null;
}

export interface ResumenTurno {
  turno: Turno;
  ventas: { cantidad: number; articulos: number; total: number; cambio: number };
  porMetodo: Record<string, number>;
  movimientos: { ingresos: number; retiros: number; gastos: number };
  efectivoEsperado: number;
}

/**
 * Abre el turno de una sucursal.
 *
 * Hay UN turno abierto por sucursal: la caja es comun. El turno guarda quien lo abrio,
 * quien lo cerro y con cuanto fondo empezo, para poder cuadrar despues.
 */
export async function abrirTurno(
  db: Db,
  datos: {
    empresaId: string;
    sucursalId: string;
    usuarioId: string;
    fondoInicial: number;
    cajaId?: string | undefined;
    dispositivoId?: string | undefined;
    notas?: string | undefined;
  },
): Promise<Turno> {
  const abierto = await turnoAbierto(db, datos.sucursalId);
  if (abierto) {
    throw new ErrorDeAplicacion(
      'Ya hay un turno abierto en esta sucursal. Cierralo antes de abrir otro.',
      409,
      'TURNO_YA_ABIERTO',
    );
  }

  const id = nuevoId();
  const abiertoEn = new Date();

  await db.insert(schema.shifts).values({
    id,
    branchId: datos.sucursalId,
    cashRegisterId: datos.cajaId ?? null,
    deviceId: datos.dispositivoId ?? null,
    openedByUserId: datos.usuarioId,
    openedAt: abiertoEn,
    initialCash: datos.fondoInicial,
    status: 'abierto',
    notes: datos.notas ?? null,
  });

  const turno = await turnoPorId(db, id);
  return turno;
}

async function turnoPorId(base: BaseDatos, turnoId: string): Promise<Turno> {
  const [fila] = await base
    .select()
    .from(schema.shifts)
    .where(eq(schema.shifts.id, turnoId))
    .limit(1);

  if (!fila) {
    throw new ErrorNoEncontrado('El turno no existe');
  }

  return aTurno(fila);
}

function aTurno(fila: typeof schema.shifts.$inferSelect): Turno {
  return {
    id: fila.id,
    sucursalId: fila.branchId,
    abiertoPor: fila.openedByUserId,
    abiertoEn: fila.openedAt,
    fondoInicial: fila.initialCash,
    estado: fila.status,
    notas: fila.notes,
  };
}

/** Turno abierto de la sucursal, si lo hay. */
export async function turnoAbierto(base: BaseDatos, sucursalId: string): Promise<Turno | null> {
  const [fila] = await base
    .select()
    .from(schema.shifts)
    .where(
      and(
        eq(schema.shifts.branchId, sucursalId),
        eq(schema.shifts.status, 'abierto'),
        isNull(schema.shifts.deletedAt),
      ),
    )
    .orderBy(desc(schema.shifts.openedAt))
    .limit(1);

  return fila ? aTurno(fila) : null;
}

/**
 * Cuenta como esta la caja del turno.
 *
 * El efectivo esperado es: fondo inicial + lo cobrado en efectivo − el cambio entregado
 * + ingresos − retiros − gastos pagados de la caja.
 */
export async function resumenTurno(base: BaseDatos, turnoId: string): Promise<ResumenTurno> {
  const turno = await turnoPorId(base, turnoId);

  const [ventas] = await base
    .select({
      cantidad: sql<number>`count(*)::int`,
      articulos: sql<number>`coalesce(sum(${schema.sales.itemCount}), 0)::int`,
      total: sql<number>`coalesce(sum(${schema.sales.total}), 0)::int`,
      cambio: sql<number>`coalesce(sum(${schema.sales.changeGiven}), 0)::int`,
    })
    .from(schema.sales)
    .where(and(eq(schema.sales.shiftId, turnoId), eq(schema.sales.status, 'completada')));

  const filasPagos = await base
    .select({
      metodo: schema.salePayments.method,
      monto: sql<number>`coalesce(sum(${schema.salePayments.amount}), 0)::int`,
    })
    .from(schema.salePayments)
    .innerJoin(schema.sales, eq(schema.sales.id, schema.salePayments.saleId))
    .where(and(eq(schema.sales.shiftId, turnoId), eq(schema.sales.status, 'completada')))
    .groupBy(schema.salePayments.method);

  const porMetodo: Record<string, number> = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const fila of filasPagos) {
    porMetodo[fila.metodo] = Number(fila.monto);
  }

  const filasMovimientos = await base
    .select({
      tipo: schema.cashMovements.type,
      monto: sql<number>`coalesce(sum(${schema.cashMovements.amount}), 0)::int`,
    })
    .from(schema.cashMovements)
    .where(eq(schema.cashMovements.shiftId, turnoId))
    .groupBy(schema.cashMovements.type);

  const movimientos = { ingresos: 0, retiros: 0, gastos: 0 };
  for (const fila of filasMovimientos) {
    if (fila.tipo === 'ingreso') {
      movimientos.ingresos = Number(fila.monto);
    } else if (fila.tipo === 'retiro') {
      movimientos.retiros = Number(fila.monto);
    } else if (fila.tipo === 'gasto') {
      movimientos.gastos = Number(fila.monto);
    }
  }

  const efectivoEsperado =
    turno.fondoInicial +
    (porMetodo.efectivo ?? 0) -
    Number(ventas?.cambio ?? 0) +
    movimientos.ingresos -
    movimientos.retiros -
    movimientos.gastos;

  return {
    turno,
    ventas: {
      cantidad: Number(ventas?.cantidad ?? 0),
      articulos: Number(ventas?.articulos ?? 0),
      total: Number(ventas?.total ?? 0),
      cambio: Number(ventas?.cambio ?? 0),
    },
    porMetodo,
    movimientos,
    efectivoEsperado,
  };
}

/** Movimiento de efectivo: ingreso, retiro o gasto pagado de la caja. */
export async function registrarMovimientoCaja(
  db: Db,
  datos: {
    empresaId: string;
    sucursalId: string;
    turnoId: string;
    tipo: TipoMovimientoCaja;
    monto: number;
    motivo: string;
    usuarioId: string;
  },
) {
  if (datos.monto <= 0) {
    throw new ErrorDeAplicacion('El monto debe ser mayor a cero', 422, 'MONTO_INVALIDO');
  }

  const turno = await turnoPorId(db, datos.turnoId);
  if (turno.estado !== 'abierto') {
    throw new ErrorDeAplicacion('El turno ya esta cerrado', 409, 'TURNO_CERRADO');
  }
  if (turno.sucursalId !== datos.sucursalId) {
    throw new ErrorDeAplicacion('El turno no es de esa sucursal', 422, 'TURNO_AJENO');
  }

  const id = nuevoId();
  await db.insert(schema.cashMovements).values({
    id,
    branchId: datos.sucursalId,
    shiftId: datos.turnoId,
    type: datos.tipo,
    amount: datos.monto,
    reason: datos.motivo,
    userId: datos.usuarioId,
    occurredAt: new Date(),
  });

  return { id, tipo: datos.tipo, monto: datos.monto };
}

/**
 * Cierra el turno con el arqueo.
 *
 * Se guarda lo esperado, lo contado y la diferencia: esa diferencia es la que hay que
 * explicar, y queda registrada con nombre y fecha.
 */
export async function cerrarTurno(
  db: Db,
  datos: {
    empresaId: string;
    turnoId: string;
    usuarioId: string;
    contado: number;
    notas?: string | undefined;
  },
) {
  return db.transaction(async (tx) => {
    const turno = await turnoPorId(tx, datos.turnoId);

    if (turno.estado !== 'abierto') {
      throw new ErrorDeAplicacion('El turno ya estaba cerrado', 409, 'TURNO_CERRADO');
    }

    const resumen = await resumenTurno(tx, datos.turnoId);
    const diferencia = datos.contado - resumen.efectivoEsperado;
    const cerradoEn = new Date();
    const id = nuevoId();

    const [dia] = cerradoEn.toISOString().split('T');

    await tx.insert(schema.cashClosures).values({
      id,
      branchId: turno.sucursalId,
      scope: 'turno',
      shiftId: datos.turnoId,
      date: dia ?? cerradoEn.toISOString().slice(0, 10),
      salesTotal: resumen.ventas.total,
      expectedCash: resumen.efectivoEsperado,
      countedCash: datos.contado,
      difference: diferencia,
      closedByUserId: datos.usuarioId,
      closedAt: cerradoEn,
      notes: datos.notas ?? null,
    });

    await tx
      .update(schema.shifts)
      .set({
        status: 'cerrado',
        closedByUserId: datos.usuarioId,
        closedAt: cerradoEn,
        updatedAt: cerradoEn,
        revision: sql`${schema.shifts.revision} + 1`,
      })
      .where(eq(schema.shifts.id, datos.turnoId));

    return {
      cierre: {
        id,
        folio: `CIERRE-${(dia ?? '').replace(/-/g, '')}-${datos.turnoId.slice(-4).toUpperCase()}`,
        esperado: resumen.efectivoEsperado,
        contado: datos.contado,
        diferencia,
      },
      resumen,
    };
  });
}

export interface FiltroCierres {
  empresaId: string;
  sucursalId?: string | undefined;
  desde?: Date | undefined;
  hasta?: Date | undefined;
  limite?: number | undefined;
}

export async function listarCierres(base: BaseDatos, filtro: FiltroCierres) {
  // La tabla de cierres no guarda la empresa: se filtra por la sucursal, que si la tiene.
  const condiciones = [eq(schema.branches.companyId, filtro.empresaId)];

  if (filtro.sucursalId) {
    condiciones.push(eq(schema.cashClosures.branchId, filtro.sucursalId));
  }
  if (filtro.desde) {
    condiciones.push(gte(schema.cashClosures.closedAt, filtro.desde));
  }
  if (filtro.hasta) {
    condiciones.push(lte(schema.cashClosures.closedAt, filtro.hasta));
  }

  return base
    .select({
      id: schema.cashClosures.id,
      alcance: schema.cashClosures.scope,
      fecha: schema.cashClosures.date,
      sucursalId: schema.cashClosures.branchId,
      sucursal: schema.branches.code,
      ventasTotal: schema.cashClosures.salesTotal,
      esperado: schema.cashClosures.expectedCash,
      contado: schema.cashClosures.countedCash,
      diferencia: schema.cashClosures.difference,
      cerradoEn: schema.cashClosures.closedAt,
      cerradoPor: schema.users.fullName,
      notas: schema.cashClosures.notes,
    })
    .from(schema.cashClosures)
    .innerJoin(schema.branches, eq(schema.branches.id, schema.cashClosures.branchId))
    .innerJoin(schema.users, eq(schema.users.id, schema.cashClosures.closedByUserId))
    .where(and(...condiciones))
    .orderBy(desc(schema.cashClosures.closedAt))
    .limit(filtro.limite ?? 60);
}

/** Turnos abiertos de toda la empresa (para ver quien tiene caja abierta). */
export async function turnosAbiertos(base: BaseDatos, empresaId: string) {
  return base
    .select({
      id: schema.shifts.id,
      sucursalId: schema.shifts.branchId,
      sucursal: schema.branches.code,
      abiertoEn: schema.shifts.openedAt,
      fondoInicial: schema.shifts.initialCash,
      abiertoPor: schema.users.fullName,
    })
    .from(schema.shifts)
    .innerJoin(schema.branches, eq(schema.branches.id, schema.shifts.branchId))
    .innerJoin(schema.users, eq(schema.users.id, schema.shifts.openedByUserId))
    .where(
      and(
        eq(schema.branches.companyId, empresaId),
        eq(schema.shifts.status, 'abierto'),
        isNull(schema.shifts.deletedAt),
      ),
    )
    .orderBy(asc(schema.branches.code));
}
