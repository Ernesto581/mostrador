import {
  crearDbPglite,
  crearDbPostgres,
  migrarDbPglite,
  migrarDbPostgres,
  schema,
  type Db,
} from '@mostrador/db-cloud';
import { eq } from 'drizzle-orm';
import {
  PERMISOS_ADMINISTRADOR,
  PERMISOS_ALMACENISTA,
  PERMISOS_CAJERO,
  PERMISOS_CONTADOR,
} from '../auth/permisos.js';
import { cargarConfig } from '../config.js';

/**
 * Pone al dia los permisos de los roles que ya existen.
 *
 * Cambiar los permisos en el codigo NO alcanza a la base de datos que ya estaba
 * sembrada: hay que reescribirlos. Esto es lo que hace que el administrador deje de
 * vender y de cerrar turno en un sistema que ya estaba en uso.
 *
 * Los roles propios (creados a mano) se dejan intactos. Se puede correr las veces que
 * haga falta: si ya esta al dia, no toca nada.
 *
 * Uso:
 *   npm run db:permisos -w @mostrador/api
 */
const DEFINIDOS: Record<string, readonly string[]> = {
  administrador: PERMISOS_ADMINISTRADOR,
  cajero: PERMISOS_CAJERO,
  almacenista: PERMISOS_ALMACENISTA,
  contador: PERMISOS_CONTADOR,
};

async function actualizar(db: Db): Promise<void> {
  const roles = await db
    .select({
      id: schema.roles.id,
      codigo: schema.roles.code,
      permisos: schema.roles.permissions,
    })
    .from(schema.roles);

  if (roles.length === 0) {
    console.log('No hay roles todavia: corre primero npm run db:seed.');
    return;
  }

  for (const rol of roles) {
    const esperados = DEFINIDOS[rol.codigo];

    if (!esperados) {
      console.log(`  sin tocar   ${rol.codigo} (rol propio, no lo define el sistema)`);
      continue;
    }

    const antes = [...rol.permisos].sort().join('|');
    const despues = [...esperados].sort().join('|');

    if (antes === despues) {
      console.log(`  al dia      ${rol.codigo} (${esperados.length} permisos)`);
      continue;
    }

    const quitados = rol.permisos.filter((permiso) => !esperados.includes(permiso));
    const puestos = esperados.filter((permiso) => !rol.permisos.includes(permiso));

    await db
      .update(schema.roles)
      .set({ permissions: [...esperados], updatedAt: new Date() })
      .where(eq(schema.roles.id, rol.id));

    console.log(
      `  ACTUALIZADO ${rol.codigo}: ${rol.permisos.length} -> ${esperados.length} permisos` +
        (quitados.length > 0 ? `\n                quita:  ${quitados.join(', ')}` : '') +
        (puestos.length > 0 ? `\n                agrega: ${puestos.join(', ')}` : ''),
    );
  }
}

const config = cargarConfig();

if (config.DATABASE_URL) {
  const db = crearDbPostgres(config.DATABASE_URL);
  await migrarDbPostgres(db);
  console.log('Permisos de los roles en PostgreSQL:');
  await actualizar(db as unknown as Db);
  await db.$client.end();
} else {
  const db = await crearDbPglite(config.PGLITE_DIR);
  await migrarDbPglite(db);
  console.log('Permisos de los roles en PGlite:');
  await actualizar(db);
  await db.$client.close();
}

console.log('');
