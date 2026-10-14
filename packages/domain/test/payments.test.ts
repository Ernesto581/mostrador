import { describe, expect, it } from 'vitest';
import { desdeDecimal } from '../src/money.js';
import { calcularCobro } from '../src/payments.js';

describe('cobro y cambio', () => {
  it('cobro exacto en efectivo no genera cambio', () => {
    const resultado = calcularCobro(desdeDecimal(100), [
      { metodo: 'efectivo', monto: desdeDecimal(100) },
    ]);
    expect(resultado.pagado).toBe(10000);
    expect(resultado.cambio).toBe(0);
  });

  it('calcula el cambio en efectivo', () => {
    const resultado = calcularCobro(desdeDecimal(78), [
      { metodo: 'efectivo', monto: desdeDecimal(100) },
    ]);
    expect(resultado.cambio).toBe(2200);
  });

  it('acepta cobro mixto (tarjeta + efectivo) y calcula el cambio', () => {
    const resultado = calcularCobro(desdeDecimal(100), [
      { metodo: 'tarjeta', monto: desdeDecimal(60), referencia: 'AUTORIZACION-123' },
      { metodo: 'efectivo', monto: desdeDecimal(50) },
    ]);

    expect(resultado.pagado).toBe(11000);
    expect(resultado.cambio).toBe(1000);
    expect(resultado.porMetodo.tarjeta).toBe(6000);
    expect(resultado.porMetodo.efectivo).toBe(5000);
    expect(resultado.porMetodo.transferencia).toBe(0);
  });

  it('rechaza pago insuficiente', () => {
    expect(() =>
      calcularCobro(desdeDecimal(100), [{ metodo: 'efectivo', monto: desdeDecimal(99.99) }]),
    ).toThrow(/insuficiente/);
  });

  it('no permite que tarjeta o transferencia excedan el total', () => {
    expect(() =>
      calcularCobro(desdeDecimal(100), [
        { metodo: 'tarjeta', monto: desdeDecimal(120) },
        { metodo: 'efectivo', monto: desdeDecimal(10) },
      ]),
    ).toThrow(/efectivo/);
  });

  it('exige al menos un pago', () => {
    expect(() => calcularCobro(desdeDecimal(100), [])).toThrow();
  });

  it('rechaza montos negativos', () => {
    expect(() =>
      calcularCobro(desdeDecimal(100), [{ metodo: 'efectivo', monto: desdeDecimal(-1) }]),
    ).toThrow();
  });
});
