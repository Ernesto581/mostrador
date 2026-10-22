import type { TipoMovimientoInventario } from '@mostrador/db-cloud/schema';
import { centavos } from '@mostrador/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS } from '../../auth/permisos.js';
import {
  asegurarPermiso,
  asegurarSucursal,
  exigirSesion,
  sesionDe,
  type Sesion,
} from '../../auth/sesion.js';
import { ErrorNoEncontrado, ErrorSinPermiso, validar } from '../../errors.js';
import {
  listarMovimientos,
  registrarMovimiento,
  stockGeneral,
  stockPorSucursal,
} from './servicio.js';
import {
  cancelarTransferencia,
  crearTransferencia,
  despacharTransferencia,
  listarTransferencias,
  listarUbicaciones,
  obtenerTransferencia,
  recibirTransferencia,
  rechazarTransferencia,
  type TransferenciaVista,
} from './transferencias.js';

/** Tipos que se pueden registrar a mano desde el panel. */
const TIPOS_MANUALES = [
  'inventario_inicial',
  'entrada_compra',
  'ajuste_positivo',
  'ajuste_negativo',
  'merma',
  'devolucion_proveedor',
] as const;

const booleanoDeConsulta = z.preprocess(
  (valor) => valor === 'true' || valor === true,
  z.boolean(),
);

