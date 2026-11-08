import { schema, type Db } from '@mostrador/db-cloud';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { ErrorDeAplicacion, ErrorNoEncontrado } from '../../errors.js';
import { nuevoId } from '../../util/id.js';

export type TipoMovimientoCaja = 'ingreso' | 'retiro' | 'gasto';

export interface Turno {
  id: string;
  sucursalId: string;
  abiertoPor: string;
  abiertoEn: Date;
  cerradoEn: Date | null;
  fondoInicial: number;
  estado: string;
  notas: string | null;
}

export interface ResumenTurno {
  turno: Turno;
  ventas: {
    cantidad: number;
    articulos: number;
    total: number;
    cambio: number;
    ventaNeta: number;
    impuestos: number;
    descuentos: number;
  };
  porMetodo: Record<string, number>;
  movimientos: { ingresos: number; retiros: number; gastos: number };
  /** Devoluciones hechas durante el turno. Las pagadas en efectivo salen de la caja. */
  devoluciones: { cantidad: number; efectivo: number };
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

/** Turno por id, para comprobar su sucursal antes de operar sobre el. */
export async function obtenerTurno(base: BaseDatos, turnoId: string): Promise<Turno> {
  return turnoPorId(base, turnoId);
}

function aTurno(fila: typeof schema.shifts.$inferSelect): Turno {
  return {
    id: fila.id,
    sucursalId: fila.branchId,
    abiertoPor: fila.openedByUserId,
    abiertoEn: fila.openedAt,
    cerradoEn: fila.closedAt,
    fondoInicial: fila.initialCash,
    estado: fila.status,
    notas: fila.notes,
  };
}

/** Un turno no puede quedar abierto mas de un dia. */
export const HORAS_MAXIMAS_TURNO = 24;
export const MS_MAXIMO_TURNO = HORAS_MAXIMAS_TURNO * 60 * 60 * 1000;

/**
 * Turno abierto de la sucursal, si lo hay.
 *
 * Si el turno ya supero las 24 horas se cierra automaticamente con el efectivo
 * esperado, para que la caja no quede abierta indefinidamente. El cierre queda
 * en el historial con una nota que explica que fue automatico.
 */
export async function turnoAbierto(db: Db, sucursalId: string): Promise<Turno | null> {
  const [fila] = await db
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

  if (!fila) {
    return null;
  }

  const turno = aTurno(fila);
  if (Date.now() - turno.abiertoEn.getTime() >= MS_MAXIMO_TURNO) {
    await cerrarTurnoVencido(db, turno);
    return null;
  }

  return turno;
}

async function cerrarTurnoVencido(db: Db, turno: Turno): Promise<void> {
  const resumen = await resumenTurno(db, turno.id);
  await cerrarTurno(db, {
    turnoId: turno.id,
    usuarioId: turno.abiertoPor,
    contado: resumen.efectivoEsperado,
    notas: `Cierre automatico: el turno supero las ${HORAS_MAXIMAS_TURNO} horas`,
  });
}

/** Cierra los turnos vencidos de las sucursales indicadas. */
export async function cerrarTurnosVencidos(
  db: Db,
  empresaId: string,
  sucursalIds?: string[],
): Promise<void> {
  if (sucursalIds && sucursalIds.length === 0) {
    return;
  }

  const corte = new Date(Date.now() - MS_MAXIMO_TURNO);
  const filas = await db
    .select({ id: schema.shifts.id })
    .from(schema.shifts)
    .innerJoin(schema.branches, eq(schema.branches.id, schema.shifts.branchId))
    .where(
      and(
        eq(schema.branches.companyId, empresaId),
        eq(schema.shifts.status, 'abierto'),
        isNull(schema.shifts.deletedAt),
        lt(schema.shifts.openedAt, corte),
        ...(sucursalIds ? [inArray(schema.shifts.branchId, sucursalIds)] : []),
      ),
    );

  for (const fila of filas) {
    const turno = await turnoPorId(db, fila.id);
    await cerrarTurnoVencido(db, turno);
  }
}

/**
 * Cuenta como esta la caja del turno.
 *
 * El efectivo esperado es: fondo inicial + lo cobrado en efectivo − el cambio entregado
 * + ingresos − retiros − gastos pagados de la caja − devoluciones pagadas en efectivo.
 */
export async function resumenTurno(base: BaseDatos, turnoId: string): Promise<ResumenTurno> {
  const turno = await turnoPorId(base, turnoId);

  const [ventas] = await base
    .select({
      cantidad: sql<number>`count(*)::int`,
      articulos: sql<number>`coalesce(sum(${schema.sales.itemCount}), 0)::int`,
      total: sql<number>`coalesce(sum(${schema.sales.total}), 0)::int`,
      cambio: sql<number>`coalesce(sum(${schema.sales.changeGiven}), 0)::int`,
      ventaNeta: sql<number>`coalesce(sum(${schema.sales.subtotal}), 0)::int`,
      impuestos: sql<number>`coalesce(sum(${schema.sales.taxTotal}), 0)::int`,
      descuentos: sql<number>`coalesce(sum(${schema.sales.discountTotal}), 0)::int`,
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

  // Devoluciones de la sucursal hechas mientras el turno estuvo abierto.
  const [devueltas] = await base
    .select({
      cantidad: sql<number>`count(*)::int`,
      efectivo: sql<number>`coalesce(sum(case when ${schema.returns.refundMethod} = 'efectivo' then ${schema.returns.total} else 0 end), 0)::int`,
    })
    .from(schema.returns)
    .where(
      and(
        eq(schema.returns.branchId, turno.sucursalId),
        gte(schema.returns.createdAt, turno.abiertoEn),
        turno.cerradoEn ? lte(schema.returns.createdAt, turno.cerradoEn) : undefined,
        isNull(schema.returns.deletedAt),
      ),
    );

  const devoluciones = {
    cantidad: Number(devueltas?.cantidad ?? 0),
    efectivo: Number(devueltas?.efectivo ?? 0),
  };

  const efectivoEsperado =
    turno.fondoInicial +
    (porMetodo.efectivo ?? 0) -
    Number(ventas?.cambio ?? 0) +
    movimientos.ingresos -
    movimientos.retiros -
    movimientos.gastos -
    devoluciones.efectivo;

  return {
    turno,
    ventas: {
      cantidad: Number(ventas?.cantidad ?? 0),
      articulos: Number(ventas?.articulos ?? 0),
      total: Number(ventas?.total ?? 0),
      cambio: Number(ventas?.cambio ?? 0),
      ventaNeta: Number(ventas?.ventaNeta ?? 0),
      impuestos: Number(ventas?.impuestos ?? 0),
      descuentos: Number(ventas?.descuentos ?? 0),
    },
    porMetodo,
    movimientos,
    devoluciones,
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

  // De la caja no se puede sacar mas de lo que hay.
  if (datos.tipo !== 'ingreso') {
    const resumen = await resumenTurno(db, datos.turnoId);
    if (datos.monto > resumen.efectivoEsperado) {
      throw new ErrorDeAplicacion(
        `En la caja hay ${(resumen.efectivoEsperado / 100).toFixed(2)} y se intentan sacar ${(datos.monto / 100).toFixed(2)}`,
        409,
        'CAJA_INSUFICIENTE',
      );
    }
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
  /** Sucursales a las que la sesion tiene acceso. Vacio = ninguna. */
  sucursalIds?: string[] | undefined;
  desde?: Date | undefined;
  hasta?: Date | undefined;
  limite?: number | undefined;
}

export async function listarCierres(base: BaseDatos, filtro: FiltroCierres) {
  // La tabla de cierres no guarda la empresa: se filtra por la sucursal, que si la tiene.
  const condiciones = [eq(schema.branches.companyId, filtro.empresaId)];

  if (filtro.sucursalId) {
    condiciones.push(eq(schema.cashClosures.branchId, filtro.sucursalId));
  } else if (filtro.sucursalIds) {
    if (filtro.sucursalIds.length === 0) {
      return [];
    }
    condiciones.push(inArray(schema.cashClosures.branchId, filtro.sucursalIds));
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

export interface DetalleCierre {
  cierre: {
    id: string;
    alcance: string;
    fecha: string;
    sucursalId: string;
    sucursal: string;
    ventasTotal: number;
    esperado: number;
    contado: number;
    diferencia: number;
    cerradoEn: Date;
    cerradoPor: string;
    notas: string | null;
  };
  turno: Turno | null;
  turnoAbiertoPor: string | null;
  resumen: ResumenTurno | null;
  ventas: {
    id: string;
    folio: string;
    vendidoEn: Date;
    total: number;
    estado: string;
    articulos: number;
    cambio: number;
    pagos: { metodo: string; monto: number }[];
  }[];
  productos: {
    productoId: string | null;
    nombre: string;
    sku: string | null;
    cantidad: number;
    venta: number;
    costo: number;
  }[];
  movimientos: {
    id: string;
    tipo: string;
    monto: number;
    motivo: string | null;
    ocurridoEn: Date;
    usuario: string | null;
  }[];
  devoluciones: {
    id: string;
    folio: string;
    motivo: string | null;
    total: number;
    metodo: string | null;
    creadoEn: Date;
  }[];
}

/**
 * Detalle de un cierre: turno, ventas, productos, pagos, movimientos de caja y
 * devoluciones. Es lo que se consulta al abrir un cierre del historial.
 */
export async function detalleCierre(
  base: BaseDatos,
  empresaId: string,
  cierreId: string,
): Promise<DetalleCierre> {
  const [fila] = await base
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
      turnoId: schema.cashClosures.shiftId,
    })
    .from(schema.cashClosures)
    .innerJoin(schema.branches, eq(schema.branches.id, schema.cashClosures.branchId))
    .innerJoin(schema.users, eq(schema.users.id, schema.cashClosures.closedByUserId))
    .where(
      and(
        eq(schema.cashClosures.id, cierreId),
        eq(schema.branches.companyId, empresaId),
        isNull(schema.branches.deletedAt),
      ),
    )
    .limit(1);

  if (!fila) {
    throw new ErrorNoEncontrado('El cierre no existe');
  }

  const cierre = {
    id: fila.id,
    alcance: fila.alcance,
    fecha: fila.fecha,
    sucursalId: fila.sucursalId,
    sucursal: fila.sucursal,
    ventasTotal: fila.ventasTotal,
    esperado: fila.esperado,
    contado: fila.contado,
    diferencia: fila.diferencia,
    cerradoEn: fila.cerradoEn,
    cerradoPor: fila.cerradoPor,
    notas: fila.notas,
  };

  const turno = fila.turnoId ? await turnoPorId(base, fila.turnoId) : null;
  if (!turno) {
    return {
      cierre,
      turno: null,
      turnoAbiertoPor: null,
      resumen: null,
      ventas: [],
      productos: [],
      movimientos: [],
      devoluciones: [],
    };
  }

  const [apertura] = await base
    .select({ nombre: schema.users.fullName })
    .from(schema.users)
    .where(eq(schema.users.id, turno.abiertoPor))
    .limit(1);

  const resumen = await resumenTurno(base, turno.id);

  const ventas = await base
    .select({
      id: schema.sales.id,
      folio: schema.sales.folio,
      vendidoEn: schema.sales.soldAt,
      total: schema.sales.total,
      estado: schema.sales.status,
      articulos: schema.sales.itemCount,
      cambio: schema.sales.changeGiven,
    })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.shiftId, turno.id),
        eq(schema.sales.status, 'completada'),
        isNull(schema.sales.deletedAt),
      ),
    )
    .orderBy(asc(schema.sales.soldAt));

  const pagos = await base
    .select({
      saleId: schema.salePayments.saleId,
      metodo: schema.salePayments.method,
      monto: schema.salePayments.amount,
    })
    .from(schema.salePayments)
    .innerJoin(schema.sales, eq(schema.sales.id, schema.salePayments.saleId))
    .where(
      and(
        eq(schema.sales.shiftId, turno.id),
        eq(schema.sales.status, 'completada'),
        isNull(schema.sales.deletedAt),
      ),
    );

  const pagosPorVenta = new Map<string, { metodo: string; monto: number }[]>();
  for (const pago of pagos) {
    const lista = pagosPorVenta.get(pago.saleId) ?? [];
    lista.push({ metodo: pago.metodo, monto: pago.monto });
    pagosPorVenta.set(pago.saleId, lista);
  }

  const productos = await base
    .select({
      productoId: schema.saleLines.productId,
      nombre: schema.saleLines.name,
      sku: schema.saleLines.sku,
      cantidad: sql<number>`sum(${schema.saleLines.quantity})::int`,
      venta: sql<number>`sum(${schema.saleLines.total})::int`,
      costo: sql<number>`sum(${schema.saleLines.quantity} * ${schema.saleLines.unitCost})::int`,
    })
    .from(schema.saleLines)
    .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
    .where(
      and(
        eq(schema.sales.shiftId, turno.id),
        eq(schema.sales.status, 'completada'),
        isNull(schema.sales.deletedAt),
      ),
    )
    .groupBy(schema.saleLines.productId, schema.saleLines.name, schema.saleLines.sku)
    .orderBy(desc(sql`sum(${schema.saleLines.total})`));

  const movimientos = await base
    .select({
      id: schema.cashMovements.id,
      tipo: schema.cashMovements.type,
      monto: schema.cashMovements.amount,
      motivo: schema.cashMovements.reason,
      ocurridoEn: schema.cashMovements.occurredAt,
      usuario: schema.users.fullName,
    })
    .from(schema.cashMovements)
    .leftJoin(schema.users, eq(schema.users.id, schema.cashMovements.userId))
    .where(
      and(
        eq(schema.cashMovements.shiftId, turno.id),
        isNull(schema.cashMovements.deletedAt),
      ),
    )
    .orderBy(asc(schema.cashMovements.occurredAt));

  const devoluciones = await base
    .select({
      id: schema.returns.id,
      folio: schema.returns.folio,
      motivo: schema.returns.reason,
      total: schema.returns.total,
      metodo: schema.returns.refundMethod,
      creadoEn: schema.returns.createdAt,
    })
    .from(schema.returns)
    .where(
      and(
        eq(schema.returns.companyId, empresaId),
        eq(schema.returns.branchId, fila.sucursalId),
        gte(schema.returns.createdAt, turno.abiertoEn),
        ...(turno.cerradoEn ? [lte(schema.returns.createdAt, turno.cerradoEn)] : []),
        isNull(schema.returns.deletedAt),
      ),
    )
    .orderBy(asc(schema.returns.createdAt));

  return {
    cierre,
    turno,
    turnoAbiertoPor: apertura?.nombre ?? null,
    resumen,
    ventas: ventas.map((venta) => ({
      ...venta,
      pagos: pagosPorVenta.get(venta.id) ?? [],
    })),
    productos: productos.map((filaProducto) => ({
      ...filaProducto,
      cantidad: Number(filaProducto.cantidad),
      venta: Number(filaProducto.venta),
      costo: Number(filaProducto.costo),
    })),
    movimientos: movimientos.map((movimiento) => ({
      ...movimiento,
      monto: Number(movimiento.monto),
    })),
    devoluciones: devoluciones.map((devolucion) => ({
      ...devolucion,
      total: Number(devolucion.total),
    })),
  };
}

/** Turnos abiertos de las sucursales a las que la sesion tiene acceso. */
export async function turnosAbiertos(
  base: BaseDatos,
  empresaId: string,
  sucursalIds?: string[],
) {
  if (sucursalIds && sucursalIds.length === 0) {
    return [];
  }

  const condiciones = [
    eq(schema.branches.companyId, empresaId),
    eq(schema.shifts.status, 'abierto'),
    isNull(schema.shifts.deletedAt),
  ];

  if (sucursalIds) {
    condiciones.push(inArray(schema.shifts.branchId, sucursalIds));
  }

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
    .where(and(...condiciones))
    .orderBy(asc(schema.branches.code));
}
