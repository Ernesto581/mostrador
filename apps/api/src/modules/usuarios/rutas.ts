import { schema } from '@mostrador/db-cloud';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashearSecreto } from '../../auth/password.js';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { ErrorDeAplicacion, ErrorNoEncontrado, validar } from '../../errors.js';
import { nuevoId } from '../../util/id.js';

const esquemaCrear = z.object({
  username: z.string().trim().min(3, 'El usuario necesita al menos 3 caracteres').max(40),
  nombre: z.string().trim().min(1, 'Escribe el nombre completo').max(120),
  password: z.string().min(8, 'La contrasena necesita al menos 8 caracteres').max(200),
  email: z.string().trim().email('Correo invalido').max(160).optional(),
  /** Codigo del rol: administrador, cajero, almacenista o contador. */
  rol: z.string().min(1, 'Elige un rol'),
  sucursalIds: z.array(z.string().min(1)).min(1, 'Asigna al menos una sucursal'),
});

const esquemaEditar = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email('Correo invalido').max(160).optional(),
  activo: z.boolean().optional(),
  rol: z.string().min(1).optional(),
  sucursalIds: z.array(z.string().min(1)).min(1).optional(),
});

const esquemaPassword = z.object({
  password: z.string().min(8, 'La contrasena necesita al menos 8 caracteres').max(200),
});

const parametroId = z.object({ id: z.string().min(1) });

