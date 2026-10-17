import { schema } from '@mostrador/db-cloud';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorDeAutenticacion, ErrorSinPermiso } from '../errors.js';
import type { Permiso } from './permisos.js';

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

    const sucursales = await app.db
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
      permisos: new Set(filasRoles.flatMap((fila) => fila.permisos)),
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
