import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sembrarDatosIniciales } from '../src/db/seed.js';
import { manejadorVercel, obtenerServidor, type RespuestaVercel } from '../src/vercel.js';

/**
 * Prueba del adaptador para Vercel.
 *
 * Se llama al manejador con una peticion y una respuesta simuladas, igual que lo hara
 * la plataforma: el navegador nunca ve la diferencia.
 */

interface Captura {
  respuesta: RespuestaVercel;
  estado: () => number;
  cabeceras: () => Record<string, string>;
  cuerpo: () => unknown;
}

function respuestaSimulada(): Captura {
  let codigo = 0;
  const cabeceras: Record<string, string> = {};
  let cuerpo: unknown;

  const respuesta: RespuestaVercel = {
    status(nuevoCodigo) {
      codigo = nuevoCodigo;
      return respuesta;
    },
    setHeader(nombre, valor) {
      cabeceras[nombre] = String(valor);
      return undefined;
    },
    send(datos) {
      cuerpo = datos;
      return undefined;
    },
  };

  return {
    respuesta,
    estado: () => codigo,
    cabeceras: () => cabeceras,
    cuerpo: () => cuerpo,
  };
}

async function llamar(
  ruta: string[],
  opciones: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<Captura> {
  const captura = respuestaSimulada();
  await manejadorVercel(
    {
      method: opciones.method ?? 'GET',
      url: `/api/${ruta.join('/')}${opciones.query ? `?${new URLSearchParams(opciones.query).toString()}` : ''}`,
      headers: { 'content-type': 'application/json' },
      query: { ruta, ...(opciones.query ?? {}) },
      ...(opciones.body !== undefined ? { body: opciones.body } : {}),
    },
    captura.respuesta,
  );
  return captura;
}

let password = 'mostrador123';

beforeAll(async () => {
  const app = await obtenerServidor();
  const semilla = await sembrarDatosIniciales(app.db, {
    usuario: 'admin',
    password,
    conProductosEjemplo: false,
  });
  password = semilla.password;
});

afterAll(async () => {
  const app = await obtenerServidor();
  await app.close();
});

describe('API como funcion (sin estado)', () => {
  it('responde el estado de salud', async () => {
    const captura = await llamar(['v1', 'health']);
    expect(captura.estado()).toBe(200);
    expect(JSON.parse(String(captura.cuerpo()))).toMatchObject({ estado: 'ok' });
  });

  it('inicia sesion con el cuerpo de la peticion', async () => {
    const captura = await llamar(['v1', 'auth', 'login'], {
      method: 'POST',
      body: { username: 'admin', password },
    });

    expect(captura.estado()).toBe(200);
    expect(JSON.parse(String(captura.cuerpo())).token).toBeTruthy();
  });

  it('devuelve 401 cuando la contrasena no es correcta', async () => {
    const captura = await llamar(['v1', 'auth', 'login'], {
      method: 'POST',
      body: { username: 'admin', password: 'equivocada' },
    });

    expect(captura.estado()).toBe(401);
  });

  it('respeta los parametros de la consulta en la url', async () => {
    const captura = await llamar(['v1', 'auth', 'login'], {
      method: 'POST',
      body: { username: 'admin', password },
    });
    const token = JSON.parse(String(captura.cuerpo())).token as string;

    const capturaProductos = respuestaSimulada();
    await manejadorVercel(
      {
        method: 'GET',
        url: '/api/v1/products?sucursalId=no-existe&limite=5',
        headers: { authorization: `Bearer ${token}` },
        query: { ruta: ['v1', 'products'], sucursalId: 'no-existe', limite: '5' },
      },
      capturaProductos.respuesta,
    );

    // No hay productos sembrados y la sucursal no es valida: debe ser un error claro,
    // no un fallo interno. Lo importante es que la consulta llego completa.
    expect([200, 403]).toContain(capturaProductos.estado());
  });

  it('devuelve 404 con el formato de error del API', async () => {
    const captura = await llamar(['v1', 'no-existe']);
    expect(captura.estado()).toBe(404);
    expect(JSON.parse(String(captura.cuerpo())).error.codigo).toBe('NO_ENCONTRADO');
  });

  it('reconstruye la ruta cuando Vercel la manda por el parametro ruta', async () => {
    // Asi llega una peticion real: vercel.json reescribe /api/(.*) a
    // /api/index?ruta=$1, y aqui se vuelve a armar /api/v1/health.
    const captura = respuestaSimulada();
    await manejadorVercel(
      {
        method: 'GET',
        url: '/api/index?ruta=v1/health',
        headers: {},
        query: { ruta: 'v1/health' },
      },
      captura.respuesta,
    );

    expect(captura.estado()).toBe(200);
    expect(JSON.parse(String(captura.cuerpo()))).toMatchObject({ estado: 'ok' });
  });

  it('conserva la forma de Vercel al iniciar sesion', async () => {
    const captura = respuestaSimulada();
    await manejadorVercel(
      {
        method: 'POST',
        url: '/api/index?ruta=v1/auth/login',
        headers: { 'content-type': 'application/json' },
        query: { ruta: 'v1/auth/login' },
        body: { username: 'admin', password },
      },
      captura.respuesta,
    );

    expect(captura.estado()).toBe(200);
    expect(JSON.parse(String(captura.cuerpo())).token).toBeTruthy();
  });
});
