import { centavos } from '@mostrador/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, asegurarSucursal, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { validar } from '../../errors.js';
import {
  abrirTurno,
  cerrarTurno,
  listarCierres,
  registrarMovimientoCaja,
  resumenTurno,
  turnoAbierto,
  turnosAbiertos,
  type TipoMovimientoCaja,
} from './servicio.js';

const parametroId = z.object({ id: z.string().min(1) });

const esquemaAbrir = z.object({
  sucursalId: z.string().min(1),
  /** Fondo con el que arranca la caja, en centavos. */
  fondoInicial: z.number().int().min(0).default(0),
  cajaId: z.string().min(1).optional(),
  dispositivoId: z.string().min(1).optional(),
  notas: z.string().max(200).optional(),
});

const esquemaCerrar = z.object({
  /** Efectivo contado fisicamente, en centavos. */
  contado: z.number().int().min(0),
  notas: z.string().max(300).optional(),
});

const esquemaMovimiento = z.object({
  sucursalId: z.string().min(1),
  turnoId: z.string().min(1),
  tipo: z.enum(['ingreso', 'retiro', 'gasto']),
  monto: z.number().int().min(1),
  motivo: z.string().trim().min(3, 'Escribe el motivo').max(200),
});

const esquemaConsultaCierres = z.object({
  sucursalId: z.string().min(1).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

export async function rutasCaja(app: FastifyInstance) {
  const preHandler = exigirSesion(app);

  /** Estado de la caja de una sucursal: si hay turno y como va. */
  app.get('/shifts/actual', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const { sucursalId } = validar(z.object({ sucursalId: z.string().min(1) }), request.query);
    asegurarSucursal(sesion, sucursalId);

    const turno = await turnoAbierto(app.db, sucursalId);
    if (!turno) {
      return { turno: null, resumen: null };
    }

    return { turno, resumen: await resumenTurno(app.db, turno.id) };
  });

  app.get('/shifts/abiertos', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.CERRAR_CAJA);

    return { turnos: await turnosAbiertos(app.db, sesion.empresaId) };
  });

  app.post('/shifts', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.VENDER);
    const datos = validar(esquemaAbrir, request.body);
    asegurarSucursal(sesion, datos.sucursalId);

    const turno = await abrirTurno(app.db, {
      empresaId: sesion.empresaId,
      sucursalId: datos.sucursalId,
      usuarioId: sesion.usuarioId,
      fondoInicial: centavos(datos.fondoInicial),
      cajaId: datos.cajaId,
      dispositivoId: datos.dispositivoId,
      notas: datos.notas,
    });

    reply.status(201);
    return { turno };
  });

  app.get('/shifts/:id/resumen', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.CERRAR_CAJA);
    const { id } = validar(parametroId, request.params);

    return { resumen: await resumenTurno(app.db, id) };
  });

  app.post('/shifts/:id/cerrar', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.CERRAR_CAJA);
    const { id } = validar(parametroId, request.params);
    const datos = validar(esquemaCerrar, request.body);

    return cerrarTurno(app.db, {
      empresaId: sesion.empresaId,
      turnoId: id,
      usuarioId: sesion.usuarioId,
      contado: centavos(datos.contado),
      notas: datos.notas,
    });
  });

  app.post('/cash-movements', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.CERRAR_CAJA);
    const datos = validar(esquemaMovimiento, request.body);
    asegurarSucursal(sesion, datos.sucursalId);

    const movimiento = await registrarMovimientoCaja(app.db, {
      empresaId: sesion.empresaId,
      sucursalId: datos.sucursalId,
      turnoId: datos.turnoId,
      tipo: datos.tipo as TipoMovimientoCaja,
      monto: centavos(datos.monto),
      motivo: datos.motivo,
      usuarioId: sesion.usuarioId,
    });

    reply.status(201);
    return { movimiento };
  });

  app.get('/cash-closures', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.CERRAR_CAJA);
    const consulta = validar(esquemaConsultaCierres, request.query);

    const cierres = await listarCierres(app.db, {
      empresaId: sesion.empresaId,
      sucursalId: consulta.sucursalId,
      desde: consulta.desde,
      hasta: consulta.hasta,
      limite: consulta.limite,
    });

    return { cierres };
  });
}
