import type { FastifyInstance } from 'fastify';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { ErrorDeAplicacion } from '../../errors.js';
import { nuevoId } from '../../util/id.js';

const TIPOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Fotos de productos en Supabase Storage.
 *
 * La clave de servicio vive solo en el servidor: el navegador nunca la recibe.
 * El bucket se crea como publico la primera vez, para que las fotos se puedan
 * mostrar sin firmar cada URL. Solo administracion y almacen pueden subir.
 */
export async function rutasSubidas(app: FastifyInstance) {
  const preHandler = exigirSesion(app);

  app.post('/uploads/producto', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_CATALOGO);

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = app.config;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new ErrorDeAplicacion(
        'El almacenamiento de fotos no esta configurado. Falta SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el servidor.',
        503,
        'ALMACENAMIENTO_NO_CONFIGURADO',
      );
    }

    const archivo = await request.file();
    if (!archivo) {
      throw new ErrorDeAplicacion('Adjunta una imagen del producto', 422, 'ARCHIVO_FALTANTE');
    }

    const extension = TIPOS[archivo.mimetype];
    if (!extension) {
      throw new ErrorDeAplicacion(
        'La foto debe ser JPG, PNG o WebP',
        422,
        'FORMATO_NO_SOPORTADO',
      );
    }

    const contenido = await archivo.toBuffer();
    if (contenido.length === 0) {
      throw new ErrorDeAplicacion('La imagen esta vacia', 422, 'ARCHIVO_VACIO');
    }

    const bucket = app.config.SUPABASE_BUCKET;
    const ruta = `${sesion.empresaId}/${nuevoId()}.${extension}`;
    const url = await subirASupabase({
      base: SUPABASE_URL.replace(/\/+$/, ''),
      clave: SUPABASE_SERVICE_ROLE_KEY,
      bucket,
      ruta,
      tipo: archivo.mimetype,
      contenido,
    });

    reply.status(201);
    return { url };
  });
}

async function subirASupabase(datos: {
  base: string;
  clave: string;
  bucket: string;
  ruta: string;
  tipo: string;
  contenido: Buffer;
}): Promise<string> {
  const cabeceras = {
    Authorization: `Bearer ${datos.clave}`,
    apikey: datos.clave,
  };

  const existente = await fetch(`${datos.base}/storage/v1/bucket/${datos.bucket}`, {
    headers: cabeceras,
  });

  if (existente.status === 404) {
    const creacion = await fetch(`${datos.base}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...cabeceras, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: datos.bucket, name: datos.bucket, public: true }),
    });
    if (!creacion.ok && creacion.status !== 409) {
      throw new ErrorDeAplicacion(
        'No se pudo preparar el almacenamiento de fotos',
        502,
        'ALMACENAMIENTO_ERROR',
      );
    }
  } else if (!existente.ok) {
    throw new ErrorDeAplicacion(
      'No se pudo consultar el almacenamiento de fotos',
      502,
      'ALMACENAMIENTO_ERROR',
    );
  }

  const subida = await fetch(
    `${datos.base}/storage/v1/object/${datos.bucket}/${datos.ruta}`,
    {
      method: 'POST',
      headers: {
        ...cabeceras,
        'Content-Type': datos.tipo,
        'x-upsert': 'true',
        'cache-control': '3600',
      },
      body: new Uint8Array(datos.contenido),
    },
  );

  if (!subida.ok) {
    throw new ErrorDeAplicacion(
      'No se pudo subir la foto. Intentalo de nuevo.',
      502,
      'ALMACENAMIENTO_ERROR',
    );
  }

  return `${datos.base}/storage/v1/object/public/${datos.bucket}/${datos.ruta}`;
}
