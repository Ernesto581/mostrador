import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';

let app: FastifyInstance;
let semilla: ResultadoSemilla;
let token = '';

beforeAll(async () => {
  app = await construirServidor();
  await app.ready();
  semilla = await sembrarDatosIniciales(app.db, {
    usuario: 'ernesto',
    password: 'mostrador123',
    conProductosEjemplo: false,
  });

  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'ernesto', password: 'mostrador123' },
  });
  token = respuesta.json().token as string;
});

afterAll(async () => {
  await app.close();
});

function auth(propio = token): Record<string, string> {
  return { authorization: `Bearer ${propio}` };
}

async function crearVendedor(username = 'vendedor1'): Promise<string> {
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: auth(),
    payload: {
      username,
      nombre: 'Vendedor Uno',
      password: 'vendedor123',
      rol: 'cajero',
      sucursalIds: [semilla.sucursalId],
    },
  });
  expect(respuesta.statusCode).toBe(201);
  return respuesta.json().usuario.id as string;
}

describe('usuarios', () => {
  it('lista el administrador de la semilla con su rol y su sucursal', async () => {
    const respuesta = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth() });

    expect(respuesta.statusCode).toBe(200);
    const { usuarios } = respuesta.json();
    const admin = usuarios.find((usuario: { username: string }) => usuario.username === 'ernesto');

    expect(admin.roles).toContain('administrador');
    expect(admin.sucursales.length).toBe(2);
    expect(JSON.stringify(usuarios)).not.toContain('scrypt');
  });

  it('crea un vendedor y ese vendedor puede entrar', async () => {
    await crearVendedor();

    const sesion = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'vendedor1', password: 'vendedor123' },
    });
    expect(sesion.statusCode).toBe(200);

    const yo = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: auth(sesion.json().token as string),
    });

    expect(yo.json().roles).toContain('cajero');
    expect(yo.json().sucursales).toHaveLength(1);
    expect(yo.json().permisos).not.toContain('users.manage');
  });

  it('rechaza un nombre de usuario repetido', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(),
      payload: {
        username: 'vendedor1',
        nombre: 'Otro',
        password: 'otra12345',
        rol: 'cajero',
        sucursalIds: [semilla.sucursalId],
      },
    });

    expect(respuesta.statusCode).toBe(409);
  });

  it('rechaza un rol que no existe', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(),
      payload: {
        username: 'raro',
        nombre: 'Raro',
        password: 'raro12345',
        rol: 'pirata',
        sucursalIds: [semilla.sucursalId],
      },
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().error.codigo).toBe('ROL_INVALIDO');
  });

  it('un vendedor no puede gestionar usuarios', async () => {
    const sesion = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'vendedor1', password: 'vendedor123' },
    });
    const tokenVendedor = sesion.json().token as string;

    const listar = await app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(tokenVendedor) });
    const crear = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(tokenVendedor),
      payload: {
        username: 'colado',
        nombre: 'Colado',
        password: 'colado123',
        rol: 'cajero',
        sucursalIds: [semilla.sucursalId],
      },
    });

    expect(listar.statusCode).toBe(403);
    expect(crear.statusCode).toBe(403);
  });

  it('cambia la contrasena de un usuario', async () => {
    const usuarioId = await crearVendedor('vendedor2');

    const cambio = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${usuarioId}/password`,
      headers: auth(),
      payload: { password: 'nueva-clave-123' },
    });
    expect(cambio.statusCode).toBe(200);

    const conNueva = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'vendedor2', password: 'nueva-clave-123' },
    });
    expect(conNueva.statusCode).toBe(200);
  });

  it('desactiva un usuario y ese usuario queda fuera', async () => {
    const usuarioId = await crearVendedor('vendedor3');

    const desactivar = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${usuarioId}`,
      headers: auth(),
      payload: { activo: false },
    });
    expect(desactivar.statusCode).toBe(200);

    const sesion = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'vendedor3', password: 'vendedor123' },
    });
    expect(sesion.statusCode).toBe(401);
  });

  it('entrega roles y sucursales para el formulario', async () => {
    const listaRoles = await app.inject({ method: 'GET', url: '/api/v1/roles', headers: auth() });
    const listaSucursales = await app.inject({ method: 'GET', url: '/api/v1/branches', headers: auth() });

    const codigos = (listaRoles.json().roles as { codigo: string }[]).map((rol) => rol.codigo);
    expect(codigos).toEqual(expect.arrayContaining(['administrador', 'cajero', 'almacenista', 'contador']));
    expect(listaSucursales.json().sucursales).toHaveLength(2);
  });
});
