import { randomBytes, scrypt } from 'node:crypto';

/**
 * Contrasenas y PIN con scrypt.
 *
 * Se usa scrypt de la biblioteca estandar de Node, sin dependencias externas ni
 * modulos nativos que compilar. El formato guardado es:
 *   scrypt$N$r$p$sal$clave
 * La comparacion es en tiempo constante para no filtrar informacion.
 */

const ALGORITMO = 'scrypt';
const COSTO = { N: 16384, r: 8, p: 1 };
const LONGITUD_CLAVE = 64;
const LONGITUD_SAL = 16;

function derivar(
  secreto: string,
  sal: Buffer,
  longitud: number,
  opciones: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(secreto, sal, longitud, opciones, (error, clave) => {
      if (error) {
        rechazar(error);
      } else {
        resolver(clave);
      }
    });
  });
}

/** Genera el hash de una contrasena o de un PIN. */
export async function hashearSecreto(secreto: string): Promise<string> {
  if (secreto.length === 0) {
    throw new Error('El secreto no puede estar vacio');
  }
  const sal = randomBytes(LONGITUD_SAL);
  const clave = await derivar(secreto, sal, LONGITUD_CLAVE, COSTO);
  return [
    ALGORITMO,
    COSTO.N,
    COSTO.r,
    COSTO.p,
    sal.toString('hex'),
    clave.toString('hex'),
  ].join('$');
}

/** Verifica una contrasena o PIN contra su hash. Nunca lanza: devuelve falso. */
export async function verificarSecreto(secreto: string, almacenado: string | null): Promise<boolean> {
  if (!almacenado || !secreto) {
    return false;
  }

  const partes = almacenado.split('$');
  if (partes.length !== 6 || partes[0] !== ALGORITMO) {
    return false;
  }

  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  const sal = Buffer.from(partes[4] ?? '', 'hex');
  const esperada = Buffer.from(partes[5] ?? '', 'hex');

  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    sal.length === 0 ||
    esperada.length === 0
  ) {
    return false;
  }

  const clave = await derivar(secreto, sal, esperada.length, { N: n, r, p });
  return clave.length === esperada.length && clave.equals(esperada);
}
