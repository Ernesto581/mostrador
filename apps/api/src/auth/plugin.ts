import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Sesion del usuario.
 *
 * El token lleva solo lo indispensable (`sub` = id del usuario). Los permisos y
 * las sucursales se consultan frescos en cada peticion, para que revocar el
 * acceso tenga efecto inmediato.
 */
export const pluginAuth = fp(
  async (app) => {
    await app.register(jwt, {
      secret: app.config.JWT_SECRET,
      sign: { expiresIn: app.config.JWT_EXPIRA },
    });
  },
  { name: 'auth' },
);

/** Exige un token valido. Se usa como `preHandler` en las rutas protegidas. */
export async function autenticar(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await request.jwtVerify();
}
