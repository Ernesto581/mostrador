import { crearAlmacenIndexedDB } from '@mostrador/storage';
import { cargarCola, guardarCola, sincronizar, type AdaptadorSync } from '@mostrador/sync';
import { api } from '../api/cliente';

const almacen = crearAlmacenIndexedDB('mostrador_local');

const adaptador: AdaptadorSync = {
  async enviar(op) {
    const res = await api.syncPush([{ opId: op.opId, tipo: op.tipo, payload: op.payload }]);
    const r = res.resultados[0];
    const resultado: { opId: string; ok: boolean; conflicto: boolean; mensaje?: string } = {
      opId: op.opId,
      ok: r?.ok ?? false,
      conflicto: false,
    };
    if (r?.duplicada) resultado.mensaje = 'duplicada';
    return resultado;
  },
  async descargar(cursor) {
    const res = await api.syncPull(cursor ? Number(cursor) : undefined);
    return { cambios: res.cambios, nuevoCursor: String(res.cursor) };
  },
};

export async function encolarOperacion(opId: string, tipo: string, payload: unknown): Promise<void> {
  const cola = await cargarCola(almacen);
  cola.encolar({ opId, tipo: tipo as any, payload });
  await guardarCola(almacen, cola);
}

export async function sincronizarAhora(): Promise<void> {
  const cursor = (await almacen.get<string>('mostrador.cursor_sync')) ?? null;
  await sincronizar(almacen, adaptador, cursor);
}

export async function pendientesCount(): Promise<number> {
  const cola = await cargarCola(almacen);
  return cola.pendientesCount();
}