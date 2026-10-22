import { schema, type Db } from '@mostrador/db-cloud';
import type { TipoMovimientoInventario, TipoUbicacion } from '@mostrador/db-cloud/schema';
import { type Centavos, type TipoMovimiento, signoMovimiento } from '@mostrador/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { ErrorDeAplicacion, ErrorNoEncontrado } from '../../errors.js';
import { nuevoId } from '../../util/id.js';

export interface EntradaMovimiento {
  empresaId: string;
  sucursalId: string;
  almacenId?: string | undefined;
  productoId: string;
  tipo: TipoMovimientoInventario;
  /** Cantidad siempre positiva: el tipo determina el signo. */
  cantidad: number;
  costoUnitario?: Centavos | undefined;
  motivo?: string | undefined;
  usuarioId?: string | undefined;
  dispositivoId?: string | undefined;
  documentoTipo?: string | undefined;
  documentoId?: string | undefined;
  documentoFolio?: string | undefined;
  ocurridoEn?: Date | undefined;
}

export interface MovimientoAplicado {
  id: string;
  productoId: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  cantidadConSigno: number;
  saldoResultante: number;
}

/** Saldo actual de un producto en un almacen concreto. */
async function leerSaldo(
  base: BaseDatos,
  productoId: string,
  sucursalId: string,
  almacenId: string,
): Promise<number> {
  const [fila] = await base
    .select({ cantidad: schema.stockBalances.quantity })
    .from(schema.stockBalances)
    .where(
      and(
        eq(schema.stockBalances.productId, productoId),
        eq(schema.stockBalances.branchId, sucursalId),
        eq(schema.stockBalances.warehouseId, almacenId),
      ),
    )
    .limit(1);

  return Number(fila?.cantidad ?? 0);
}

/** Ubicacion de una sucursal de un tipo dado: su piso de venta o su almacen. */
export async function ubicacionDeSucursal(
  base: BaseDatos,
  sucursalId: string,
  tipo: TipoUbicacion,
): Promise<string> {
  const [ubicacion] = await base
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.branchId, sucursalId),
        eq(schema.warehouses.kind, tipo),
        isNull(schema.warehouses.deletedAt),
        eq(schema.warehouses.active, true),
      ),
    )
    .orderBy(asc(schema.warehouses.createdAt))
    .limit(1);

  if (!ubicacion) {
    throw new ErrorNoEncontrado(
      tipo === 'piso_venta'
        ? 'La sucursal no tiene piso de venta configurado'
        : 'La sucursal no tiene almacen configurado',
    );
  }
  return ubicacion.id;
}

/** Evita escribir en una ubicacion que pertenece a otra sucursal. */
async function asegurarUbicacionDeSucursal(
  base: BaseDatos,
  ubicacionId: string,
  sucursalId: string,
): Promise<void> {
  const [ubicacion] = await base
    .select({ sucursalId: schema.warehouses.branchId })
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, ubicacionId), isNull(schema.warehouses.deletedAt)))
    .limit(1);

  if (!ubicacion || ubicacion.sucursalId !== sucursalId) {
    throw new ErrorNoEncontrado('La ubicacion no pertenece a esta sucursal');
  }
}

export async function productoExiste(
  base: BaseDatos,
  empresaId: string,
  productoId: string,
): Promise<{ id: string; nombre: string; costoPromedio: number } | undefined> {
  const [producto] = await base
    .select({
      id: schema.products.id,
      nombre: schema.products.name,
      costoPromedio: schema.products.averageCost,
    })
    .from(schema.products)
    .where(
      and(
        eq(schema.products.id, productoId),
        eq(schema.products.companyId, empresaId),
        isNull(schema.products.deletedAt),
      ),
    )
    .limit(1);

  return producto;
}

/**
 * Aplica un movimiento al kardex y actualiza el saldo.
 *
 * Son dos escrituras que van juntas: el movimiento (la historia) y el saldo
 * (la lectura rapida). Deben vivir en la misma transaccion para que el saldo
 * nunca se despegue de la historia.
 */
