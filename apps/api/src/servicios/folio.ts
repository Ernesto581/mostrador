import { schema } from '@mostrador/db-cloud';
import { generarFolio } from '@mostrador/domain';
import { and, count, eq, gte, lt } from 'drizzle-orm';
import type { BaseDatos } from '../db/tipos.js';
import { ErrorNoEncontrado } from '../errors.js';

async function codigoDeSucursal(base: BaseDatos, sucursalId: string): Promise<string> {
  const [sucursal] = await base
    .select({ codigo: schema.branches.code })
    .from(schema.branches)
    .where(eq(schema.branches.id, sucursalId))
    .limit(1);

  if (!sucursal) {
    throw new ErrorNoEncontrado('La sucursal no existe');
  }
  return sucursal.codigo;
}

function rangoDelDia(fecha: Date): { inicio: Date; siguiente: Date } {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  const siguiente = new Date(inicio);
  siguiente.setDate(siguiente.getDate() + 1);
  return { inicio, siguiente };
}

/**
 * Siguiente folio de venta del dia para una sucursal.
 *
 * Cada sucursal numera de forma independiente (`CODIGO-AAAAMMDD-0001`), asi que dos
 * sucursales nunca chocan aunque trabajen sin conexion. Cuando el folio lo genera el
 * celular, el servidor respeta el que le manden.
 */
export async function siguienteFolioVenta(
  base: BaseDatos,
  sucursalId: string,
  fecha: Date,
): Promise<string> {
  const codigo = await codigoDeSucursal(base, sucursalId);
  const { inicio, siguiente } = rangoDelDia(fecha);

  const filas = await base
    .select({ total: count() })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.branchId, sucursalId),
        gte(schema.sales.soldAt, inicio),
        lt(schema.sales.soldAt, siguiente),
      ),
    );

  return generarFolio({
    codigoSucursal: codigo,
    fecha,
    consecutivo: Number(filas[0]?.total ?? 0) + 1,
  });
}

/** Siguiente folio de devolucion del dia para una sucursal. */
export async function siguienteFolioDevolucion(
  base: BaseDatos,
  sucursalId: string,
  fecha: Date,
): Promise<string> {
  const codigo = await codigoDeSucursal(base, sucursalId);
  const { inicio, siguiente } = rangoDelDia(fecha);

  const filas = await base
    .select({ total: count() })
    .from(schema.returns)
    .where(
      and(
        eq(schema.returns.branchId, sucursalId),
        gte(schema.returns.createdAt, inicio),
        lt(schema.returns.createdAt, siguiente),
      ),
    );

  return `DEV-${generarFolio({
    codigoSucursal: codigo,
    fecha,
    consecutivo: Number(filas[0]?.total ?? 0) + 1,
  })}`;
}
