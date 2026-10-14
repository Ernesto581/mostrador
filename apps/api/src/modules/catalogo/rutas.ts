import { schema } from '@mostrador/db-cloud';
import { centavos } from '@mostrador/domain';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS } from '../../auth/permisos.js';
import { asegurarPermiso, exigirSesion, sesionDe } from '../../auth/sesion.js';
import { ErrorNoEncontrado, validar } from '../../errors.js';
import { nuevoId } from '../../util/id.js';
import { registrarMovimiento, stockDeProductos } from '../inventario/servicio.js';

const esquemaConsultaProductos = z.object({
  sucursalId: z.string().min(1).optional(),
  buscar: z.string().trim().max(120).optional(),
  categoriaId: z.string().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(500).optional(),
});

const esquemaCrearProducto = z.object({
  sku: z.string().trim().min(1).max(40),
  nombre: z.string().trim().min(1).max(200),
  descripcion: z.string().max(500).optional(),
  categoriaId: z.string().max(40).optional(),
  esServicio: z.boolean().default(false),
  precioCosto: z.number().int().min(0).default(0),
  precioVenta: z.number().int().min(0).default(0),
  tasaImpuesto: z.number().int().min(0).max(100).optional(),
  stockMinimo: z.number().int().min(0).default(0),
  codigosBarras: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  /** Si se indica, se registra una entrada de inventario inicial. */
  stockInicial: z.number().int().min(0).default(0),
  sucursalId: z.string().min(1).optional(),
});

const esquemaEditarProducto = esquemaCrearProducto.partial().omit({ codigosBarras: true, stockInicial: true });

const esquemaNuevoCodigo = z.object({
  codigo: z.string().trim().min(1).max(64),
});

const esquemaCrearCategoria = z.object({
  nombre: z.string().trim().min(1).max(120),
  categoriaPadreId: z.string().min(1).optional(),
});

