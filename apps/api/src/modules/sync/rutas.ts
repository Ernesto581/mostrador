import { schema } from '@mostrador/db-cloud';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigirSesion, sesionDe } from '../../auth/sesion.js';
import { validar } from '../../errors.js';

const esquemaOp = z.object({
  opId: z.string().min(1),
  tipo: z.string().min(1),
  payload: z.unknown().optional(),
});

const esquemaPush = z.object({
  operaciones: z.array(esquemaOp).min(1).max(100),
});

const esquemaPull = z.object({
  cursor: z.coerce.number().int().min(0).optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

export async function rutasSync(app: FastifyInstance) {
  const preHandler = exigirSesion(app);
  const { syncOperations, changeFeed } = schema;

  app.post('/sync/push', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const { operaciones } = validar(esquemaPush, request.body);

    const opIds = operaciones.map((o) => o.opId);
    const yaProcesadas = await app.db
      .select({ opId: syncOperations.opId })
      .from(syncOperations)
      .where(inArray(syncOperations.opId, opIds));

    const setYa = new Set(yaProcesadas.map((r) => r.opId));
    const nuevas = operaciones.filter((o) => !setYa.has(o.opId));

    if (nuevas.length > 0) {
      await app.db
        .insert(syncOperations)
        .values(nuevas.map((o) => ({ opId: o.opId, companyId: sesion.empresaId, tipo: o.tipo })))
        .onConflictDoNothing();
    }

    return {
      resultados: operaciones.map((o) => ({
        opId: o.opId,
        ok: true,
        duplicada: setYa.has(o.opId),
      })),
    };
  });

  app.get('/sync/pull', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const consulta = validar(esquemaPull, request.query);
    const cursor = consulta.cursor ?? 0;
    const limite = consulta.limite ?? 100;

    const filas = await app.db
      .select()
      .from(changeFeed)
      .where(
        and(
          eq(changeFeed.companyId, sesion.empresaId),
          gt(changeFeed.seq, cursor),
        ),
      )
      .orderBy(asc(changeFeed.seq))
      .limit(limite);

    const ultimo = filas[filas.length - 1];
    const nuevoCursor = filas.length > 0 && ultimo ? ultimo.seq : cursor;

    return {
      cambios: filas,
      cursor: nuevoCursor,
    };
  });
}