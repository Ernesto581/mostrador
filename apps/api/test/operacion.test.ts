import { schema } from '@mostrador/db-cloud';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashearSecreto } from '../src/auth/password.js';
import { sembrarDatosIniciales, type ResultadoSemilla } from '../src/db/seed.js';
import { construirServidor } from '../src/server.js';
import { nuevoId } from '../src/util/id.js';

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

  const respuesta = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'ernesto', password: 'mostrador123' },
  });
  token = respuesta.json().token as string;

  // Un cajero, para comprobar que los permisos se respetan de verdad.
  const [rolCajero] = await app.db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.code, 'cajero'));

  const cajeroId = nuevoId();
  await app.db.insert(schema.users).values({
    id: cajeroId,
    companyId: semilla.empresaId,
    username: 'cajero1',
    fullName: 'Cajero Uno',
    passwordHash: await hashearSecreto('cajero123'),
  });
  await app.db.insert(schema.userRoles).values({ userId: cajeroId, roleId: rolCajero!.id });
  await app.db
    .insert(schema.userBranchAccess)
    .values({ userId: cajeroId, branchId: semilla.sucursalId });

  const respuestaCajero = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'cajero1', password: 'cajero123' },
  });
  tokenCajero = respuestaCajero.json().token as string;
});

afterAll(async () => {
  await app.close();
});

function auth(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Cobrar es de la cuenta de mostrador: el administrador ya no vende. */
function authCajero(): Record<string, string> {
  return { authorization: `Bearer ${tokenCajero}` };
}

function producto(sku: string) {
  const encontrado = semilla.productos.find((candidato) => candidato.sku === sku);
  if (!encontrado) {
    throw new Error(`No existe el producto de ejemplo ${sku}`);
  }
  return encontrado;
}

async function stockDe(sku: string, sucursalId = semilla.sucursalId): Promise<number> {
  const respuesta = await app.inject({
    method: 'GET',
    url: `/api/v1/inventory/stock?sucursalId=${sucursalId}&buscar=${sku}`,
    headers: auth(),
  });
  const filas = respuesta.json().stock as { sku: string; stock: number }[];
  return filas.find((fila) => fila.sku === sku)?.stock ?? 0;
}

describe('catalogo', () => {
  it('encuentra productos por nombre', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/products?buscar=Arroz',
      headers: auth(),
    });
    expect(respuesta.statusCode).toBe(200);
    const { productos } = respuesta.json();
    expect(productos).toHaveLength(1);
    expect(productos[0].sku).toBe('ABA-001');
  });

  it('encuentra productos por codigo de barras', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/products?buscar=7501001100080',
      headers: auth(),
    });
    expect(respuesta.json().productos[0].sku).toBe('ABA-001');
  });

  it('devuelve el producto y su stock al escanear un codigo', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/products/barcode/7501001100080?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });
    expect(respuesta.statusCode).toBe(200);
    const { producto: encontrado } = respuesta.json();
    expect(encontrado.sku).toBe('ABA-001');
    expect(encontrado.stock).toBe(18);
  });

  it('avisa cuando ningun producto tiene el codigo escaneado', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/api/v1/products/barcode/0000000000000',
      headers: auth(),
    });
    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().error.codigo).toBe('NO_ENCONTRADO');
  });

  it('crea un producto con codigo de barras y stock inicial', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: auth(),
      payload: {
        sku: 'NUE-001',
        nombre: 'Producto nuevo',
        precioCosto: 1000,
        precioVenta: 2000,
        stockMinimo: 3,
        codigosBarras: ['9999999999999'],
        stockInicial: 7,
        sucursalId: semilla.sucursalId,
      },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(await stockDe('NUE-001')).toBe(7);
  });

  it('rechaza un codigo de barras repetido', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: auth(),
      payload: { sku: 'NUE-002', nombre: 'Otro', codigosBarras: ['9999999999999'] },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('DUPLICADO');
  });

  it('un cajero no puede dar de alta productos', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/products',
      headers: { authorization: `Bearer ${tokenCajero}` },
      payload: { sku: 'NUE-003', nombre: 'No permitido' },
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error.codigo).toBe('SIN_PERMISO');
  });
});

