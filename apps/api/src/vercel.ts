import type { FastifyInstance, HTTPMethods } from 'fastify';
import { construirServidor } from './server.js';

/**
 * Adaptador para ejecutar el API como funcion de Vercel.
 *
 * Un servidor normal escucha en un puerto; una funcion recibe una peticion y debe
 * responderla. En vez de enchufar los flujos crudos de Node (que en Vercel llegan ya
 * consumidos), se usa `app.inject`: el modo de Fastify para llamar a la aplicacion sin
 * abrir un socket. Asi el mismo API sirve en los dos mundos y no depende de que la
 * plataforma intercepte `listen`.
 *
 * La instancia se guarda en una variable de modulo: mientras la funcion siga
 * "caliente", las siguientes peticiones reutilizan la aplicacion y la conexion.
 */

export interface PeticionVercel {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface RespuestaVercel {
  status(codigo: number): RespuestaVercel;
  setHeader(nombre: string, valor: number | string | readonly string[]): unknown;
  send(cuerpo?: unknown): unknown;
}

let aplicacion: Promise<FastifyInstance> | undefined;

export function obtenerServidor(): Promise<FastifyInstance> {
  aplicacion ??= construirServidor();
  return aplicacion;
}

function normalizarSegmentos(valor: string | string[] | undefined): string[] {
  if (Array.isArray(valor)) {
    return valor;
  }
  return valor ? [valor] : [];
}

function obtenerConsulta(
  url: string | undefined,
  query: Record<string, string | string[] | undefined> | undefined,
): string {
  if (typeof url === 'string') {
    const indice = url.indexOf('?');
    if (indice >= 0) {
      return url.slice(indice);
    }
  }

  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query ?? {})) {
    if (clave === 'ruta') {
      continue;
    }
    if (Array.isArray(valor)) {
      for (const elemento of valor) {
        parametros.append(clave, elemento);
      }
    } else if (valor !== undefined) {
      parametros.append(clave, valor);
    }
  }

  const texto = parametros.toString();
  return texto ? `?${texto}` : '';
}

/**
 * Vercel entrega la ruta en el parametro `ruta` (archivo `api/[...ruta].ts`).
 * Cuando se llama directamente (pruebas), se usa tal cual la url recibida.
 */
function construirRuta(peticion: PeticionVercel): string {
  const segmentos = normalizarSegmentos(peticion.query?.ruta);
  const consulta = obtenerConsulta(peticion.url, peticion.query);

  if (segmentos.length > 0) {
    return `/api/${segmentos.join('/')}${consulta}`;
  }
  if (typeof peticion.url === 'string' && peticion.url.startsWith('/api/')) {
    return peticion.url;
  }
  return '/api/v1/health';
}

async function leerCuerpo(peticion: PeticionVercel): Promise<Buffer | undefined> {
  if (peticion.body !== undefined) {
    if (Buffer.isBuffer(peticion.body)) {
      return peticion.body;
    }
    if (typeof peticion.body === 'string') {
      return Buffer.from(peticion.body);
    }
    return Buffer.from(JSON.stringify(peticion.body));
  }

  const iterable = peticion as unknown as AsyncIterable<Buffer>;
  if (typeof iterable[Symbol.asyncIterator] !== 'function') {
    return undefined;
  }

  const trozos: Buffer[] = [];
  for await (const trozo of iterable) {
    trozos.push(Buffer.from(trozo));
  }
  return trozos.length > 0 ? Buffer.concat(trozos) : undefined;
}

function normalizarCabeceras(
  cabeceras: PeticionVercel['headers'],
): Record<string, string | string[]> {
  const resultado: Record<string, string | string[]> = {};
  for (const [nombre, valor] of Object.entries(cabeceras ?? {})) {
    if (valor !== undefined) {
      resultado[nombre] = valor;
    }
  }
  return resultado;
}

export async function manejadorVercel(
  peticion: PeticionVercel,
  respuesta: RespuestaVercel,
): Promise<void> {
  const app = await obtenerServidor();

  const cuerpo = await leerCuerpo(peticion);
  const resultado = await app.inject({
    method: (peticion.method ?? 'GET').toUpperCase() as HTTPMethods,
    url: construirRuta(peticion),
    headers: normalizarCabeceras(peticion.headers),
    ...(cuerpo !== undefined ? { payload: cuerpo } : {}),
  });

  respuesta.status(resultado.statusCode);
  for (const [nombre, valor] of Object.entries(resultado.headers)) {
    if (valor !== undefined) {
      respuesta.setHeader(nombre, valor as string);
    }
  }
  respuesta.send(resultado.rawPayload);
}
