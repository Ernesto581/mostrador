import { integer, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Columnas comunes de toda entidad sincronizable.
 *
 * - `id`: ULID generado en el cliente. Es la clave de la sincronizacion idempotente:
 *   da igual cuantas veces llegue la operacion, siempre cae en la misma fila.
 * - `deletedAt`: borrado logico. Nada se borra de verdad, para no perder historia.
 * - `originBranchId`: sucursal que origino el ultimo cambio.
 * - `revision`: contador que sube en cada cambio; sirve para resolver empates.
 *
 * Se define como funcion para devolver constructores nuevos en cada tabla.
 */
export function columnasSync() {
  return {
    id: text().primaryKey(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    originBranchId: text(),
    revision: integer().notNull().default(1),
  };
}

/** Importe en CENTAVOS enteros. Nunca se usan decimales. */
export const importe = () => integer();

/** Cantidad de piezas (entero; el sistema no maneja fracciones). */
export const piezas = () => integer();

/** Porcentaje en base 100 (16 = 16%). */
export const porcentaje = () => integer();
