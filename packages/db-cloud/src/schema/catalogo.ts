import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { columnasSync, importe, piezas, porcentaje } from './comun.js';
import { companies } from './organizacion.js';

export const categories = pgTable('categories', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  /** Categoria padre para jerarquia (sin llave foranea, para permitir reordenar). */
  parentId: text(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
});

export const unitsOfMeasure = pgTable(
  'units_of_measure',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    code: text().notNull(),
    name: text().notNull(),
    active: boolean().notNull().default(true),
  },
  (tabla) => [uniqueIndex('units_of_measure_company_code_uq').on(tabla.companyId, tabla.code)],
);

export const suppliers = pgTable('suppliers', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  name: text().notNull(),
  taxId: text(),
  contactName: text(),
  phone: text(),
  email: text(),
  notes: text(),
  active: boolean().notNull().default(true),
});

export const customers = pgTable('customers', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  name: text().notNull(),
  phone: text(),
  email: text(),
  taxId: text(),
  notes: text(),
  active: boolean().notNull().default(true),
});

/**
 * Producto.
 *
 * `costPrice` es el precio de compra capturado por el usuario y `averageCost`
 * el costo promedio que el sistema recalcula al recibir compras. La venta guarda
 * el costo que uso en ese momento, para que la utilidad historica no cambie.
 */
export const products = pgTable(
  'products',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    sku: text().notNull(),
    name: text().notNull(),
    description: text(),
    categoryId: text().references(() => categories.id),
    unitId: text().references(() => unitsOfMeasure.id),
    isService: boolean().notNull().default(false),
    costPrice: importe().notNull().default(0),
    averageCost: importe().notNull().default(0),
    salePrice: importe().notNull().default(0),
    taxRate: porcentaje().notNull().default(0),
    minStock: piezas().notNull().default(0),
    imageUrl: text(),
    active: boolean().notNull().default(true),
  },
  (tabla) => [uniqueIndex('products_company_sku_uq').on(tabla.companyId, tabla.sku)],
);

/**
 * Codigos de barras de un producto.
 *
 * Un producto puede tener varios codigos, pero un codigo solo puede pertenecer
 * a un producto: la unicidad es a nivel empresa.
 */
export const productBarcodes = pgTable(
  'product_barcodes',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    productId: text()
      .notNull()
      .references(() => products.id),
    barcode: text().notNull(),
    isPrimary: boolean().notNull().default(false),
  },
  (tabla) => [
    uniqueIndex('product_barcodes_company_barcode_uq').on(tabla.companyId, tabla.barcode),
  ],
);
