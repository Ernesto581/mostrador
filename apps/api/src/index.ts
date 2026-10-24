
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

/**
 * Arranque del API.
 *
 * Los detalles técnicos de los errores nunca se envían al cliente.
 * Cada fallo recibe un identificador para facilitar su investigación.
 */

function sanitizarMensaje(mensaje: string): string {
  return mensaje
    .replace(
      /((?:password|passwd|token|secret|authorization|api[_-]?key|DATABASE_URL)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTADO]',
    )
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[URL DE BASE DE DATOS REDACTADA]')
    .replace(/:\/\/[^/@\s]+:[^/@\s]+@/g, '://[CREDENCIALES REDACTADAS]@');
}

/** Extrae información útil para los registros internos. */
function detalleDe(error: unknown): string {
  const mensajes: string[] = [];
  let actual: unknown = error;

  for (let nivel = 0; nivel < 6 && actual instanceof Error; nivel += 1) {
    mensajes.push(
      `${actual.name}: ${sanitizarMensaje(actual.message)}`,
    );
    actual = (actual as { cause?: unknown }).cause;
  }

  if (mensajes.length > 0) {
    return [...new Set(mensajes)].join(' | ');
  }

  return sanitizarMensaje(String(error));
}

async function arrancar(): Promise<void> {
  let app: FastifyInstance = Fastify({
    logger: { level: 'info' },
  });

  try {
    const { construirServidor } = await import('./server.js');
    app = await construirServidor();
  } catch (error) {
    const incidenteId = randomUUID();
    const detalle = detalleDe(error);

    // El detalle se conserva únicamente en los registros del servidor.
    app.log.error(
      { incidenteId, error: detalle },
      'Falló la inicialización del API',
    );

    app.setNotFoundHandler((_request, reply) =>
      reply.status(500).send({
        error: {
          codigo: 'ARRANQUE_FALLIDO',
          mensaje:
            'El servicio no está disponible temporalmente. Inténtalo más tarde.',
          incidenteId,
        },
      }),
    );
  }

  try {
    await app.listen({
      port: Number(process.env.PORT ?? 3000),
      ...(process.env.HOST ? { host: process.env.HOST } : {}),
    });
  } catch (error) {
    app.log.error(
      { error: detalleDe(error) },
      'No se pudo iniciar el servidor HTTP',
    );
    process.exit(1);
  }
}

await arrancar();