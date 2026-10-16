import { describe, expect, it, vi } from 'vitest';

/**
 * Prueba del arranque fallido.
 *
 * Comprueba lo mas importante para poder diagnosticar: que si el API no puede
 * arrancar, la respuesta sea un JSON con el motivo real, no una pagina generica.
 */

function respuestaSimulada() {
  let codigo = 0;
  let cuerpo: unknown;

  const respuesta = {
    status(nuevo: number) {
      codigo = nuevo;
      return respuesta;
    },
    setHeader() {
      return undefined;
    },
    send(datos?: unknown) {
      cuerpo = datos;
      return undefined;
    },
  };

  return {
    respuesta,
    estado: () => codigo,
    cuerpo: () => cuerpo,
  };
}

describe('arranque fallido', () => {
  it('responde el motivo real en vez de una pagina generica', async () => {
    vi.resetModules();

    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'corto';

    try {
      const { default: manejador } = await import('../api/index.js');
      const capturada = respuestaSimulada();

      await manejador(
        {
          method: 'GET',
          url: '/api/index?ruta=v1/health',
          headers: {},
          query: { ruta: 'v1/health' },
        },
        capturada.respuesta,
      );

      expect(capturada.estado()).toBe(500);

      const texto = JSON.stringify(capturada.cuerpo());
      expect(texto).toContain('ARRANQUE_FALLIDO');
      expect(texto).toContain('JWT_SECRET');
    } finally {
      if (original === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = original;
      }
    }
  });
});
