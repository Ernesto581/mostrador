/**
 * Dinero.
 *
 * Todo el dinero del sistema se maneja en CENTAVOS ENTEROS.
 * Nunca se usan decimales flotantes para representar importes:
 * sumar 0.1 + 0.2 en punto flotante da 0.30000000000000004, y en un punto de venta
 * un centavo perdido descuadra la caja y la contabilidad.
 */

export type Centavos = number & { readonly __marca: 'Centavos' };

export const CERO: Centavos = 0 as Centavos;

/** Crea un valor en centavos validando que sea un numero entero. */
export function centavos(valor: number): Centavos {
  if (!Number.isFinite(valor)) {
    throw new Error(`Valor no finito: ${valor}`);
  }
  if (!Number.isInteger(valor)) {
    throw new Error(`Los centavos deben ser enteros, se recibio: ${valor}`);
  }
  return valor as Centavos;
}

/** Redondeo comercial: la mitad se va hacia arriba (alejandose del cero). */
export function redondear(valor: number): Centavos {
  if (!Number.isFinite(valor)) {
    throw new Error(`Valor no finito: ${valor}`);
  }
  return centavos(Math.sign(valor) * Math.round(Math.abs(valor)));
}

/** Convierte un monto decimal (por ejemplo 19.99) a centavos. */
export function desdeDecimal(decimal: number): Centavos {
  return redondear(decimal * 100);
}

/** Convierte centavos a un monto decimal (solo para mostrar o exportar). */
export function aDecimal(monto: Centavos): number {
  return monto / 100;
}

export function sumar(...montos: Centavos[]): Centavos {
  return centavos(montos.reduce<number>((acumulado, monto) => acumulado + monto, 0));
}

export function restar(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b);
}

export function multiplicarPor(monto: Centavos, factor: number): Centavos {
  return redondear(monto * factor);
}

/** Porcentaje sobre un monto. `porcentaje` en base 100 (16 = 16%). */
export function porcentajeDe(monto: Centavos, porcentaje: number): Centavos {
  return redondear((monto * porcentaje) / 100);
}

export function opuesto(monto: Centavos): Centavos {
  return centavos(-monto);
}

export function esPositivo(monto: Centavos): boolean {
  return monto > 0;
}

export function esCero(monto: Centavos): boolean {
  return monto === 0;
}

export function formatear(
  monto: Centavos,
  opciones: { moneda?: string; locale?: string } = {},
): string {
  const { moneda = 'MXN', locale = 'es-MX' } = opciones;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: moneda,
  }).format(monto / 100);
}
