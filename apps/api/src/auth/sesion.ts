import { schema } from '@mostrador/db-cloud';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorDeAutenticacion, ErrorSinPermiso } from '../errors.js';
import { PERMISOS, type Permiso } from './permisos.js';

export interface SucursalSesion {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
}

export interface Sesion {
  usuarioId: string;
  empresaId: string;
  nombre: string;
  permisos: Set<string>;
  sucursales: SucursalSesion[];
}

/**
 * Carga la sesion a partir del token.
 *
 * Los permisos y las sucursales se leen frescos de la base en cada peticion, no
 * del token: asi, revocar un permiso o el acceso a una sucursal tiene efecto
 * inmediato, sin esperar a que expire la sesion.
 */
export function exigirSesion(app: FastifyInstance) {
  const { users, roles, userRoles, branches, userBranchAccess } = schema;

  return async function cargarSesion(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    await request.jwtVerify();

    const [usuario] = await app.db
      .select()
      .from(users)
      .where(and(eq(users.id, request.user.sub), isNull(users.deletedAt)))
      .limit(1);

    if (!usuario || !usuario.active) {
      throw new ErrorDeAutenticacion('La sesion ya no es valida');
    }

    const filasRoles = await app.db
      .select({ permisos: roles.permissions })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, usuario.id));

    const permisos = new Set(filasRoles.flatMap((fila) => fila.permisos));
    // El administrador gestiona todo el negocio: no depende de una asignacion
    // expresa de sucursales. Los demas roles si quedan limitados a las suyas.
    const accesoATodo =
      permisos.has(PERMISOS.GESTIONAR_SUCURSALES) || permisos.has(PERMISOS.GESTIONAR_USUARIOS);

    const sucursales = accesoATodo
      ? await app.db
          .select({
            id: branches.id,
            codigo: branches.code,
            nombre: branches.name,
            tipo: branches.type,
          })
          .from(branches)
          .where(
            and(
              eq(branches.companyId, usuario.companyId),
              isNull(branches.deletedAt),
              eq(branches.active, true),
            ),
          )
          .orderBy(asc(branches.name))
      : await app.db
          .select({
            id: branches.id,
            codigo: branches.code,
            nombre: branches.name,
            tipo: branches.type,
          })
          .from(userBranchAccess)
          .innerJoin(branches, eq(branches.id, userBranchAccess.branchId))
          .where(
            and(
              eq(userBranchAccess.userId, usuario.id),
              isNull(branches.deletedAt),
              eq(branches.active, true),
            ),
          );

    request.sesion = {
      usuarioId: usuario.id,
      empresaId: usuario.companyId,
      nombre: usuario.fullName,
      permisos,
      sucursales,
    };
  };
}

export function sesionDe(request: FastifyRequest): Sesion {
  if (!request.sesion) {
    throw new ErrorDeAutenticacion('Falta cargar la sesion');
  }
  return request.sesion;
}

/** Lanza un error si la sesion no tiene el permiso indicado. */
export function asegurarPermiso(sesion: Sesion, permiso: Permiso): void {
  if (!sesion.permisos.has(permiso)) {
    throw new ErrorSinPermiso(`Te falta el permiso: ${permiso}`);
  }
}

/** Lanza un error si la sesion no puede operar en esa sucursal. */
export function asegurarSucursal(sesion: Sesion, sucursalId: string): void {
  if (!sesion.sucursales.some((sucursal) => sucursal.id === sucursalId)) {
    throw new ErrorSinPermiso('No tienes acceso a esa sucursal');
  }
}

/**
 * Costos, margenes y utilidad.
 *
 * La app del vendedor nunca debe recibirlos: si el telefono se pierde, no se
 * lleva cuanto cuesta la mercancia ni el margen del negocio. Solo los ven la
 * administracion, el almacen y la contabilidad.
 */
export function puedeVerCostos(sesion: Sesion): boolean {
  return (
    sesion.permisos.has(PERMISOS.VER_UTILIDAD) ||
    sesion.permisos.has(PERMISOS.GESTIONAR_CATALOGO) ||
    sesion.permisos.has(PERMISOS.AJUSTAR_INVENTARIO)
  );
}