export async function rutasUsuarios(app: FastifyInstance) {
  const preHandler = exigirSesion(app);
  const { users, roles, userRoles, branches, userBranchAccess } = schema;

  /** Sucursales de una empresa, para el formulario. */
  app.get('/branches', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const lista = await app.db
      .select({
        id: branches.id,
        codigo: branches.code,
        nombre: branches.name,
        tipo: branches.type,
      })
      .from(branches)
      .where(and(eq(branches.companyId, sesion.empresaId), isNull(branches.deletedAt)))
      .orderBy(asc(branches.code));

    return { sucursales: lista };
  });

  app.get('/roles', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const lista = await app.db
      .select({
        id: roles.id,
        codigo: roles.code,
        nombre: roles.name,
        permisos: roles.permissions,
      })
      .from(roles)
      .where(and(eq(roles.companyId, sesion.empresaId), isNull(roles.deletedAt)))
      .orderBy(asc(roles.code));

    return { roles: lista };
  });

  app.get('/users', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_USUARIOS);

    const filas = await app.db
      .select({
        id: users.id,
        username: users.username,
        nombre: users.fullName,
        email: users.email,
        activo: users.active,
        rol: roles.code,
        rolNombre: roles.name,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.companyId, sesion.empresaId), isNull(users.deletedAt)))
      .orderBy(asc(users.username));

    const accesos = await app.db
      .select({
        userId: userBranchAccess.userId,
        branchId: branches.id,
        codigo: branches.code,
        nombre: branches.name,
      })
      .from(userBranchAccess)
      .innerJoin(branches, eq(branches.id, userBranchAccess.branchId))
      .where(eq(branches.companyId, sesion.empresaId));

    const sucursalesPorUsuario = new Map<string, { id: string; codigo: string; nombre: string }[]>();
    for (const acceso of accesos) {
      const lista = sucursalesPorUsuario.get(acceso.userId) ?? [];
      lista.push({ id: acceso.branchId, codigo: acceso.codigo, nombre: acceso.nombre });
      sucursalesPorUsuario.set(acceso.userId, lista);
    }

    // Un usuario puede tener varios roles: se agrupan.
    const porUsuario = new Map<string, {
      id: string;
      username: string;
      nombre: string;
      email: string | null;
      activo: boolean;
      roles: string[];
      rolNombres: string[];
    }>();

    for (const fila of filas) {
      const actual = porUsuario.get(fila.id) ?? {
        id: fila.id,
        username: fila.username,
        nombre: fila.nombre,
        email: fila.email,
        activo: fila.activo,
        roles: [],
        rolNombres: [],
      };
      if (fila.rol) {
        actual.roles.push(fila.rol);
        actual.rolNombres.push(fila.rolNombre ?? fila.rol);
      }
      porUsuario.set(fila.id, actual);
    }

    return {
      usuarios: [...porUsuario.values()].map((usuario) => ({
        ...usuario,
        sucursales: sucursalesPorUsuario.get(usuario.id) ?? [],
      })),
    };
  });

  app.post('/users', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_USUARIOS);
    const datos = validar(esquemaCrear, request.body);

    const rol = await buscarRol(app, sesion.empresaId, datos.rol);
    const usuarioId = nuevoId();

    await app.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: usuarioId,
        companyId: sesion.empresaId,
        username: datos.username,
        fullName: datos.nombre,
        email: datos.email ?? null,
        passwordHash: await hashearSecreto(datos.password),
      });

      await tx.insert(userRoles).values({ userId: usuarioId, roleId: rol.id });

      await tx.insert(userBranchAccess).values(
        datos.sucursalIds.map((sucursalId) => ({ userId: usuarioId, branchId: sucursalId })),
      );
    });

    reply.status(201);
    return { usuario: { id: usuarioId, username: datos.username, nombre: datos.nombre } };
  });

  app.patch('/users/:id', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_USUARIOS);
    const { id } = validar(parametroId, request.params);
    const datos = validar(esquemaEditar, request.body);

    const usuario = await buscarUsuario(app, sesion.empresaId, id);

    if (datos.rol) {
      const rol = await buscarRol(app, sesion.empresaId, datos.rol);
      await app.db.transaction(async (tx) => {
        await tx.delete(userRoles).where(eq(userRoles.userId, usuario.id));
        await tx.insert(userRoles).values({ userId: usuario.id, roleId: rol.id });
      });
    }

    if (datos.sucursalIds) {
      await app.db.transaction(async (tx) => {
        await tx.delete(userBranchAccess).where(eq(userBranchAccess.userId, usuario.id));
        await tx.insert(userBranchAccess).values(
          datos.sucursalIds!.map((sucursalId) => ({ userId: usuario.id, branchId: sucursalId })),
        );
      });
    }

    await app.db
      .update(users)
      .set({
        ...(datos.nombre !== undefined ? { fullName: datos.nombre } : {}),
        ...(datos.email !== undefined ? { email: datos.email } : {}),
        ...(datos.activo !== undefined ? { active: datos.activo } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, usuario.id));

    return { usuario: { id: usuario.id, actualizado: true } };
  });

  app.post('/users/:id/password', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_USUARIOS);
    const { id } = validar(parametroId, request.params);
    const { password } = validar(esquemaPassword, request.body);

    const usuario = await buscarUsuario(app, sesion.empresaId, id);

    await app.db
      .update(users)
      .set({ passwordHash: await hashearSecreto(password), updatedAt: new Date() })
      .where(eq(users.id, usuario.id));

    return { usuario: { id: usuario.id, passwordActualizada: true } };
  });
}

async function buscarUsuario(app: FastifyInstance, empresaId: string, usuarioId: string) {
  const { users } = schema;
  const [usuario] = await app.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, usuarioId), eq(users.companyId, empresaId), isNull(users.deletedAt)))
    .limit(1);

  if (!usuario) {
    throw new ErrorNoEncontrado('El usuario no existe');
  }
  return usuario;
}

async function buscarRol(app: FastifyInstance, empresaId: string, codigo: string) {
  const { roles } = schema;
  const [rol] = await app.db
    .select({ id: roles.id, nombre: roles.name })
    .from(roles)
    .where(and(eq(roles.companyId, empresaId), eq(roles.code, codigo), isNull(roles.deletedAt)))
    .limit(1);

  if (!rol) {
    throw new ErrorDeAplicacion(`El rol "${codigo}" no existe`, 422, 'ROL_INVALIDO');
  }
  return rol;
}
