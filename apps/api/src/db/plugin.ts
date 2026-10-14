import {
  crearDbPglite,
  crearDbPostgres,
  migrarDbPglite,
  migrarDbPostgres,
  type Db,
} from '@mostrador/db-cloud';
import fp from 'fastify-plugin';

/**
 * Conexion a la base de datos.
 *
 * Si hay DATABASE_URL se usa PostgreSQL real (produccion). Si no, PGlite: el mismo
 * PostgreSQL compilado a WebAssembly, que sirve para desarrollo y pruebas sin
 * instalar ningun servidor. Las migraciones se aplican al arrancar.
 */
export const pluginBaseDeDatos = fp(
  async (app) => {
    const { DATABASE_URL, PGLITE_DIR } = app.config;

    if (DATABASE_URL) {
      const db = crearDbPostgres(DATABASE_URL);
      if (app.config.MIGRAR_AL_ARRANCAR) {
        await migrarDbPostgres(db);
      }
      app.decorate('db', db as unknown as Db);
      app.addHook('onClose', async () => {
        await db.$client.end();
      });
      app.log.info({ migrado: app.config.MIGRAR_AL_ARRANCAR }, 'Base de datos: PostgreSQL');
      return;
    }

    const db = await crearDbPglite(PGLITE_DIR);
    await migrarDbPglite(db);
    app.decorate('db', db);
    app.addHook('onClose', async () => {
      await db.$client.close();
    });
    app.log.info(
      { persistente: Boolean(PGLITE_DIR) },
      'Base de datos: PGlite (PostgreSQL embebido)',
    );
  },
  { name: 'base-de-datos' },
);
