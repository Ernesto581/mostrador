import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Producto, Turno, VentaRespuesta } from '../src/api/tipos';
import type { VentaPendiente } from '../src/servicios/almacenLocal';

/**
 * El almacen local del telefono: IndexedDB con copia en memoria.
 *
 * Cada prueba arranca con una base de datos vacia y un localStorage vacio; "reiniciar"
 * la app es cerrar el almacen y volver a abrirlo desde IndexedDB.
 */

type Almacen = typeof import('../src/servicios/almacenLocal');

function crearLocalStorage(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() {
      return datos.size;
    },
    key: (indice: number) => [...datos.keys()][indice] ?? null,
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => {
      datos.set(clave, String(valor));
    },
    removeItem: (clave: string) => {
      datos.delete(clave);
    },
    clear: () => datos.clear(),
  } as unknown as Storage;
}

async function cargarAlmacen(): Promise<Almacen> {
  vi.resetModules();
  return import('../src/servicios/almacenLocal');
}

function venta(id: string, vendidoEn: string): VentaPendiente {
  return {
    id,
    folio: `CENTRO-20261021-${id.padStart(4, '0')}-K4X2`,
    sucursalId: 'S1',
    turnoId: 'T1',
    vendidoEn,
    lineas: [{ productoId: 'P1', cantidad: 2 }],
    pagos: [{ metodo: 'efectivo', monto: 5000 }],
    venta: { id, folio: `CENTRO-20261021-${id}` } as unknown as VentaRespuesta,
  };
}

const producto = { id: 'P1', sku: 'BEB-001', nombre: 'Refresco', stock: 10 } as unknown as Producto;
const turno = { id: 'T1', sucursalId: 'S1' } as unknown as Turno;
const DIA = new Date(2026, 9, 21, 10, 30);

let almacen: Almacen;

beforeEach(() => {
  globalThis.localStorage = crearLocalStorage();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await almacen?.cerrarAlmacen();
});

describe('almacen local en IndexedDB', () => {
  it('pasa a IndexedDB lo que habia en localStorage y lo borra de ahi', async () => {
    localStorage.setItem('mostrador.token', 'sesion-del-servidor');
    localStorage.setItem('mostrador.catalogo.S1', JSON.stringify([producto]));
    localStorage.setItem('mostrador.turno.S1', JSON.stringify(turno));
    localStorage.setItem(
      'mostrador.cola',
      JSON.stringify([venta('1', '2026-10-21T09:00:00.000Z'), venta('2', '2026-10-21T09:05:00.000Z')]),
    );
    localStorage.setItem('mostrador.folios', JSON.stringify({ 'CENTRO-20261021': 3 }));
    localStorage.setItem('mostrador.dispositivo', JSON.stringify('K4X2'));

    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();

    expect(almacen.leerCola()).toHaveLength(2);
    expect(almacen.leerCatalogo('S1')).toHaveLength(1);
    expect(almacen.leerTurno('S1')?.id).toBe('T1');
    expect(almacen.codigoDeDispositivo()).toBe('K4X2');
    expect(await almacen.siguienteFolioLocal('CENTRO', DIA)).toBe('CENTRO-20261021-0004-K4X2');

    expect(localStorage.getItem('mostrador.token')).toBe('sesion-del-servidor');
    expect(localStorage.getItem('mostrador.cola')).toBeNull();
    expect(localStorage.getItem('mostrador.catalogo.S1')).toBeNull();
  });

  it('una venta sin conexion sobrevive a un reinicio de la app', async () => {
    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();
    await almacen.encolarVenta(venta('7', '2026-10-21T10:00:00.000Z'));

    await almacen.cerrarAlmacen();
    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();

    const cola = almacen.leerCola();
    expect(cola.map((pendiente) => pendiente.id)).toEqual(['7']);
    expect(cola[0]?.lineas[0]?.cantidad).toBe(2);
  });

  it('el folio no se repite despues de reiniciar la app', async () => {
    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();
    expect(await almacen.siguienteFolioLocal('CENTRO', DIA)).toMatch(/-0001-/);
    expect(await almacen.siguienteFolioLocal('CENTRO', DIA)).toMatch(/-0002-/);

    await almacen.cerrarAlmacen();
    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();

    expect(await almacen.siguienteFolioLocal('CENTRO', DIA)).toMatch(/-0003-/);
  });

  it('el error de una venta rechazada tambien sobrevive al reinicio', async () => {
    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();
    await almacen.encolarVenta(venta('9', '2026-10-21T10:00:00.000Z'));
    almacen.marcarErrorEnCola('9', 'Ya no hay existencia');

    await almacen.cerrarAlmacen();
    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();

    expect(almacen.leerCola()[0]?.error).toBe('Ya no hay existencia');
  });

  it('las ventas pendientes se leen de la mas antigua a la mas reciente', async () => {
    almacen = await cargarAlmacen();
    await almacen.abrirAlmacen();
    await almacen.encolarVenta(venta('2', '2026-10-21T11:00:00.000Z'));
    await almacen.encolarVenta(venta('1', '2026-10-21T09:00:00.000Z'));

    expect(almacen.leerCola().map((pendiente) => pendiente.id)).toEqual(['1', '2']);
  });

  it('sin IndexedDB la app abre, pero no se puede vender sin conexion', async () => {
    // @ts-expect-error: el navegador de prueba no tiene IndexedDB
    globalThis.indexedDB = undefined;

    almacen = await cargarAlmacen();
    await expect(almacen.abrirAlmacen()).resolves.toBeUndefined();

    await expect(almacen.encolarVenta(venta('3', '2026-10-21T12:00:00.000Z'))).rejects.toThrow();
    await expect(almacen.siguienteFolioLocal('CENTRO', DIA)).rejects.toThrow();
  });
});
