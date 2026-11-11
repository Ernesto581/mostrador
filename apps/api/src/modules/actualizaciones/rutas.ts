import { schema } from '@mostrador/db-cloud';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErrorDeAplicacion, ErrorDeAutenticacion, ErrorNoEncontrado, validar } from '../../errors.js';
import { exigirSesion, sesionDe } from '../../auth/sesion.js';
import { nuevoId } from '../../util/id.js';

/**
 * Actualizaciones de la app de Android.
 *
 * Hay dos mundos separados:
 *
 * - La app del cliente solo pregunta `GET /app-releases/actual` y se entera si
 *   hay una version que debe instalar.
 * - El panel del desarrollador (`/actualizaciones` en la web) administra el
 *   historial y publica versiones con una clave de desarrollador, sin usar la
 *   sesion del administrador del negocio.
 */

const esquemaCrear = z.object({
  versionCode: z.number().int().min(1, 'La version debe ser 1 o mas'),
  versionName: z.string().trim().min(1, 'Escribe el nombre de la version').max(40),
  notas: z.string().trim().max(2000).optional(),
  url: z.string().trim().url('La direccion del APK debe ser valida').max(500),
  publicada: z.boolean().optional(),
});

const esquemaEditar = esquemaCrear.partial();

const parametroId = z.object({ id: z.string().min(1) });

const campos = {
  id: schema.appReleases.id,
  versionCode: schema.appReleases.versionCode,
  versionName: schema.appReleases.versionName,
  notas: schema.appReleases.notas,
  url: schema.appReleases.url,
  publicada: schema.appReleases.publicada,
  publicadoEn: schema.appReleases.publicadoEn,
  creadoEn: schema.appReleases.createdAt,
};

function clavesIguales(a: string, b: string): boolean {
  const izquierda = Buffer.from(a);
  const derecha = Buffer.from(b);
  return izquierda.length === derecha.length && timingSafeEqual(izquierda, derecha);
}

async function empresaDelDesarrollador(app: FastifyInstance): Promise<string> {
  if (app.config.DEVELOPER_COMPANY_ID) {
    return app.config.DEVELOPER_COMPANY_ID;
  }

  const [empresa] = await app.db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .limit(1);

  if (!empresa) {
    throw new ErrorDeAplicacion(
      'No hay empresas registradas en esta instalacion',
      503,
      'EMPRESA_FALTANTE',
    );
  }
  return empresa.id;
}

/** La version publicada mas alta, o null si no se mando ninguna. */
async function ultimaPublicada(app: FastifyInstance, empresaId: string) {
  const { appReleases } = schema;
  const [actual] = await app.db
    .select(campos)
    .from(appReleases)
    .where(
      and(
        eq(appReleases.companyId, empresaId),
        eq(appReleases.publicada, true),
        isNull(appReleases.deletedAt),
      ),
    )
    .orderBy(desc(appReleases.versionCode))
    .limit(1);

  return actual ?? null;
}