export async function aplicarMovimiento(
  base: BaseDatos,
  entrada: EntradaMovimiento,
): Promise<MovimientoAplicado> {
  const almacenId =
    entrada.almacenId ?? (await ubicacionDeSucursal(base, entrada.sucursalId, 'almacen'));
  if (entrada.almacenId) {
    await asegurarUbicacionDeSucursal(base, entrada.almacenId, entrada.sucursalId);
  }
  const signo = signoMovimiento(entrada.tipo as TipoMovimiento);
  const cantidadConSigno = signo * entrada.cantidad;
  const id = nuevoId();

  // Nada puede quedar en negativo: si el movimiento resta, se comprueba antes.
  if (cantidadConSigno < 0) {
    const disponible = await leerSaldo(base, entrada.productoId, entrada.sucursalId, almacenId);
    if (disponible + cantidadConSigno < 0) {
      throw new ErrorDeAplicacion(
        `No hay suficiente existencia: hay ${disponible} y se intentan mover ${entrada.cantidad}`,
        409,
        'SIN_EXISTENCIA',
      );
    }
  }

  await base.insert(schema.inventoryMovements).values({
    id,
    companyId: entrada.empresaId,
    branchId: entrada.sucursalId,
    warehouseId: almacenId,
    productId: entrada.productoId,
    type: entrada.tipo,
    quantity: entrada.cantidad,
    unitCost: entrada.costoUnitario ?? null,
    documentType: entrada.documentoTipo ?? null,
    documentId: entrada.documentoId ?? null,
    documentFolio: entrada.documentoFolio ?? null,
    reason: entrada.motivo ?? null,
    userId: entrada.usuarioId ?? null,
    deviceId: entrada.dispositivoId ?? null,
    occurredAt: entrada.ocurridoEn ?? new Date(),
  });

  await base
    .insert(schema.stockBalances)
    .values({
      productId: entrada.productoId,
      branchId: entrada.sucursalId,
      warehouseId: almacenId,
      // Se propone un valor nunca negativo: PostgreSQL evalua la restriccion sobre el
      // valor del INSERT aunque despues el conflicto lo convierta en una suma. Si la
      // fila ya existe esto no se usa; y si no existe y el movimiento resta, la
      // comprobacion de arriba ya lo habria rechazado.
      quantity: cantidadConSigno > 0 ? cantidadConSigno : 0,
    })
    .onConflictDoUpdate({
      target: [
        schema.stockBalances.productId,
        schema.stockBalances.branchId,
        schema.stockBalances.warehouseId,
      ],
      set: {
        quantity: sql`${schema.stockBalances.quantity} + ${cantidadConSigno}`,
        updatedAt: new Date(),
      },
    });

  const [saldo] = await base
    .select({ cantidad: schema.stockBalances.quantity })
    .from(schema.stockBalances)
    .where(
      and(
        eq(schema.stockBalances.productId, entrada.productoId),
        eq(schema.stockBalances.branchId, entrada.sucursalId),
        eq(schema.stockBalances.warehouseId, almacenId),
      ),
    )
    .limit(1);

  return {
    id,
    productoId: entrada.productoId,
    tipo: entrada.tipo,
    cantidad: entrada.cantidad,
    cantidadConSigno,
    saldoResultante: Number(saldo?.cantidad ?? 0),
  };
}

/** Registra un movimiento suelto (compra, ajuste, merma, inventario inicial). */
export async function registrarMovimiento(
  db: Db,
  entrada: EntradaMovimiento,
): Promise<MovimientoAplicado> {
  return db.transaction(async (tx) => aplicarMovimiento(tx, entrada));
}

export interface FiltroStock {
  empresaId: string;
  sucursalId: string;
  buscar?: string | undefined;
  soloBajoMinimo?: boolean | undefined;
  limite?: number | undefined;
}

export interface FilaStock {
  productoId: string;
  sku: string;
  nombre: string;
  imagenUrl: string | null;
  precioCosto: number;
  precioVenta: number;
  costoPromedio: number;
  /** Total de la sucursal: piso de venta mas almacen. */
  stock: number;
  piso: number;
  almacen: number;
  stockMinimo: number;
  bajoMinimo: boolean;
  categoriaId: string | null;
}

/** Existencias de un producto en una sucursal, separadas por tipo de ubicacion. */
export interface ExistenciaSucursal {
  piso: number;
  almacen: number;
}

