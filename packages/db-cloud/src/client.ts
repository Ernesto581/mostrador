import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import * as schema from './schema/index.js';

export { schema };

/** Base de datos real de la nube (produccion). */
export function crearDbPostgres(cadenaConexion: string) {
  const pool = new Pool({ connectionString: cadenaConexion });
  return drizzlePostgres(pool, { schema, casing: 'snake_case' });
}

export type DbPostgres = ReturnType<typeof crearDbPostgres>;

/**
 * Base de datos con PGlite: PostgreSQL REAL compilado a WebAssembly.
 *
 * Sirve para desarrollo y pruebas sin instalar ningun servidor. Si se pasa un
 * directorio, persiste en disco; si no, vive en memoria.
 *
 * Se importa de forma dinamica a proposito: en produccion no se carga PGlite,
 * asi que no pesa en el despliegue de la nube.
 */
export async function crearDbPglite(directorio?: string) {
  if (directorio) {
    await mkdir(directorio, { recursive: true });
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const cliente = new PGlite(directorio);
  return drizzle(cliente, { schema, casing: 'snake_case' });
}

export type DbPglite = Awaited<ReturnType<typeof crearDbPglite>>;

/**
 * Tipo de base de datos usado en todo el proyecto.
 *
 * PGlite y node-postgres hablan el mismo dialecto, pero exponen tipos de driver
 * distintos. Se toma el de PGlite como tipo comun; la conexion de produccion se
 * convierte a este tipo en un unico punto (ver `apps/api/src/db/plugin.ts`).
 */
export type Db = DbPglite;

/** Ruta de las migraciones generadas por drizzle-kit. */
export function carpetaMigraciones(): string {
  return fileURLToPath(new URL('../drizzle/', import.meta.url));
}

/** Aplica las migraciones pendientes sobre una base PGlite. */
export async function migrarDbPglite(db: DbPglite): Promise<void> {
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  await migrate(db, { migrationsFolder: carpetaMigraciones() });
}

/** Aplica las migraciones pendientes sobre un PostgreSQL real. */
export async function migrarDbPostgres(db: DbPostgres): Promise<void> {
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(db, { migrationsFolder: carpetaMigraciones() });
}

/** Base de datos de prueba: PGlite en memoria, ya migrada. */
export async function crearDbDePrueba(): Promise<DbPglite> {
  const db = await crearDbPglite();
  await migrarDbPglite(db);
  return db;
}
