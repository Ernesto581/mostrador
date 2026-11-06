import { schema } from '@mostrador/db-cloud';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, asegurarSucursal, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { ErrorDeAplicacion, validar } from '../../errors.js';

const esquemaResumen = z.object({
  desde: z.coerce.date(),
  hasta: z.coerce.date(),
  sucursalId: z.string().min(1).optional(),
  por: z.enum(['importe', 'cantidad']).default('importe'),
});

/**
 * Reportes de ventas y utilidad.
 *
 * Se calculan con las ventas completadas y el costo que quedo guardado en cada
 * linea al vender. No se estima ni se recalcula con el costo actual: si el costo
 * cambio despues, la utilidad historica sigue siendo la real de ese momento.
 */
export async function rutasReportes(app: FastifyInstance) {
  const preHandler = exigirSesion(app);
  const { sales, saleLines, salePayments, branches, companies } = schema;

  app.get('/reports/resumen', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.VER_UTILIDAD);

    const consulta = validar(esquemaResumen, request.query);
    if (consulta.desde > consulta.hasta) {
      throw new ErrorDeAplicacion(
        'La fecha inicial no puede ser posterior a la final',
        422,
        'RANGO_INVALIDO',
      );
    }

    if (consulta.sucursalId) {
      asegurarSucursal(sesion, consulta.sucursalId);
    }

    const sucursalIds = consulta.sucursalId
      ? [consulta.sucursalId]
      : sesion.sucursales.map((sucursal) => sucursal.id);

    const [empresa] = await app.db
      .select({ moneda: companies.currency })
      .from(companies)
      .where(eq(companies.id, sesion.empresaId))
      .limit(1);

    const moneda = empresa?.moneda ?? 'CUP';

    if (sucursalIds.length === 0) {
      return reporteVacio(consulta.desde, consulta.hasta, moneda);
    }

    const condiciones = [
      eq(sales.companyId, sesion.empresaId),
      isNull(sales.deletedAt),
      eq(sales.status, 'completada'),
      gte(sales.soldAt, consulta.desde),
      lte(sales.soldAt, consulta.hasta),
      inArray(sales.branchId, sucursalIds),
    ];

    const [resumen] = await app.db
      .select({
        tickets: sql<number>`count(*)::int`,
        articulos: sql<number>`coalesce(sum(${sales.itemCount}), 0)::int`,
        ventaBruta: sql<number>`coalesce(sum(${sales.total}), 0)::int`,
        ventaNeta: sql<number>`coalesce(sum(${sales.subtotal}), 0)::int`,
        impuestos: sql<number>`coalesce(sum(${sales.taxTotal}), 0)::int`,
        descuentos: sql<number>`coalesce(sum(${sales.discountTotal}), 0)::int`,
        cambio: sql<number>`coalesce(sum(${sales.changeGiven}), 0)::int`,
      })
      .from(sales)
      .where(and(...condiciones));

    const [costos] = await app.db
      .select({
        costo: sql<number>`coalesce(sum(${saleLines.quantity} * ${saleLines.unitCost}), 0)::int`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(...condiciones));

    const pagosFilas = await app.db
      .select({
        metodo: salePayments.method,
        monto: sql<number>`coalesce(sum(${salePayments.amount}), 0)::int`,
      })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(and(...condiciones))
      .groupBy(salePayments.method);

    const totalPagado = pagosFilas.reduce((total, fila) => total + Number(fila.monto), 0);
    const pagos = pagosFilas
      .map((fila) => ({
        metodo: fila.metodo,
        monto: Number(fila.monto),
        porcentaje: totalPagado > 0 ? Number(fila.monto) / totalPagado : 0,
      }))
      .sort((a, b) => b.monto - a.monto);

    const orden =
      consulta.por === 'cantidad'
        ? desc(sql`sum(${saleLines.quantity})`)
        : desc(sql`sum(${saleLines.total})`);

    const masVendidos = await app.db
      .select({
        productoId: saleLines.productId,
        nombre: saleLines.name,
        sku: saleLines.sku,
        cantidad: sql<number>`sum(${saleLines.quantity})::int`,
        venta: sql<number>`sum(${saleLines.total})::int`,
        costo: sql<number>`sum(${saleLines.quantity} * ${saleLines.unitCost})::int`,
        utilidad: sql<number>`sum(${saleLines.baseAmount})::int - sum(${saleLines.quantity} * ${saleLines.unitCost})::int`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(...condiciones))
      .groupBy(saleLines.productId, saleLines.name, saleLines.sku)
      .orderBy(orden)
      .limit(10);

    const porSucursal = await app.db
      .select({
        sucursalId: sales.branchId,
        codigo: branches.code,
        nombre: branches.name,
        tickets: sql<number>`count(*)::int`,
        ventaBruta: sql<number>`coalesce(sum(${sales.total}), 0)::int`,
        ventaNeta: sql<number>`coalesce(sum(${sales.subtotal}), 0)::int`,
      })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .where(and(...condiciones))
      .groupBy(sales.branchId, branches.code, branches.name)
      .orderBy(asc(branches.code));

    const porDia = await app.db
      .select({
        dia: sql<string>`to_char(${sales.soldAt}, 'YYYY-MM-DD')`,
        tickets: sql<number>`count(*)::int`,
        ventaBruta: sql<number>`coalesce(sum(${sales.total}), 0)::int`,
      })
      .from(sales)
      .where(and(...condiciones))
      .groupBy(sql`to_char(${sales.soldAt}, 'YYYY-MM-DD')`)
      .orderBy(asc(sql`to_char(${sales.soldAt}, 'YYYY-MM-DD')`));

    const tickets = Number(resumen?.tickets ?? 0);
    const ventaBruta = Number(resumen?.ventaBruta ?? 0);
    const ventaNeta = Number(resumen?.ventaNeta ?? 0);
    const costo = Number(costos?.costo ?? 0);
    const utilidad = ventaNeta - costo;

    return {
      rango: { desde: consulta.desde.toISOString(), hasta: consulta.hasta.toISOString() },
      moneda,
      resumen: {
        tickets,
        articulos: Number(resumen?.articulos ?? 0),
        ventaBruta,
        ventaNeta,
        impuestos: Number(resumen?.impuestos ?? 0),
        descuentos: Number(resumen?.descuentos ?? 0),
        cambio: Number(resumen?.cambio ?? 0),
        costo,
        utilidad,
        margen: ventaNeta > 0 ? utilidad / ventaNeta : 0,
        ticketPromedio: tickets > 0 ? Math.round(ventaBruta / tickets) : 0,
      },
      pagos,
      porSucursal: porSucursal.map((fila) => ({
        ...fila,
        tickets: Number(fila.tickets),
        ventaBruta: Number(fila.ventaBruta),
        ventaNeta: Number(fila.ventaNeta),
      })),
      masVendidos: masVendidos.map((fila) => ({
        ...fila,
        cantidad: Number(fila.cantidad),
        venta: Number(fila.venta),
        costo: Number(fila.costo),
        utilidad: Number(fila.utilidad),
      })),
      porDia: porDia.map((fila) => ({
        ...fila,
        tickets: Number(fila.tickets),
        ventaBruta: Number(fila.ventaBruta),
      })),
    };
  });
}

function reporteVacio(desde: Date, hasta: Date, moneda: string) {
  return {
    rango: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    moneda,
    resumen: {
      tickets: 0,
      articulos: 0,
      ventaBruta: 0,
      ventaNeta: 0,
      impuestos: 0,
      descuentos: 0,
      cambio: 0,
      costo: 0,
      utilidad: 0,
      margen: 0,
      ticketPromedio: 0,
    },
    pagos: [],
    porSucursal: [],
    masVendidos: [],
    porDia: [],
  };
}
