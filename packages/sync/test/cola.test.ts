import { describe, expect, it } from 'vitest';
import { ColaSync } from '../src/cola.js';

describe('ColaSync', () => {
  it('encola una operacion nueva', () => {
    const cola = new ColaSync();
    const op = cola.encolar({ opId: 'op1', tipo: 'venta', payload: { total: 100 } });
    expect(op.opId).toBe('op1');
    expect(op.estado).toBe('pendiente');
    expect(cola.pendientesCount()).toBe(1);
  });

  it('no duplica si el opId ya existe', () => {
    const cola = new ColaSync();
    cola.encolar({ opId: 'op1', tipo: 'venta', payload: {} });
    const segunda = cola.encolar({ opId: 'op1', tipo: 'venta', payload: {} });
    expect(cola.listarTodas()).toHaveLength(1);
    expect(segunda.estado).toBe('pendiente');
  });

  it('marca enviada y ya no cuenta como pendiente', () => {
    const cola = new ColaSync();
    cola.encolar({ opId: 'op1', tipo: 'venta', payload: {} });
    cola.marcarEnviando('op1');
    cola.marcarEnviada('op1');
    expect(cola.pendientesCount()).toBe(0);
  });

  it('marca error y sigue pendiente', () => {
    const cola = new ColaSync();
    cola.encolar({ opId: 'op1', tipo: 'venta', payload: {} });
    cola.marcarError('op1', 'sin red');
    expect(cola.pendientesCount()).toBe(1);
    expect(cola.listarPendientes()[0]?.error).toBe('sin red');
  });
});