/**
 * Invariantes del sistema.
 *
 * Estas pruebas no revisan un caso concreto: comprueban que las reglas se cumplen
 * SIEMPRE, sobre miles de combinaciones generadas al azar. Son la red de seguridad
 * contra los errores que descuadran una caja o una contabilidad.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calcularTotales, type LineaVentaEntrada } from '../src/cart.js';
import { centavos, type Centavos, sumar } from '../src/money.js';
import { calcularCobro } from '../src/payments.js';
import {
  saldo,
  signoMovimiento,
  TIPOS_MOVIMIENTO,
  type MovimientoInventario,
} from '../src/stock.js';
import { desglosar } from '../src/tax.js';

const centavosArb: fc.Arbitrary<Centavos> = fc
  .integer({ min: 0, max: 500000 })
  .map((n) => centavos(n));

const totalArb: fc.Arbitrary<Centavos> = fc
  .integer({ min: 1, max: 500000 })
  .map((n) => centavos(n));

const extraArb: fc.Arbitrary<Centavos> = fc
  .integer({ min: 0, max: 100000 })
  .map((n) => centavos(n));

const cantidadArb = fc.integer({ min: 1, max: 50 });
const tasaArb = fc.constantFrom(0, 8, 16);

describe('invariantes del sistema', () => {
  it('el total de una venta es la suma de sus lineas y equivale a base + impuestos', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            precioUnitario: centavosArb,
            cantidad: cantidadArb,
            tasaImpuesto: tasaArb,
            descuentoPorcentaje: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (entradas) => {
          const lineas: LineaVentaEntrada[] = entradas.map((entrada, indice) => ({
            productoId: `p${indice}`,
            nombre: `Producto ${indice}`,
            ...entrada,
          }));

          const totales = calcularTotales(lineas, { preciosConImpuestoIncluido: true });

          expect(totales.total).toBe(sumar(...totales.lineas.map((linea) => linea.total)));
          expect(totales.total).toBe(sumar(totales.base, totales.impuestos));
          expect(totales.total).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('el desglose de impuestos siempre cuadra', () => {
    fc.assert(
      fc.property(centavosArb, tasaArb, (monto, tasa) => {
        const resultado = desglosar(monto, tasa, { preciosConImpuestoIncluido: true });
        expect(sumar(resultado.base, resultado.impuesto)).toBe(resultado.total);
        expect(resultado.base).toBeLessThanOrEqual(resultado.total);
        expect(resultado.impuesto).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('el cambio es exactamente lo pagado menos el total', () => {
    fc.assert(
      fc.property(totalArb, extraArb, (total, extra) => {
        const resultado = calcularCobro(total, [
          { metodo: 'efectivo', monto: centavos(total + extra) },
        ]);
        expect(resultado.cambio).toBe(extra);
        expect(resultado.pagado).toBe(total + extra);
      }),
    );
  });

  it('el saldo de inventario es la suma con signo de los movimientos', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tipo: fc.constantFrom(...TIPOS_MOVIMIENTO),
            cantidad: cantidadArb,
          }),
          { maxLength: 50 },
        ),
        (entradas) => {
          const movimientos: MovimientoInventario[] = entradas.map((entrada) => ({
            productoId: 'p1',
            sucursalId: 's1',
            fecha: new Date(2026, 0, 1),
            tipo: entrada.tipo,
            cantidad: entrada.cantidad,
          }));

          const esperado = movimientos.reduce(
            (acumulado, movimiento) =>
              acumulado + movimiento.cantidad * signoMovimiento(movimiento.tipo),
            0,
          );

          expect(saldo(movimientos)).toBe(esperado);
        },
      ),
    );
  });
});
