import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
  (tabla) => [
    primaryKey({ columns: [tabla.productId, tabla.branchId, tabla.warehouseId] }),
    // El stock NUNCA puede quedar en negativo: lo garantiza la propia base de datos.
    check('stock_balances_no_negativo', sql`${tabla.quantity} >= 0`),
  ],
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

/**
 * Estados de una transferencia entre ubicaciones.
 *
 * - borrador: creada, todavia no sale mercancia (solo entre locales).
 * - en_transito: ya salio del origen; el destino todavia no confirma.
 * - recibida: el destino confirmo las cantidades recibidas.
 * - rechazada: el destino no acepto la mercancia; regresa al origen.
 * - cancelada: se anulo antes de salir.
 *
 * Una transferencia dentro del mismo local no pasa por borrador ni transito:
 * se confirma en un solo paso.
 */
export type EstadoTransferencia =
  | 'borrador'
  | 'en_transito'
  | 'recibida'
  | 'rechazada'
  | 'cancelada';

/** Documento de transferencia entre ubicaciones (almacen, piso o local). */
export const transfers = pgTable(
  'transfers',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    folio: text().notNull(),
    fromWarehouseId: text()
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: text()
      .notNull()
      .references(() => warehouses.id),
    fromBranchId: text()
      .notNull()
      .references(() => branches.id),
    toBranchId: text()
      .notNull()
      .references(() => branches.id),
    status: text().$type<EstadoTransferencia>().notNull().default('borrador'),
    reason: text(),
    /** true si la cantidad recibida fue menor que la enviada: queda como incidencia. */
    hasDiscrepancy: boolean().notNull().default(false),
    createdByUserId: text()
      .notNull()
      .references(() => users.id),
    dispatchedByUserId: text().references(() => users.id),
    dispatchedAt: timestamp({ withTimezone: true }),
    receivedByUserId: text().references(() => users.id),
    receivedAt: timestamp({ withTimezone: true }),
  },
  (tabla) => [
    uniqueIndex('transfers_company_folio_uq').on(tabla.companyId, tabla.folio),
    index('transfers_from_branch_idx').on(tabla.fromBranchId),
    index('transfers_to_branch_idx').on(tabla.toBranchId),
  ],
);

/** Linea de una transferencia: lo enviado y, al recibir, lo que realmente llego. */
export const transferLines = pgTable(
  'transfer_lines',
  {
    id: text().primaryKey(),
    transferId: text()
      .notNull()
      .references(() => transfers.id),
    productId: text()
      .notNull()
      .references(() => products.id),
    quantitySent: piezas().notNull(),
    quantityReceived: piezas(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('transfer_lines_transfer_idx').on(tabla.transferId)],
);
