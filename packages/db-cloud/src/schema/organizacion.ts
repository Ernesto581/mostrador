import {
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { columnasSync, porcentaje } from './comun.js';

export type TipoSucursal = 'tienda' | 'almacen';
/** Piso de venta: de aqui sale lo que se vende. Almacen: reserva que se transfiere al piso. */
export type TipoUbicacion = 'piso_venta' | 'almacen';
export type PlataformaDispositivo = 'android' | 'ios' | 'web';
export type EstadoDispositivo = 'pendiente' | 'aprobado' | 'revocado';

/** Empresa (inquilino unico del sistema). */
export const companies = pgTable('companies', {
  ...columnasSync(),
  name: text().notNull(),
  legalName: text(),
  taxId: text(),
  currency: text().notNull().default('CUP'),
  /** true: el precio de venta ya incluye el impuesto (lo normal en tienda). */
  pricesIncludeTax: boolean().notNull().default(true),
  /** Tasa de impuesto por defecto en base 100. 0 = sin impuestos. */
  defaultTaxRate: porcentaje().notNull().default(0),
  active: boolean().notNull().default(true),
});

/** Sucursal: punto de venta o almacen. */
export const branches = pgTable(
  'branches',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    code: text().notNull(),
    name: text().notNull(),
    type: text().$type<TipoSucursal>().notNull().default('tienda'),
    address: text(),
    phone: text(),
    active: boolean().notNull().default(true),
    /**
     * false (lo normal): el mostrador vende solo del piso de venta.
     * true: si el piso no alcanza, la venta toma el resto del almacen.
     */
    ventaDesdeAlmacen: boolean().notNull().default(false),
  },
  (tabla) => [uniqueIndex('branches_company_code_uq').on(tabla.companyId, tabla.code)],
);

/** Ubicacion de inventario dentro de una sucursal: piso de venta o almacen. */
export const warehouses = pgTable('warehouses', {
  ...columnasSync(),
  branchId: text()
    .notNull()
    .references(() => branches.id),
  code: text().notNull(),
  name: text().notNull(),
  kind: text().$type<TipoUbicacion>().notNull().default('almacen'),
  active: boolean().notNull().default(true),
});

/** Usuario del sistema (vendedor, almacenista, contador, administrador). */
export const users = pgTable(
  'users',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    username: text().notNull(),
    fullName: text().notNull(),
    email: text(),
    passwordHash: text(),
    /** PIN corto para cambio rapido de vendedor en el mostrador. */
    pinHash: text(),
    active: boolean().notNull().default(true),
  },
  (tabla) => [uniqueIndex('users_company_username_uq').on(tabla.companyId, tabla.username)],
);

/** Rol con su lista de permisos. */
export const roles = pgTable('roles', {
  ...columnasSync(),
  companyId: text()
    .notNull()
    .references(() => companies.id),
  code: text().notNull(),
  name: text().notNull(),
  /** Permisos granulares, por ejemplo: sale.sell, sale.void, inventory.adjust. */
  permissions: text().array().notNull().default([]),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: text()
      .notNull()
      .references(() => users.id),
    roleId: text()
      .notNull()
      .references(() => roles.id),
  },
  (tabla) => [primaryKey({ columns: [tabla.userId, tabla.roleId] })],
);

/** Sucursales a las que puede acceder un usuario. */
export const userBranchAccess = pgTable(
  'user_branch_access',
  {
    userId: text()
      .notNull()
      .references(() => users.id),
    branchId: text()
      .notNull()
      .references(() => branches.id),
  },
  (tabla) => [primaryKey({ columns: [tabla.userId, tabla.branchId] })],
);

/**
 * Dispositivo (telefono) autorizado.
 *
 * Como los telefonos son personales, un dispositivo nuevo queda "pendiente"
 * hasta que el administrador lo aprueba; despues se puede revocar a distancia.
 */
export const devices = pgTable('devices', {
  ...columnasSync(),
  userId: text()
    .notNull()
    .references(() => users.id),
  branchId: text()
    .notNull()
    .references(() => branches.id),
  name: text().notNull(),
  platform: text().$type<PlataformaDispositivo>().notNull(),
  status: text().$type<EstadoDispositivo>().notNull().default('pendiente'),
  appVersion: text(),
  approvedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  lastSeenAt: timestamp({ withTimezone: true }),
});
