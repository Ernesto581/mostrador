import {
  crearDbPglite,
  crearDbPostgres,
  migrarDbPglite,
  migrarDbPostgres,
  type Db,
} from '@mostrador/db-cloud';
import { cargarConfig } from '../config.js';
import { sembrarDatosIniciales } from '../db/seed.js';

/**
 * Crea los datos iniciales: empresa, sucursal, almacen, roles y administrador.
 *
 * Uso:
 *   npm run db:seed -w @mostrador/api
 */
const config = cargarConfig();

/** Permite elegir el usuario y la contrasena desde el entorno, sin editar codigo. */
const opcionesSemilla = {
  ...(process.env.SEED_EMPRESA ? { nombreEmpresa: process.env.SEED_EMPRESA } : {}),
  ...(process.env.SEED_USUARIO ? { usuario: process.env.SEED_USUARIO } : {}),
  ...(process.env.SEED_PASSWORD ? { password: process.env.SEED_PASSWORD } : {}),
  ...(process.env.SEED_SIN_PRODUCTOS === 'true' ? { conProductosEjemplo: false } : {}),
};

if (config.DATABASE_URL) {
  const db = crearDbPostgres(config.DATABASE_URL);
  await migrarDbPostgres(db);
  const resultado = await sembrarDatosIniciales(db as unknown as Db, opcionesSemilla);
  imprimir(resultado.usuario, resultado.password, 'PostgreSQL');
  await db.$client.end();
} else {
  const db = await crearDbPglite(config.PGLITE_DIR);
  await migrarDbPglite(db);
  const resultado = await sembrarDatosIniciales(db, opcionesSemilla);
  imprimir(
    resultado.usuario,
    resultado.password,
    config.PGLITE_DIR ? 'PGlite en disco' : 'PGlite en memoria',
  );
  await db.$client.close();
}

function imprimir(usuario: string, password: string, motor: string): void {
  console.log('');
  console.log(`Datos iniciales creados en ${motor}.`);
  console.log(`  Usuario:    ${usuario}`);
  console.log(`  Contrasena: ${password}`);
  console.log('Cambia la contrasena en cuanto entres.');
  console.log('');
}
