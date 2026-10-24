import {
  crearDbPglite,
  crearDbPostgres,
  migrarDbPglite,
  migrarDbPostgres,
  type Db,
} from '@mostrador/db-cloud';
import fp from 'fastify-plugin';
import { sql } from 'drizzle-orm';

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
        // Nunca se tumba la aplicacion por una migracion: se avisa y se sigue.
        try {
          await migrarDbPostgres(db);
        } catch (error) {
          app.log.error(
            { err: error },
            'No se pudieron aplicar las migraciones; el API arranca igual',
          );
        }
      }

      // Compatibilidad con bases antiguas: asegura columnas nuevas.
      try {
        await db.execute(sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS venta_desde_almacen boolean NOT NULL DEFAULT false`);
      } catch (error) {
        app.log.warn({ err: error }, 'No se pudo asegurar la columna venta_desde_almacen');
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

    // Compatibilidad con bases antiguas: asegura columnas nuevas.
    try {
      await db.execute(sql`ALTER TABLE branches ADD COLUMN IF NOT EXISTS venta_desde_almacen boolean NOT NULL DEFAULT false`);
    } catch (error) {
      app.log.warn({ err: error }, 'No se pudo asegurar la columna venta_desde_almacen');
    }

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

 
