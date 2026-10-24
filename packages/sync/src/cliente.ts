import type { AlmacenClaveValor } from '@mostrador/storage';

import type { OpPendiente, ResultadoEnvio } from './tipos.js';
import { cargarCola, guardarCola } from './persistencia.js';

export interface AdaptadorSync {
  /** Envia una operacion al servidor. Debe ser idempotente por opId. */
  enviar(op: OpPendiente): Promise<ResultadoEnvio>;
  /** Descarga cambios del servidor desde el cursor dado. */
  descargar(cursor: string | null): Promise<{ cambios: unknown[]; nuevoCursor: string }>;
}

export interface ResultadoSincronizacion {
  enviadas: number;
  errores: number;
  conflictos: number;
  descargados: number;
  nuevoCursor: string | null;
}

/**
 * Sincroniza: envia las operaciones pendientes y descarga cambios.
 * Persiste la cola y el cursor en el almacen local.
 */
export async function sincronizar(
  almacen: AlmacenClaveValor,
  adaptador: AdaptadorSync,
  cursorActual: string | null,
): Promise<ResultadoSincronizacion> {
  const cola = await cargarCola(almacen);
  const resultado: ResultadoSincronizacion = {
    enviadas: 0,
    errores: 0,
    conflictos: 0,
    descargados: 0,
    nuevoCursor: cursorActual,
  };

  // 1) Enviar pendientes
  for (const op of cola.listarPendientes()) {
    cola.marcarEnviando(op.opId);
    try {
      const res = await adaptador.enviar(op);
      if (res.ok) {
        if (res.conflicto) {
          cola.marcarConflicto(op.opId, res.mensaje ?? 'conflicto');
          resultado.conflictos += 1;
        } else {
          cola.marcarEnviada(op.opId);
          resultado.enviadas += 1;
        }
      } else {
        cola.marcarError(op.opId, res.mensaje ?? 'error');
        resultado.errores += 1;
      }
    } catch (error) {
      cola.marcarError(op.opId, error instanceof Error ? error.message : String(error));
      resultado.errores += 1;
    }
  }

  await guardarCola(almacen, cola);

  // 2) Descargar cambios
  try {
    const descarga = await adaptador.descargar(cursorActual);
    resultado.descargados = descarga.cambios.length;
    resultado.nuevoCursor = descarga.nuevoCursor;
    await almacen.set('mostrador.cursor_sync', descarga.nuevoCursor);
  } catch {
    // La descarga puede fallar por red; se reintenta despues.
  }

  return resultado;
}