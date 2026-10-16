import Fastify from 'fastify';

/**
 * Arranque del API.
 *
 * Todo lo demas se carga de forma DIFERIDA a proposito: si al importar la aplicacion
 * falla algo (un paquete que no viaja en el empaquetado, una variable mal puesta, la
 * base de datos inalcanzable), en vez de una pagina 500 sin explicacion se responde
 * **el motivo real**. Asi el problema se ve desde el navegador, sin entrar a los
 * registros de la plataforma.
 */

/** Mensaje legible recorriendo la cadena de causas. */
function detalleDe(error: unknown): string {
  const mensajes: string[] = [];
  let actual: unknown = error;

  for (let nivel = 0; nivel < 6 && actual instanceof Error; nivel += 1) {
    mensajes.push(`${actual.name}: ${actual.message}`);
    actual = (actual as { cause?: unknown }).cause;
  }

  return mensajes.length > 0 ? [...new Set(mensajes)].join(' | ') : String(error);
}

async function arrancar(): Promise<void> {
  let app = Fastify({ logger: { level: 'info' } });

  try {
    const { construirServidor } = await import('./server.js');
    app = await construirServidor();
  } catch (error) {
    const detalle = detalleDe(error);
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
  }

  try {
    // Sin `host`: es la forma que documenta Vercel para Fastify.
    await app.listen({
      port: Number(process.env.PORT ?? 3000),
      ...(process.env.HOST ? { host: process.env.HOST } : {}),
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await arrancar();