export async function rutasActualizaciones(app: FastifyInstance) {
  const preHandlerSesion = exigirSesion(app);
  const { appReleases } = schema;

  /**
   * La app del cliente pregunta si hay una version nueva. No la administra:
   * solo ve lo que el desarrollador publico.
   */
  app.get('/app-releases/actual', { preHandler: [preHandlerSesion] }, async (request) => {
    const sesion = sesionDe(request);
    const actual = await ultimaPublicada(app, sesion.empresaId);

    return {
      actualizacion: actual
        ? {
            id: actual.id,
            versionCode: actual.versionCode,
            versionName: actual.versionName,
            notas: actual.notas,
            url: actual.url,
            publicadoEn: actual.publicadoEn,
          }
        : null,
    };
  });

  /** Clave de desarrollador: vive en el servidor, no en la pagina. */
  async function preHandlerDesarrollador(request: FastifyRequest): Promise<void> {
    const token = app.config.DEVELOPER_TOKEN;
    if (!token) {
      throw new ErrorDeAplicacion(
        'El panel del desarrollador no esta configurado en el servidor',
        503,
        'DESARROLLADOR_NO_CONFIGURADO',
      );
    }

    const recibido = request.headers['x-developer-token'];
    if (typeof recibido !== 'string' || !clavesIguales(recibido, token)) {
      throw new ErrorDeAutenticacion('Clave de desarrollador incorrecta');
    }
  }

  app.get('/developer/app-releases', { preHandler: [preHandlerDesarrollador] }, async () => {
    const empresaId = await empresaDelDesarrollador(app);

    const filas = await app.db
      .select(campos)
      .from(appReleases)
      .where(and(eq(appReleases.companyId, empresaId), isNull(appReleases.deletedAt)))
      .orderBy(desc(appReleases.versionCode));

    return {
      actualizaciones: filas.map((fila) => ({
        id: fila.id,
        versionCode: fila.versionCode,
        versionName: fila.versionName,
        notas: fila.notas,
        url: fila.url,
        publicada: fila.publicada,
        publicadoEn: fila.publicadoEn,
        creadoEn: fila.creadoEn,
      })),
    };
  });

  app.get('/developer/app-releases/actual', { preHandler: [preHandlerDesarrollador] }, async () => {
    const empresaId = await empresaDelDesarrollador(app);
    const actual = await ultimaPublicada(app, empresaId);

    return {
      actualizacion: actual
        ? {
            id: actual.id,
            versionCode: actual.versionCode,
            versionName: actual.versionName,
            notas: actual.notas,
            url: actual.url,
            publicadoEn: actual.publicadoEn,
          }
        : null,
    };
  });

  app.post('/developer/app-releases', { preHandler: [preHandlerDesarrollador] }, async (request, reply) => {
    const empresaId = await empresaDelDesarrollador(app);
    const datos = validar(esquemaCrear, request.body);

    const [repetida] = await app.db
      .select({ id: appReleases.id })
      .from(appReleases)
      .where(
        and(
          eq(appReleases.companyId, empresaId),
          eq(appReleases.versionCode, datos.versionCode),
          isNull(appReleases.deletedAt),
        ),
      )
      .limit(1);

    if (repetida) {
      throw new ErrorDeAplicacion(
        `Ya existe una actualizacion con el numero ${datos.versionCode}`,
        409,
        'VERSION_REPETIDA',
      );
    }

    const ahora = new Date();
    const id = nuevoId();
    const publicada = datos.publicada ?? false;

    await app.db.transaction(async (tx) => {
      if (publicada) {
        await tx
          .update(appReleases)
          .set({ publicada: false, publicadoEn: null, updatedAt: ahora })
          .where(and(eq(appReleases.companyId, empresaId), eq(appReleases.publicada, true)));
      }

      await tx.insert(appReleases).values({
        id,
        companyId: empresaId,
        versionCode: datos.versionCode,
        versionName: datos.versionName,
        notas: datos.notas ?? null,
        url: datos.url,
        publicada,
        publicadoEn: publicada ? ahora : null,
        publicadoPor: null,
        createdAt: ahora,
        updatedAt: ahora,
      });
    });

    reply.status(201);
    return { actualizacion: { id, versionCode: datos.versionCode } };
  });

  app.patch('/developer/app-releases/:id', { preHandler: [preHandlerDesarrollador] }, async (request) => {
    const empresaId = await empresaDelDesarrollador(app);
    const { id } = validar(parametroId, request.params);
    const datos = validar(esquemaEditar, request.body);

    const [existente] = await app.db
      .select({ id: appReleases.id, versionCode: appReleases.versionCode })
      .from(appReleases)
      .where(
        and(
          eq(appReleases.id, id),
          eq(appReleases.companyId, empresaId),
          isNull(appReleases.deletedAt),
        ),
      )
      .limit(1);

    if (!existente) {
      throw new ErrorNoEncontrado('La actualizacion no existe');
    }

    if (datos.versionCode !== undefined && datos.versionCode !== existente.versionCode) {
      const [repetida] = await app.db
        .select({ id: appReleases.id })
        .from(appReleases)
        .where(
          and(
            eq(appReleases.companyId, empresaId),
            eq(appReleases.versionCode, datos.versionCode),
            isNull(appReleases.deletedAt),
          ),
        )
        .limit(1);

      if (repetida && repetida.id !== id) {
        throw new ErrorDeAplicacion(
          `Ya existe una actualizacion con el numero ${datos.versionCode}`,
          409,
          'VERSION_REPETIDA',
        );
      }
    }

    const ahora = new Date();
    const publica = datos.publicada === true;
    const retira = datos.publicada === false;

    await app.db.transaction(async (tx) => {
      if (publica) {
        await tx
          .update(appReleases)
          .set({ publicada: false, publicadoEn: null, updatedAt: ahora })
          .where(and(eq(appReleases.companyId, empresaId), eq(appReleases.publicada, true)));
      }

      await tx
        .update(appReleases)
        .set({
          ...(datos.versionCode !== undefined ? { versionCode: datos.versionCode } : {}),
          ...(datos.versionName !== undefined ? { versionName: datos.versionName } : {}),
          ...(datos.notas !== undefined ? { notas: datos.notas } : {}),
          ...(datos.url !== undefined ? { url: datos.url } : {}),
          ...(publica ? { publicada: true, publicadoEn: ahora } : {}),
          ...(retira ? { publicada: false, publicadoEn: null } : {}),
          updatedAt: ahora,
          revision: sql`${appReleases.revision} + 1`,
        })
        .where(eq(appReleases.id, id));
    });

    return { actualizacion: { id, actualizada: true } };
  });

  app.delete('/developer/app-releases/:id', { preHandler: [preHandlerDesarrollador] }, async (request) => {
    const empresaId = await empresaDelDesarrollador(app);
    const { id } = validar(parametroId, request.params);

    const [existente] = await app.db
      .select({ id: appReleases.id })
      .from(appReleases)
      .where(
        and(
          eq(appReleases.id, id),
          eq(appReleases.companyId, empresaId),
          isNull(appReleases.deletedAt),
        ),
      )
      .limit(1);

    if (!existente) {
      throw new ErrorNoEncontrado('La actualizacion no existe');
    }

    await app.db
      .update(appReleases)
      .set({ deletedAt: new Date(), publicada: false, updatedAt: new Date() })
      .where(eq(appReleases.id, id));

    return { actualizacion: { id, borrada: true } };
  });
}