describe('inventario', () => {
  it('alerta los productos por debajo del minimo', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/stock?sucursalId=${semilla.sucursalId}&soloBajoMinimo=true`,
      headers: auth(),
    });

    const skus = (respuesta.json().stock as { sku: string }[]).map((fila) => fila.sku);
    expect(skus).toContain('BOT-003');
    expect(skus).toContain('BEB-004');
    expect(skus).not.toContain('ABA-001');
  });

  it('registra una entrada de compra y sube el stock', async () => {
    const antes = await stockDe('ABA-005');
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        productoId: producto('ABA-005').id,
        tipo: 'entrada_compra',
        cantidad: 10,
        costoUnitario: 950,
        motivo: 'Compra a proveedor',
      },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(await stockDe('ABA-005')).toBe(antes + 10);
  });

  it('registra una merma y baja el stock', async () => {
    const antes = await stockDe('ABA-005');
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        productoId: producto('ABA-005').id,
        tipo: 'merma',
        cantidad: 2,
        motivo: 'Producto vencido',
      },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(await stockDe('ABA-005')).toBe(antes - 2);
  });

  it('guarda el kardex con el motivo y el documento', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/movements?productoId=${producto('ABA-005').id}`,
      headers: auth(),
    });

    const tipos = (respuesta.json().movimientos as { tipo: string }[]).map((fila) => fila.tipo);
    expect(tipos).toContain('entrada_compra');
    expect(tipos).toContain('merma');
    expect(respuesta.json().movimientos[0].motivo).toBe('Producto vencido');
  });

  it('transfiere stock entre locales: borrador, despacho y recepcion', async () => {
    const antesCentro = await stockDe('BEB-001');
    const antesBodega = await stockDe('BEB-001', semilla.sucursalSecundariaId);

    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        motivo: 'Reabasto de bodega',
        lineas: [{ productoId: producto('BEB-001').id, cantidad: 5 }],
      },
    });

    expect(creada.statusCode).toBe(201);
    const transferencia = creada.json().transferencia;
    expect(transferencia.estado).toBe('borrador');
    expect(await stockDe('BEB-001')).toBe(antesCentro);

    const despachada = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferencia.id}/dispatch`,
      headers: auth(),
    });
    expect(despachada.json().transferencia.estado).toBe('en_transito');
    expect(await stockDe('BEB-001')).toBe(antesCentro - 5);
    expect(await stockDe('BEB-001', semilla.sucursalSecundariaId)).toBe(antesBodega);

    const recibida = await app.inject({
      method: 'POST',
      url: `/api/v1/inventory/transfers/${transferencia.id}/receive`,
      headers: auth(),
      payload: {},
    });
    expect(recibida.json().transferencia.estado).toBe('recibida');
    expect(recibida.json().transferencia.hayIncidencia).toBe(false);
    expect(await stockDe('BEB-001', semilla.sucursalSecundariaId)).toBe(antesBodega + 5);
  });

  it('no permite transferir a la misma ubicacion', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.pisoId,
        lineas: [{ productoId: producto('BEB-001').id, cantidad: 1 }],
      },
    });

    expect(respuesta.statusCode).toBe(422);
  });

  it('rechaza una merma mayor a la existencia', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        productoId: producto('ABA-005').id,
        tipo: 'merma',
        cantidad: 9999,
        motivo: 'Prueba de cantidad imposible',
      },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('SIN_EXISTENCIA');
  });

  it('rechaza transferir mas de lo que hay en el origen', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.pisoId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        lineas: [{ productoId: producto('ABA-002').id, cantidad: 9999 }],
      },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('SIN_EXISTENCIA');
  });

  it('el inventario general muestra el total y el reparto por sucursal', async () => {
    const azucar = producto('ABA-004');

    // Llegan 25 piezas a la sucursal principal.
    await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/movements',
      headers: auth(),
      payload: {
        sucursalId: semilla.sucursalId,
        productoId: azucar.id,
        tipo: 'entrada_compra',
        cantidad: 25,
        motivo: 'Compra de prueba',
      },
    });

    // 10 de esas piezas se van a la bodega (del almacen, donde llego la compra).
    const creada = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/transfers',
      headers: auth(),
      payload: {
        origenUbicacionId: semilla.almacenId,
        destinoUbicacionId: semilla.almacenSecundariaId,
        motivo: 'Reparto a bodega',
        lineas: [{ productoId: azucar.id, cantidad: 10 }],
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

    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/inventory/stock-general?buscar=${azucar.sku}`,
      headers: auth(),
    });

    expect(respuesta.statusCode).toBe(200);
    const fila = respuesta.json().stock[0];

    // Empezo con 20 y llegaron 25: hay 45 en total. La transferencia solo mueve
    // piezas de lugar, no las quita.
    expect(fila.stock).toBe(45);

    const centro = fila.reparto.find((parte: { codigo: string }) => parte.codigo === 'CENTRO');
    const bodega = fila.reparto.find((parte: { codigo: string }) => parte.codigo === 'BODEGA');

    // 20 + 25 − 10 que se fueron a la bodega.
    expect(centro.cantidad).toBe(35);
    expect(bodega.cantidad).toBe(10);
    expect(respuesta.json().sucursales).toHaveLength(2);
  });
});

