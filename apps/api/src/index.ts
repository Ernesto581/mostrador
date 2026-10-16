import Fastify from 'fastify';
import { construirServidor } from './server.js';

/**
 * Arranque del API.
 *
 * Si algo falla al preparar la aplicacion (una variable mal puesta, la base de datos
 * inalcanzable, un paquete que no viaja en el empaquetado), en vez de dejar una
 * pagina 500 sin explicacion se levanta un servidor minimo que **responde el motivo
 * real** en todas las rutas. Asi el problema se ve desde el navegador.
 */
function servidorDeDiagnostico(error: unknown) {
  const app = Fastify({ logger: { level: 'error' } });
  const detalle = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  app.log.error(error as Error);

  app.setNotFoundHandler((_request, reply) =>
    reply.status(500).send({
      error: {
        codigo: 'ARRANQUE_FALLIDO',
        mensaje: 'El API no pudo arrancar. Revisa la configuracion del proyecto.',
        detalle,
      },
    }),
  );

  return app;
}

async function arrancar(): Promise<void> {
  let app;

  try {
    app = await construirServidor();
  } catch (error) {
    app = servidorDeDiagnostico(error);
  }

  try {
    // Sin `host`: es exactamente la forma que documenta Vercel para Fastify
    // (`app.listen({ port })`). La plataforma se encarga de escuchar.
    await app.listen({
      port: app.config.PORT,
      ...(app.config.HOST ? { host: app.config.HOST } : {}),
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await arrancar();
