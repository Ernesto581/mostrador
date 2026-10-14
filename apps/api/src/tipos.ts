import type { Db } from '@mostrador/db-cloud';
import type { Config } from './config.js';

/** Piezas que el servidor pone a disposicion de todas las rutas. */
declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }
}

/** Contenido del token de sesion. */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; nombre: string };
    user: { sub: string; nombre: string };
  }
}