export async function existenciasDeProductos(
  base: BaseDatos,
  sucursalId: string,
  productoIds: readonly string[],
): Promise<Map<string, ExistenciaSucursal>> {
  const existencias = new Map<string, ExistenciaSucursal>(
    productoIds.map((id) => [id, { piso: 0, almacen: 0 }]),
  );
  if (productoIds.length === 0) {
    return existencias;
  }

  const filas = await base
    .select({
      productoId: schema.stockBalances.productId,
      tipo: schema.warehouses.kind,
      cantidad: sql<number>`sum(${schema.stockBalances.quantity})`,
    })
    .from(schema.stockBalances)
    .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.stockBalances.warehouseId))
    .where(
      and(
        eq(schema.stockBalances.branchId, sucursalId),
        inArray(schema.stockBalances.productId, [...productoIds]),
      ),
    )
    .groupBy(schema.stockBalances.productId, schema.warehouses.kind);

  for (const fila of filas) {
    const existencia = existencias.get(fila.productoId) ?? { piso: 0, almacen: 0 };
    if (fila.tipo === 'piso_venta') {
      existencia.piso += Number(fila.cantidad);
    } else {
      existencia.almacen += Number(fila.cantidad);
    }
    existencias.set(fila.productoId, existencia);
  }

  return existencias;
}

/** Disponible para vender en el piso de venta de la sucursal. */
export async function stockDeProductos(
  base: BaseDatos,
  sucursalId: string,
  productoIds: readonly string[],
): Promise<Map<string, number>> {
  const existencias = await existenciasDeProductos(base, sucursalId, productoIds);
  return new Map([...existencias].map(([id, existencia]) => [id, existencia.piso]));
}

/** Productos activos de la empresa, con el filtro de busqueda aplicado. */
async function listarProductos(
  base: BaseDatos,
  filtro: { empresaId: string; buscar?: string | undefined; limite?: number | undefined },
) {
  const condiciones = [
    eq(schema.products.companyId, filtro.empresaId),
    isNull(schema.products.deletedAt),
    eq(schema.products.active, true),
  ];

  if (filtro.buscar) {
    const comoTexto = `%${filtro.buscar}%`;
    condiciones.push(
      or(
        sql`${schema.products.name} ilike ${comoTexto}`,
        sql`${schema.products.sku} ilike ${comoTexto}`,
      )!,
    );
  }

  return base
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      nombre: schema.products.name,
      imagenUrl: schema.products.imageUrl,
      precioCosto: schema.products.costPrice,
      precioVenta: schema.products.salePrice,
      costoPromedio: schema.products.averageCost,
      stockMinimo: schema.products.minStock,
      categoriaId: schema.products.categoryId,
    })
    .from(schema.products)
    .where(and(...condiciones))
    .orderBy(asc(schema.products.name))
    .limit(filtro.limite ?? 200);
}

/** Stock por producto en una sucursal, con la alerta de minimo ya resuelta. */
export async function stockPorSucursal(base: BaseDatos, filtro: FiltroStock): Promise<FilaStock[]> {
  const productos = await listarProductos(base, {
    empresaId: filtro.empresaId,
    buscar: filtro.buscar,
    limite: filtro.limite,
  });

  if (productos.length === 0) {
    return [];
  }

  const existencias = await existenciasDeProductos(
    base,
    filtro.sucursalId,
    productos.map((producto) => producto.id),
  );

  const resultado: FilaStock[] = productos.map((producto) => {
    const { piso, almacen } = existencias.get(producto.id) ?? { piso: 0, almacen: 0 };
    const stock = piso + almacen;
    return {
      productoId: producto.id,
      sku: producto.sku,
      nombre: producto.nombre,
      imagenUrl: producto.imagenUrl,
      precioCosto: producto.precioCosto,
      precioVenta: producto.precioVenta,
      costoPromedio: producto.costoPromedio,
      stock,
      piso,
      almacen,
      stockMinimo: producto.stockMinimo,
      bajoMinimo: stock <= producto.stockMinimo,
      categoriaId: producto.categoriaId,
    };
  });

  return filtro.soloBajoMinimo ? resultado.filter((fila) => fila.bajoMinimo) : resultado;
}

export interface FiltroStockGeneral {
  empresaId: string;
  buscar?: string | undefined;
  soloBajoMinimo?: boolean | undefined;
  limite?: number | undefined;
}

export interface RepartoSucursal {
  sucursalId: string;
  codigo: string;
  nombre: string;
  cantidad: number;
}

export interface FilaStockGeneral {
  productoId: string;
  sku: string;
  nombre: string;
  imagenUrl: string | null;
  precioCosto: number;
  precioVenta: number;
  costoPromedio: number;
  /** Total sumando todas las sucursales. */
  stock: number;
  stockMinimo: number;
  bajoMinimo: boolean;
  categoriaId: string | null;
  /** Como esta repartido: cuanto hay en cada sucursal. */
  reparto: RepartoSucursal[];
}

