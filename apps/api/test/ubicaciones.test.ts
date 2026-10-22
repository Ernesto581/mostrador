import { schema } from '@mostrador/db-cloud';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';

/**
 * Ubicaciones: piso de venta, almacen y transferencias entre ellas.
 *
 * Las reglas de la especificacion: se vende solo del piso (salvo que el local lo
 * permita), el almacen no cuenta como disponible para vender, una transferencia
 * dentro del mismo local se confirma en un paso y una entre locales pasa por
 * despacho y recepcion.
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

/** Existencias de un producto en una sucursal, separadas en piso y almacen. */
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

async function fijarVentaDesdeAlmacen(activa: boolean): Promise<void> {
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/branches/${semilla.sucursalId}`,
    headers: auth(),
    payload: { ventaDesdeAlmacen: activa },
  });
}

describe('piso de venta y almacen', () => {
  it('la sucursal de ejemplo tiene piso de venta y almacen separados', async () => {
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

  it('una entrada de compra llega al almacen, no al piso de venta', async () => {
    const antes = await existencias('BEB-003');
    await entrarAlAlmacen('BEB-003', 6);
    const despues = await existencias('BEB-003');

    expect(despues.almacen).toBe(antes.almacen + 6);
    expect(despues.piso).toBe(antes.piso);
  });

  it('una venta descuenta solo del piso de venta', async () => {
    await entrarAlAlmacen('BEB-001', 10);
    const antes = await existencias('BEB-001');

    const respuesta = await vender('BEB-001', 2);
    expect(respuesta.statusCode).toBe(201);

    const despues = await existencias('BEB-001');
    expect(despues.piso).toBe(antes.piso - 2);
    expect(despues.almacen).toBe(antes.almacen);
  });

  it('no vende mas de lo que hay en el piso si el local no vende desde el almacen', async () => {
    await fijarVentaDesdeAlmacen(false);
    const piso = await existencias('BEB-001');

    const respuesta = await vender('BEB-001', piso.piso + 1);
    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('SIN_EXISTENCIA');
  });

  it('el catalogo del mostrador muestra solo lo que hay en el piso', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/products/barcode/7501001100011?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });
    const piso = await existencias('BEB-001');

    expect(respuesta.json().producto.stock).toBe(piso.piso);
  });

  it('con venta desde almacen activa, la venta toma primero el piso y luego el almacen', async () => {
    await fijarVentaDesdeAlmacen(true);
    const antes = await existencias('BEB-004');
    const cantidad = antes.piso + 2;
    await entrarAlAlmacen('BEB-004', 5);
    const conAlmacen = await existencias('BEB-004');

    const respuesta = await vender('BEB-004', cantidad);
    expect(respuesta.statusCode).toBe(201);

    const despues = await existencias('BEB-004');
    expect(despues.piso).toBe(0);
    expect(despues.almacen).toBe(conAlmacen.almacen - 2);

    await fijarVentaDesdeAlmacen(false);
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
  });
});

describe('transferencias dentro del mismo local', () => {
  it('pasar del almacen al piso se confirma en un solo paso', async () => {
    await entrarAlAlmacen('BOT-001', 4);
    const antes = await existencias('BOT-001');

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.almacenId,
        destinoUbicacionId: semilla.pisoId,
        motivo: 'Surtir el piso',
        lineas: [{ productoId: producto('BOT-001').id, cantidad: 4 }],
      },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.json().transferencia.estado).toBe('recibida');

    const despues = await existencias('BOT-001');
    expect(despues.almacen).toBe(antes.almacen - 4);
    expect(despues.piso).toBe(antes.piso + 4);
  });

  it('no permite pedir mas de lo que hay en el almacen', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.almacenId,
        destinoUbicacionId: semilla.pisoId,
        lineas: [{ productoId: producto('BOT-001').id, cantidad: 9999 }],
      },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('SIN_EXISTENCIA');
  });
});

describe('transferencias entre locales', () => {
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
    expect((await existencias('ABA-002')).piso).toBe(origenAntes.piso);

    const despachada = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferencia.id}/dispatch`,
      headers: auth(),
    });
    expect(despachada.json().transferencia.estado).toBe('en_transito');
    expect((await existencias('ABA-002')).piso).toBe(origenAntes.piso - 5);
    expect((await existencias('ABA-002', semilla.sucursalSecundariaId)).almacen).toBe(
      destinoAntes.almacen,
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
    expect((await existencias('ABA-002', semilla.sucursalSecundariaId)).almacen).toBe(
      destinoAntes.almacen + 4,
    );
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
    expect((await existencias('ABA-003')).piso).toBe(origenAntes.piso);
    expect((await existencias('ABA-003', semilla.sucursalSecundariaId)).almacen).toBe(0);
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
    expect((await existencias('ABA-004')).piso).toBe(origenAntes.piso);

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
