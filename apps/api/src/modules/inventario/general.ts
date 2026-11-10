import { schema } from '@mostrador/db-cloud';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { nuevoId } from '../../util/id.js';

/**
 * Deposito general.
 *
 * Es una sucursal oculta donde vive la mercancia que todavia no se ha asignado
 * a un punto de venta. No aparece en Sucursales ni en los selectores: el
 * administrador la usa desde Movimientos para repartir la mercancia.
 */
export const CODIGO_SUCURSAL_GENERAL = 'GENERAL';
export const NOMBRE_SUCURSAL_GENERAL = 'Inventario general';

export interface SucursalGeneral {
  sucursalId: string;
  almacenId: string;
}

/** Busca el deposito general sin crearlo. Devuelve null si la empresa aun no lo tiene. */
export async function buscarSucursalGeneral(
  base: BaseDatos,
  empresaId: string,
): Promise<SucursalGeneral | null> {
  const { branches, warehouses } = schema;

  const [sucursal] = await base
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.companyId, empresaId),
        eq(branches.code, CODIGO_SUCURSAL_GENERAL),
        isNull(branches.deletedAt),
      ),
    )
    .limit(1);

  if (!sucursal) {
    return null;
  }

  const [almacen] = await base
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.branchId, sucursal.id), isNull(warehouses.deletedAt)))
    .orderBy(asc(warehouses.createdAt))
    .limit(1);

  if (almacen) {
    return { sucursalId: sucursal.id, almacenId: almacen.id };
  }

  // Repara el caso raro de una sucursal general sin almacen.
  const almacenId = nuevoId();
  await base.insert(warehouses).values({
    id: almacenId,
    branchId: sucursal.id,
    code: 'GENERAL',
    name: NOMBRE_SUCURSAL_GENERAL,
    kind: 'almacen',
  });

  return { sucursalId: sucursal.id, almacenId };
}

/** Devuelve el deposito general y lo crea la primera vez que hace falta. */
export async function obtenerSucursalGeneral(
  base: BaseDatos,
  empresaId: string,
): Promise<SucursalGeneral> {
  const existente = await buscarSucursalGeneral(base, empresaId);
  if (existente) {
    return existente;
  }

  const { branches } = schema;
  await base
    .insert(branches)
    .values({
      id: nuevoId(),
      companyId: empresaId,
      code: CODIGO_SUCURSAL_GENERAL,
      name: NOMBRE_SUCURSAL_GENERAL,
      type: 'almacen',
      active: true,
    })
    .onConflictDoNothing();

  const creado = await buscarSucursalGeneral(base, empresaId);
  if (!creado) {
    throw new Error('No se pudo preparar el inventario general');
  }
  return creado;
}
