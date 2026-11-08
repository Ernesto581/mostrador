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

/**
 * Quien atiende el mostrador solo consulta lo que vendio hoy. Los permisos de
 * supervision o reportes pueden ver todo el alcance de sus sucursales.
 */
function puedeVerTodasLasVentas(sesion: Sesion): boolean {
  return sesion.permisos.has(PERMISOS.CANCELAR_VENTA) || sesion.permisos.has(PERMISOS.VER_UTILIDAD);
}

/** Zona horaria del negocio para cortar el dia del cajero. */
const ZONA_HORARIA = process.env.ZONA_HORARIA ?? 'America/Havana';

function partesEnZona(fecha: Date) {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const valores: Record<string, string> = {};
  for (const parte of formato.formatToParts(fecha)) {
    if (parte.type !== 'literal') {
      valores[parte.type] = parte.value;
    }
  }
  return {
    year: Number(valores.year),
    month: Number(valores.month),
    day: Number(valores.day),
    hour: Number(valores.hour ?? 0),
    minute: Number(valores.minute ?? 0),
    second: Number(valores.second ?? 0),
  };
}

/** Diferencia entre la hora de pared de la zona y UTC, en milisegundos. */
function desfaseZona(fecha: Date): number {
  const partes = partesEnZona(fecha);
  const comoUtc = Date.UTC(
    partes.year,
    partes.month - 1,
    partes.day,
    partes.hour,
    partes.minute,
    partes.second,
  );
  return comoUtc - fecha.getTime();
}

/** Rango del dia actual del negocio para el cajero. */
function rangoDeHoy(): { desde: Date; hasta: Date } {
  const ahora = new Date();
  const { year, month, day } = partesEnZona(ahora);
  const medianocheUtc = Date.UTC(year, month - 1, day);
  const desde = new Date(medianocheUtc - desfaseZona(new Date(medianocheUtc)));
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { desde, hasta };
}

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

/** Carga una venta comprobando que la sesion pueda operar en su sucursal. */
async function ventaConAcceso(app: FastifyInstance, sesion: Sesion, ventaId: string) {
  const encontrada = await obtenerVenta(app.db, sesion.empresaId, ventaId);
  if (!encontrada) {
    throw new ErrorNoEncontrado('La venta no existe');
  }
  asegurarSucursal(sesion, encontrada.venta.branchId);
  return encontrada;
}

export async function rutasVentas(app: FastifyInstance) {
  const preHandler = exigirSesion(app);

  app.post('/sales', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.VENDER);
    const datos = validar(esquemaVenta, request.body);
    asegurarSucursal(sesion, datos.sucursalId);

    const pideDescuento = datos.lineas.some(
      (linea) => (linea.descuentoPorcentaje ?? 0) > 0 || (linea.descuentoMonto ?? 0) > 0,
    );
    if (pideDescuento) {
      asegurarPermiso(sesion, PERMISOS.APLICAR_DESCUENTO);
    }

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

    if (consulta.sucursalId) {
      asegurarSucursal(sesion, consulta.sucursalId);
    }

    // Sin sucursal explicita se listan solo las sucursales de la sesion.
    // Nunca se devuelven ventas de una sucursal a la que no se tiene acceso.
    // El cajero, ademas, solo ve las suyas del dia.
    const supervision = puedeVerTodasLasVentas(sesion);
    const rango = supervision
      ? { desde: consulta.desde, hasta: consulta.hasta }
      : rangoDeHoy();

    const ventas = await listarVentas(app.db, {
      empresaId: sesion.empresaId,
      ...(consulta.sucursalId
        ? { sucursalId: consulta.sucursalId }
        : { sucursalIds: sesion.sucursales.map((sucursal) => sucursal.id) }),
      ...(supervision ? {} : { usuarioId: sesion.usuarioId }),
      desde: rango.desde,
      hasta: rango.hasta,
      limite: consulta.limite,
    });

    return { ventas };
  });

  app.get('/sales/:id', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const { id } = validar(z.object({ id: z.string().min(1) }), request.params);

    const encontrada = await ventaConAcceso(app, sesion, id);

    if (!puedeVerTodasLasVentas(sesion)) {
      const { desde, hasta } = rangoDeHoy();
      if (
        encontrada.venta.soldByUserId !== sesion.usuarioId ||
        encontrada.venta.soldAt < desde ||
        encontrada.venta.soldAt > hasta
      ) {
        throw new ErrorSinPermiso('Solo puedes consultar tus ventas de hoy');
      }
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
    await ventaConAcceso(app, sesion, id);

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
    await ventaConAcceso(app, sesion, id);

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
