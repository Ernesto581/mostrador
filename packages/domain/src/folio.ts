/**
 * Folios.
 *
 * Cada sucursal numera sus documentos de forma independiente para poder trabajar
 * sin internet y sin coordinarse con la nube. El prefijo de sucursal y la fecha
 * garantizan que dos sucursales (o dos dispositivos) nunca generen el mismo folio.
 *
 * Formato: SUC-AAAAMMDD-0001
 */

export interface FolioPartes {
  /** Codigo corto de la sucursal: 1 a 6 caracteres A-Z o 0-9. */
  codigoSucursal: string;
  fecha: Date;
  /** Consecutivo del dia, empezando en 1. */
  consecutivo: number;
}

const PATRON_SUCURSAL = /^[A-Z0-9]{1,6}$/;

/** Limite de consecutivos por dia para conservar el ancho fijo de 4 digitos. */
export const MAXIMO_CONSECUTIVO_DIARIO = 9999;

export function generarFolio({ codigoSucursal, fecha, consecutivo }: FolioPartes): string {
  if (!PATRON_SUCURSAL.test(codigoSucursal)) {
    throw new Error(
      `Codigo de sucursal invalido: "${codigoSucursal}" (use 1 a 6 caracteres A-Z o 0-9)`,
    );
  }
  if (!Number.isInteger(consecutivo) || consecutivo < 1 || consecutivo > MAXIMO_CONSECUTIVO_DIARIO) {
    throw new Error(
      `Consecutivo invalido: ${consecutivo} (debe ser entero entre 1 y ${MAXIMO_CONSECUTIVO_DIARIO})`,
    );
  }

  return `${codigoSucursal}-${formatearFecha(fecha)}-${String(consecutivo).padStart(4, '0')}`;
}

function formatearFecha(fecha: Date): string {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
    throw new Error('Fecha invalida para el folio');
  }
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}${mes}${dia}`;
}
