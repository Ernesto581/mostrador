import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Cada archivo de pruebas levanta su propio PostgreSQL embebido (PGlite), que tarda
     * en arrancar. Con varios archivos a la vez se estorban entre ellos, asi que se
     * limita el paralelismo y se da mas margen de tiempo.
     */
    maxWorkers: 2,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