/**
 * Inventario general: el total de cada producto y su reparto por sucursal.
 *
 * Es la vista para decidir: "tengo 25 en total, 15 aqui y 10 alla".
 */
export async function stockGeneral(
  base: BaseDatos,
  filtro: FiltroStockGeneral,
): Promise<FilaStockGeneral[]> {
  const productos = await listarProductos(base, {
    empresaId: filtro.empresaId,
    buscar: filtro.buscar,
    limite: filtro.limite,
  });

  if (productos.length === 0) {
    return [];
  }

  const ids = productos.map((producto) => producto.id);

  const filas = await base
    .select({
      productoId: schema.stockBalances.productId,
      sucursalId: schema.stockBalances.branchId,
      codigo: schema.branches.code,
      nombreSucursal: schema.branches.name,
      cantidad: sql<number>`sum(${schema.stockBalances.quantity})`,
    })
    .from(schema.stockBalances)
    .innerJoin(schema.branches, eq(schema.branches.id, schema.stockBalances.branchId))
    .where(
      and(
        eq(schema.branches.companyId, filtro.empresaId),
        inArray(schema.stockBalances.productId, ids),
      ),
    )
    .groupBy(
      schema.stockBalances.productId,
      schema.stockBalances.branchId,
      schema.branches.code,
      schema.branches.name,
    )
    .orderBy(asc(schema.branches.code));

  const repartoPorProducto = new Map<string, RepartoSucursal[]>();
  for (const fila of filas) {
    const lista = repartoPorProducto.get(fila.productoId) ?? [];
    lista.push({
      sucursalId: fila.sucursalId,
      codigo: fila.codigo,
      nombre: fila.nombreSucursal,
      cantidad: Number(fila.cantidad),
    });
    repartoPorProducto.set(fila.productoId, lista);
  }

  const resultado: FilaStockGeneral[] = productos.map((producto) => {
    const reparto = repartoPorProducto.get(producto.id) ?? [];
    const stock = reparto.reduce((total, parte) => total + parte.cantidad, 0);

    return {
      productoId: producto.id,
      sku: producto.sku,
      nombre: producto.nombre,
      imagenUrl: producto.imagenUrl,
      precioCosto: producto.precioCosto,
      precioVenta: producto.precioVenta,
      costoPromedio: producto.costoPromedio,
      stock,
      stockMinimo: producto.stockMinimo,
      bajoMinimo: stock <= producto.stockMinimo,
      categoriaId: producto.categoriaId,
      reparto,
    };
  });

  return filtro.soloBajoMinimo ? resultado.filter((fila) => fila.bajoMinimo) : resultado;
}

export interface FiltroMovimientos {
  empresaId: string;
  productoId?: string | undefined;
  sucursalId?: string | undefined;
  desde?: Date | undefined;
  hasta?: Date | undefined;
  limite?: number | undefined;
}

/** Kardex: la historia de movimientos, lo mas reciente primero. */
export async function listarMovimientos(base: BaseDatos, filtro: FiltroMovimientos) {
  const condiciones = [eq(schema.inventoryMovements.companyId, filtro.empresaId)];

  if (filtro.productoId) {
    condiciones.push(eq(schema.inventoryMovements.productId, filtro.productoId));
  }
  if (filtro.sucursalId) {
    condiciones.push(eq(schema.inventoryMovements.branchId, filtro.sucursalId));
  }
  if (filtro.desde) {
    condiciones.push(gte(schema.inventoryMovements.occurredAt, filtro.desde));
  }
  if (filtro.hasta) {
    condiciones.push(lte(schema.inventoryMovements.occurredAt, filtro.hasta));
  }

  return base
    .select({
      id: schema.inventoryMovements.id,
      tipo: schema.inventoryMovements.type,
      cantidad: schema.inventoryMovements.quantity,
      costoUnitario: schema.inventoryMovements.unitCost,
      motivo: schema.inventoryMovements.reason,
      documentoTipo: schema.inventoryMovements.documentType,
      documentoFolio: schema.inventoryMovements.documentFolio,
      ocurridoEn: schema.inventoryMovements.occurredAt,
      productoId: schema.inventoryMovements.productId,
      producto: schema.products.name,
      sku: schema.products.sku,
      sucursalId: schema.inventoryMovements.branchId,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.products, eq(schema.products.id, schema.inventoryMovements.productId))
    .where(and(...condiciones))
    .orderBy(desc(schema.inventoryMovements.occurredAt))
    .limit(filtro.limite ?? 100);
}
