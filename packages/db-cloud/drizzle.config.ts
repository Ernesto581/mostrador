import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  // Los nombres en TypeScript van en camelCase y en la base quedan en snake_case.
  casing: 'snake_case',
  strict: false,
  verbose: true,
  dbCredentials: {
    // Solo se usa para `db:migrate` y `db:push`, nunca para generar migraciones.
    url: process.env.DATABASE_URL ?? '',
  },
});
