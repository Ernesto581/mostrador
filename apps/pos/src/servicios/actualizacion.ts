import { Browser } from '@capacitor/browser';

/**
 * Actualizaciones de la app de Android.
 *
 * Cada vez que se compila, la version se publica en GitHub con un numero que siempre
 * sube. La app mira si hay una mas nueva y, si la hay, ofrece el boton de actualizar.
 *
 * Android instala encima de la version anterior: **los datos se conservan**. Pide una
 * confirmacion porque la app no viene de una tienda, pero no hay que desinstalar nada.
 */

const REPOSITORIO = 'Ernesto581/mostrador';
const BASE_DESCARGAS = `https://github.com/${REPOSITORIO}/releases/latest/download`;

const versionCruda = import.meta.env.VITE_VERSION_CODE;

/** Version de esta instalacion. La pone el flujo de compilacion. */
export const versionActual = versionCruda ? Number(versionCruda) : 0;

export interface VersionNueva {
  versionCode: number;
  versionName: string;
  url: string;
}

/** Devuelve la version nueva si existe; null si esta al dia o no se pudo revisar. */
export async function buscarActualizacion(): Promise<VersionNueva | null> {
  // En desarrollo (sin numero de version) no se revisa nada.
  if (!versionActual) {
    return null;
  }

  try {
    const respuesta = await fetch(`${BASE_DESCARGAS}/version.json`, { cache: 'no-store' });
    if (!respuesta.ok) {
      return null;
    }

    const datos = (await respuesta.json()) as { versionCode?: unknown; versionName?: unknown };
    if (typeof datos.versionCode !== 'number' || datos.versionCode <= versionActual) {
      return null;
    }

    return {
      versionCode: datos.versionCode,
      versionName: typeof datos.versionName === 'string' ? datos.versionName : String(datos.versionCode),
      url: `${BASE_DESCARGAS}/mostrador.apk`,
    };
  } catch {
    // Sin internet no se molesta al usuario: se revisara la proxima vez.
    return null;
  }
}

/** Abre la descarga en el navegador del telefono. */
export async function abrirDescarga(url: string): Promise<void> {
  await Browser.open({ url });
}
