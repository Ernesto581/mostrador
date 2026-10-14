/**
 * Inventario: el kardex.
 *
 * El stock NO es un numero que se edita: es la SUMA CON SIGNO de los movimientos.
 * Cada operacion (vender, comprar, mermar, ajustar, transferir) agrega un movimiento,
 * y cancelar o devolver agrega un movimiento inverso.
 *
 * Gracias a esto, sincronizar dos sucursales es unir listas y no hay conflictos
 * por "el mismo dato": nadie sobrescribe el stock, solo se agregan hechos.
 *
 * La cantidad de un movimiento siempre es POSITIVA; el tipo determina su signo.
 */

import { CERO, type Centavos, multiplicarPor, sumar } from './money.js';

export const TIPOS_MOVIMIENTO = [
  'inventario_inicial',
  'entrada_compra',
  'salida_venta',
  'devolucion_cliente',
  'devolucion_proveedor',
  'ajuste_positivo',
  'ajuste_negativo',
  'merma',
  'transferencia_entrada',
  'transferencia_salida',
] as const;

export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

const SIGNO: Record<TipoMovimiento, 1 | -1> = {
  inventario_inicial: 1,
  entrada_compra: 1,
  salida_venta: -1,
  devolucion_cliente: 1,
  devolucion_proveedor: -1,
  ajuste_positivo: 1,
  ajuste_negativo: -1,
  merma: -1,
  transferencia_entrada: 1,
  transferencia_salida: -1,
};

export interface MovimientoInventario {
  productoId: string;
  sucursalId: string;
  tipo: TipoMovimiento;
  /** Cantidad siempre positiva; el signo lo determina el tipo. */
  cantidad: number;
  /** Costo unitario en el momento del movimiento (valorizacion y utilidad). */
  costoUnitario?: Centavos | undefined;
  fecha: Date;
  /** Folio o identificador del documento que origino el movimiento. */
  documento?: string | undefined;
}

export interface FiltroStock {
  productoId?: string;
  sucursalId?: string;
}

export function signoMovimiento(tipo: TipoMovimiento): 1 | -1 {
  const signo = SIGNO[tipo];
  if (signo === undefined) {
    throw new Error(`Tipo de movimiento desconocido: ${tipo}`);
  }
  return signo;
}

export function cantidadConSigno(movimiento: MovimientoInventario): number {
  if (!Number.isInteger(movimiento.cantidad) || movimiento.cantidad < 0) {
    throw new Error(`Cantidad invalida: ${movimiento.cantidad}`);
  }
  return movimiento.cantidad * signoMovimiento(movimiento.tipo);
}

function coincide(movimiento: MovimientoInventario, filtro?: FiltroStock): boolean {
  if (filtro?.productoId !== undefined && movimiento.productoId !== filtro.productoId) {
    return false;
  }
  if (filtro?.sucursalId !== undefined && movimiento.sucursalId !== filtro.sucursalId) {
    return false;
  }
  return true;
}

/** Saldo disponible = suma con signo de los movimientos que coinciden con el filtro. */
export function saldo(
  movimientos: readonly MovimientoInventario[],
  filtro?: FiltroStock,
): number {
  return movimientos
    .filter((movimiento) => coincide(movimiento, filtro))
    .reduce((acumulado, movimiento) => acumulado + cantidadConSigno(movimiento), 0);
}

export function hayStockSuficiente(
  movimientos: readonly MovimientoInventario[],
  requerimiento: { productoId: string; sucursalId: string; cantidad: number },
): boolean {
  return saldo(movimientos, requerimiento) >= requerimiento.cantidad;
}

/** Valor del inventario: suma de cantidad con signo por costo unitario. */
export function valorInventario(movimientos: readonly MovimientoInventario[]): Centavos {
  const valores: Centavos[] = [];
  for (const movimiento of movimientos) {
    if (movimiento.costoUnitario === undefined) {
      continue;
    }
    valores.push(multiplicarPor(movimiento.costoUnitario, cantidadConSigno(movimiento)));
  }
  return valores.length === 0 ? CERO : sumar(...valores);
}
