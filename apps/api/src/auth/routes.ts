import { schema } from '@mostrador/db-cloud';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorDeAutenticacion, validar } from '../errors.js';
import { verificarSecreto } from './password.js';
import { autenticar } from './plugin.js';

const EsquemaLogin = z.object({
  username: z.string().trim().min(1, 'Escribe tu usuario').max(64),
  password: z.string().min(1, 'Escribe tu contrasena').max(200),
});

export async function rutasAuth(app: FastifyInstance) {
  const { users, roles, userRoles, branches, userBranchAccess } = schema;

  app.post('/login', async (request, reply) => {
    const { username, password } = validar(EsquemaLogin, request.body);

    const [usuario] = await app.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), eq(users.active, true), isNull(users.deletedAt)))
      .limit(1);

    if (!usuario) {
      throw new ErrorDeAutenticacion();
    }

    const coincide = await verificarSecreto(password, usuario.passwordHash);
    if (!coincide) {
      throw new ErrorDeAutenticacion();
    }

    const token = await reply.jwtSign({ sub: usuario.id, nombre: usuario.fullName });

    return {
      token,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        nombre: usuario.fullName,
      },
    };
  });

  app.get('/me', { preHandler: [autenticar] }, async (request) => {
    const [usuario] = await app.db
      .select()
      .from(users)
      .where(and(eq(users.id, request.user.sub), isNull(users.deletedAt)))
      .limit(1);

    if (!usuario) {
      throw new ErrorDeAutenticacion('La sesion ya no es valida');
    }

    const [empresa] = await app.db
      .select({
        nombre: schema.companies.name,
        moneda: schema.companies.currency,
        preciosConImpuestoIncluido: schema.companies.pricesIncludeTax,
      })
      .from(schema.companies)
      .where(eq(schema.companies.id, usuario.companyId))
      .limit(1);

    const filasRoles = await app.db
      .select({ codigo: roles.code, nombre: roles.name, permisos: roles.permissions })
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
      .where(eq(userBranchAccess.userId, usuario.id));

    return {
      empresa: {
        nombre: empresa?.nombre ?? '',
        moneda: empresa?.moneda ?? 'MXN',
        preciosConImpuestoIncluido: empresa?.preciosConImpuestoIncluido ?? true,
      },
      usuario: {
        id: usuario.id,
        username: usuario.username,
        nombre: usuario.fullName,
        email: usuario.email,
      },
      roles: filasRoles.map((fila) => fila.codigo),
      permisos: [...new Set(filasRoles.flatMap((fila) => fila.permisos))].sort(),
      sucursales,
    };
  });
}
