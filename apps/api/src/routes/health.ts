import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { mensajeDeError } from '../errors.js';

/**
 * Estado del servicio.
 *
 * Nunca falla: si la base de datos no responde, lo dice con el motivo real. Este
 * endpoint es la forma rapida de saber que esta pasando sin entrar a los registros.
 */
export async function rutasSalud(app: FastifyInstance) {
  app.get('/health', async () => {
    const base = {
      estado: 'ok',
      motor: app.config.DATABASE_URL ? 'postgresql' : 'pglite',
      migraAlArrancar: app.config.MIGRAR_AL_ARRANCAR,
      hora: new Date().toISOString(),
    };

    try {
      await app.db.execute(sql`select 1`);
      return { ...base, baseDeDatos: 'conectada' };
    } catch (error) {
      return {
        ...base,
        estado: 'degradado',
        baseDeDatos: 'sin conexion',
        detalle: mensajeDeError(error),
      };
    }
  });
}
