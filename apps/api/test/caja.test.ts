import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';

let app: FastifyInstance;
let semilla: ResultadoSemilla;
let token = '';
let turnoId = '';

beforeAll(async () => {
  app = await construirServidor();
  await app.ready();
  semilla = await sembrarDatosIniciales(app.db, {
    usuario: 'ernesto',
    password: 'mostrador123',
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

function auth(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function producto(sku: string) {
  const encontrado = semilla.productos.find((candidato) => candidato.sku === sku);
  if (!encontrado) {
    throw new Error(`No existe el producto ${sku}`);
  }
  return encontrado;
}

describe('caja y cierre de turno', () => {
  it('abre el turno con su fondo inicial', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/shifts',
      headers: auth(),
      payload: { sucursalId: semilla.sucursalId, fondoInicial: 20000, notas: 'Turno de prueba' },
    });

    expect(respuesta.statusCode).toBe(201);
    const { turno } = respuesta.json();
    expect(turno.fondoInicial).toBe(20000);
    expect(turno.estado).toBe('abierto');

    turnoId = turno.id;
  });

  it('no deja abrir un segundo turno en la misma sucursal', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/shifts',
      headers: auth(),
      payload: { sucursalId: semilla.sucursalId, fondoInicial: 0 },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('TURNO_YA_ABIERTO');
  });

  it('el turno actual se consulta desde la sucursal', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/shifts/actual?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().turno.id).toBe(turnoId);
    expect(respuesta.json().resumen.efectivoEsperado).toBe(20000);
  });

  it('las ventas del turno se cobran y quedan ligadas a el', async () => {
    // Efectivo: 2 x $12.00 = $24.00, paga $50.00 => cambio $26.00
    const efectivo = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        turnoId,
        lineas: [{ productoId: producto('BEB-002').id, cantidad: 2 }],
        pagos: [{ metodo: 'efectivo', monto: 5000 }],
      },
    });
    expect(efectivo.statusCode).toBe(201);
    expect(efectivo.json().venta.cambio).toBe(2600);

    // Tarjeta: 1 x $25.00
    const tarjeta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        turnoId,
        lineas: [{ productoId: producto('BEB-003').id, cantidad: 1 }],
        pagos: [{ metodo: 'tarjeta', monto: 2500, referencia: 'AUT-1' }],
      },
    });
    expect(tarjeta.statusCode).toBe(201);
  });

  it('no deja sacar mas efectivo del que hay en la caja', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        turnoId,
        tipo: 'retiro',
        monto: 99999999,
        motivo: 'Retiro imposible',
      },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('CAJA_INSUFICIENTE');
  });

  it('registra un retiro de efectivo de la caja', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        turnoId,
        tipo: 'retiro',
        monto: 1000,
        motivo: 'Pago al proveedor de refrescos',
      },
    });

    expect(respuesta.statusCode).toBe(201);
  });

  it('el resumen cuadra el efectivo que deberia haber', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/shifts/${turnoId}/resumen`,
      headers: auth(),
    });

    expect(respuesta.statusCode).toBe(200);
    const { resumen } = respuesta.json();

    expect(resumen.ventas.cantidad).toBe(2);
    expect(resumen.ventas.total).toBe(4900);
    expect(resumen.porMetodo.efectivo).toBe(5000);
    expect(resumen.porMetodo.tarjeta).toBe(2500);
    expect(resumen.movimientos.retiros).toBe(1000);

    // 200.00 de fondo + 50.00 cobrados en efectivo − 26.00 de cambio − 10.00 retirados
    expect(resumen.efectivoEsperado).toBe(20000 + 5000 - 2600 - 1000);
  });

  it('cierra el turno con el arqueo y guarda la diferencia', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/shifts/${turnoId}/cerrar`,
      headers: auth(),
      payload: { contado: 21400, notas: 'Contado por la manana' },
    });

    expect(respuesta.statusCode).toBe(200);
    const { cierre } = respuesta.json();

    expect(cierre.esperado).toBe(21400);
    expect(cierre.contado).toBe(21400);
    expect(cierre.diferencia).toBe(0);
    expect(cierre.folio).toMatch(/^CIERRE-/);
  });

  it('guarda el descuadre cuando el conteo no coincide', async () => {
    const abrir = await app.inject({
      method: 'POST',
      url: '/api/v1/shifts',
      headers: auth(),
      payload: { sucursalId: semilla.sucursalId, fondoInicial: 10000 },
    });
    const segundoTurno = abrir.json().turno.id as string;

    const cerrar = await app.inject({
      method: 'POST',
      url: `/api/v1/shifts/${segundoTurno}/cerrar`,
      headers: auth(),
      payload: { contado: 9500, notas: 'Faltaron 5 pesos' },
    });

    expect(cerrar.statusCode).toBe(200);
    expect(cerrar.json().cierre.diferencia).toBe(-500);
  });

  it('no deja cerrar dos veces el mismo turno', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/shifts/${turnoId}/cerrar`,
      headers: auth(),
      payload: { contado: 21400 },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('TURNO_CERRADO');
  });

  it('el historial de cierres trae los dos arqueos', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/cash-closures',
      headers: auth(),
    });

    expect(respuesta.statusCode).toBe(200);
    const cierres = respuesta.json().cierres as { diferencia: number; sucursal: string }[];
    expect(cierres.length).toBeGreaterThanOrEqual(2);
    expect(cierres.some((cierre) => cierre.diferencia === -500)).toBe(true);
    expect(cierres.every((cierre) => cierre.sucursal === 'CENTRO')).toBe(true);
  });

  it('no hay turno abierto al terminar', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/shifts/actual?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });

    expect(respuesta.json().turno).toBeNull();
  });
});
