import { schema } from '@mostrador/db-cloud';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';

/**
 * Inventario por sucursal.
 *
 * Internamente cada sucursal conserva piso de venta y almacen, pero la operacion
 * es a nivel de sucursal: el stock se suma, la venta toma primero del piso y
 * despues del almacen, y las transferencias son entre sucursales distintas.
 */

let app: FastifyInstance;
let semilla: ResultadoSemilla;
let token = '';
let tokenCajero = '';

beforeAll(async () => {
  app = await construirServidor();
  await app.ready();
  semilla = await sembrarDatosIniciales(app.db, {
    usuario: 'ernesto',
    password: 'mostrador123',
  });

  const admin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'ernesto', password: 'mostrador123' },
  });
  token = admin.json().token as string;

  const cajero = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: semilla.usuarioCajero, password: semilla.passwordCajero },
  });
  tokenCajero = cajero.json().token as string;
});

afterAll(async () => {
  await app.close();
});

function auth(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function authCajero(): Record<string, string> {
  return { authorization: `Bearer ${tokenCajero}` };
}

function producto(sku: string): { id: string; precioVenta: number } {
  const encontrado = semilla.productos.find((candidato) => candidato.sku === sku);
  if (!encontrado) {
    throw new Error(`No existe el producto de ejemplo ${sku}`);
  }
  return encontrado;
}

/** Existencias de un producto en una sucursal, con el total de la sucursal. */
async function existencias(sku: string, sucursalId = semilla.sucursalId) {
  const respuesta = await app.inject({
    method: 'GET',
    url: `/api/v1/inventory/stock?sucursalId=${sucursalId}&buscar=${sku}`,
    headers: auth(),
  });
  const fila = (respuesta.json().stock as { sku: string; piso: number; almacen: number; stock: number }[]).find(
    (candidata) => candidata.sku === sku,
  );
  return { piso: fila?.piso ?? 0, almacen: fila?.almacen ?? 0, total: fila?.stock ?? 0 };
}

async function entrarAlAlmacen(sku: string, cantidad: number): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/inventory/movements',
    headers: auth(),
    payload: {
      sucursalId: semilla.sucursalId,
      almacenId: semilla.almacenId,
      productoId: producto(sku).id,
      tipo: 'entrada_compra',
      cantidad,
      motivo: 'Compra de prueba',
    },
  });
}

async function entrarSinUbicacion(sku: string, cantidad: number) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/inventory/movements',
    headers: auth(),
    payload: {
      sucursalId: semilla.sucursalId,
      productoId: producto(sku).id,
      tipo: 'entrada_compra',
      cantidad,
      motivo: 'Compra de prueba',
    },
  });
}

async function vender(sku: string, cantidad: number) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/sales',
    headers: authCajero(),
    payload: {
      sucursalId: semilla.sucursalId,
      lineas: [{ productoId: producto(sku).id, cantidad }],
      pagos: [{ metodo: 'efectivo', monto: 100000 }],
    },
  });
}

