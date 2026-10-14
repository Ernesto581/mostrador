import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  // Los nombres en TypeScript van en camelCase y en la base quedan en snake_case.
  casing: 'snake_case',
  strict: false,
  verbose: true,
});
