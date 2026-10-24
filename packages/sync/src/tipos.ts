/** Identificador unico de una operacion (idempotencia). */
export type OpId = string;

/** Tipo de operacion que se sincroniza. */
export type TipoOperacion =
  | 'venta'
  | 'devolucion'
  | 'cancelacion'
  | 'cierre_turno'
  | 'movimiento_inventario';

/** Estado de una operacion en la cola. */
export type EstadoOp = 'pendiente' | 'enviando' | 'enviada' | 'error' | 'conflicto';

/** Operacion encolada para sincronizar. */
export interface OpPendiente {
  opId: OpId;
  tipo: TipoOperacion;
  /** Payload serializable de la operacion. */
  payload: unknown;
  creadaEn: string;
  intentos: number;
  estado: EstadoOp;
  /** Ultimo error si fallo. */
  error?: string;
}

/** Resultado de enviar una operacion al servidor. */
export interface ResultadoEnvio {
  opId: OpId;
  ok: boolean;
  /** Si el servidor detecto un conflicto (ej. sobreventa). */
  conflicto?: boolean;
  mensaje?: string;
}

/** Cursor de sincronizacion (descarga incremental). */
export interface CursorSync {
  entidad: string;
  valor: string;
}