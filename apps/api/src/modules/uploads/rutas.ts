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

  /**
   * Diagnostico para administracion: dice si el almacenamiento esta configurado
   * y que responde Supabase, sin mostrar la clave.
   */
  app.get('/uploads/estado', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_CATALOGO);

    const base = app.config.SUPABASE_URL;
    const clave = app.config.SUPABASE_SECRET_KEY ?? app.config.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = app.config.SUPABASE_BUCKET;

    if (!base || !clave) {
      return {
        configurado: false,
        bucket,
        alcanzable: false,
        detalle: 'Falta SUPABASE_URL o SUPABASE_SECRET_KEY',
      };
    }

    const respuesta = await fetch(`${base.replace(/\/+$/, '')}/storage/v1/bucket/${bucket}`, {
      headers: { Authorization: `Bearer ${clave}`, apikey: clave },
    });

    return {
      configurado: true,
      bucket,
      estadoHttp: respuesta.status,
      alcanzable: respuesta.ok,
      detalle: respuesta.ok ? null : await detalleDeRespuesta(respuesta),
    };
  });

  app.post('/uploads/producto', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_CATALOGO);

    const { SUPABASE_URL } = app.config;
    const clave = app.config.SUPABASE_SECRET_KEY ?? app.config.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !clave) {
      throw new ErrorDeAplicacion(
        'El almacenamiento de fotos no esta configurado. Falta SUPABASE_URL y SUPABASE_SECRET_KEY en el servidor.',
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
      clave,
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

  // Supabase responde 400 (no 404) cuando el bucket no existe. En ambos casos
  // se intenta crear; si ya existe, la creacion devuelve 409 y se ignora.
  if (existente.status === 404 || existente.status === 400) {
    const creacion = await fetch(`${datos.base}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...cabeceras, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: datos.bucket, name: datos.bucket, public: true }),
    });
    if (!creacion.ok && creacion.status !== 409) {
      const detalle = await detalleDeRespuesta(creacion);
      throw new ErrorDeAplicacion(
        `No se pudo preparar el almacenamiento de fotos (HTTP ${creacion.status}${detalle ? `: ${detalle}` : ''})`,
        502,
        'ALMACENAMIENTO_ERROR',
      );
    }
  } else if (!existente.ok) {
    const detalle = await detalleDeRespuesta(existente);
    throw new ErrorDeAplicacion(
      `No se pudo consultar el almacenamiento de fotos (HTTP ${existente.status}${detalle ? `: ${detalle}` : ''})`,
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
    const detalle = await detalleDeRespuesta(subida);
    throw new ErrorDeAplicacion(
      `No se pudo subir la foto (HTTP ${subida.status}${detalle ? `: ${detalle}` : ''})`,
      502,
      'ALMACENAMIENTO_ERROR',
    );
  }

  return `${datos.base}/storage/v1/object/public/${datos.bucket}/${datos.ruta}`;
}

async function detalleDeRespuesta(respuesta: Response): Promise<string> {
  const texto = await respuesta.text();
  if (!texto) {
    return '';
  }

  let mensaje = texto;
  try {
    const json = JSON.parse(texto) as { message?: unknown; error?: unknown };
    const partes = [json.message, json.error].filter(
      (valor): valor is string => typeof valor === 'string',
    );
    if (partes.length > 0) {
      mensaje = partes.join(' - ');
    }
  } catch {
    // No era JSON: se usa el texto tal cual.
  }

  return mensaje
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, 'sb_secret_***')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
