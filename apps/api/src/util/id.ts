import { randomBytes } from 'node:crypto';

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function codificar(valor: bigint, longitud: number): string {
  let restante = valor;
  let salida = '';
  for (let indice = 0; indice < longitud; indice += 1) {
    salida = ALFABETO.charAt(Number(restante & 31n)) + salida;
    restante >>= 5n;
  }
  return salida;
}

/**
 * Identificador ULID: 26 caracteres ordenables por tiempo.
 *
 * Se genera en el dispositivo, sin pedirle nada al servidor. Esa es la base de
 * una sincronizacion idempotente: reenviar la misma operacion no duplica datos.
 */
export function nuevoId(): string {
  const tiempo = codificar(BigInt(Date.now()), 10);
  let azar = 0n;
  for (const byte of randomBytes(16)) {
    azar = (azar << 8n) | BigInt(byte);
  }
  return tiempo + codificar(azar, 26).slice(-16);
}
