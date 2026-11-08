import { schema } from '@mostrador/db-cloud';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashearSecreto } from '../src/auth/password.js';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';
import { nuevoId } from '../src/util/id.js';

/**
 * Reglas de acceso a ventas.
 *
 * Una sesion solo puede ver, cancelar o devolver ventas de las sucursales que
 * tiene asignadas. Los descuentos tienen un limite validado en el servidor y
 * exigen el permiso correspondiente. Nada de esto puede depender de la pantalla.
 */

let app: FastifyInstance;
let semilla: ResultadoSemilla;

let tokenVendedor = '';
let tokenVendedorAmplio = '';
let tokenSupervisor = '';
let tokenSinDescuento = '';
let tokenAdmin = '';

let ventaSecundariaId = '';
let turnoSecundariaId = '';

const PASSWORD = 'secreto123';

beforeAll(async () => {
  app = await construirServidor();
  await app.ready();
  semilla = await sembrarDatosIniciales(app.db, {
    usuario: 'ernesto',
    password: 'mostrador123',
  });

  tokenAdmin = await iniciarSesion('ernesto', 'mostrador123');

  const rolCajero = nuevoId();
  await app.db.insert(schema.roles).values({
    id: rolCajero,
    companyId: semilla.empresaId,
    code: 'cajero_prueba',
    name: 'Cajero de prueba',
    permissions: ['sale.sell', 'sale.discount', 'cash.close'],
  });

  // Puede vender y cancelar, pero solo tiene acceso a la sucursal principal.
  const rolSupervisor = nuevoId();
  await app.db.insert(schema.roles).values({
    id: rolSupervisor,
    companyId: semilla.empresaId,
    code: 'supervisor_prueba',
    name: 'Supervisor de prueba',
    permissions: ['sale.sell', 'sale.discount', 'sale.void', 'cash.close', 'report.profit'],
  });

  // Puede vender, pero no aplicar descuentos.
  const rolSinDescuento = nuevoId();
  await app.db.insert(schema.roles).values({
    id: rolSinDescuento,
    companyId: semilla.empresaId,
    code: 'vendedor_sin_descuento_prueba',
    name: 'Vendedor sin descuento',
    permissions: ['sale.sell'],
  });

  await crearUsuario('vendedor_centro', [rolCajero], [semilla.sucursalId]);
  await crearUsuario(
    'vendedor_amplio',
    [rolCajero],
    [semilla.sucursalId, semilla.sucursalSecundariaId],
  );
  await crearUsuario('supervisor_centro', [rolSupervisor], [semilla.sucursalId]);
  await crearUsuario('vendedor_sin_descuento', [rolSinDescuento], [semilla.sucursalId]);

  tokenVendedor = await iniciarSesion('vendedor_centro');
  tokenVendedorAmplio = await iniciarSesion('vendedor_amplio');
  tokenSupervisor = await iniciarSesion('supervisor_centro');
  tokenSinDescuento = await iniciarSesion('vendedor_sin_descuento');

  // El catalogo de ejemplo solo trae stock en la sucursal principal: se manda
  // mercancia a la bodega para poder vender alli.
  const entrada = await app.inject({
    method: 'POST',
    url: '/api/v1/inventory/movements',
    headers: auth(tokenAdmin),
    payload: {
      sucursalId: semilla.sucursalSecundariaId,
      productoId: producto('ABA-001').id,
      tipo: 'entrada_compra',
      cantidad: 10,
      costoUnitario: 1000,
      motivo: 'Stock para pruebas de acceso',
    },
  });
  expect(entrada.statusCode).toBe(201);

  const venta = await app.inject({
    method: 'POST',
    url: '/api/v1/sales',
    headers: auth(tokenVendedorAmplio),
    payload: {
      sucursalId: semilla.sucursalSecundariaId,
      lineas: [{ productoId: producto('ABA-001').id, cantidad: 1 }],
      pagos: [{ metodo: 'efectivo', monto: 100000 }],
    },
  });
  expect(venta.statusCode).toBe(201);
  ventaSecundariaId = venta.json().venta.id as string;

  // Una venta en la sucursal principal para comprobar el listado filtrado.
  const ventaCentro = await app.inject({
    method: 'POST',
    url: '/api/v1/sales',
    headers: auth(tokenVendedor),
    payload: {
      sucursalId: semilla.sucursalId,
      lineas: [{ productoId: producto('BEB-002').id, cantidad: 1 }],
      pagos: [{ metodo: 'efectivo', monto: 2000 }],
    },
  });
  expect(ventaCentro.statusCode).toBe(201);

  // Un turno abierto en la sucursal secundaria para probar el alcance de caja.
  const turno = await app.inject({
    method: 'POST',
    url: '/api/v1/shifts',
    headers: auth(tokenVendedorAmplio),
    payload: { sucursalId: semilla.sucursalSecundariaId, fondoInicial: 0 },
  });
  expect(turno.statusCode).toBe(201);
  turnoSecundariaId = turno.json().turno.id as string;
}, 120_000);

