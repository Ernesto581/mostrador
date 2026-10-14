import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
