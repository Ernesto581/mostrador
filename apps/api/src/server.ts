import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { pluginAuth } from './auth/plugin.js';
import { rutasAuth } from './auth/routes.js';
import { cargarConfig } from './config.js';
import { pluginBaseDeDatos } from './db/plugin.js';
import { ErrorDeAplicacion, ErrorDeValidacion } from './errors.js';
import { rutasSalud } from './routes/health.js';
import './tipos.js';

export async function construirServidor() {
  const config = cargarConfig();
  const enPruebas = config.NODE_ENV === 'test';

  const app = Fastify({
    logger: enPruebas ? false : { level: config.LOG_LEVEL },
  });

  app.decorate('config', config);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ErrorDeValidacion) {
      return reply.status(error.statusCode).send({
        error: {
          codigo: error.codigo,
          mensaje: error.message,
          detalles: error.detalle.issues.map((problema) => ({
            campo: problema.path.join('.') || '(cuerpo)',
            mensaje: problema.message,
          })),
        },
      });
    }

    if (error instanceof ErrorDeAplicacion) {
      return reply.status(error.statusCode).send({
        error: { codigo: error.codigo, mensaje: error.message },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: { codigo: 'DATOS_INVALIDOS', mensaje: 'Los datos enviados no son validos' },
      });
    }

    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error(error);
    }
    return reply.status(status).send({
      error: {
        codigo: status >= 500 ? 'ERROR_INTERNO' : (error.code ?? 'ERROR'),
        mensaje: status >= 500 ? 'Ocurrio un error inesperado' : error.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        codigo: 'NO_ENCONTRADO',
        mensaje: `Ruta no encontrada: ${request.method} ${request.url}`,
      },
    }),
  );

  await app.register(pluginBaseDeDatos);
  await app.register(pluginAuth);
  await app.register(rutasSalud, { prefix: '/api/v1' });
  await app.register(rutasAuth, { prefix: '/api/v1/auth' });

  return app;
}
