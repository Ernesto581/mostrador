import { schema } from '@mostrador/db-cloud';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashearSecreto } from '../src/auth/password.js';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';
import { nuevoId } from '../src/util/id.js';

/**
 * Reportes: ventas, utilidad y productos mas vendidos.
 *
 * La utilidad se calcula con el costo guardado en cada linea al vender, no con
 * el costo actual del producto. Y cada usuario ve solo sus sucursales.
 */

let app: FastifyInstance;
let semilla: ResultadoSemilla;
let tokenAdmin = '';
let tokenCajero = '';
let tokenReporteCentro = '';

const DESDE = '2020-01-01T00:00:00.000Z';
const HASTA = '2030-01-01T00:00:00.000Z';

beforeAll(async () => {
  app = await construirServidor();
  await app.ready();
  semilla = await sembrarDatosIniciales(app.db, {
    usuario: 'ernesto',
    password: 'mostrador123',
  });

  tokenAdmin = await iniciarSesion('ernesto', 'mostrador123');
  tokenCajero = await iniciarSesion(semilla.usuarioCajero, semilla.passwordCajero);

  await vender(tokenCajero, semilla.sucursalId, producto('BEB-002').id, 2, 3000, 'efectivo');
  await vender(tokenCajero, semilla.sucursalId, producto('BEB-003').id, 1, 2500, 'tarjeta');

  // Una venta en la otra sucursal para comprobar el alcance.
  const entrada = await app.inject({
    method: 'POST',
    url: '/api/v1/inventory/movements',
    headers: auth(tokenAdmin),
    payload: {
      sucursalId: semilla.sucursalSecundariaId,
      productoId: producto('ABA-001').id,
      tipo: 'entrada_compra',
      cantidad: 10,
      costoUnitario: 2400,
      motivo: 'Stock para reportes',
    },
  });
  expect(entrada.statusCode).toBe(201);

  await vender(
    tokenCajero,
    semilla.sucursalSecundariaId,
    producto('ABA-001').id,
    1,
    4000,
    'efectivo',
  );

  // Un gasto pagado de la caja para comprobar el resumen del dashboard.
  const turno = await app.inject({
    method: 'POST',
    url: '/api/v1/shifts',
    headers: auth(tokenCajero),
    payload: { sucursalId: semilla.sucursalId, fondoInicial: 10000 },
  });
  expect(turno.statusCode).toBe(201);

  const gasto = await app.inject({
    method: 'POST',
    url: '/api/v1/cash-movements',
    headers: auth(tokenCajero),
    payload: {
      sucursalId: semilla.sucursalId,
      turnoId: turno.json().turno.id,
      tipo: 'gasto',
      monto: 500,
      motivo: 'Gasto de prueba',
    },
  });
  expect(gasto.statusCode).toBe(201);

  const rolReporte = nuevoId();
  await app.db.insert(schema.roles).values({
    id: rolReporte,
    companyId: semilla.empresaId,
    code: 'reporte_centro',
    name: 'Reportes de Centro',
    permissions: ['report.profit'],
  });

  const usuarioId = nuevoId();
  await app.db.insert(schema.users).values({
    id: usuarioId,
    companyId: semilla.empresaId,
    username: 'reporte_centro',
    fullName: 'Reportes de Centro',
    passwordHash: await hashearSecreto('reporte123'),
  });
  await app.db.insert(schema.userRoles).values({ userId: usuarioId, roleId: rolReporte });
  await app.db
    .insert(schema.userBranchAccess)
    .values({ userId: usuarioId, branchId: semilla.sucursalId });

  tokenReporteCentro = await iniciarSesion('reporte_centro', 'reporte123');
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

async function iniciarSesion(username: string, password: string): Promise<string> {
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  expect(respuesta.statusCode).toBe(200);
  return respuesta.json().token as string;
}

async function vender(
  token: string,
  sucursalId: string,
  productoId: string,
  cantidad: number,
  monto: number,
  metodo: 'efectivo' | 'tarjeta' | 'transferencia',
): Promise<void> {
  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/sales',
    headers: auth(token),
    payload: {
      sucursalId,
      lineas: [{ productoId, cantidad }],
      pagos: [{ metodo, monto }],
    },
  });
  expect(respuesta.statusCode).toBe(201);
}

