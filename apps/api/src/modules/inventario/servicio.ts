import { schema, type Db } from '@mostrador/db-cloud';
import type { TipoMovimientoInventario, TipoUbicacion } from '@mostrador/db-cloud/schema';
import { type Centavos, type TipoMovimiento, centavos, signoMovimiento } from '@mostrador/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { BaseDatos } from '../../db/tipos.js';
import { ErrorDeAplicacion, ErrorNoEncontrado } from '../../errors.js';
import { nuevoId } from '../../util/id.js';
import { CODIGO_SUCURSAL_GENERAL, obtenerSucursalGeneral } from './general.js';

export interface EntradaMovimiento {
  empresaId: string;
  sucursalId: string;
  almacenId?: string | undefined;
  productoId: string;
  tipo: TipoMovimientoInventario;
  /** Cantidad siempre positiva: el tipo determina el signo. */
  cantidad: number;
  costoUnitario?: Centavos | undefined;
  precioVenta?: Centavos | undefined;
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

/**
 * Ubicacion principal de una sucursal: su piso de venta si lo tiene y, si no,
 * la primera ubicacion activa. El inventario se maneja por sucursal, asi que
 * las entradas siempre tienen un destino valido.
 */
export async function ubicacionPrincipalDeSucursal(
  base: BaseDatos,
  sucursalId: string,
): Promise<string> {
  const [ubicacion] = await base
    .select({ id: schema.warehouses.id })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.branchId, sucursalId),
        isNull(schema.warehouses.deletedAt),
        eq(schema.warehouses.active, true),
      ),
    )
    .orderBy(
      sql`case when ${schema.warehouses.kind} = 'piso_venta' then 0 else 1 end`,
      asc(schema.warehouses.createdAt),
    )
    .limit(1);

  if (!ubicacion) {
    throw new ErrorNoEncontrado('La sucursal no tiene una ubicacion configurada');
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
    entrada.almacenId ?? (await ubicacionPrincipalDeSucursal(base, entrada.sucursalId));
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

  if (entrada.precioVenta !== undefined) {
    await base
      .update(schema.products)
      .set({
        salePrice: entrada.precioVenta,
        ...(entrada.costoUnitario !== undefined
          ? {
              costPrice: entrada.costoUnitario,
              averageCost: entrada.costoUnitario,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.products.id, entrada.productoId),
          eq(schema.products.companyId, entrada.empresaId),
          isNull(schema.products.deletedAt),
        ),
      );
  }

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

/**
 * Registra un movimiento suelto (compra, ajuste, merma, inventario inicial).
 *
 * Si no se indica una ubicacion, el movimiento se resuelve por sucursal: las
 * entradas van al piso de venta y las salidas toman primero del piso y despues
 * del almacen. Asi el inventario se maneja por sucursal y no por ubicacion.
 */
export async function registrarMovimiento(
  db: Db,
  entrada: EntradaMovimiento,
): Promise<MovimientoAplicado> {
  return db.transaction(async (tx) => {
    if (entrada.almacenId) {
      return aplicarMovimiento(tx, entrada);
    }

    const signo = signoMovimiento(entrada.tipo as TipoMovimiento);
    if (signo >= 0) {
      return aplicarMovimiento(tx, {
        ...entrada,
        almacenId: await ubicacionPrincipalDeSucursal(tx, entrada.sucursalId),
      });
    }

    const saldos = await tx
      .select({
        almacenId: schema.stockBalances.warehouseId,
        cantidad: schema.stockBalances.quantity,
      })
      .from(schema.stockBalances)
      .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.stockBalances.warehouseId))
      .where(
        and(
          eq(schema.stockBalances.branchId, entrada.sucursalId),
          eq(schema.stockBalances.productId, entrada.productoId),
          eq(schema.warehouses.active, true),
          isNull(schema.warehouses.deletedAt),
          sql`${schema.stockBalances.quantity} > 0`,
        ),
      )
      .orderBy(sql`case when ${schema.warehouses.kind} = 'piso_venta' then 0 else 1 end`);

    const disponible = saldos.reduce((total, saldo) => total + Number(saldo.cantidad), 0);
    if (disponible < entrada.cantidad) {
      throw new ErrorDeAplicacion(
        `No hay suficiente existencia: hay ${disponible} y se intentan mover ${entrada.cantidad}`,
        409,
        'SIN_EXISTENCIA',
      );
    }

    let restante = entrada.cantidad;
    let aplicado: MovimientoAplicado | undefined;
    for (const saldo of saldos) {
      if (restante === 0) {
        break;
      }
      const cantidad = Math.min(restante, Number(saldo.cantidad));
      aplicado = await aplicarMovimiento(tx, {
        ...entrada,
        almacenId: saldo.almacenId,
        cantidad,
      });
      restante -= cantidad;
    }

    return aplicado!;
  });
}

