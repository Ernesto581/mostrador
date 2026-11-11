import { Browser } from '@capacitor/browser';
import { api } from '../api/cliente';

/**
 * Actualizaciones de la app de Android.
 *
 * Ya no se pregunta a GitHub: el administrador publica cada version desde el
 * panel y la app solo avisa cuando el mismo manda la actualizacion. Mientras no
 * haya nada publicado, los telefonos no ven ningun aviso. Android instala encima
 * de la version anterior y conserva los datos.
 */

/** Direccion por defecto del APK: siempre apunta a la ultima publicacion. */
export const URL_DESCARGA =
  'https://github.com/Ernesto581/mostrador/releases/latest/download/mostrador.apk';

const versionCruda = import.meta.env.VITE_VERSION_CODE;

/** Version de esta instalacion. La pone el flujo de compilacion. */
export const versionActual = versionCruda ? Number(versionCruda) : 0;

export interface VersionNueva {
  versionCode: number;
  versionName: string;
  url: string;
  notas?: string | null;
}

export type Revision =
  | { estado: 'nueva'; version: VersionNueva }
  /** Ya es la ultima. */
  | { estado: 'aldia' }
  /** No se pudo preguntar: sin internet, o el servidor no contesto. */
  | { estado: 'sinRevisar' };

export async function buscarActualizacion(): Promise<Revision> {
  // En desarrollo (sin numero de version) no hay nada que revisar.
  if (!versionActual) {
    return { estado: 'sinRevisar' };
  }

  try {
    const { actualizacion } = await api.actualizacionActual();

    if (!actualizacion) {
      return { estado: 'aldia' };
    }

    if (actualizacion.versionCode <= versionActual) {
      return { estado: 'aldia' };
    }

    return {
      estado: 'nueva',
      version: {
        versionCode: actualizacion.versionCode,
        versionName: actualizacion.versionName,
        url: actualizacion.url,
        notas: actualizacion.notas,
      },
    };
  } catch {
    // Sin internet o el servidor no responde: no se molesta a nadie.
    return { estado: 'sinRevisar' };
  }
}

/** Abre la descarga en el navegador del telefono. */
export async function abrirDescarga(url: string): Promise<void> {
  await Browser.open({ url });
}
