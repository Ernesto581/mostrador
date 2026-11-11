import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sembrarDatosIniciales } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';

// La clave de desarrollador vive solo en el servidor. En produccion se pone en
// Vercel; en la prueba se define antes de levantar el API.
process.env.DEVELOPER_TOKEN = 'clave-de-desarrollador-1234567890';

const CLAVE = process.env.DEVELOPER_TOKEN!;
const URL_APK = 'https://github.com/Ernesto581/mostrador/releases/latest/download/mostrador.apk';

let app: FastifyInstance;
let tokenSesion = '';

beforeAll(async () => {
  app = await construirServidor();
  await app.ready();
  await sembrarDatosIniciales(app.db, {
    usuario: 'admin',
    password: 'admin12345',
    conProductosEjemplo: false,
  });

  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'admin12345' },
  });
  tokenSesion = respuesta.json().token as string;
});

afterAll(async () => {
  await app.close();
});

function sesion(): Record<string, string> {
  return { authorization: `Bearer ${tokenSesion}` };
}

function desarrollador(): Record<string, string> {
  return { 'x-developer-token': CLAVE };
}

describe('panel del desarrollador', () => {
  it('la app del cliente no ve ninguna version publicada al empezar', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/app-releases/actual',
      headers: sesion(),
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().actualizacion).toBeNull();
  });

  it('el panel del desarrollador exige su propia clave', async () => {
    const sinClave = await app.inject({ method: 'GET', url: '/api/v1/developer/app-releases' });
    expect(sinClave.statusCode).toBe(401);

    const mala = await app.inject({
      method: 'GET',
      url: '/api/v1/developer/app-releases',
      headers: { 'x-developer-token': 'incorrecta' },
    });
    expect(mala.statusCode).toBe(401);
  });

  it('registra, publica y retira una version', async () => {
    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/developer/app-releases',
      headers: desarrollador(),
      payload: {
        versionCode: 10,
        versionName: '1.0',
        notas: 'Primera version',
        url: URL_APK,
      },
    });
    expect(creada.statusCode).toBe(201);
    const id = creada.json().actualizacion.id as string;

    // Mientras no se publica, la app no ve nada.
    const antes = await app.inject({
      method: 'GET',
      url: '/api/v1/app-releases/actual',
      headers: sesion(),
    });
    expect(antes.json().actualizacion).toBeNull();

    const publicada = await app.inject({
      method: 'PATCH',
      url: `/api/v1/developer/app-releases/${id}`,
      headers: desarrollador(),
      payload: { publicada: true },
    });
    expect(publicada.statusCode).toBe(200);

    const despues = await app.inject({
      method: 'GET',
      url: '/api/v1/app-releases/actual',
      headers: sesion(),
    });
    expect(despues.statusCode).toBe(200);
    expect(despues.json().actualizacion.versionCode).toBe(10);
    expect(despues.json().actualizacion.versionName).toBe('1.0');

    const siguiente = await app.inject({
      method: 'POST',
      url: '/api/v1/developer/app-releases',
      headers: desarrollador(),
      payload: {
        versionCode: 11,
        versionName: '1.1',
        url: URL_APK,
        publicada: true,
      },
    });
    expect(siguiente.statusCode).toBe(201);
    const siguienteId = siguiente.json().actualizacion.id as string;

    const reemplazada = await app.inject({
      method: 'GET',
      url: '/api/v1/app-releases/actual',
      headers: sesion(),
    });
    expect(reemplazada.json().actualizacion.versionCode).toBe(11);

    const historial = await app.inject({
      method: 'GET',
      url: '/api/v1/developer/app-releases',
      headers: desarrollador(),
    });
    expect(
      historial.json().actualizaciones.filter((fila: { publicada: boolean }) => fila.publicada),
    ).toHaveLength(1);

    const retirada = await app.inject({
      method: 'PATCH',
      url: `/api/v1/developer/app-releases/${siguienteId}`,
      headers: desarrollador(),
      payload: { publicada: false },
    });
    expect(retirada.statusCode).toBe(200);

    const final = await app.inject({
      method: 'GET',
      url: '/api/v1/app-releases/actual',
      headers: sesion(),
    });
    expect(final.json().actualizacion).toBeNull();
  });

  it('no deja repetir el numero de version', async () => {
    const repetida = await app.inject({
      method: 'POST',
      url: '/api/v1/developer/app-releases',
      headers: desarrollador(),
      payload: { versionCode: 10, versionName: 'Otra', url: URL_APK },
    });

    expect(repetida.statusCode).toBe(409);
    expect(repetida.json().error.codigo).toBe('VERSION_REPETIDA');
  });
});