afterAll(async () => {
  await app.close();
});

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function producto(sku: string) {
  const encontrado = semilla.productos.find((candidato) => candidato.sku === sku);
  if (!encontrado) {
    throw new Error(`No existe el producto de ejemplo ${sku}`);
  }
  return encontrado;
}

async function iniciarSesion(username: string, password = PASSWORD): Promise<string> {
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  expect(respuesta.statusCode).toBe(200);
  return respuesta.json().token as string;
}

async function crearUsuario(
  username: string,
  roles: string[],
  sucursales: string[],
): Promise<string> {
  const id = nuevoId();
  await app.db.insert(schema.users).values({
    id,
    companyId: semilla.empresaId,
    username,
    fullName: username,
    passwordHash: await hashearSecreto(PASSWORD),
  });
  await app.db
    .insert(schema.userRoles)
    .values(roles.map((roleId) => ({ userId: id, roleId })));
  await app.db
    .insert(schema.userBranchAccess)
    .values(sucursales.map((branchId) => ({ userId: id, branchId })));
  return id;
}

async function stockDe(sku: string, sucursalId = semilla.sucursalId): Promise<number> {
  const respuesta = await app.inject({
    method: 'GET',
    url: `/api/v1/inventory/stock?sucursalId=${sucursalId}&buscar=${sku}`,
    headers: auth(tokenSinDescuento),
  });
  const filas = respuesta.json().stock as { sku: string; stock: number }[];
  return filas.find((fila) => fila.sku === sku)?.stock ?? 0;
}

function ventaDePrueba(descuento: Record<string, number>) {
  return {
    sucursalId: semilla.sucursalId,
    lineas: [{ productoId: producto('BEB-002').id, cantidad: 1, ...descuento }],
    pagos: [{ metodo: 'efectivo', monto: 2000 }],
  };
}

