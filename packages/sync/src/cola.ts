import type { OpId, OpPendiente } from './tipos.js';

/**
 * Cola de operaciones pendientes de sincronizacion.
 *
 * En memoria por defecto; el adaptador de almacenamiento (IndexedDB/SQLite)
 * persiste la cola entre sesiones. Esta clase encapsula la logica y es testeable.
 */
export class ColaSync {
  private ops: OpPendiente[] = [];

  constructor(inicial: OpPendiente[] = []) {
    this.ops = [...inicial];
  }

  encolar(op: Omit<OpPendiente, 'creadaEn' | 'intentos' | 'estado'>): OpPendiente {
    const existente = this.ops.find((o) => o.opId === op.opId);
    if (existente) {
      return existente;
    }
    const nueva: OpPendiente = {
      ...op,
      creadaEn: new Date().toISOString(),
      intentos: 0,
      estado: 'pendiente',
    };
    this.ops.push(nueva);
    return nueva;
  }

  listarPendientes(): OpPendiente[] {
    return this.ops.filter((o) => o.estado === 'pendiente' || o.estado === 'error');
  }

  listarTodas(): OpPendiente[] {
    return [...this.ops];
  }

  marcarEnviando(opId: OpId): void {
    const op = this.buscar(opId);
    if (op) {
      op.estado = 'enviando';
      op.intentos += 1;
    }
  }

  marcarEnviada(opId: OpId): void {
    const op = this.buscar(opId);
    if (op) {
      op.estado = 'enviada';
    }
  }

  marcarError(opId: OpId, error: string): void {
    const op = this.buscar(opId);
    if (op) {
      op.estado = 'error';
      op.error = error;
    }
  }

  marcarConflicto(opId: OpId, mensaje: string): void {
    const op = this.buscar(opId);
    if (op) {
      op.estado = 'conflicto';
      op.error = mensaje;
    }
  }

  pendientesCount(): number {
    return this.ops.filter((o) => o.estado === 'pendiente' || o.estado === 'error').length;
  }

  private buscar(opId: OpId): OpPendiente | undefined {
    return this.ops.find((o) => o.opId === opId);
  }
}