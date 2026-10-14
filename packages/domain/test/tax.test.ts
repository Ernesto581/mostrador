import { describe, expect, it } from 'vitest';
import { desdeDecimal, sumar } from '../src/money.js';
import {
  desglosar,
  desglosarImpuestoAgregado,
  desglosarImpuestoIncluido,
  type ConfiguracionImpuestos,
} from '../src/tax.js';

const INCLUIDO: ConfiguracionImpuestos = { preciosConImpuestoIncluido: true };
const AGREGADO: ConfiguracionImpuestos = { preciosConImpuestoIncluido: false };

describe('impuestos', () => {
  it('desglosa un monto que ya incluye el impuesto', () => {
    const resultado = desglosarImpuestoIncluido(desdeDecimal(116), 16);
    expect(resultado.base).toBe(10000);
    expect(resultado.impuesto).toBe(1600);
    expect(resultado.total).toBe(11600);
  });

  it('agrega el impuesto cuando el precio no lo incluye', () => {
    const resultado = desglosarImpuestoAgregado(desdeDecimal(100), 16);
    expect(resultado.base).toBe(10000);
    expect(resultado.impuesto).toBe(1600);
    expect(resultado.total).toBe(11600);
  });

  it('respeta productos exentos (tasa 0)', () => {
    const resultado = desglosarImpuestoIncluido(desdeDecimal(50), 0);
    expect(resultado.base).toBe(5000);
    expect(resultado.impuesto).toBe(0);
  });

  it('la base mas el impuesto siempre es el total', () => {
    const resultado = desglosar(desdeDecimal(99.99), 16, INCLUIDO);
    expect(sumar(resultado.base, resultado.impuesto)).toBe(resultado.total);
  });

  it('rechaza tasas invalidas', () => {
    expect(() => desglosarImpuestoIncluido(desdeDecimal(10), -1)).toThrow();
    expect(() => desglosarImpuestoIncluido(desdeDecimal(10), Number.NaN)).toThrow();
  });

  it('usa la configuracion para decidir el modo', () => {
    const incluido = desglosar(desdeDecimal(116), 16, INCLUIDO);
    const agregado = desglosar(desdeDecimal(116), 16, AGREGADO);
    expect(incluido.base).toBe(10000);
    expect(agregado.total).toBe(desdeDecimal(134.56));
  });
});