describe('ventas', () => {
  let ventaId = '';
  let folio = '';
  let stockAntes = 0;

  it('registra una venta con cobro mixto y calcula el cambio', async () => {
    stockAntes = await stockDe('BEB-002');

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: authCajero(),
      payload: {
        sucursalId: semilla.sucursalId,
        lineas: [{ productoId: producto('BEB-002').id, cantidad: 3 }],
        pagos: [
          { metodo: 'tarjeta', monto: 2000, referencia: 'AUT-999' },
          { metodo: 'efectivo', monto: 2000 },
        ],
      },
    });

    expect(respuesta.statusCode).toBe(201);
    const { venta } = respuesta.json();

    // 3 x 12.00 = 36.00 ; paga 20.00 con tarjeta y 20.00 en efectivo => cambio 4.00
    expect(venta.total).toBe(3600);
    expect(venta.pagado).toBe(4000);
    expect(venta.cambio).toBe(400);
    expect(venta.articulos).toBe(3);
    expect(venta.folio).toMatch(/^CENTRO-\d{8}-\d{4}$/);

    ventaId = venta.id;
    folio = venta.folio;

    expect(await stockDe('BEB-002')).toBe(stockAntes - 3);
  });

  it('aplica descuentos y recalcula el total en el servidor', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: authCajero(),
      payload: {
        sucursalId: semilla.sucursalId,
        lineas: [{ productoId: producto('BEB-003').id, cantidad: 2, descuentoPorcentaje: 10 }],
        pagos: [{ metodo: 'efectivo', monto: 5000 }],
      },
    });

    const { venta } = respuesta.json();
    // 2 x 25.00 = 50.00, menos 10% => 45.00
    expect(venta.total).toBe(4500);
    expect(venta.descuentoTotal).toBe(500);
    expect(venta.cambio).toBe(500);
  });

  it('rechaza una venta con pago insuficiente', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: authCajero(),
      payload: {
        sucursalId: semilla.sucursalId,
        lineas: [{ productoId: producto('ABA-003').id, cantidad: 2 }],
        pagos: [{ metodo: 'efectivo', monto: 1000 }],
      },
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().error.mensaje).toMatch(/insuficiente/i);
  });

  it('rechaza cantidades invalidas', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: authCajero(),
      payload: {
        sucursalId: semilla.sucursalId,
        lineas: [{ productoId: producto('ABA-003').id, cantidad: 0 }],
        pagos: [{ metodo: 'efectivo', monto: 1000 }],
      },
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().error.codigo).toBe('DATOS_INVALIDOS');
  });

  it('rechaza vender mas de lo que hay: nada puede quedar en negativo', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: authCajero(),
      payload: {
        sucursalId: semilla.sucursalId,
        lineas: [{ productoId: producto('BOT-003').id, cantidad: 50 }],
        pagos: [{ metodo: 'efectivo', monto: 80000 }],
      },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('SIN_EXISTENCIA');
    expect(respuesta.json().error.mensaje).toMatch(/existencia/i);

    // Y no se creo ninguna venta a medias.
    const listado = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });
    const conCincuenta = (listado.json().ventas as { total: number }[]).find(
      (venta) => venta.total === 80000,
    );
    expect(conCincuenta).toBeUndefined();
  });

  it('la venta aparece en el listado y en su detalle', async () => {
    const listado = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });
    expect((listado.json().ventas as { folio: string }[]).map((fila) => fila.folio)).toContain(folio);

    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${ventaId}`,
      headers: auth(),
    });
    expect(detalle.json().lineas).toHaveLength(1);
    expect(detalle.json().pagos).toHaveLength(2);
    expect(detalle.json().venta.folio).toBe(folio);
  });

  it('cancela una venta y devuelve el stock al inventario', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${ventaId}/void`,
      headers: auth(),
      payload: { motivo: 'El cliente se arrepintio' },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().venta.estado).toBe('cancelada');
    expect(await stockDe('BEB-002')).toBe(stockAntes);
  });

  it('no permite cancelar dos veces la misma venta', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${ventaId}/void`,
      headers: auth(),
      payload: { motivo: 'Otra vez' },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('VENTA_YA_CANCELADA');
  });

  it('devuelve productos parcialmente y reingresa el stock', async () => {
    const antes = await stockDe('DUL-003');

    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: authCajero(),
      payload: {
        sucursalId: semilla.sucursalId,
        lineas: [{ productoId: producto('DUL-003').id, cantidad: 3 }],
        pagos: [{ metodo: 'efectivo', monto: 2100 }],
      },
    });
    const creada = venta.json().venta;
    expect(await stockDe('DUL-003')).toBe(antes - 3);

    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${creada.id}`,
      headers: auth(),
    });
    const linea = detalle.json().lineas[0];

    const devolucion = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${creada.id}/returns`,
      headers: auth(),
      payload: {
        motivo: 'Producto en mal estado',
        metodoReembolso: 'efectivo',
        lineas: [{ lineaId: linea.id, cantidad: 1 }],
      },
    });

    expect(devolucion.statusCode).toBe(201);
    expect(devolucion.json().devolucion.total).toBe(700);
    expect(devolucion.json().devolucion.folio).toMatch(/^DEV-CENTRO-/);
    expect(await stockDe('DUL-003')).toBe(antes - 2);
  });

  it('no permite devolver mas de lo vendido', async () => {
    const listado = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?sucursalId=${semilla.sucursalId}`,
      headers: auth(),
    });
    const ventaDulces = (listado.json().ventas as { id: string; total: number }[]).find(
      (fila) => fila.total === 2100,
    )!;

    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/${ventaDulces.id}`,
      headers: auth(),
    });
    const linea = detalle.json().lineas[0];

    const respuesta = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${ventaDulces.id}/returns`,
      headers: auth(),
      payload: {
        motivo: 'Devuelvo todo y mas',
        lineas: [{ lineaId: linea.id, cantidad: 5 }],
      },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().error.codigo).toBe('CANTIDAD_EXCEDIDA');
  });
});
