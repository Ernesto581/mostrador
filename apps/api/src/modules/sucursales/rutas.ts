import { schema } from '@mostrador/db-cloud';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { ErrorDeAplicacion, ErrorNoEncontrado, validar } from '../../errors.js';
import { nuevoId } from '../../util/id.js';

/**
 * Sucursales.
 *
 * El administrador da de alta las tiendas o bodegas y las quita cuando dejan de
 * usarse. Quitar una sucursal NUNCA borra la historia: se marca como inactiva y las
 * ventas, los turnos y el kardex siguen ahi.
 */

const esquemaCrear = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, 'Escribe un codigo')
    .max(12, 'El codigo es muy largo')
    .regex(/^[A-Za-z0-9-]+$/, 'Solo letras, numeros y guiones, sin espacios'),
  nombre: z.string().trim().min(1, 'Escribe el nombre').max(120),
  tipo: z.enum(['tienda', 'almacen']).default('tienda'),
  direccion: z.string().trim().max(200).optional(),
  telefono: z.string().trim().max(40).optional(),
  descripcion: z.string().trim().max(500).optional(),
  tipoNegocio: z.string().trim().max(80).optional(),
  fotoUrl: z.string().trim().max(500).optional(),
  provincia: z.string().trim().max(80).optional(),
  municipio: z.string().trim().max(80).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  horarios: z.record(z.string(), z.object({ desde: z.string(), hasta: z.string(), activo: z.boolean() })).optional(),
});

const esquemaEditar = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  tipo: z.enum(['tienda', 'almacen']).optional(),
  direccion: z.string().trim().max(200).optional(),
  telefono: z.string().trim().max(40).optional(),
  activa: z.boolean().optional(),
  ventaDesdeAlmacen: z.boolean().optional(),
  descripcion: z.string().trim().max(500).optional(),
  tipoNegocio: z.string().trim().max(80).optional(),
  fotoUrl: z.string().trim().max(500).optional(),
  provincia: z.string().trim().max(80).optional(),
  municipio: z.string().trim().max(80).optional(),
  whatsapp: z.string().trim().max(40).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  horarios: z.record(z.string(), z.object({ desde: z.string(), hasta: z.string(), activo: z.boolean() })).optional(),
});

const parametroId = z.object({ id: z.string().min(1) });

