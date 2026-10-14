import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sembrarDatosIniciales } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';

let app: FastifyInstance;
let usuario = '';
let password = '';

beforeAll(async () => {
  app = await construirServidor();
  await app.ready();
  const semilla = await sembrarDatosIniciales(app.db, {
    usuario: 'ernesto',
    password: 'mostrador123',
  });
  usuario = semilla.usuario;
  password = semilla.password;
});

afterAll(async () => {
  await app.close();
});

async function iniciarSesion(): Promise<string> {
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: usuario, password },
  });
  return respuesta.json().token as string;
}

describe('servidor', () => {
  it('responde el estado de salud y confirma la base de datos', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ estado: 'ok', baseDeDatos: 'conectada' });
  });

  it('devuelve 404 con un mensaje claro en una ruta inexistente', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/v1/no-existe' });
    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().error.codigo).toBe('NO_ENCONTRADO');
  });
});

describe('autenticacion', () => {
  it('acepta el usuario y la contrasena correctos', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: usuario, password },
    });

    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(typeof cuerpo.token).toBe('string');
    expect(cuerpo.token.length).toBeGreaterThan(20);
    expect(cuerpo.usuario.username).toBe('ernesto');
    expect(JSON.stringify(cuerpo)).not.toContain('scrypt'); // nunca se filtra el hash
  });

  it('rechaza una contrasena incorrecta', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: usuario, password: 'equivocada' },
    });

    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.json().error.codigo).toBe('SIN_ACCESO');
  });

  it('rechaza un usuario inexistente', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'nadie', password: 'lo-que-sea' },
    });

    expect(respuesta.statusCode).toBe(401);
  });

  it('exige datos validos y explica que falta', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: '' },
    });

    expect(respuesta.statusCode).toBe(422);
    const cuerpo = respuesta.json();
    expect(cuerpo.error.codigo).toBe('DATOS_INVALIDOS');
    expect(cuerpo.error.detalles.length).toBeGreaterThan(0);
  });

  it('no deja ver la sesion sin token', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(respuesta.statusCode).toBe(401);
  });

  it('devuelve el usuario, sus permisos y sus sucursales con token valido', async () => {
    const token = await iniciarSesion();
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(cuerpo.usuario.username).toBe('ernesto');
    expect(cuerpo.roles).toContain('administrador');
    expect(cuerpo.permisos).toContain('sale.sell');
    expect(cuerpo.permisos).toContain('devices.approve');
    expect(cuerpo.sucursales).toHaveLength(2);
    expect(cuerpo.sucursales.map((s: { codigo: string }) => s.codigo).sort()).toEqual([
      'BODEGA',
      'CENTRO',
    ]);
    expect(cuerpo.usuario).not.toHaveProperty('passwordHash');
  });

  it('rechaza un token invalido', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer token-falso' },
    });

    expect(respuesta.statusCode).toBe(401);
  });

  it('rechaza el cambio de contrasena si la actual no coincide', async () => {
    const token = await iniciarSesion();
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { actual: 'no-es-la-correcta', nueva: 'otra-clave-123' },
    });

    expect(respuesta.statusCode).toBe(401);
  });

  it('exige una contrasena nueva de al menos 8 caracteres', async () => {
    const token = await iniciarSesion();
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { actual: password, nueva: 'corta' },
    });

    expect(respuesta.statusCode).toBe(422);
  });

  it('cambia la contrasena y deja de aceptar la anterior', async () => {
    const token = await iniciarSesion();
    const nueva = 'nueva-clave-123';

    const cambio = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { actual: password, nueva },
    });
    expect(cambio.statusCode).toBe(200);

    const conNueva = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: usuario, password: nueva },
    });
    expect(conNueva.statusCode).toBe(200);

    const conVieja = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: usuario, password },
    });
    expect(conVieja.statusCode).toBe(401);

    password = nueva;
  });
});
