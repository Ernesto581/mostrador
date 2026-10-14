import { describe, expect, it } from 'vitest';
import { desdeDecimal } from '../src/money.js';
import {
  cantidadConSigno,
  hayStockSuficiente,
  saldo,
  signoMovimiento,
  valorInventario,
  type MovimientoInventario,
} from '../src/stock.js';

function movimiento(
  datos: Partial<MovimientoInventario> & Pick<MovimientoInventario, 'tipo' | 'cantidad'>,
): MovimientoInventario {
  return {
    productoId: 'p1',
    sucursalId: 's1',
    fecha: new Date(2026, 0, 1),
    ...datos,
  };
}

describe('inventario (kardex)', () => {
  it('asigna signo segun el tipo de movimiento', () => {
    expect(signoMovimiento('entrada_compra')).toBe(1);
    expect(signoMovimiento('salida_venta')).toBe(-1);
    expect(signoMovimiento('merma')).toBe(-1);
    expect(signoMovimiento('devolucion_cliente')).toBe(1);
    expect(signoMovimiento('transferencia_salida')).toBe(-1);
  });

  it('calcula el saldo como la suma con signo de los movimientos', () => {
    const movimientos = [
      movimiento({ tipo: 'inventario_inicial', cantidad: 10 }),
      movimiento({ tipo: 'entrada_compra', cantidad: 5 }),
      movimiento({ tipo: 'salida_venta', cantidad: 3 }),
      movimiento({ tipo: 'merma', cantidad: 1 }),
    ];

    expect(saldo(movimientos)).toBe(11);
    expect(cantidadConSigno(movimientos[2]!)).toBe(-3);
  });

  it('detecta cuando no hay stock suficiente', () => {
    const movimientos = [movimiento({ tipo: 'inventario_inicial', cantidad: 5 })];
    expect(
      hayStockSuficiente(movimientos, { productoId: 'p1', sucursalId: 's1', cantidad: 5 }),
    ).toBe(true);
    expect(
      hayStockSuficiente(movimientos, { productoId: 'p1', sucursalId: 's1', cantidad: 6 }),
    ).toBe(false);
  });

  it('separa el stock por sucursal', () => {
    const movimientos = [
      movimiento({ tipo: 'inventario_inicial', cantidad: 10, sucursalId: 's1' }),
      movimiento({ tipo: 'inventario_inicial', cantidad: 4, sucursalId: 's2' }),
    ];

    expect(saldo(movimientos, { sucursalId: 's1' })).toBe(10);
    expect(saldo(movimientos, { sucursalId: 's2' })).toBe(4);
  });

  it('valora el inventario con el costo de cada movimiento', () => {
    const movimientos = [
      movimiento({ tipo: 'entrada_compra', cantidad: 10, costoUnitario: desdeDecimal(8) }),
      movimiento({ tipo: 'salida_venta', cantidad: 4, costoUnitario: desdeDecimal(8) }),
    ];

    expect(valorInventario(movimientos)).toBe(desdeDecimal(48));
  });

  it('rechaza cantidades no enteras o negativas', () => {
    expect(() => cantidadConSigno(movimiento({ tipo: 'salida_venta', cantidad: -1 }))).toThrow();
    expect(() => cantidadConSigno(movimiento({ tipo: 'salida_venta', cantidad: 1.5 }))).toThrow();
  });
});
