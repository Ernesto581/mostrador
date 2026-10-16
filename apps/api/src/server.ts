import cors from '@fastify/cors';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { pluginAuth } from './auth/plugin.js';
import { rutasAuth } from './auth/routes.js';
import { cargarConfig } from './config.js';
import { pluginBaseDeDatos } from './db/plugin.js';
import { ErrorDeAplicacion, ErrorDeValidacion, codigoDePostgres } from './errors.js';
import { rutasCatalogo } from './modules/catalogo/rutas.js';
import { rutasInventario } from './modules/inventario/rutas.js';
import { rutasVentas } from './modules/ventas/rutas.js';
import { rutasUsuarios } from './modules/usuarios/rutas.js';
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

    const codigoPostgres = codigoDePostgres(error);
    if (codigoPostgres === '23505') {
      return reply.status(409).send({
        error: {
          codigo: 'DUPLICADO',
          mensaje: 'Ese dato ya existe (por ejemplo, un codigo de barras o un SKU repetido)',
        },
      });
    }
    if (codigoPostgres === '23503') {
      return reply.status(409).send({
        error: {
          codigo: 'REFERENCIA_INVALIDA',
          mensaje: 'El dato hace referencia a algo que no existe',
        },
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

  await app.register(cors, {
    origin: config.CORS_ORIGIN
      ? config.CORS_ORIGIN.split(',').map((origen) => origen.trim())
      : true,
  });
  await app.register(pluginBaseDeDatos);
  await app.register(pluginAuth);
  await app.register(rutasSalud, { prefix: '/api/v1' });
  await app.register(rutasAuth, { prefix: '/api/v1/auth' });
  await app.register(rutasCatalogo, { prefix: '/api/v1' });
  await app.register(rutasInventario, { prefix: '/api/v1' });
  await app.register(rutasVentas, { prefix: '/api/v1' });
  await app.register(rutasUsuarios, { prefix: '/api/v1' });

  return app;
}
