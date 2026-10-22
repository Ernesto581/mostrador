import { describe, expect, it } from 'vitest';
import {
  aDecimal,
  centavos,
  desdeDecimal,
  formatear,
  multiplicarPor,
  opuesto,
  porcentajeDe,
  redondear,
  restar,
  sumar,
} from '../src/money.js';

describe('dinero', () => {
  it('convierte decimales a centavos sin errores de punto flotante', () => {
    expect(desdeDecimal(19.99)).toBe(1999);
    expect(desdeDecimal(0.1 + 0.2)).toBe(30);
    expect(desdeDecimal(1000)).toBe(100000);
  });

  it('redondea la mitad hacia arriba', () => {
    expect(redondear(2.5)).toBe(3);
    expect(redondear(2.4)).toBe(2);
    expect(redondear(-2.5)).toBe(-3);
  });

  it('rechaza valores que no son enteros', () => {
    expect(() => centavos(10.5)).toThrow();
    expect(() => centavos(Number.NaN)).toThrow();
    expect(() => centavos(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('suma, resta y opone', () => {
    expect(sumar(centavos(1000), centavos(250), centavos(5))).toBe(1255);
    expect(restar(centavos(1000), centavos(250))).toBe(750);
    expect(opuesto(centavos(500))).toBe(-500);
  });

  it('multiplica y calcula porcentajes', () => {
    expect(multiplicarPor(centavos(1999), 3)).toBe(5997);
    expect(porcentajeDe(centavos(10000), 16)).toBe(1600);
    expect(porcentajeDe(centavos(999), 10)).toBe(100);
  });

  it('convierte a decimal', () => {
    expect(aDecimal(centavos(1999))).toBe(19.99);
  });

  it('formatea como moneda', () => {
    expect(formatear(centavos(1999), { moneda: 'CUP', locale: 'es-CU' })).toContain('19.99');
  });
});