describe('alcance por sucursal', () => {
  it('al listar sin sucursal explicita solo devuelve las sucursales de la sesion', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/sales',
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(200);
    const ventas = respuesta.json().ventas as { id: string; sucursalId: string }[];
    expect(ventas.length).toBeGreaterThan(0);
    expect(ventas.every((venta) => venta.sucursalId === semilla.sucursalId)).toBe(true);
    expect(ventas.map((venta) => venta.id)).not.toContain(ventaSecundariaId);
  });

  it('rechaza listar una sucursal a la que no se tiene acceso', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?sucursalId=${semilla.sucursalSecundariaId}`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('rechaza ver el detalle de una venta de otra sucursal', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${ventaSecundariaId}`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('rechaza cancelar una venta de otra sucursal aunque se tenga el permiso', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${ventaSecundariaId}/void`,
      headers: auth(tokenSupervisor),
      payload: { motivo: 'Intento desde otra sucursal' },
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');

    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${ventaSecundariaId}`,
      headers: auth(tokenVendedorAmplio),
    });
    expect(detalle.statusCode).toBe(200);
    expect(detalle.json().venta.status).toBe('completada');
  });

  it('rechaza devolver una venta de otra sucursal', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${ventaSecundariaId}/returns`,
      headers: auth(tokenSupervisor),
      payload: {
        motivo: 'Intento desde otra sucursal',
        lineas: [{ lineaId: 'cualquiera', cantidad: 1 }],
      },
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });
});

describe('descuentos', () => {
  it('acepta el limite del 15%', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(tokenVendedor),
      payload: ventaDePrueba({ descuentoPorcentaje: 15 }),
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.json().venta.descuentoTotal).toBe(180);
  });

  it('rechaza un descuento mayor al 15% sin tocar el inventario', async () => {
    const antes = await stockDe('BEB-002');

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(tokenVendedor),
      payload: ventaDePrueba({ descuentoPorcentaje: 20 }),
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().error.codigo).toBe('DESCUENTO_EXCEDIDO');
    expect(await stockDe('BEB-002')).toBe(antes);
  });

  it('no deja esquivar el limite con un descuento en monto fijo', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(tokenVendedor),
      payload: ventaDePrueba({ descuentoMonto: 500 }),
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().error.codigo).toBe('DESCUENTO_EXCEDIDO');
  });

  it('exige el permiso de descuentos para aplicarlos', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(tokenSinDescuento),
      payload: ventaDePrueba({ descuentoPorcentaje: 5 }),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('deja vender sin descuento a quien no tiene ese permiso', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(tokenSinDescuento),
      payload: ventaDePrueba({}),
    });

    expect(respuesta.statusCode).toBe(201);
  });
});

describe('caja', () => {
  it('el administrador ve los turnos abiertos de todas las sucursales y el cajero no', async () => {
    const propios = await app.inject({
      method: 'GET',
      url: '/api/v1/shifts/abiertos',
      headers: auth(tokenSupervisor),
    });
    expect(propios.statusCode).toBe(200);
    const idsPropios = (propios.json().turnos as { id: string }[]).map((turno) => turno.id);
    expect(idsPropios).not.toContain(turnoSecundariaId);

    const todos = await app.inject({
      method: 'GET',
      url: '/api/v1/shifts/abiertos',
      headers: auth(tokenAdmin),
    });
    expect(todos.statusCode).toBe(200);
    const idsTodos = (todos.json().turnos as { id: string }[]).map((turno) => turno.id);
    expect(idsTodos).toContain(turnoSecundariaId);

    const cajero = await app.inject({
      method: 'GET',
      url: '/api/v1/shifts/abiertos',
      headers: auth(tokenVendedorAmplio),
    });
    expect(cajero.statusCode).toBe(403);
    expect(cajero.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('rechaza el resumen de un turno de otra sucursal', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/shifts/${turnoSecundariaId}/resumen`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('rechaza cerrar un turno de otra sucursal', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/shifts/${turnoSecundariaId}/cerrar`,
      headers: auth(tokenVendedor),
      payload: { contado: 0 },
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('rechaza consultar cierres de una sucursal ajena', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/cash-closures?sucursalId=${semilla.sucursalSecundariaId}`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('cierra el turno propio y no lo muestra a una sesion de otra sucursal', async () => {
    const cierre = await app.inject({
      method: 'POST',
      url: `/api/v1/shifts/${turnoSecundariaId}/cerrar`,
      headers: auth(tokenVendedorAmplio),
      payload: { contado: 0 },
    });
    expect(cierre.statusCode).toBe(200);
    expect(cierre.json().cierre.id).toBeTruthy();

    const cierresAjenos = await app.inject({
      method: 'GET',
      url: '/api/v1/cash-closures',
      headers: auth(tokenSupervisor),
    });
    expect(cierresAjenos.statusCode).toBe(200);
    const sucursales = (cierresAjenos.json().cierres as { sucursalId: string }[]).map(
      (fila) => fila.sucursalId,
    );
    expect(sucursales).not.toContain(semilla.sucursalSecundariaId);
  });
});