export interface AsignacionInventario {
  productoId: string;
  sucursalId: string;
  cantidad: number;
  salida: MovimientoAplicado;
  entrada: MovimientoAplicado;
}

/**
 * Mueve existencia del deposito general a una sucursal.
 *
 * No es compra ni venta: son dos movimientos de transferencia dentro de la misma
 * transaccion. El total de la empresa no cambia, solo el reparto.
 */
export async function asignarASucursal(
  db: Db,
  datos: {
    empresaId: string;
    sucursalId: string;
    productoId: string;
    cantidad: number;
    motivo?: string | undefined;
    usuarioId: string;
  },
): Promise<AsignacionInventario> {
  const general = await obtenerSucursalGeneral(db, datos.empresaId);
  if (general.sucursalId === datos.sucursalId) {
    throw new ErrorDeAplicacion(
      'Elige una sucursal de venta, no el inventario general',
      422,
      'DESTINO_INVALIDO',
    );
  }

  return db.transaction(async (tx) => {
    const producto = await productoExiste(tx, datos.empresaId, datos.productoId);
    if (!producto) {
      throw new ErrorNoEncontrado('El producto no existe');
    }

    const documentoId = nuevoId();
    const comun = {
      empresaId: datos.empresaId,
      productoId: datos.productoId,
      cantidad: datos.cantidad,
      costoUnitario: centavos(producto.costoPromedio),
      motivo: datos.motivo ?? 'Asignacion a sucursal',
      usuarioId: datos.usuarioId,
      documentoTipo: 'asignacion_inventario',
      documentoId,
    };

    const salida = await aplicarMovimiento(tx, {
      ...comun,
      sucursalId: general.sucursalId,
      almacenId: general.almacenId,
      tipo: 'transferencia_salida',
    });

    const entrada = await aplicarMovimiento(tx, {
      ...comun,
      sucursalId: datos.sucursalId,
      tipo: 'transferencia_entrada',
    });

    return {
      productoId: datos.productoId,
      sucursalId: datos.sucursalId,
      cantidad: datos.cantidad,
      salida,
      entrada,
    };
  });
}

