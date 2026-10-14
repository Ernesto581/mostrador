import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { columnasSync, importe } from './comun.js';
import { suppliers } from './catalogo.js';
import { branches, companies, users } from './organizacion.js';

export type TipoCuenta = 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'costo' | 'gasto';
export type TipoOrigenAsiento =
  | 'venta'
  | 'devolucion'
  | 'cancelacion'
  | 'compra'
  | 'gasto'
  | 'merma'
  | 'ajuste'
  | 'manual';
export type EstadoPeriodo = 'abierto' | 'cerrado';

/** Periodo contable mensual. Cerrarlo bloquea cambios hacia atras. */
export const accountingPeriods = pgTable(
  'accounting_periods',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    year: integer().notNull(),
    month: integer().notNull(),
    status: text().$type<EstadoPeriodo>().notNull().default('abierto'),
    closedAt: timestamp({ withTimezone: true }),
    closedByUserId: text().references(() => users.id),
  },
  (tabla) => [
    uniqueIndex('accounting_periods_company_year_month_uq').on(
      tabla.companyId,
      tabla.year,
      tabla.month,
    ),
  ],
);

/** Catalogo de cuentas. */
export const chartOfAccounts = pgTable(
  'chart_of_accounts',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    code: text().notNull(),
    name: text().notNull(),
    type: text().$type<TipoCuenta>().notNull(),
    parentCode: text(),
    /** Cuenta de sistema: no se puede renombrar ni borrar desde la interfaz. */
    isSystem: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
  },
  (tabla) => [uniqueIndex('chart_of_accounts_company_code_uq').on(tabla.companyId, tabla.code)],
);

/** Poliza: encabezado de un asiento contable. */
export const journalEntries = pgTable(
  'journal_entries',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    branchId: text().references(() => branches.id),
    periodId: text().references(() => accountingPeriods.id),
    date: date().notNull(),
    memo: text().notNull(),
    sourceType: text().$type<TipoOrigenAsiento>().notNull(),
    /** Documento que lo origino: id de la venta, la compra, el gasto... */
    sourceId: text(),
    postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('journal_entries_source_idx').on(tabla.sourceType, tabla.sourceId)],
);

/** Renglon del asiento. Todo asiento debe cumplir: suma de debe = suma de haber. */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: text().primaryKey(),
    entryId: text()
      .notNull()
      .references(() => journalEntries.id),
    accountId: text()
      .notNull()
      .references(() => chartOfAccounts.id),
    debit: importe().notNull().default(0),
    credit: importe().notNull().default(0),
    memo: text(),
  },
  (tabla) => [index('journal_lines_entry_idx').on(tabla.entryId)],
);

/** Regla de contabilizacion automatica: evento de negocio -> cuentas. */
export const accountingRules = pgTable('accounting_rules', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  eventType: text().notNull(),
  debitAccountId: text()
    .notNull()
    .references(() => chartOfAccounts.id),
  creditAccountId: text()
    .notNull()
    .references(() => chartOfAccounts.id),
  description: text(),
  active: boolean().notNull().default(true),
});

export const expenseCategories = pgTable('expense_categories', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  name: text().notNull(),
  accountId: text().references(() => chartOfAccounts.id),
});

/** Gasto del negocio (renta, luz, sueldos, etc.). */
export const expenses = pgTable(
  'expenses',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    branchId: text().references(() => branches.id),
    categoryId: text().references(() => expenseCategories.id),
    supplierId: text().references(() => suppliers.id),
    date: date().notNull(),
    amount: importe().notNull(),
    description: text().notNull(),
    paymentMethod: text(),
    createdByUserId: text().references(() => users.id),
  },
  (tabla) => [index('expenses_company_date_idx').on(tabla.companyId, tabla.date)],
);

/** Cuenta por pagar a proveedor. */
export const accountsPayable = pgTable('accounts_payable', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  supplierId: text()
    .notNull()
    .references(() => suppliers.id),
  documentFolio: text(),
  date: date().notNull(),
  dueDate: date(),
  amount: importe().notNull(),
  paidAmount: importe().notNull().default(0),
});
