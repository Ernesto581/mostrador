import { construirServidor } from './server.js';

const app = await construirServidor();

try {
  await app.listen({ port: app.config.PORT, host: app.config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
