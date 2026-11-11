import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { columnasSync } from './comun.js';
import { companies } from './organizacion.js';

export type OperacionSync = 'upsert' | 'delete';

/**
 * Bitacora de cambios de la nube.
 *
 * Cada cambio que llega se publica aqui con un consecutivo creciente (`seq`).
 * Los dispositivos piden "dame todo lo mayor a mi cursor" y reciben solo lo nuevo.
 * Asi la sincronizacion es incremental y barata, sin recorrer tablas completas.
 */
export const changeFeed = pgTable(
  'change_feed',
  {
    seq: bigserial({ mode: 'number' }).primaryKey(),
    companyId: text().notNull(),
    branchId: text(),
    entity: text().notNull(),
    entityId: text().notNull(),
    operation: text().$type<OperacionSync>().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('change_feed_company_seq_idx').on(tabla.companyId, tabla.seq)],
);

/** Bitacora de auditoria: quien cambio que, cuando y desde donde. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text().primaryKey(),
    companyId: text().notNull(),
    branchId: text(),
    userId: text(),
    deviceId: text(),
    entity: text().notNull(),
    entityId: text().notNull(),
    action: text().notNull(),
    before: jsonb().$type<Record<string, unknown>>(),
    after: jsonb().$type<Record<string, unknown>>(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('audit_log_entity_idx').on(tabla.entity, tabla.entityId)],
);

/** Operaciones sincronizadas (idempotencia por opId). */
export const syncOperations = pgTable('sync_operations', {
  opId: text().primaryKey(),
  companyId: text().notNull(),
  tipo: text().notNull(),
  processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Versiones de la app de Android.
 *
 * El administrador registra cada version que compila y decide cuando mandarla:
 * mientras `publicada` sea false, los telefonos no ven nada. Con true, la app
 * avisa que hay una version nueva y ofrece descargarla desde `url`.
 */
export const appReleases = pgTable(
  'app_releases',
  {
    ...columnasSync(),
    companyId: text()
      .notNull()
      .references(() => companies.id),
    /** Numero que siempre sube: la app lo compara con el suyo. */
    versionCode: integer().notNull(),
    /** Nombre para mostrar, por ejemplo 1.4. */
    versionName: text().notNull(),
    /** Que cambio en esta version. */
    notas: text(),
    /** De donde se baja el APK. */
    url: text().notNull(),
    /** false: solo registrada. true: los telefonos ya ven la actualizacion. */
    publicada: boolean().notNull().default(false),
    publicadoEn: timestamp({ withTimezone: true }),
    publicadoPor: text(),
  },
  (tabla) => [
    uniqueIndex('app_releases_company_version_uq').on(tabla.companyId, tabla.versionCode),
    index('app_releases_company_idx').on(tabla.companyId),
  ],
);