const esquemaConsultaStock = z.object({
  sucursalId: z.string().min(1),
  buscar: z.string().trim().max(120).optional(),
  soloBajoMinimo: booleanoDeConsulta.optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

const esquemaConsultaStockGeneral = z.object({
  buscar: z.string().trim().max(120).optional(),
  soloBajoMinimo: booleanoDeConsulta.optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

const esquemaConsultaMovimientos = z.object({
  productoId: z.string().min(1).optional(),
  sucursalId: z.string().min(1).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

const esquemaMovimiento = z.object({
  sucursalId: z.string().min(1),
  almacenId: z.string().min(1).optional(),
  productoId: z.string().min(1),
  tipo: z.enum(TIPOS_MANUALES),
  cantidad: z.number().int().min(1),
  costoUnitario: z.number().int().min(0).optional(),
  motivo: z.string().max(200).optional(),
});

const esquemaTransferencia = z
  .object({
    origenUbicacionId: z.string().min(1),
    destinoUbicacionId: z.string().min(1),
    motivo: z.string().max(200).optional(),
    lineas: z
      .array(
        z.object({
          productoId: z.string().min(1),
          cantidad: z.number().int().min(1),
        }),
      )
      .min(1),
  })
  .refine((datos) => datos.origenUbicacionId !== datos.destinoUbicacionId, {
    message: 'El origen y el destino deben ser distintos',
    path: ['destinoUbicacionId'],
  });

const esquemaRecepcion = z.object({
  lineas: z
    .array(
      z.object({
        lineaId: z.string().min(1),
        cantidadRecibida: z.number().int().min(0),
      }),
    )
    .optional(),
});

const esquemaRechazo = z.object({
  motivo: z.string().trim().min(3, 'Escribe el motivo del rechazo').max(200),
});

const esquemaConsultaTransferencias = z.object({
  sucursalId: z.string().min(1).optional(),
  estado: z
    .enum(['borrador', 'en_transito', 'recibida', 'rechazada', 'cancelada'])
    .optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

const parametroTransferencia = z.object({ id: z.string().min(1) });

/** Carga una transferencia o avisa si no existe. */
async function transferenciaDeLaEmpresa(
  app: FastifyInstance,
  sesion: Sesion,
  id: string,
): Promise<TransferenciaVista> {
  const transferencia = await obtenerTransferencia(app.db, sesion.empresaId, id);
  if (!transferencia) {
    throw new ErrorNoEncontrado('La transferencia no existe');
  }
  return transferencia;
}

export async function rutasInventario(app: FastifyInstance) {
  const preHandler = exigirSesion(app);

  app.get('/inventory/stock', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const consulta = validar(esquemaConsultaStock, request.query);
    asegurarSucursal(sesion, consulta.sucursalId);

    const stock = await stockPorSucursal(app.db, {
      empresaId: sesion.empresaId,
      sucursalId: consulta.sucursalId,
      buscar: consulta.buscar,
      soloBajoMinimo: consulta.soloBajoMinimo,
      limite: consulta.limite,
    });

    return {
      sucursalId: consulta.sucursalId,
      conAlerta: stock.filter((fila) => fila.bajoMinimo).length,
      stock,
    };
  });

  app.get('/inventory/stock-general', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const consulta = validar(esquemaConsultaStockGeneral, request.query);

    const stock = await stockGeneral(app.db, {
      empresaId: sesion.empresaId,
      buscar: consulta.buscar,
      soloBajoMinimo: consulta.soloBajoMinimo,
      limite: consulta.limite,
    });

    return {
      conAlerta: stock.filter((fila) => fila.bajoMinimo).length,
      sucursales: sesion.sucursales,
      stock,
    };
  });

  app.get('/inventory/movements', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const consulta = validar(esquemaConsultaMovimientos, request.query);

    const movimientos = await listarMovimientos(app.db, {
      empresaId: sesion.empresaId,
      productoId: consulta.productoId,
      sucursalId: consulta.sucursalId,
      desde: consulta.desde,
      hasta: consulta.hasta,
      limite: consulta.limite,
    });

    return { movimientos };
  });

  app.post('/inventory/movements', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.AJUSTAR_INVENTARIO);
    const datos = validar(esquemaMovimiento, request.body);
    asegurarSucursal(sesion, datos.sucursalId);

    const aplicado = await registrarMovimiento(app.db, {
      empresaId: sesion.empresaId,
      sucursalId: datos.sucursalId,
      almacenId: datos.almacenId,
      productoId: datos.productoId,
      tipo: datos.tipo as TipoMovimientoInventario,
      cantidad: datos.cantidad,
      costoUnitario: datos.costoUnitario !== undefined ? centavos(datos.costoUnitario) : undefined,
      motivo: datos.motivo,
      usuarioId: sesion.usuarioId,
      documentoTipo: 'ajuste',
    });

    reply.status(201);
    return { movimiento: aplicado };
  });

  app.get('/inventory/locations', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const ubicaciones = await listarUbicaciones(app.db, sesion.empresaId);
    return { ubicaciones };
  });

  app.get('/inventory/transfers', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const consulta = validar(esquemaConsultaTransferencias, request.query);
    if (consulta.sucursalId) {
      asegurarSucursal(sesion, consulta.sucursalId);
    }

    const transferencias = await listarTransferencias(app.db, {
      empresaId: sesion.empresaId,
      sucursalIds: consulta.sucursalId
        ? [consulta.sucursalId]
        : sesion.sucursales.map((sucursal) => sucursal.id),
      estado: consulta.estado,
      limite: consulta.limite,
    });

    return { transferencias };
  });

  app.get('/inventory/transfers/:id', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const { id } = validar(parametroTransferencia, request.params);
    const transferencia = await transferenciaDeLaEmpresa(app, sesion, id);

    const veLaTransferencia = sesion.sucursales.some(
      (sucursal) =>
        sucursal.id === transferencia.origen.sucursalId ||
        sucursal.id === transferencia.destino.sucursalId,
    );
    if (!veLaTransferencia) {
      throw new ErrorSinPermiso('No tienes acceso a esa transferencia');
    }

    return { transferencia };
  });

  app.post('/inventory/transfers', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.TRANSFERIR_INVENTARIO);
    const datos = validar(esquemaTransferencia, request.body);

    const ubicaciones = await listarUbicaciones(app.db, sesion.empresaId);
    const origen = ubicaciones.find((ubicacion) => ubicacion.id === datos.origenUbicacionId);
    const destino = ubicaciones.find((ubicacion) => ubicacion.id === datos.destinoUbicacionId);
    if (!origen || !destino) {
      throw new ErrorNoEncontrado('La ubicacion no existe');
    }
    asegurarSucursal(sesion, origen.sucursalId);
    asegurarSucursal(sesion, destino.sucursalId);

    const transferencia = await crearTransferencia(app.db, {
      empresaId: sesion.empresaId,
      origenUbicacionId: datos.origenUbicacionId,
      destinoUbicacionId: datos.destinoUbicacionId,
      usuarioId: sesion.usuarioId,
      motivo: datos.motivo,
      lineas: datos.lineas,
    });

    reply.status(201);
    return { transferencia };
  });

  app.post('/inventory/transfers/:id/dispatch', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.TRANSFERIR_INVENTARIO);
    const { id } = validar(parametroTransferencia, request.params);
    const actual = await transferenciaDeLaEmpresa(app, sesion, id);
    asegurarSucursal(sesion, actual.origen.sucursalId);

    const transferencia = await despacharTransferencia(app.db, {
      empresaId: sesion.empresaId,
      transferenciaId: id,
      usuarioId: sesion.usuarioId,
    });

    return { transferencia };
  });

  app.post('/inventory/transfers/:id/receive', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.TRANSFERIR_INVENTARIO);
    const { id } = validar(parametroTransferencia, request.params);
    const datos = validar(esquemaRecepcion, request.body ?? {});
    const actual = await transferenciaDeLaEmpresa(app, sesion, id);
    asegurarSucursal(sesion, actual.destino.sucursalId);

    const transferencia = await recibirTransferencia(app.db, {
      empresaId: sesion.empresaId,
      transferenciaId: id,
      usuarioId: sesion.usuarioId,
      lineas: datos.lineas?.map((linea) => ({
        lineaId: linea.lineaId,
        cantidadRecibida: linea.cantidadRecibida,
      })),
    });

    return { transferencia };
  });

  app.post('/inventory/transfers/:id/reject', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.TRANSFERIR_INVENTARIO);
    const { id } = validar(parametroTransferencia, request.params);
    const datos = validar(esquemaRechazo, request.body);
    const actual = await transferenciaDeLaEmpresa(app, sesion, id);
    asegurarSucursal(sesion, actual.destino.sucursalId);

    const transferencia = await rechazarTransferencia(app.db, {
      empresaId: sesion.empresaId,
      transferenciaId: id,
      usuarioId: sesion.usuarioId,
      motivo: datos.motivo,
    });

    return { transferencia };
  });

  app.post('/inventory/transfers/:id/cancel', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.TRANSFERIR_INVENTARIO);
    const { id } = validar(parametroTransferencia, request.params);
    const actual = await transferenciaDeLaEmpresa(app, sesion, id);
    asegurarSucursal(sesion, actual.origen.sucursalId);

    const transferencia = await cancelarTransferencia(app.db, {
      empresaId: sesion.empresaId,
      transferenciaId: id,
    });

    return { transferencia };
  });
}
