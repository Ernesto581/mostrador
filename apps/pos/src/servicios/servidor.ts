/**
 * Direccion del servidor.
 *
 * En el navegador la aplicacion vive en el mismo sitio que el API, asi que usa rutas
 * relativas y no hay nada que configurar. Dentro del APK no existe ese "mismo sitio":
 * hay que decirle a que servidor conectarse, y eso se guarda en el telefono.
 */

const CLAVE = 'mostrador.servidor';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/** true cuando corre dentro de la app instalada (Android), no en el navegador. */
export function esAplicacionNativa(): boolean {
  const capacitor = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

/** Direccion configurada: la del telefono si la hay, si no la del despliegue. */
export function obtenerServidor(): string {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado) {
      return guardado.replace(/\/$/, '');
    }
  } catch {
    // Sin almacenamiento se cae a la direccion por defecto.
  }

  return (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
}

export function guardarServidor(direccion: string): void {
  try {
    localStorage.setItem(CLAVE, direccion.trim().replace(/\/$/, ''));
  } catch {
    // nada
  }
}

export function olvidarServidor(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // nada
  }
}

/** Falta configurar cuando es la app instalada y no sabe a donde conectarse. */
export function faltaConfigurarServidor(): boolean {
  return esAplicacionNativa() && obtenerServidor() === '';
}
