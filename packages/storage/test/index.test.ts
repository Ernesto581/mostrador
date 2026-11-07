import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearAlmacenIndexedDB } from '../src/index.js';

/**
 * El adaptador de almacenamiento local.
 *
 * Se prueba contra una implementacion de IndexedDB en memoria para comprobar que
 * las cuatro operaciones basicas quedan realmente guardadas en la base.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory() as unknown as IDBFactory;
});

describe('crearAlmacenIndexedDB', () => {
  it('guarda, lee, lista y borra valores', async () => {
    const almacen = crearAlmacenIndexedDB('prueba-storage');

    expect(await almacen.get('inexistente')).toBeUndefined();

    await almacen.set('clave', { nombre: 'valor', numero: 7 });

    expect(await almacen.get('clave')).toEqual({ nombre: 'valor', numero: 7 });
    expect(await almacen.keys()).toEqual(['clave']);

    await almacen.remove('clave');

    expect(await almacen.get('clave')).toBeUndefined();
    expect(await almacen.keys()).toEqual([]);
  });
});
