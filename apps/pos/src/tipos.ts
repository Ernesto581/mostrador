import type { Producto } from './api/tipos';

export interface LineaCarrito {
  producto: Producto;
  cantidad: number;
  /** 0, 5, 10 o 15 por ciento. */
  descuentoPorcentaje: number;
}

export interface PagoLocal {
  metodo: 'efectivo' | 'tarjeta' | 'transferencia';
  /** Se guarda como texto porque el usuario lo esta escribiendo. */
  monto: string;
}

export const DESCUENTOS: readonly number[] = [0, 5, 10, 15];
