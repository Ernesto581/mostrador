import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function rutasSalud(app: FastifyInstance) {
  app.get('/health', async () => {
    await app.db.execute(sql`select 1`);
    return {
      estado: 'ok',
      baseDeDatos: 'conectada',
      hora: new Date().toISOString(),
    };
  });
}