async function resumen(token: string, extra = ''): Promise<Record<string, any>> {
  const respuesta = await app.inject({
    method: 'GET',
    url: `/api/v1/reports/resumen?desde=${DESDE}&hasta=${HASTA}${extra}`,
    headers: auth(token),
  });
  expect(respuesta.statusCode).toBe(200);
  return respuesta.json() as Record<string, any>;
}

describe('reporte de ventas', () => {
  it('suma ventas, costo y utilidad de las sucursales de la sesion', async () => {
    const reporte = await resumen(tokenAdmin);

    expect(reporte.resumen.tickets).toBe(3);
    expect(reporte.resumen.ventaBruta).toBe(8500);
    expect(reporte.resumen.ventaNeta).toBe(8500);
    expect(reporte.resumen.costo).toBe(5000);
    expect(reporte.resumen.utilidad).toBe(3500);
    expect(reporte.resumen.ticketPromedio).toBe(2833);
    expect(reporte.resumen.margen).toBeCloseTo(3500 / 8500, 5);
    expect(reporte.resumen.compras).toBe(24000);
    expect(reporte.resumen.gastos).toBe(500);
    expect(reporte.resumen.gastosCaja).toBe(500);
    expect(reporte.resumen.utilidadNeta).toBe(3000);
    expect(reporte.porSucursal).toHaveLength(2);
  });

  it('ordena los mas vendidos por importe o por cantidad', async () => {
    const porImporte = await resumen(tokenAdmin);
    expect(porImporte.masVendidos[0].sku).toBe('ABA-001');
    expect(porImporte.masVendidos[0].venta).toBe(3600);
    expect(porImporte.masVendidos[0].utilidad).toBe(1200);

    const porCantidad = await resumen(tokenAdmin, '&por=cantidad');
    expect(porCantidad.masVendidos[0].sku).toBe('BEB-002');
    expect(porCantidad.masVendidos[0].cantidad).toBe(2);
  });

  it('desglosa los cobros por forma de pago', async () => {
    const reporte = await resumen(tokenAdmin);
    const porMetodo = new Map(
      (reporte.pagos as { metodo: string; monto: number }[]).map((pago) => [
        pago.metodo,
        pago.monto,
      ]),
    );

    expect(porMetodo.get('efectivo')).toBe(7000);
    expect(porMetodo.get('tarjeta')).toBe(2500);
  });

  it('limita el reporte a las sucursales asignadas', async () => {
    const reporte = await resumen(tokenReporteCentro);

    expect(reporte.resumen.tickets).toBe(2);
    expect(reporte.resumen.ventaBruta).toBe(4900);
    expect(reporte.resumen.costo).toBe(2600);
    expect(reporte.resumen.utilidad).toBe(2300);
    expect(reporte.resumen.compras).toBe(0);
    expect(reporte.resumen.gastos).toBe(500);
    expect(reporte.resumen.utilidadNeta).toBe(1800);
    expect(reporte.porSucursal).toHaveLength(1);
    expect(reporte.masVendidos.map((fila: { sku: string }) => fila.sku)).not.toContain('ABA-001');
  });

  it('rechaza una sucursal ajena', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/resumen?desde=${DESDE}&hasta=${HASTA}&sucursalId=${semilla.sucursalSecundariaId}`,
      headers: auth(tokenReporteCentro),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('exige el permiso de utilidad', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/resumen?desde=${DESDE}&hasta=${HASTA}`,
      headers: auth(tokenCajero),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('rechaza un rango de fechas al reves', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/resumen?desde=${HASTA}&hasta=${DESDE}`,
      headers: auth(tokenAdmin),
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().error.codigo).toBe('RANGO_INVALIDO');
  });
});
