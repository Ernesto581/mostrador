/**
 * Modelo de datos de la nube (PostgreSQL).
 *
 * Decisiones importantes:
 *
 * 1. Los identificadores son ULID en texto, generados por el dispositivo. Asi una
 *    operacion repetida cae siempre en la misma fila (sincronizacion idempotente).
 * 2. `inventory_movements`, `sale_lines` y `sale_payments` son APPEND-ONLY: no se
 *    actualizan ni se borran. El stock y la utilidad se derivan de ellos.
 * 3. Los importes van en CENTAVOS enteros.
 * 4. Las claves foraneas se incluyen para integridad; la sincronizacion inserta
 *    respetando el orden de dependencia entre entidades.
 */

export * from './comun.js';
export * from './organizacion.js';
export * from './catalogo.js';
export * from './inventario.js';
export * from './ventas.js';
export * from './contabilidad.js';
export * from './plataforma.js';
