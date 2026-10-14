import { centavos } from '@mostrador/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, asegurarSucursal, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { ErrorNoEncontrado, validar } from '../../errors.js';
import {
  cancelarVenta,
  listarVentas,
  obtenerVenta,
  registrarDevolucion,
  registrarVenta,
  type MetodoPago,
} from './servicio.js';

const metodoPago = z.enum(['efectivo', 'tarjeta', 'transferencia']);

const esquemaVenta = z.object({
  sucursalId: z.string().min(1),
  dispositivoId: z.string().max(40).optional(),
  turnoId: z.string().max(40).optional(),
  cajaId: z.string().max(40).optional(),
  clienteId: z.string().max(40).optional(),
  folio: z.string().max(40).optional(),
  vendidoEn: z.coerce.date().optional(),
  lineas: z
    .array(
      z.object({
        productoId: z.string().min(1),
        cantidad: z.number().int().min(1),
        descuentoPorcentaje: z.number().min(0).max(100).optional(),
        descuentoMonto: z.number().int().min(0).optional(),
      }),
    )
    .min(1, 'La venta necesita al menos una linea'),
  pagos: z
    .array(
      z.object({
        metodo: metodoPago,
        monto: z.number().int().min(0),
        referencia: z.string().max(80).optional(),
      }),
    )
    .min(1, 'La venta necesita al menos un pago'),
});

const esquemaConsultaVentas = z.object({
  sucursalId: z.string().min(1).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

const esquemaCancelacion = z.object({
  motivo: z.string().trim().min(3, 'Escribe el motivo de la cancelacion').max(200),
});

const esquemaDevolucion = z.object({
  motivo: z.string().trim().min(3, 'Escribe el motivo de la devolucion').max(200),
  metodoReembolso: metodoPago.optional(),
  lineas: z
    .array(
      z.object({
        lineaId: z.string().min(1),
        cantidad: z.number().int().min(1),
        reingresar: z.boolean().optional(),
      }),
    )
    .min(1),
});

export async function rutasVentas(app: FastifyInstance) {
  const preHandler = exigirSesion(app);

  app.post('/sales', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.VENDER);
    const datos = validar(esquemaVenta, request.body);
    asegurarSucursal(sesion, datos.sucursalId);

    const venta = await registrarVenta(app.db, {
      empresaId: sesion.empresaId,
      sucursalId: datos.sucursalId,
      usuarioId: sesion.usuarioId,
      dispositivoId: datos.dispositivoId,
      turnoId: datos.turnoId,
      cajaId: datos.cajaId,
      clienteId: datos.clienteId,
      folio: datos.folio,
      vendidoEn: datos.vendidoEn,
      lineas: datos.lineas.map((linea) => ({
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        descuentoPorcentaje: linea.descuentoPorcentaje,
        descuentoMonto:
          linea.descuentoMonto !== undefined ? centavos(linea.descuentoMonto) : undefined,
      })),
      pagos: datos.pagos.map((pago) => ({
        metodo: pago.metodo as MetodoPago,
        monto: centavos(pago.monto),
        referencia: pago.referencia,
      })),
    });

    reply.status(201);
    return { venta };
  });

  app.get('/sales', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const consulta = validar(esquemaConsultaVentas, request.query);

    const ventas = await listarVentas(app.db, {
      empresaId: sesion.empresaId,
      sucursalId: consulta.sucursalId,
      desde: consulta.desde,
      hasta: consulta.hasta,
      limite: consulta.limite,
    });

    return { ventas };
  });

  app.get('/sales/:id', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const { id } = validar(z.object({ id: z.string().min(1) }), request.params);

    const encontrada = await obtenerVenta(app.db, sesion.empresaId, id);
    if (!encontrada) {
      throw new ErrorNoEncontrado('La venta no existe');
    }

    return {
      venta: encontrada.venta,
      lineas: encontrada.lineas,
      pagos: encontrada.pagos,
    };
  });

  app.post('/sales/:id/void', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.CANCELAR_VENTA);
    const { id } = validar(z.object({ id: z.string().min(1) }), request.params);
    const { motivo } = validar(esquemaCancelacion, request.body);

    const resultado = await cancelarVenta(app.db, {
      empresaId: sesion.empresaId,
      ventaId: id,
      motivo,
      usuarioId: sesion.usuarioId,
    });

    return { venta: resultado };
  });

  app.post('/sales/:id/returns', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.CANCELAR_VENTA);
    const { id } = validar(z.object({ id: z.string().min(1) }), request.params);
    const datos = validar(esquemaDevolucion, request.body);

    const devolucion = await registrarDevolucion(app.db, {
      empresaId: sesion.empresaId,
      ventaId: id,
      motivo: datos.motivo,
      usuarioId: sesion.usuarioId,
      metodoReembolso: datos.metodoReembolso as MetodoPago | undefined,
      lineas: datos.lineas,
    });

    reply.status(201);
    return { devolucion };
  });
}
