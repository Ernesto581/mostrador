import { describe, expect, it } from 'vitest';
import { generarFolio } from '../src/folio.js';

describe('folios', () => {
  it('genera folios con sucursal y fecha', () => {
    const folio = generarFolio({
      codigoSucursal: 'SUC1',
      fecha: new Date(2026, 9, 14),
      consecutivo: 1,
    });
    expect(folio).toBe('SUC1-20261014-0001');
  });

  it('rellena el consecutivo a 4 digitos', () => {
    expect(generarFolio({ codigoSucursal: 'A', fecha: new Date(2026, 0, 5), consecutivo: 42 })).toBe(
      'A-20260105-0042',
    );
  });

  it('rechaza codigos de sucursal invalidos', () => {
    expect(() =>
      generarFolio({ codigoSucursal: 'suc 1', fecha: new Date(2026, 0, 1), consecutivo: 1 }),
    ).toThrow();
    expect(() =>
      generarFolio({ codigoSucursal: '', fecha: new Date(2026, 0, 1), consecutivo: 1 }),
    ).toThrow();
  });

  it('rechaza consecutivos fuera de rango', () => {
    expect(() =>
      generarFolio({ codigoSucursal: 'SUC1', fecha: new Date(2026, 0, 1), consecutivo: 0 }),
    ).toThrow();
    expect(() =>
      generarFolio({ codigoSucursal: 'SUC1', fecha: new Date(2026, 0, 1), consecutivo: 10000 }),
    ).toThrow();
  });

  it('rechaza fechas invalidas', () => {
    expect(() =>
      generarFolio({ codigoSucursal: 'SUC1', fecha: new Date('no-es-fecha'), consecutivo: 1 }),
    ).toThrow();
  });

  it('sucursales distintas nunca producen el mismo folio', () => {
    const fecha = new Date(2026, 5, 20);
    const a = generarFolio({ codigoSucursal: 'NORTE', fecha, consecutivo: 7 });
    const b = generarFolio({ codigoSucursal: 'SUR', fecha, consecutivo: 7 });
    expect(a).not.toBe(b);
  });
});
