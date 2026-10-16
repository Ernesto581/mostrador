import type { Sesion } from '../api/tipos';

/**
 * Sesion guardada en el dispositivo.
 *
 * Sirve para dos cosas sin internet:
 *
 * 1. Al reabrir la aplicacion, entrar con los datos de la sesion que ya se validaron.
 * 2. Al iniciar sesion, comprobar la contrasena contra un verificador local: asi se
 *    puede entrar sin red sin tener que confiar en el servidor.
 *
 * El verificador NO guarda la contrasena. Guarda su huella (PBKDF2 con sal), que no
 * permite recuperarla.
 */

const CLAVE_SESION = 'mostrador.sesion';
const CLAVE_VERIFICADOR = 'mostrador.verificador';
const ITERACIONES = 120_000;

interface Verificador {
  usuario: string;
  sal: string;
  huella: string;
  iteraciones: number;
}

function aBase64(bytes: Uint8Array): string {
  let texto = '';
  for (const byte of bytes) {
    texto += String.fromCharCode(byte);
  }
  return btoa(texto);
}

function deBase64(texto: string): Uint8Array {
  return Uint8Array.from(atob(texto), (caracter) => caracter.charCodeAt(0));
}

function hayCriptografia(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

async function derivarHuella(
  password: string,
  sal: Uint8Array,
  iteraciones: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal as unknown as BufferSource, iterations: iteraciones, hash: 'SHA-256' },
    material,
    256,
  );

  return new Uint8Array(bits);
}

/* ---------- Sesion ---------- */

export function guardarSesion(sesion: Sesion): void {
  try {
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
  } catch {
    // sin almacenamiento no habria modo sin conexion
  }
}

export function leerSesion(): Sesion | null {
  try {
    const texto = localStorage.getItem(CLAVE_SESION);
    return texto ? (JSON.parse(texto) as Sesion) : null;
  } catch {
    return null;
  }
}

export function borrarSesion(): void {
  try {
    localStorage.removeItem(CLAVE_SESION);
  } catch {
    // nada
  }
}

/* ---------- Verificador de contrasena ---------- */

/** Se llama al iniciar sesion con exito, para poder entrar sin red despues. */
export async function guardarVerificador(usuario: string, password: string): Promise<void> {
  if (!hayCriptografia()) {
    return;
  }

  try {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const huella = await derivarHuella(password, sal, ITERACIONES);

    const verificador: Verificador = {
      usuario,
      sal: aBase64(sal),
      huella: aBase64(huella),
      iteraciones: ITERACIONES,
    };

    localStorage.setItem(CLAVE_VERIFICADOR, JSON.stringify(verificador));
  } catch {
    // si no se puede guardar, simplemente no habra acceso sin red
  }
}

export function hayAccesoGuardado(usuario: string): boolean {
  try {
    const texto = localStorage.getItem(CLAVE_VERIFICADOR);
    if (!texto) {
      return false;
    }
    return (JSON.parse(texto) as Verificador).usuario === usuario;
  } catch {
    return false;
  }
}

/** Comprueba la contrasena contra la huella guardada, sin tocar el servidor. */
export async function verificarSinConexion(usuario: string, password: string): Promise<boolean> {
  if (!hayCriptografia()) {
    return false;
  }

  try {
    const texto = localStorage.getItem(CLAVE_VERIFICADOR);
    if (!texto) {
      return false;
    }

    const verificador = JSON.parse(texto) as Verificador;
    if (verificador.usuario !== usuario) {
      return false;
    }

    const huella = await derivarHuella(password, deBase64(verificador.sal), verificador.iteraciones);
    const esperada = deBase64(verificador.huella);

    if (huella.length !== esperada.length) {
      return false;
    }

    // Comparacion en tiempo constante.
    let diferencia = 0;
    for (let indice = 0; indice < huella.length; indice += 1) {
      diferencia |= huella[indice]! ^ esperada[indice]!;
    }
    return diferencia === 0;
  } catch {
    return false;
  }
}

export function borrarVerificador(): void {
  try {
    localStorage.removeItem(CLAVE_VERIFICADOR);
  } catch {
    // nada
  }
}
