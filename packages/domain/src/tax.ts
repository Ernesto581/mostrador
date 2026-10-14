/**
 * Impuestos.
 *
 * En una tienda el precio de venta mostrado normalmente YA incluye el impuesto.
 * El sistema debe poder desglosar (base + impuesto) en ambos modos:
 *   - precio con impuesto incluido
 *   - precio sin impuesto (el impuesto se agrega)
 *
 * El impuesto se usa solo para desglose, utilidad y contabilidad internas.
 */

import { type Centavos, porcentajeDe, redondear, restar, sumar } from './money.js';

export interface ConfiguracionImpuestos {
  /** true: el precio de venta ya incluye el impuesto. */
  preciosConImpuestoIncluido: boolean;
}

export interface DesgloseImpuesto {
  /** Importe sin impuesto. */
  base: Centavos;
  /** Impuesto contenido o agregado. */
  impuesto: Centavos;
  /** Importe final que paga el cliente. */
  total: Centavos;
}

function validarTasa(tasa: number): void {
  if (!Number.isFinite(tasa) || tasa < 0) {
    throw new Error(`Tasa de impuesto invalida: ${tasa}`);
  }
}

/** Desglose cuando el monto YA incluye el impuesto. */
export function desglosarImpuestoIncluido(monto: Centavos, tasa: number): DesgloseImpuesto {
  validarTasa(tasa);
  const base = redondear(monto / (1 + tasa / 100));
  return { base, impuesto: restar(monto, base), total: monto };
}

/** Desglose cuando el monto NO incluye impuesto: se agrega. */
export function desglosarImpuestoAgregado(monto: Centavos, tasa: number): DesgloseImpuesto {
  validarTasa(tasa);
  const impuesto = porcentajeDe(monto, tasa);
  return { base: monto, impuesto, total: sumar(monto, impuesto) };
}

export function desglosar(
  monto: Centavos,
  tasa: number,
  config: ConfiguracionImpuestos,
): DesgloseImpuesto {
  return config.preciosConImpuestoIncluido
    ? desglosarImpuestoIncluido(monto, tasa)
    : desglosarImpuestoAgregado(monto, tasa);
}
