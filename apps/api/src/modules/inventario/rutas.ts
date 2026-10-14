import type { TipoMovimientoInventario } from '@mostrador/db-cloud/schema';
import { centavos } from '@mostrador/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, asegurarSucursal, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { validar } from '../../errors.js';
import {
  listarMovimientos,
  registrarMovimiento,
  stockPorSucursal,
  transferir,
} from './servicio.js';

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
    origenSucursalId: z.string().min(1),
    destinoSucursalId: z.string().min(1),
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
  .refine((datos) => datos.origenSucursalId !== datos.destinoSucursalId, {
    message: 'El origen y el destino deben ser distintos',
    path: ['destinoSucursalId'],
  });

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

  app.post('/inventory/transfers', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.TRANSFERIR_INVENTARIO);
    const datos = validar(esquemaTransferencia, request.body);
    asegurarSucursal(sesion, datos.origenSucursalId);
    asegurarSucursal(sesion, datos.destinoSucursalId);

    const movimientos = await transferir(app.db, {
      empresaId: sesion.empresaId,
      origenSucursalId: datos.origenSucursalId,
      destinoSucursalId: datos.destinoSucursalId,
      usuarioId: sesion.usuarioId,
      motivo: datos.motivo,
      lineas: datos.lineas,
    });

    reply.status(201);
    return { movimientos };
  });
}
