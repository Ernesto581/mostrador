/**
 * Ventas: lineas del carrito y totales.
 *
 * Una linea conoce su precio, cantidad, tasa de impuesto y descuento.
 * El descuento se aplica sobre el importe bruto y luego se desglosa el impuesto.
 *
 * Invariantes (probadas en test/invariantes.test.ts):
 *   - total = base + impuestos
 *   - total = suma de los totales de las lineas
 */

import { CERO, type Centavos, multiplicarPor, porcentajeDe, restar, sumar } from './money.js';
import { type ConfiguracionImpuestos, desglosar } from './tax.js';

export interface LineaVentaEntrada {
  productoId: string;
  nombre: string;
  /** Precio unitario en la base configurada (con o sin impuesto). */
  precioUnitario: Centavos;
  cantidad: number;
  /** Tasa de impuesto en porcentaje (0 = exento, 16 = 16%). */
  tasaImpuesto: number;
  /** Descuento en porcentaje (0 a 100). */
  descuentoPorcentaje?: number | undefined;
  /** Descuento en monto fijo. Tiene prioridad sobre el porcentaje. */
  descuentoMonto?: Centavos | undefined;
}

export interface LineaVentaCalculada {
  productoId: string;
  nombre: string;
  precioUnitario: Centavos;
  cantidad: number;
  tasaImpuesto: number;
  /** Importe antes de descuento. */
  importeBruto: Centavos;
  descuento: Centavos;
  /** Importe neto sin impuesto. */
  base: Centavos;
  impuesto: Centavos;
  /** Importe final de la linea: lo que paga el cliente por ella. */
  total: Centavos;
}

export interface TotalesVenta {
  lineas: LineaVentaCalculada[];
  importeBruto: Centavos;
  descuentoTotal: Centavos;
  base: Centavos;
  impuestos: Centavos;
  total: Centavos;
}

export function calcularLinea(
  linea: LineaVentaEntrada,
  config: ConfiguracionImpuestos,
): LineaVentaCalculada {
  if (!Number.isInteger(linea.cantidad) || linea.cantidad <= 0) {
    throw new Error(`Cantidad invalida: ${linea.cantidad}`);
  }
  if (linea.precioUnitario < 0) {
    throw new Error('El precio unitario no puede ser negativo');
  }

  const importeBruto = multiplicarPor(linea.precioUnitario, linea.cantidad);

  const descuento = calcularDescuento(linea, importeBruto);
  const neto = restar(importeBruto, descuento);
  const desglose = desglosar(neto, linea.tasaImpuesto, config);

  return {
    productoId: linea.productoId,
    nombre: linea.nombre,
    precioUnitario: linea.precioUnitario,
    cantidad: linea.cantidad,
    tasaImpuesto: linea.tasaImpuesto,
    importeBruto,
    descuento,
    base: desglose.base,
    impuesto: desglose.impuesto,
    total: desglose.total,
  };
}

function calcularDescuento(linea: LineaVentaEntrada, importeBruto: Centavos): Centavos {
  let descuento: Centavos = CERO;

  if (linea.descuentoMonto !== undefined) {
    descuento = linea.descuentoMonto;
  } else if (linea.descuentoPorcentaje !== undefined) {
    if (linea.descuentoPorcentaje < 0 || linea.descuentoPorcentaje > 100) {
      throw new Error(`Descuento porcentual fuera de rango (0-100): ${linea.descuentoPorcentaje}`);
    }
    descuento = porcentajeDe(importeBruto, linea.descuentoPorcentaje);
  }

  if (descuento < 0) {
    throw new Error('El descuento no puede ser negativo');
  }
  if (descuento > importeBruto) {
    throw new Error('El descuento no puede superar el importe de la linea');
  }

  return descuento;
}

export function calcularTotales(
  lineas: readonly LineaVentaEntrada[],
  config: ConfiguracionImpuestos,
): TotalesVenta {
  if (lineas.length === 0) {
    throw new Error('La venta debe tener al menos una linea');
  }

  const calculadas = lineas.map((linea) => calcularLinea(linea, config));

  return {
    lineas: calculadas,
    importeBruto: sumar(...calculadas.map((linea) => linea.importeBruto)),
    descuentoTotal: sumar(...calculadas.map((linea) => linea.descuento)),
    base: sumar(...calculadas.map((linea) => linea.base)),
    impuestos: sumar(...calculadas.map((linea) => linea.impuesto)),
    total: sumar(...calculadas.map((linea) => linea.total)),
  };
}