describe('costos e inventario', () => {
  it('no envia costos al vendedor en el catalogo', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/products?buscar=BEB-002&sucursalId=${semilla.sucursalId}`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(200);
    const encontrado = respuesta.json().productos[0];
    expect(encontrado).not.toHaveProperty('precioCosto');
    expect(encontrado).not.toHaveProperty('costoPromedio');
    expect(encontrado.stock).toBeGreaterThan(0);
  });

  it('si envia costos a la administracion', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/products?buscar=BEB-002&sucursalId=${semilla.sucursalId}`,
      headers: auth(tokenAdmin),
    });

    expect(respuesta.statusCode).toBe(200);
    const encontrado = respuesta.json().productos[0];
    expect(encontrado).toHaveProperty('precioCosto');
    expect(encontrado).toHaveProperty('costoPromedio');
  });

  it('rechaza consultar el catalogo de una sucursal ajena', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/products?buscar=ABA-001&sucursalId=${semilla.sucursalSecundariaId}`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('no envia el costo promedio al escanear un codigo', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/products/barcode/7501001100080?sucursalId=${semilla.sucursalId}`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().producto).not.toHaveProperty('costoPromedio');
  });

  it('oculta los costos en el stock al vendedor y los muestra a la administracion', async () => {
    const delVendedor = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/stock?sucursalId=${semilla.sucursalId}&buscar=BEB-002`,
      headers: auth(tokenVendedor),
    });
    expect(delVendedor.statusCode).toBe(200);
    const filaVendedor = delVendedor.json().stock[0];
    expect(filaVendedor).not.toHaveProperty('precioCosto');
    expect(filaVendedor).not.toHaveProperty('costoPromedio');

    const delAdmin = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/stock?sucursalId=${semilla.sucursalId}&buscar=BEB-002`,
      headers: auth(tokenAdmin),
    });
    expect(delAdmin.statusCode).toBe(200);
    expect(delAdmin.json().stock[0]).toHaveProperty('precioCosto');
  });

  it('reserva el inventario general a la administracion', async () => {
    const delVendedor = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/stock-general',
      headers: auth(tokenVendedor),
    });
    expect(delVendedor.statusCode).toBe(403);
    expect(delVendedor.json().error.codigo).toBe('SIN_PERMISO');

    const delAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/stock-general',
      headers: auth(tokenAdmin),
    });
    expect(delAdmin.statusCode).toBe(200);
  });

  it('el inventario general solo reparte las sucursales de la sesion', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/stock-general',
      headers: auth(tokenSupervisor),
    });

    expect(respuesta.statusCode).toBe(200);
    const { stock, sucursales } = respuesta.json() as {
      stock: { reparto: { sucursalId: string }[] }[];
      sucursales: { id: string }[];
    };
    expect(sucursales).toHaveLength(1);
    expect(sucursales[0]?.id).toBe(semilla.sucursalId);
    expect(stock.length).toBeGreaterThan(0);
    expect(
      stock.every((fila) =>
        fila.reparto.every((parte) => parte.sucursalId === semilla.sucursalId),
      ),
    ).toBe(true);
  });

  it('no muestra movimientos de otras sucursales ni sus costos al vendedor', async () => {
    const delVendedor = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/movements?limite=100',
      headers: auth(tokenVendedor),
    });
    expect(delVendedor.statusCode).toBe(200);
    const movimientos = delVendedor.json().movimientos as {
      sucursalId: string;
      costoUnitario?: number;
    }[];
    expect(movimientos.length).toBeGreaterThan(0);
    expect(movimientos.every((fila) => fila.sucursalId === semilla.sucursalId)).toBe(true);
    expect(movimientos.every((fila) => !('costoUnitario' in fila))).toBe(true);

    const delAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/movements?limite=100',
      headers: auth(tokenAdmin),
    });
    const delAdminMovimientos = delAdmin.json().movimientos as {
      sucursalId: string;
      costoUnitario?: number;
    }[];
    expect(
      delAdminMovimientos.some((fila) => fila.sucursalId === semilla.sucursalSecundariaId),
    ).toBe(true);
    expect(delAdminMovimientos.some((fila) => fila.costoUnitario !== undefined)).toBe(true);
  });

  it('rechaza el kardex de una sucursal ajena', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/movements?sucursalId=${semilla.sucursalSecundariaId}`,
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('no expone la lista completa de sucursales al vendedor', async () => {
    const delVendedor = await app.inject({
      method: 'GET',
      url: '/api/v1/branches',
      headers: auth(tokenVendedor),
    });
    expect(delVendedor.statusCode).toBe(403);
    expect(delVendedor.json().error.codigo).toBe('SIN_PERMISO');

    const delAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/branches',
      headers: auth(tokenAdmin),
    });
    expect(delAdmin.statusCode).toBe(200);
  });

  it('no expone los roles ni sus permisos al vendedor', async () => {
    const delVendedor = await app.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: auth(tokenVendedor),
    });
    expect(delVendedor.statusCode).toBe(403);
    expect(delVendedor.json().error.codigo).toBe('SIN_PERMISO');

    const delAdmin = await app.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: auth(tokenAdmin),
    });
    expect(delAdmin.statusCode).toBe(200);
  });

  it('solo lista las ubicaciones de las sucursales de la sesion', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/locations',
      headers: auth(tokenVendedor),
    });

    expect(respuesta.statusCode).toBe(200);
    const ubicaciones = respuesta.json().ubicaciones as { sucursalId: string }[];
    expect(ubicaciones.length).toBeGreaterThan(0);
    expect(ubicaciones.every((fila) => fila.sucursalId === semilla.sucursalId)).toBe(true);
  });
});
