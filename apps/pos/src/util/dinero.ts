/** Formato de dinero. Los importes SIEMPRE llegan y viajan en centavos enteros. */

const CON_MONEDA = new Intl.NumberFormat('es-CU', {
  style: 'currency',
  currency: 'CUP',
  minimumFractionDigits: 2,
});

const SOLO_NUMERO = new Intl.NumberFormat('es-CU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 1800 -> "$18.00" (peso cubano, CUP) */
export function dinero(centavos: number): string {
  return CON_MONEDA.format(centavos / 100);
}

/** 1800 -> "18.00" (para alinear cifras en columnas) */
export function cifra(centavos: number): string {
  return SOLO_NUMERO.format(centavos / 100);
}

/** "18.50" -> 1850 centavos */
export function aCentavos(pesos: string | number): number {
  const valor = typeof pesos === 'number' ? pesos : Number(pesos.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(valor)) {
    return 0;
  }
  return Math.round(valor * 100);
}

/** 1850 -> "18.50" (para el campo de captura, sin simbolos) */
export function aTextoCaptura(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
