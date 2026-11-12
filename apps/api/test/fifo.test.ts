import { schema } from '@mostrador/db-cloud';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';

let app: FastifyInstance;
let semilla: ResultadoSemilla;
let tokenAdmin = '';
let tokenCajero = '';

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
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

function producto(sku: string) {
  const encontrado = semilla.productos.find((candidato) => candidato.sku === sku);
  if (!encontrado) throw new Error(`No existe el producto ${sku}`);
  return encontrado;
}

describe('valoración FIFO por lote', () => {
  beforeAll(async () => {
    app = await construirServidor();
    await app.ready();
    semilla = await sembrarDatosIniciales(app.db, {
      usuario: 'fifo_admin',
      password: 'fifo_admin',
    });
    tokenAdmin = await iniciarSesion('fifo_admin', 'fifo_admin');
    tokenCajero = await iniciarSesion(semilla.usuarioCajero, semilla.passwordCajero);
  });

  afterAll(async () => {
    await app.close();
  });

  it('consume primero el lote antiguo y conserva el costo real de cada lote', async () => {
    const arroz = producto('ABA-001');

    const limpiar = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: auth(tokenAdmin),
      payload: {
        sucursalId: semilla.sucursalId,
        almacenId: semilla.pisoId,
        productoId: arroz.id,
        tipo: 'merma',
        cantidad: 18,
        motivo: 'Preparar escenario FIFO',
      },
    });
    expect(limpiar.statusCode).toBe(201);

    for (const [cantidad, costo] of [
      [100, 300],
      [50, 360],
    ]) {
      const entrada = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory/movements',
        headers: auth(tokenAdmin),
        payload: {
          sucursalId: semilla.sucursalId,
          almacenId: semilla.pisoId,
          productoId: arroz.id,
          tipo: 'entrada_compra',
          cantidad,
          costoUnitario: costo,
          precioVenta: 500,
          motivo: 'Compra FIFO',
        },
      });
      expect(entrada.statusCode).toBe(201);
    }

    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: auth(tokenCajero),
      payload: {
        sucursalId: semilla.sucursalId,
        lineas: [{ productoId: arroz.id, cantidad: 120 }],
        pagos: [{ metodo: 'efectivo', monto: 60000 }],
      },
    });
    expect(venta.statusCode).toBe(201);
    const ventaId = venta.json().venta.id as string;

    const [linea] = await app.db
      .select()
      .from(schema.saleLines)
      .where(eq(schema.saleLines.saleId, ventaId));
    expect(linea?.unitCost).toBe(310);

    const lotes = await app.db
      .select()
      .from(schema.saleLineLots)
      .where(eq(schema.saleLineLots.saleLineId, linea!.id));
    expect(lotes.map((lote) => [lote.quantity, lote.unitCost])).toEqual([
      [100, 300],
      [20, 360],
    ]);
  });
});
