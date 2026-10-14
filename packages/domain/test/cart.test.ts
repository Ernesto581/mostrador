import { describe, expect, it } from 'vitest';
import { calcularLinea, calcularTotales, type LineaVentaEntrada } from '../src/cart.js';
import { desdeDecimal, sumar } from '../src/money.js';
import type { ConfiguracionImpuestos } from '../src/tax.js';

const INCLUIDO: ConfiguracionImpuestos = { preciosConImpuestoIncluido: true };

describe('carrito de venta', () => {
  it('calcula una linea sin descuento', () => {
    const linea = calcularLinea(
      {
        productoId: 'p1',
        nombre: 'Refresco',
        precioUnitario: desdeDecimal(11.6),
        cantidad: 1,
        tasaImpuesto: 16,
      },
      INCLUIDO,
    );

    expect(linea.importeBruto).toBe(1160);
    expect(linea.descuento).toBe(0);
    expect(linea.base).toBe(1000);
    expect(linea.impuesto).toBe(160);
    expect(linea.total).toBe(1160);
  });

  it('aplica descuento por porcentaje', () => {
    const linea = calcularLinea(
      {
        productoId: 'p1',
        nombre: 'Refresco',
        precioUnitario: desdeDecimal(100),
        cantidad: 2,
        tasaImpuesto: 16,
        descuentoPorcentaje: 10,
      },
      INCLUIDO,
    );

    expect(linea.importeBruto).toBe(20000);
    expect(linea.descuento).toBe(2000);
    expect(linea.total).toBe(18000);
  });

  it('aplica descuento por monto', () => {
    const linea = calcularLinea(
      {
        productoId: 'p1',
        nombre: 'Refresco',
        precioUnitario: desdeDecimal(50),
        cantidad: 2,
        tasaImpuesto: 16,
        descuentoMonto: desdeDecimal(25),
      },
      INCLUIDO,
    );

    expect(linea.total).toBe(7500);
  });

  it('el descuento por monto tiene prioridad sobre el porcentaje', () => {
    const linea = calcularLinea(
      {
        productoId: 'p1',
        nombre: 'Refresco',
        precioUnitario: desdeDecimal(100),
        cantidad: 1,
        tasaImpuesto: 16,
        descuentoMonto: desdeDecimal(10),
        descuentoPorcentaje: 50,
      },
      INCLUIDO,
    );

    expect(linea.total).toBe(9000);
  });

  it('rechaza descuentos mayores al importe de la linea', () => {
    expect(() =>
      calcularLinea(
        {
          productoId: 'p1',
          nombre: 'Refresco',
          precioUnitario: desdeDecimal(10),
          cantidad: 1,
          tasaImpuesto: 16,
          descuentoMonto: desdeDecimal(20),
        },
        INCLUIDO,
      ),
    ).toThrow();
  });

  it('rechaza cantidades invalidas', () => {
    expect(() =>
      calcularLinea(
        { productoId: 'p1', nombre: 'x', precioUnitario: desdeDecimal(10), cantidad: 0, tasaImpuesto: 16 },
        INCLUIDO,
      ),
    ).toThrow();
  });

  it('rechaza descuentos porcentuales fuera de rango', () => {
    expect(() =>
      calcularLinea(
        {
          productoId: 'p1',
          nombre: 'x',
          precioUnitario: desdeDecimal(10),
          cantidad: 1,
          tasaImpuesto: 16,
          descuentoPorcentaje: 101,
        },
        INCLUIDO,
      ),
    ).toThrow();
  });

  it('suma los totales de varias lineas', () => {
    const lineas: LineaVentaEntrada[] = [
      { productoId: 'p1', nombre: 'A', precioUnitario: desdeDecimal(11.6), cantidad: 3, tasaImpuesto: 16 },
      {
        productoId: 'p2',
        nombre: 'B',
        precioUnitario: desdeDecimal(25),
        cantidad: 2,
        tasaImpuesto: 16,
        descuentoPorcentaje: 10,
      },
    ];

    const totales = calcularTotales(lineas, INCLUIDO);

    expect(totales.total).toBe(sumar(...totales.lineas.map((linea) => linea.total)));
    expect(totales.total).toBe(sumar(totales.base, totales.impuestos));
    expect(totales.total).toBe(desdeDecimal(11.6 * 3 + 25 * 2 * 0.9));
    expect(totales.descuentoTotal).toBe(desdeDecimal(5));
  });

  it('exige al menos una linea', () => {
    expect(() => calcularTotales([], INCLUIDO)).toThrow();
  });
});