describe('stock por sucursal', () => {
  it('la sucursal de ejemplo conserva piso de venta y almacen internos', async () => {
    const [piso] = await app.db
      .select({ tipo: schema.warehouses.kind })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, semilla.pisoId));
    const [almacen] = await app.db
      .select({ tipo: schema.warehouses.kind })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, semilla.almacenId));

    expect(piso?.tipo).toBe('piso_venta');
    expect(almacen?.tipo).toBe('almacen');
  });

  it('una entrada de compra suma al stock y entra al piso', async () => {
    const antes = await existencias('BEB-003');
    const respuesta = await entrarSinUbicacion('BEB-003', 6);
    expect(respuesta.statusCode).toBe(201);

    const despues = await existencias('BEB-003');
    expect(despues.total).toBe(antes.total + 6);
    expect(despues.piso).toBe(antes.piso + 6);
    expect(despues.almacen).toBe(antes.almacen);
  });

  it('una merma sin ubicacion descuenta del stock de la sucursal', async () => {
    const antes = await existencias('ABA-001');
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        productoId: producto('ABA-001').id,
        tipo: 'merma',
        cantidad: antes.total,
        motivo: 'Conteo fisico',
      },
    });

    expect(respuesta.statusCode).toBe(201);
    expect((await existencias('ABA-001')).total).toBe(0);
  });

  it('una salida manual toma del piso y despues del almacen', async () => {
    await entrarAlAlmacen('DUL-003', 5);
    const antes = await existencias('DUL-003');
    const cantidad = antes.piso + 3;

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        productoId: producto('DUL-003').id,
        tipo: 'merma',
        cantidad,
        motivo: 'Conteo fisico',
      },
    });

    expect(respuesta.statusCode).toBe(201);
    const despues = await existencias('DUL-003');
    expect(despues.piso).toBe(0);
    expect(despues.almacen).toBe(antes.almacen - 3);
    expect(despues.total).toBe(antes.total - cantidad);
  });

  it('una venta no toma directamente del almacen', async () => {
    await entrarAlAlmacen('BEB-004', 5);
    const antes = await existencias('BEB-004');
    const cantidad = antes.piso + 2;

    const respuesta = await vender('BEB-004', cantidad);
    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('SIN_EXISTENCIA');

    const despues = await existencias('BEB-004');
    expect(despues.piso).toBe(antes.piso);
    expect(despues.almacen).toBe(antes.almacen);
    expect(despues.total).toBe(antes.total);
  });

  it('no vende mas que el stock total de la sucursal', async () => {
    const antes = await existencias('BEB-001');
    const respuesta = await vender('BEB-001', antes.total + 1);
    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('SIN_EXISTENCIA');
  });

  it('el catalogo del mostrador muestra el stock total de la sucursal', async () => {
    await entrarAlAlmacen('BEB-001', 10);
    const total = await existencias('BEB-001');
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/products/barcode/7501001100011?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });

    expect(respuesta.json().producto.stock).toBe(total.total);
  });

  it('anular una venta devuelve la mercancia al piso de venta', async () => {
    const antes = await existencias('BOT-002');
    const venta = await vender('BOT-002', 1);
    const ventaId = venta.json().venta.id;
    expect((await existencias('BOT-002')).piso).toBe(antes.piso - 1);

    const anulada = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${ventaId}/void`,
      headers: auth(),
      payload: { motivo: 'Cliente cambio de opinion' },
    });
    expect(anulada.statusCode).toBe(200);
    expect((await existencias('BOT-002')).piso).toBe(antes.piso);
    expect((await existencias('BOT-002')).total).toBe(antes.total);
  });
});

describe('transferencias entre sucursales', () => {
  it('rechaza mover mercancia dentro de la misma sucursal', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.almacenId,
        destinoUbicacionId: semilla.pisoId,
        lineas: [{ productoId: producto('BOT-001').id, cantidad: 1 }],
      },
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().error.codigo).toBe('MISMA_SUCURSAL');
  });

  it('el origen baja al despachar y el destino sube al recibir, con incidencia si llega menos', async () => {
    const origenAntes = await existencias('ABA-002');
    const destinoAntes = await existencias('ABA-002', semilla.sucursalSecundariaId);

    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        motivo: 'Reabasto',
        lineas: [{ productoId: producto('ABA-002').id, cantidad: 5 }],
      },
    });
    const transferencia = creada.json().transferencia;
    expect(transferencia.estado).toBe('borrador');
    expect((await existencias('ABA-002')).total).toBe(origenAntes.total);

    const despachada = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferencia.id}/dispatch`,
      headers: auth(),
    });
    expect(despachada.json().transferencia.estado).toBe('en_transito');
    expect((await existencias('ABA-002')).total).toBe(origenAntes.total - 5);
    expect((await existencias('ABA-002', semilla.sucursalSecundariaId)).total).toBe(
      destinoAntes.total,
    );

    const lineaId = despachada.json().transferencia.lineas[0].id;
    const recibida = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferencia.id}/receive`,
      headers: auth(),
      payload: { lineas: [{ lineaId, cantidadRecibida: 4 }] },
    });

    expect(recibida.json().transferencia.estado).toBe('recibida');
    expect(recibida.json().transferencia.hayIncidencia).toBe(true);
    expect(recibida.json().transferencia.lineas[0].recibida).toBe(4);
    expect((await existencias('ABA-002', semilla.sucursalSecundariaId)).total).toBe(
      destinoAntes.total + 4,
    );
  });

  it('el despacho toma tambien del almacen si el piso no alcanza', async () => {
    await entrarAlAlmacen('BEB-002', 10);
    const conAlmacen = await existencias('BEB-002');

    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        lineas: [{ productoId: producto('BEB-002').id, cantidad: conAlmacen.piso + 2 }],
      },
    });
    expect(creada.statusCode).toBe(201);

    const despachada = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${creada.json().transferencia.id}/dispatch`,
      headers: auth(),
    });
    expect(despachada.statusCode).toBe(200);

    const despues = await existencias('BEB-002');
    expect(despues.piso).toBe(0);
    expect(despues.total).toBe(conAlmacen.total - (conAlmacen.piso + 2));
  });

  it('rechazar devuelve la mercancia completa al origen', async () => {
    const origenAntes = await existencias('ABA-003');
    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        lineas: [{ productoId: producto('ABA-003').id, cantidad: 3 }],
      },
    });
    const id = creada.json().transferencia.id;
    await app.inject({ method: 'POST', url: `/api/v1/inventory/transfers/${id}/dispatch`, headers: auth() });

    const rechazada = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${id}/reject`,
      headers: auth(),
      payload: { motivo: 'No era lo pedido' },
    });

    expect(rechazada.json().transferencia.estado).toBe('rechazada');
    expect((await existencias('ABA-003')).total).toBe(origenAntes.total);
    expect((await existencias('ABA-003', semilla.sucursalSecundariaId)).total).toBe(0);
  });

  it('solo se puede cancelar antes de despachar', async () => {
    const origenAntes = await existencias('ABA-004');
    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        lineas: [{ productoId: producto('ABA-004').id, cantidad: 2 }],
      },
    });
    const id = creada.json().transferencia.id;

    const cancelada = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${id}/cancel`,
      headers: auth(),
    });
    expect(cancelada.json().transferencia.estado).toBe('cancelada');
    expect((await existencias('ABA-004')).total).toBe(origenAntes.total);

    const despues = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${id}/dispatch`,
      headers: auth(),
    });
    expect(despues.statusCode).toBe(409);
    expect(despues.json().error.codigo).toBe('ESTADO_INVALIDO');
  });

  it('no se puede recibir dos veces la misma transferencia', async () => {
    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        lineas: [{ productoId: producto('DUL-001').id, cantidad: 1 }],
      },
    });
    const id = creada.json().transferencia.id;
    await app.inject({ method: 'POST', url: `/api/v1/inventory/transfers/${id}/dispatch`, headers: auth() });
    await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${id}/receive`,
      headers: auth(),
      payload: {},
    });

    const segunda = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${id}/receive`,
      headers: auth(),
      payload: {},
    });
    expect(segunda.statusCode).toBe(409);
  });

  it('un cajero no puede transferir mercancia', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: authCajero(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        lineas: [{ productoId: producto('DUL-002').id, cantidad: 1 }],
      },
    });

    expect(respuesta.statusCode).toBe(403);
  });

  it('la lista de transferencias incluye las que tocan la sucursal', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/transfers?sucursalId=${semilla.sucursalSecundariaId}`,
      headers: auth(),
    });

    expect(respuesta.statusCode).toBe(200);
    const transferencias = respuesta.json().transferencias as {
      origen: { sucursalId: string };
      destino: { sucursalId: string };
    }[];
    expect(transferencias.length).toBeGreaterThan(0);
    expect(
      transferencias.every(
        (transferencia) =>
          transferencia.destino.sucursalId === semilla.sucursalSecundariaId ||
          transferencia.origen.sucursalId === semilla.sucursalSecundariaId,
      ),
    ).toBe(true);
  });
});