export async function rutasCatalogo(app: FastifyInstance) {
  const preHandler = exigirSesion(app);
  const { products, productBarcodes, categories } = schema;

  app.get('/products', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const consulta = validar(esquemaConsultaProductos, request.query);

    const condiciones = [
      eq(products.companyId, sesion.empresaId),
      isNull(products.deletedAt),
      eq(products.active, true),
    ];

    if (consulta.buscar) {
      const comoTexto = `%${consulta.buscar}%`;
      condiciones.push(
        sql`(${products.name} ilike ${comoTexto} or ${products.sku} ilike ${comoTexto} or exists (select 1 from ${productBarcodes} where ${productBarcodes.productId} = ${products.id} and ${productBarcodes.barcode} = ${consulta.buscar}))`,
      );
    }
    if (consulta.categoriaId) {
      condiciones.push(eq(products.categoryId, consulta.categoriaId));
    }

    const filas = await app.db
      .select({
        id: products.id,
        sku: products.sku,
        nombre: products.name,
        precioCosto: products.costPrice,
        costoPromedio: products.averageCost,
        precioVenta: products.salePrice,
        tasaImpuesto: products.taxRate,
        stockMinimo: products.minStock,
        esServicio: products.isService,
        categoriaId: products.categoryId,
      })
      .from(products)
      .where(and(...condiciones))
      .orderBy(asc(products.name))
      .limit(consulta.limite ?? 50);

    const stock = consulta.sucursalId
      ? await stockDeProductos(
          app.db,
          consulta.sucursalId,
          filas.map((fila) => fila.id),
        )
      : undefined;

    return {
      productos: filas.map((fila) => ({
        ...fila,
        stock: stock ? (stock.get(fila.id) ?? 0) : null,
      })),
    };
  });

  app.get('/products/barcode/:codigo', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const { codigo } = validar(z.object({ codigo: z.string().min(1).max(64) }), request.params);
    const { sucursalId } = validar(
      z.object({ sucursalId: z.string().min(1).optional() }),
      request.query,
    );

    const [fila] = await app.db
      .select({
        id: products.id,
        sku: products.sku,
        nombre: products.name,
        precioVenta: products.salePrice,
        costoPromedio: products.averageCost,
        tasaImpuesto: products.taxRate,
        esServicio: products.isService,
      })
      .from(productBarcodes)
      .innerJoin(products, eq(products.id, productBarcodes.productId))
      .where(
        and(
          eq(productBarcodes.companyId, sesion.empresaId),
          eq(productBarcodes.barcode, codigo),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);

    if (!fila) {
      throw new ErrorNoEncontrado(`Ningun producto tiene el codigo ${codigo}`);
    }

    const stock = sucursalId
      ? ((await stockDeProductos(app.db, sucursalId, [fila.id])).get(fila.id) ?? 0)
      : null;

    return { producto: { ...fila, stock } };
  });

  app.post('/products', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_CATALOGO);
    const datos = validar(esquemaCrearProducto, request.body);

    const [empresa] = await app.db
      .select({ tasaPorDefecto: schema.companies.defaultTaxRate })
      .from(schema.companies)
      .where(eq(schema.companies.id, sesion.empresaId))
      .limit(1);

    const productoId = nuevoId();

    await app.db.transaction(async (tx) => {
      await tx.insert(products).values({
        id: productoId,
        companyId: sesion.empresaId,
        sku: datos.sku,
        name: datos.nombre,
        description: datos.descripcion ?? null,
        categoryId: datos.categoriaId ?? null,
        isService: datos.esServicio,
        costPrice: datos.precioCosto,
        averageCost: datos.precioCosto,
        salePrice: datos.precioVenta,
        taxRate: datos.tasaImpuesto ?? empresa?.tasaPorDefecto ?? 0,
        minStock: datos.stockMinimo,
      });

      if (datos.codigosBarras.length > 0) {
        await tx.insert(productBarcodes).values(
          datos.codigosBarras.map((codigo, indice) => ({
            id: nuevoId(),
            companyId: sesion.empresaId,
            productId: productoId,
            barcode: codigo,
            isPrimary: indice === 0,
          })),
        );
      }
    });

    if (datos.stockInicial > 0 && datos.sucursalId) {
      await registrarMovimiento(app.db, {
        empresaId: sesion.empresaId,
        sucursalId: datos.sucursalId,
        productoId,
        tipo: 'inventario_inicial',
        cantidad: datos.stockInicial,
        costoUnitario: centavos(datos.precioCosto),
        motivo: 'Alta de producto',
        usuarioId: sesion.usuarioId,
        documentoTipo: 'producto',
        documentoId: productoId,
      });
    }

    reply.status(201);
    return { producto: { id: productoId, sku: datos.sku, nombre: datos.nombre } };
  });

  app.patch('/products/:id', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_CATALOGO);
    const { id } = validar(z.object({ id: z.string().min(1) }), request.params);
    const datos = validar(esquemaEditarProducto, request.body);

    const [existente] = await app.db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, id),
          eq(products.companyId, sesion.empresaId),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);

    if (!existente) {
      throw new ErrorNoEncontrado('El producto no existe');
    }

    await app.db
      .update(products)
      .set({
        ...(datos.sku !== undefined ? { sku: datos.sku } : {}),
        ...(datos.nombre !== undefined ? { name: datos.nombre } : {}),
        ...(datos.descripcion !== undefined ? { description: datos.descripcion } : {}),
        ...(datos.categoriaId !== undefined ? { categoryId: datos.categoriaId } : {}),
        ...(datos.esServicio !== undefined ? { isService: datos.esServicio } : {}),
        ...(datos.precioCosto !== undefined
          ? { costPrice: datos.precioCosto, averageCost: datos.precioCosto }
          : {}),
        ...(datos.precioVenta !== undefined ? { salePrice: datos.precioVenta } : {}),
        ...(datos.tasaImpuesto !== undefined ? { taxRate: datos.tasaImpuesto } : {}),
        ...(datos.stockMinimo !== undefined ? { minStock: datos.stockMinimo } : {}),
        updatedAt: new Date(),
        revision: sql`${products.revision} + 1`,
      })
      .where(eq(products.id, id));

    return { producto: { id, actualizado: true } };
  });

  app.post('/products/:id/barcodes', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_CATALOGO);
    const { id } = validar(z.object({ id: z.string().min(1) }), request.params);
    const { codigo } = validar(esquemaNuevoCodigo, request.body);

    const [producto] = await app.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, id), eq(products.companyId, sesion.empresaId)))
      .limit(1);

    if (!producto) {
      throw new ErrorNoEncontrado('El producto no existe');
    }

    await app.db.insert(productBarcodes).values({
      id: nuevoId(),
      companyId: sesion.empresaId,
      productId: id,
      barcode: codigo,
    });

    reply.status(201);
    return { productoId: id, codigo };
  });

  app.get('/categories', { preHandler: [preHandler] }, async (request) => {
    const sesion = sesionDe(request);
    const filas = await app.db
      .select({ id: categories.id, nombre: categories.name, padreId: categories.parentId })
      .from(categories)
      .where(and(eq(categories.companyId, sesion.empresaId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.name));

    return { categorias: filas };
  });

  app.post('/categories', { preHandler: [preHandler] }, async (request, reply) => {
    const sesion = sesionDe(request);
    asegurarPermiso(sesion, PERMISOS.GESTIONAR_CATALOGO);
    const datos = validar(esquemaCrearCategoria, request.body);

    const id = nuevoId();
    await app.db.insert(categories).values({
      id,
      companyId: sesion.empresaId,
      name: datos.nombre,
      parentId: datos.categoriaPadreId ?? null,
    });

    reply.status(201);
    return { categoria: { id, nombre: datos.nombre } };
  });
}
