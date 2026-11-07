import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/api/cliente';
import { decidirAnteFallo } from '../src/servicios/conexion';

/**
 * Que pasa cuando el servidor responde al subir una venta guardada.
 *
 * La regla importante: una venta mala no puede frenar a las que vienen detras, y
 * un fallo de red si debe reintentarse despues.
 */

describe('decidirAnteFallo', () => {
  it('da por subida una venta que el servidor ya tenia', () => {
    expect(decidirAnteFallo(new ErrorApi('Folio repetido', 'DUPLICADO', 409))).toBe('ya-existe');
  });

  it('marca como rechazada cualquier respuesta 4xx', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(decidirAnteFallo(new ErrorApi('Rechazada', 'ERROR', status))).toBe('rechazada');
    }
  });

  it('deja para despues los fallos de red o del servidor', () => {
    expect(decidirAnteFallo(new ErrorApi('Sin conexion', 'SIN_CONEXION', 0))).toBe('reintentar');
    expect(decidirAnteFallo(new ErrorApi('Fallo interno', 'ERROR_INTERNO', 500))).toBe(
      'reintentar',
    );
    expect(decidirAnteFallo(new TypeError('fetch failed'))).toBe('reintentar');
  });
});
