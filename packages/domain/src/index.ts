/**
 * @mostrador/domain
 *
 * Reglas de negocio compartidas por la app movil y el panel web.
 * Es la UNICA fuente de verdad para dinero, impuestos, ventas, cobros, folios
 * e inventario: asi la app y la nube nunca calculan distinto.
 */

export * from './money.js';
export * from './tax.js';
export * from './cart.js';
export * from './payments.js';
export * from './folio.js';
export * from './stock.js';