export async function rutasSucursales(app: FastifyInstance) {
  const preHandler = exigirSesion(app);
  const { branches, warehouses, users, roles, userRoles, userBranchAccess, stockBalances } =
    schema;

  /**
   * Lista de sucursales de la empresa.
   *
   * Se incluyen las inactivas, marcadas: asi el administrador las ve y puede
   * reactivarlas en vez de que desaparezcan sin explicacion.
   */
  app.get('/branches', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const lista = await app.db
      .select({
        id: branches.id,
        codigo: branches.code,
        nombre: branches.name,
        tipo: branches.type,
        direccion: branches.address,
        telefono: branches.phone,
        activa: branches.active,
        ventaDesdeAlmacen: branches.ventaDesdeAlmacen,
        descripcion: branches.descripcion,
        tipoNegocio: branches.tipoNegocio,
        fotoUrl: branches.fotoUrl,
        provincia: branches.provincia,
        municipio: branches.municipio,
        whatsapp: branches.whatsapp,
        lat: branches.lat,
        lng: branches.lng,
        horarios: branches.horarios,
      })
      .from(branches)
      .where(and(eq(branches.companyId, sesion.empresaId), isNull(branches.deletedAt)))
      .orderBy(asc(branches.code));

    return { sucursales: lista };
  });

  app.post('/branches', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_SUCURSALES);
    const datos = validar(esquemaCrear, request.body);

    const [repetida] = await app.db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.companyId, sesion.empresaId),
          eq(branches.code, datos.codigo.toUpperCase()),
          isNull(branches.deletedAt),
        ),
      )
      .limit(1);

    if (repetida) {
      throw new ErrorDeAplicacion(
        `Ya existe una sucursal con el codigo ${datos.codigo.toUpperCase()}`,
        409,
        'CODIGO_REPETIDO',
      );
    }

    const sucursalId = nuevoId();

    // Quien la crea y los demas administradores quedan con acceso, para que la
    // sucursal aparezca en su selector y no se quede "invisible".
    const administradores = await app.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.companyId, sesion.empresaId),
          eq(roles.code, 'administrador'),
          isNull(users.deletedAt),
        ),
      );

    const conAcceso = new Set([sesion.usuarioId, ...administradores.map((fila) => fila.id)]);

    await app.db.transaction(async (tx) => {
      await tx.insert(branches).values({
        id: sucursalId,
        companyId: sesion.empresaId,
        code: datos.codigo.toUpperCase(),
        name: datos.nombre,
        type: datos.tipo,
        address: datos.direccion ?? null,
        phone: datos.telefono ?? null,
        descripcion: datos.descripcion ?? null,
        tipoNegocio: datos.tipoNegocio ?? null,
        fotoUrl: datos.fotoUrl ?? null,
        provincia: datos.provincia ?? null,
        municipio: datos.municipio ?? null,
        whatsapp: datos.whatsapp ?? null,
        lat: datos.lat ?? null,
        lng: datos.lng ?? null,
        horarios: datos.horarios ?? null,
      });

      // Toda sucursal tiene almacen; las tiendas ademas tienen piso de venta, de donde se vende.
      await tx.insert(warehouses).values(
        datos.tipo === 'tienda'
          ? [
              {
                id: nuevoId(),
                branchId: sucursalId,
                code: 'PISO',
                name: 'Piso de venta',
                kind: 'piso_venta' as const,
              },
              {
                id: nuevoId(),
                branchId: sucursalId,
                code: 'ALM',
                name: 'Almacen',
                kind: 'almacen' as const,
              },
            ]
          : [
              {
                id: nuevoId(),
                branchId: sucursalId,
                code: 'P1',
                name: 'Principal',
                kind: 'almacen' as const,
              },
            ],
      );

      await tx
        .insert(userBranchAccess)
        .values([...conAcceso].map((usuarioId) => ({ userId: usuarioId, branchId: sucursalId })))
        .onConflictDoNothing();
    });

    reply.status(201);
    return {
      sucursal: { id: sucursalId, codigo: datos.codigo.toUpperCase(), nombre: datos.nombre },
    };
  });

  app.patch('/branches/:id', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_SUCURSALES);
    const { id } = validar(parametroId, request.params);
    const datos = validar(esquemaEditar, request.body);

    await buscarSucursal(app, sesion.empresaId, id);

    // No se puede quedar la empresa sin ninguna sucursal activa: nadie podria vender.
    if (datos.activa === false) {
      await asegurarNoEsLaUltima(app, sesion.empresaId);
    }

    await app.db
      .update(branches)
      .set({
        ...(datos.nombre !== undefined ? { name: datos.nombre } : {}),
        ...(datos.tipo !== undefined ? { type: datos.tipo } : {}),
        ...(datos.direccion !== undefined ? { address: datos.direccion } : {}),
        ...(datos.telefono !== undefined ? { phone: datos.telefono } : {}),
        ...(datos.activa !== undefined ? { active: datos.activa } : {}),
        ...(datos.ventaDesdeAlmacen !== undefined
          ? { ventaDesdeAlmacen: datos.ventaDesdeAlmacen }
          : {}),
        ...(datos.descripcion !== undefined ? { descripcion: datos.descripcion } : {}),
        ...(datos.tipoNegocio !== undefined ? { tipoNegocio: datos.tipoNegocio } : {}),
        ...(datos.fotoUrl !== undefined ? { fotoUrl: datos.fotoUrl } : {}),
        ...(datos.provincia !== undefined ? { provincia: datos.provincia } : {}),
        ...(datos.municipio !== undefined ? { municipio: datos.municipio } : {}),
        ...(datos.whatsapp !== undefined ? { whatsapp: datos.whatsapp } : {}),
        ...(datos.lat !== undefined ? { lat: datos.lat } : {}),
        ...(datos.lng !== undefined ? { lng: datos.lng } : {}),
        ...(datos.horarios !== undefined ? { horarios: datos.horarios } : {}),
        updatedAt: new Date(),
        revision: sql`${branches.revision} + 1`,
      })
      .where(eq(branches.id, id));

    return { sucursal: { id, actualizada: true } };
  });

  app.delete('/branches/:id', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_SUCURSALES);
    const { id } = validar(parametroId, request.params);

    await buscarSucursal(app, sesion.empresaId, id);
    await asegurarNoEsLaUltima(app, sesion.empresaId);

    // Si todavia hay mercancia, quitarla dejaria piezas "en el aire": mejor avisar.
    const [existencia] = await app.db
      .select({ total: sql<number>`coalesce(sum(${stockBalances.quantity}), 0)` })
      .from(stockBalances)
      .where(eq(stockBalances.branchId, id));

    const piezas = Number(existencia?.total ?? 0);
    if (piezas > 0) {
      throw new ErrorDeAplicacion(
        `No se puede quitar: todavia hay ${piezas} pieza(s) en existencia. Muevelas a otra sucursal o ajustalas a cero primero.`,
        409,
        'SUCURSAL_CON_EXISTENCIA',
      );
    }

    // Borrado logico: la historia de ventas y turnos se conserva.
    await app.db
      .update(branches)
      .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
      .where(eq(branches.id, id));

    return { sucursal: { id, quitada: true } };
  });
}

async function buscarSucursal(app: FastifyInstance, empresaId: string, sucursalId: string) {
  const { branches } = schema;
  const [sucursal] = await app.db
    .select({ id: branches.id, code: branches.code })
    .from(branches)
    .where(
      and(
        eq(branches.id, sucursalId),
        eq(branches.companyId, empresaId),
        isNull(branches.deletedAt),
      ),
    )
    .limit(1);

  if (!sucursal) {
    throw new ErrorNoEncontrado('La sucursal no existe');
  }
  return sucursal;
}

/** Evita dejar la empresa sin ninguna sucursal donde vender. */
async function asegurarNoEsLaUltima(app: FastifyInstance, empresaId: string): Promise<void> {
  const { branches } = schema;
  const [activas] = await app.db
    .select({ total: sql<number>`count(*)` })
    .from(branches)
    .where(
      and(
        eq(branches.companyId, empresaId),
        eq(branches.active, true),
        isNull(branches.deletedAt),
      ),
    );

  if (Number(activas?.total ?? 0) <= 1) {
    throw new ErrorDeAplicacion(
      'Es la unica sucursal: si la quitas nadie podria vender. Crea otra primero.',
      409,
      'ULTIMA_SUCURSAL',
    );
  }
}
