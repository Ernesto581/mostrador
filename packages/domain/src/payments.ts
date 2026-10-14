/**
 * Cobro: pagos simples y MIXTOS, y calculo del cambio.
 *
 * Reglas de negocio:
 *   - Se puede pagar con uno o varios metodos a la vez.
 *   - Lo pagado no puede ser menor al total.
 *   - El cambio SOLO se entrega en efectivo: por eso lo pagado con tarjeta o
 *     transferencia no puede exceder el total.
 */

import { CERO, type Centavos, restar, sumar } from './money.js';

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';

export const METODOS_PAGO: readonly MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia'];

export interface PagoEntrada {
  metodo: MetodoPago;
  monto: Centavos;
  /** Referencia de la terminal, autorizacion o folio de la transferencia. */
  referencia?: string | undefined;
}

export interface ResultadoCobro {
  total: Centavos;
  pagado: Centavos;
  cambio: Centavos;
  porMetodo: Record<MetodoPago, Centavos>;
}

export function calcularCobro(total: Centavos, pagos: readonly PagoEntrada[]): ResultadoCobro {
  if (total < 0) {
    throw new Error('El total no puede ser negativo');
  }
  if (pagos.length === 0) {
    throw new Error('Se requiere al menos un pago');
  }

  const porMetodo: Record<MetodoPago, Centavos> = {
    efectivo: CERO,
    tarjeta: CERO,
    transferencia: CERO,
  };

  for (const pago of pagos) {
    if (pago.monto < 0) {
      throw new Error('El monto de un pago no puede ser negativo');
    }
    porMetodo[pago.metodo] = sumar(porMetodo[pago.metodo], pago.monto);
  }

  const pagado = sumar(porMetodo.efectivo, porMetodo.tarjeta, porMetodo.transferencia);

  if (pagado < total) {
    throw new Error(`Pago insuficiente: faltan ${total - pagado} centavos`);
  }

  const noEfectivo = sumar(porMetodo.tarjeta, porMetodo.transferencia);
  if (noEfectivo > total) {
    throw new Error(
      'El pago con tarjeta o transferencia no puede exceder el total: el cambio solo se entrega en efectivo',
    );
  }

  return {
    total,
    pagado,
    cambio: restar(pagado, total),
    porMetodo,
  };
}
