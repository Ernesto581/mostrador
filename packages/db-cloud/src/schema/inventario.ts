import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { columnasSync, importe, piezas } from './comun.js';
import { products } from './catalogo.js';
import { branches, companies, users, warehouses } from './organizacion.js';

/**
 * Tipos de movimiento. El tipo determina el SIGNO del movimiento.
 * Debe coincidir con `TipoMovimiento` de `@mostrador/domain`.
 */
export type TipoMovimientoInventario =
  | 'inventario_inicial'
  | 'entrada_compra'
  | 'salida_venta'
  | 'devolucion_cliente'
  | 'devolucion_proveedor'
  | 'ajuste_positivo'
  | 'ajuste_negativo'
  | 'merma'
  | 'transferencia_entrada'
  | 'transferencia_salida';

/**
 * Kardex: el libro de movimientos.
 *
 * Es APPEND-ONLY. Nunca se actualiza ni se borra una fila: el stock es la suma
 * con signo de estos movimientos. Cancelar o devolver agrega un movimiento inverso.
 * Por eso no lleva `updatedAt` ni `deletedAt`.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: text().primaryKey(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    warehouseId: text().references(() => warehouses.id),
    productId: text()
      .notNull()
      .references(() => products.id),
    type: text().$type<TipoMovimientoInventario>().notNull(),
    /** Cantidad siempre positiva; el signo lo determina el tipo. */
    quantity: piezas().notNull(),
    unitCost: importe(),
    documentType: text(),
    documentId: text(),
    documentFolio: text(),
    reason: text(),
    userId: text().references(() => users.id),
    deviceId: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [
    index('inventory_movements_product_branch_idx').on(tabla.productId, tabla.branchId),
    index('inventory_movements_occurred_at_idx').on(tabla.occurredAt),
  ],
);

/** Saldo de stock por producto, sucursal y almacen. Tabla derivada del kardex. */
export const stockBalances = pgTable(
  'stock_balances',
  {
    productId: text()
      .notNull()
      .references(() => products.id),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    warehouseId: text()
      .notNull()
      .references(() => warehouses.id),
    quantity: piezas().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [primaryKey({ columns: [tabla.productId, tabla.branchId, tabla.warehouseId] })],
);

/** Regla de stock minimo. `branchId` nulo significa "aplica a todas las sucursales". */
export const stockMinRules = pgTable('stock_min_rules', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  productId: text()
    .notNull()
    .references(() => products.id),
  branchId: text().references(() => branches.id),
  minStock: piezas().notNull().default(0),
  maxStock: piezas(),
  reorderPoint: piezas(),
});
