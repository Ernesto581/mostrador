import type { Db } from '@mostrador/db-cloud';

/**
 * Tipos de base de datos.
 *
 * Los servicios aceptan `BaseDatos`, que es la conexion normal o una transaccion.
 * Asi una misma funcion sirve dentro y fuera de una transaccion, sin duplicar codigo.
 */
export type Transaccion = Parameters<Parameters<Db['transaction']>[0]>[0];
export type BaseDatos = Db | Transaccion;
