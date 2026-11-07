import type { TipoMovimiento } from '../api/tipos';

/**
 * Nombres y etiquetas de los movimientos de inventario.
 *
 * Se comparten entre la pantalla de existencias y la de movimientos para que un
 * mismo tipo se llame igual en todas partes.
 */

/** Tipos que se pueden registrar a mano desde el panel. */
export const TIPOS_MANUALES: { valor: TipoMovimiento; etiqueta: string }[] = [
  { valor: 'entrada_compra', etiqueta: 'Entrada por compra' },
  { valor: 'merma', etiqueta: 'Merma (se perdio o se rompio)' },
  { valor: 'ajuste_positivo', etiqueta: 'Ajuste que suma' },
  { valor: 'ajuste_negativo', etiqueta: 'Ajuste que resta' },
  { valor: 'devolucion_proveedor', etiqueta: 'Devolucion a proveedor' },
  { valor: 'inventario_inicial', etiqueta: 'Inventario inicial' },
];

export const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  inventario_inicial: 'Inventario inicial',
  entrada_compra: 'Entrada por compra',
  salida_venta: 'Venta',
  devolucion_cliente: 'Devolucion de cliente',
  devolucion_proveedor: 'Devolucion a proveedor',
  ajuste_positivo: 'Ajuste que suma',
  ajuste_negativo: 'Ajuste que resta',
  merma: 'Merma',
  transferencia_entrada: 'Entrada por transferencia',
  transferencia_salida: 'Salida por transferencia',
};

/** Los movimientos que quitan existencia: en el kardex se pintan con signo menos. */
export const MOVIMIENTOS_QUE_RESTAN = new Set([
  'salida_venta',
  'devolucion_proveedor',
  'ajuste_negativo',
  'merma',
  'transferencia_salida',
]);
