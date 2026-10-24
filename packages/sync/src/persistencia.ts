import type { AlmacenClaveValor } from '@mostrador/storage';
import type { OpPendiente } from './tipos.js';
import { ColaSync } from './cola.js';

const CLAVE_COLA = 'mostrador.cola_sync';

/** Carga la cola desde el almacen local (o una vacia si no existe). */
export async function cargarCola(almacen: AlmacenClaveValor): Promise<ColaSync> {
  const guardada = await almacen.get<OpPendiente[]>(CLAVE_COLA);
  return new ColaSync(guardada ?? []);
}

/** Guarda la cola actual en el almacen local. */
export async function guardarCola(almacen: AlmacenClaveValor, cola: ColaSync): Promise<void> {
  await almacen.set(CLAVE_COLA, cola.listarTodas());
}