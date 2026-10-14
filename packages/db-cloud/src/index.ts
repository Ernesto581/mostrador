/**
 * @mostrador/db-cloud
 *
 * Modelo de datos (PostgreSQL) y cliente de base de datos de la nube.
 * En desarrollo y pruebas se usa PGlite (PostgreSQL embebido, sin instalar nada).
 */

export * as schema from './schema/index.js';
export * from './client.js';
