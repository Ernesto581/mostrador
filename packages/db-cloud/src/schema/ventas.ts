import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { columnasSync, importe, piezas, porcentaje } from './comun.js';
import { customers, products } from './catalogo.js';
import { branches, companies, devices, users } from './organizacion.js';

export type EstadoVenta = 'completada' | 'cancelada';
export type EstadoTurno = 'abierto' | 'cerrado';
export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';
export type TipoMovimientoCaja = 'ingreso' | 'retiro' | 'gasto';
export type AlcanceCierre = 'turno' | 'dia';

/** Caja fisica de una sucursal. */
export const cashRegisters = pgTable('cash_registers', {
  ...columnasSync(),
  branchId: text()
    .notNull()
    .references(() => branches.id),
  code: text().notNull(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
});

/** Turno de un vendedor: fondo inicial, ventas y cierre. */
export const shifts = pgTable('shifts', {
  ...columnasSync(),
  branchId: text()
    .notNull()
    .references(() => branches.id),
  cashRegisterId: text().references(() => cashRegisters.id),
  deviceId: text().references(() => devices.id),
  openedByUserId: text()
    .notNull()
    .references(() => users.id),
  openedAt: timestamp({ withTimezone: true }).notNull(),
  initialCash: importe().notNull().default(0),
  status: text().$type<EstadoTurno>().notNull().default('abierto'),
  closedByUserId: text().references(() => users.id),
  closedAt: timestamp({ withTimezone: true }),
  notes: text(),
});

/** Venta. Inmutable una vez registrada: cancelar es un acto aparte, no un borrado. */
export const sales = pgTable(
  'sales',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    deviceId: text().references(() => devices.id),
    shiftId: text().references(() => shifts.id),
    cashRegisterId: text().references(() => cashRegisters.id),
    folio: text().notNull(),
    soldByUserId: text()
      .notNull()
      .references(() => users.id),
    customerId: text().references(() => customers.id),
    status: text().$type<EstadoVenta>().notNull().default('completada'),
    currency: text().notNull().default('CUP'),
    subtotal: importe().notNull().default(0),
    discountTotal: importe().notNull().default(0),
    taxTotal: importe().notNull().default(0),
    total: importe().notNull().default(0),
    paidTotal: importe().notNull().default(0),
    changeGiven: importe().notNull().default(0),
    itemCount: piezas().notNull().default(0),
    soldAt: timestamp({ withTimezone: true }).notNull(),
  },
  (tabla) => [
    uniqueIndex('sales_company_folio_uq').on(tabla.companyId, tabla.folio),
    index('sales_branch_sold_at_idx').on(tabla.branchId, tabla.soldAt),
  ],
);

/** Linea de venta. Guarda el nombre y el costo del momento: es un comprobante. */
export const saleLines = pgTable(
  'sale_lines',
  {
    id: text().primaryKey(),
    saleId: text()
      .notNull()
      .references(() => sales.id),
    productId: text().references(() => products.id),
    lineNumber: integer().notNull(),
    /** Copia del producto al momento de vender (por si cambia despues). */
    name: text().notNull(),
    sku: text(),
    barcode: text(),
    quantity: piezas().notNull(),
    unitPrice: importe().notNull(),
    discountAmount: importe().notNull().default(0),
    taxRate: porcentaje().notNull().default(0),
    baseAmount: importe().notNull().default(0),
    taxAmount: importe().notNull().default(0),
    total: importe().notNull(),
    /** Costo unitario usado al momento de vender (utilidad historica). */
    unitCost: importe().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('sale_lines_sale_idx').on(tabla.saleId)],
);

/** Pago de una venta. Varios pagos = cobro mixto. */
export const salePayments = pgTable(
  'sale_payments',
  {
    id: text().primaryKey(),
    saleId: text()
      .notNull()
      .references(() => sales.id),
    method: text().$type<MetodoPago>().notNull(),
    amount: importe().notNull(),
    /** Referencia de la terminal, autorizacion o folio de la transferencia. */
    reference: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('sale_payments_sale_idx').on(tabla.saleId)],
);

/** Movimiento de efectivo de la caja: ingreso, retiro o gasto pagado de la caja. */
export const cashMovements = pgTable(
  'cash_movements',
  {
    ...columnasSync(),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    shiftId: text().references(() => shifts.id),
    deviceId: text().references(() => devices.id),
    type: text().$type<TipoMovimientoCaja>().notNull(),
    amount: importe().notNull(),
    reason: text(),
    userId: text().references(() => users.id),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
  },
  (tabla) => [index('cash_movements_branch_occurred_idx').on(tabla.branchId, tabla.occurredAt)],
);

/** Cierre de caja: arqueo por turno y consolidado del dia. */
export const cashClosures = pgTable(
  'cash_closures',
  {
    ...columnasSync(),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    scope: text().$type<AlcanceCierre>().notNull(),
    shiftId: text().references(() => shifts.id),
    date: date().notNull(),
    salesTotal: importe().notNull().default(0),
    expectedCash: importe().notNull().default(0),
    countedCash: importe().notNull().default(0),
    difference: importe().notNull().default(0),
    closedByUserId: text()
      .notNull()
      .references(() => users.id),
    closedAt: timestamp({ withTimezone: true }).notNull(),
    notes: text(),
  },
  (tabla) => [index('cash_closures_branch_date_idx').on(tabla.branchId, tabla.date)],
);

/** Devolucion de una venta (parcial o total). */
export const returns = pgTable(
  'returns',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    branchId: text()
      .notNull()
      .references(() => branches.id),
    saleId: text()
      .notNull()
      .references(() => sales.id),
    deviceId: text().references(() => devices.id),
    folio: text().notNull(),
    reason: text(),
    total: importe().notNull().default(0),
    refundMethod: text().$type<MetodoPago>(),
    createdByUserId: text()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [uniqueIndex('returns_company_folio_uq').on(tabla.companyId, tabla.folio)],
);

export const returnLines = pgTable(
  'return_lines',
  {
    id: text().primaryKey(),
    returnId: text()
      .notNull()
      .references(() => returns.id),
    saleLineId: text().references(() => saleLines.id),
    productId: text().references(() => products.id),
    quantity: piezas().notNull(),
    unitPrice: importe().notNull(),
    total: importe().notNull(),
    /** true si el producto regresa al inventario; false si esta dañado. */
    restock: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('return_lines_return_idx').on(tabla.returnId)],
);

/** Cancelacion de una venta, con motivo. Genera movimientos de reverso. */
export const saleVoids = pgTable('sale_voids', {
  ...columnasSync(),
  saleId: text()
    .notNull()
    .references(() => sales.id),
  reason: text().notNull(),
  voidedByUserId: text()
    .notNull()
    .references(() => users.id),
  authorizedByUserId: text().references(() => users.id),
  voidedAt: timestamp({ withTimezone: true }).notNull(),
});