export interface FiltroStock {
  empresaId: string;
  sucursalId: string;
  buscar?: string | undefined;
  categoriaId?: string | undefined;
  soloBajoMinimo?: boolean | undefined;
  soloAgotados?: boolean | undefined;
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
  /** Minimo efectivo de la sucursal (regla propia o respaldo general). */
  stockMinimo: number;
  /** Minimo general del producto, el respaldo de las sucursales sin regla. */
  stockMinimoGeneral: number;
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

/** Disponible para vender: todo el stock de la sucursal, sin separar ubicaciones. */
export async function stockDeProductos(
  base: BaseDatos,
  sucursalId: string,
  productoIds: readonly string[],
): Promise<Map<string, number>> {
  const existencias = await existenciasDeProductos(base, sucursalId, productoIds);
  return new Map(
    [...existencias].map(([id, existencia]) => [id, existencia.piso + existencia.almacen]),
  );
}

/** Productos activos de la empresa, con el filtro de busqueda aplicado. */
async function listarProductos(
  base: BaseDatos,
  filtro: {
    empresaId: string;
    buscar?: string | undefined;
    categoriaId?: string | undefined;
    limite?: number | undefined;
  },
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
  if (filtro.categoriaId) {
    condiciones.push(eq(schema.products.categoryId, filtro.categoriaId));
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

/** Minimos por producto y sucursal: la regla propia gana sobre la general. */
async function minimosPorSucursal(
  base: BaseDatos,
  empresaId: string,
  productoIds: readonly string[],
  sucursalIds: readonly string[],
): Promise<Map<string, number>> {
  const resultado = new Map<string, number>();
  if (productoIds.length === 0 || sucursalIds.length === 0) {
    return resultado;
  }

  const reglas = await base
    .select({
      productoId: schema.stockMinRules.productId,
      branchId: schema.stockMinRules.branchId,
      minStock: schema.stockMinRules.minStock,
    })
    .from(schema.stockMinRules)
    .where(
      and(
        eq(schema.stockMinRules.companyId, empresaId),
        inArray(schema.stockMinRules.productId, [...productoIds]),
        isNull(schema.stockMinRules.deletedAt),
        or(
          isNull(schema.stockMinRules.branchId),
          inArray(schema.stockMinRules.branchId, [...sucursalIds]),
        ),
      ),
    );

  const especificas = new Map<string, number>();
  const generales = new Map<string, number>();
  for (const regla of reglas) {
    if (regla.branchId) {
      especificas.set(`${regla.productoId}:${regla.branchId}`, regla.minStock);
    } else {
      generales.set(regla.productoId, regla.minStock);
    }
  }

  for (const productoId of productoIds) {
    for (const sucursalId of sucursalIds) {
      const minimo =
        especificas.get(`${productoId}:${sucursalId}`) ?? generales.get(productoId);
      if (minimo !== undefined) {
        resultado.set(`${productoId}:${sucursalId}`, minimo);
      }
    }
  }

  return resultado;
}

/** Stock por producto en una sucursal, con la alerta de minimo ya resuelta. */
export async function stockPorSucursal(base: BaseDatos, filtro: FiltroStock): Promise<FilaStock[]> {
  const productos = await listarProductos(base, {
    empresaId: filtro.empresaId,
    buscar: filtro.buscar,
    categoriaId: filtro.categoriaId,
    limite: filtro.limite,
  });

  if (productos.length === 0) {
    return [];
  }

  const ids = productos.map((producto) => producto.id);
  const existencias = await existenciasDeProductos(base, filtro.sucursalId, ids);
  const minimos = await minimosPorSucursal(base, filtro.empresaId, ids, [filtro.sucursalId]);

  const resultado: FilaStock[] = productos.map((producto) => {
    const { piso, almacen } = existencias.get(producto.id) ?? { piso: 0, almacen: 0 };
    const stock = piso + almacen;
    const stockMinimo =
      minimos.get(`${producto.id}:${filtro.sucursalId}`) ?? producto.stockMinimo;
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
      stockMinimo,
      stockMinimoGeneral: producto.stockMinimo,
      bajoMinimo: stockMinimo > 0 && stock <= stockMinimo,
      categoriaId: producto.categoriaId,
    };
  });

  return resultado.filter(
    (fila) =>
      (!filtro.soloBajoMinimo || fila.bajoMinimo) && (!filtro.soloAgotados || fila.stock <= 0),
  );
}

export interface FiltroStockGeneral {
  empresaId: string;
  /** Sucursales a las que la sesion tiene acceso. Vacio = ninguna. */
  sucursalIds?: string[] | undefined;
  buscar?: string | undefined;
  categoriaId?: string | undefined;
  soloBajoMinimo?: boolean | undefined;
  soloAgotados?: boolean | undefined;
  limite?: number | undefined;
}

export interface RepartoSucursal {
  sucursalId: string;
  codigo: string;
  nombre: string;
  cantidad: number;
  /** Minimo configurado para esta sucursal. */
  minimo: number;
  bajoMinimo: boolean;
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
  /** Minimo general del producto, el respaldo de las sucursales sin regla. */
  stockMinimoGeneral: number;
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
    categoriaId: filtro.categoriaId,
    limite: filtro.limite,
  });

  if (productos.length === 0) {
    return [];
  }

  const sucursalIds = filtro.sucursalIds ?? [];
  if (sucursalIds.length === 0) {
    return [];
  }

  const ids = productos.map((producto) => producto.id);

  const sucursales = await base
    .select({ id: schema.branches.id, codigo: schema.branches.code, nombre: schema.branches.name })
    .from(schema.branches)
    .where(
      and(
        eq(schema.branches.companyId, filtro.empresaId),
        inArray(schema.branches.id, [...sucursalIds]),
        isNull(schema.branches.deletedAt),
      ),
    )
    .orderBy(asc(schema.branches.name));

  const filas = await base
    .select({
      productoId: schema.stockBalances.productId,
      sucursalId: schema.stockBalances.branchId,
      cantidad: sql<number>`sum(${schema.stockBalances.quantity})`,
    })
    .from(schema.stockBalances)
    .innerJoin(schema.branches, eq(schema.branches.id, schema.stockBalances.branchId))
    .where(
      and(
        eq(schema.branches.companyId, filtro.empresaId),
        inArray(schema.stockBalances.productId, ids),
        inArray(schema.stockBalances.branchId, [...sucursalIds]),
      ),
    )
    .groupBy(schema.stockBalances.productId, schema.stockBalances.branchId);

  const cantidadesPorProducto = new Map<string, Map<string, number>>();
  for (const fila of filas) {
    const porSucursal = cantidadesPorProducto.get(fila.productoId) ?? new Map<string, number>();
    porSucursal.set(fila.sucursalId, Number(fila.cantidad));
    cantidadesPorProducto.set(fila.productoId, porSucursal);
  }

  const minimos = await minimosPorSucursal(base, filtro.empresaId, ids, sucursalIds);

  const resultado: FilaStockGeneral[] = productos.map((producto) => {
    const cantidades = cantidadesPorProducto.get(producto.id) ?? new Map<string, number>();
    const reparto: RepartoSucursal[] = sucursales.map((sucursal) => {
      const cantidad = cantidades.get(sucursal.id) ?? 0;
      const esInventarioGeneral = sucursal.codigo === CODIGO_SUCURSAL_GENERAL;
      const minimo =
        esInventarioGeneral
          ? 0
          : (minimos.get(`${producto.id}:${sucursal.id}`) ?? producto.stockMinimo);
      return {
        sucursalId: sucursal.id,
        codigo: sucursal.codigo,
        nombre: sucursal.nombre,
        cantidad,
        minimo,
        bajoMinimo: !esInventarioGeneral && minimo > 0 && cantidad <= minimo,
      };
    });
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
      stockMinimoGeneral: producto.stockMinimo,
      bajoMinimo: reparto.some((parte) => parte.bajoMinimo),
      categoriaId: producto.categoriaId,
      reparto,
    };
  });

  return resultado.filter(
    (fila) =>
      (!filtro.soloBajoMinimo || fila.bajoMinimo) && (!filtro.soloAgotados || fila.stock <= 0),
  );
}

export interface MinimoSucursal {
  productoId: string;
  sucursalId: string;
  stockMinimo: number;
}

/**
 * Guarda el minimo de un producto en una sucursal. Si ya existe una regla para
 * esa pareja se actualiza; si no, se crea. El minimo general del producto queda
 * como respaldo para las sucursales sin regla propia.
 */
export async function guardarMinimoSucursal(
  db: Db,
  datos: {
    empresaId: string;
    sucursalId: string;
    productoId: string;
    stockMinimo: number;
  },
): Promise<MinimoSucursal> {
  return db.transaction(async (tx) => {
    const producto = await productoExiste(tx, datos.empresaId, datos.productoId);
    if (!producto) {
      throw new ErrorNoEncontrado('El producto no existe');
    }

    const [existente] = await tx
      .select({ id: schema.stockMinRules.id })
      .from(schema.stockMinRules)
      .where(
        and(
          eq(schema.stockMinRules.companyId, datos.empresaId),
          eq(schema.stockMinRules.productId, datos.productoId),
          eq(schema.stockMinRules.branchId, datos.sucursalId),
          isNull(schema.stockMinRules.deletedAt),
        ),
      )
      .limit(1);

    if (existente) {
      await tx
        .update(schema.stockMinRules)
        .set({
          minStock: datos.stockMinimo,
          updatedAt: new Date(),
          revision: sql`${schema.stockMinRules.revision} + 1`,
        })
        .where(eq(schema.stockMinRules.id, existente.id));
    } else {
      await tx.insert(schema.stockMinRules).values({
        id: nuevoId(),
        companyId: datos.empresaId,
        productId: datos.productoId,
        branchId: datos.sucursalId,
        minStock: datos.stockMinimo,
      });
    }

    return {
      productoId: datos.productoId,
      sucursalId: datos.sucursalId,
      stockMinimo: datos.stockMinimo,
    };
  });
}

export interface FiltroMovimientos {
  empresaId: string;
  productoId?: string | undefined;
  sucursalId?: string | undefined;
  /** Sucursales a las que la sesion tiene acceso. Vacio = ninguna. */
  sucursalIds?: string[] | undefined;
  tipo?: string | undefined;
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
  } else if (filtro.sucursalIds) {
    if (filtro.sucursalIds.length === 0) {
      return [];
    }
    condiciones.push(inArray(schema.inventoryMovements.branchId, filtro.sucursalIds));
  }
  if (filtro.tipo) {
    condiciones.push(
      eq(schema.inventoryMovements.type, filtro.tipo as TipoMovimientoInventario),
    );
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
      sucursalNombre: schema.branches.name,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.products, eq(schema.products.id, schema.inventoryMovements.productId))
    .innerJoin(schema.branches, eq(schema.branches.id, schema.inventoryMovements.branchId))
    .where(and(...condiciones))
    .orderBy(desc(schema.inventoryMovements.occurredAt))
    .limit(filtro.limite ?? 100);
}
