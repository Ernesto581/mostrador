import { Browser } from '@capacitor/browser';

/**
 * Actualizaciones de la app de Android.
 *
 * Cada vez que se compila, la version se publica en GitHub con un numero que siempre
 * sube. La app pregunta si hay una mas nueva y, si la hay, ofrece el boton de
 * actualizar. Android instala encima de la version anterior: **los datos se conservan**.
 * Pide una confirmacion porque la app no viene de una tienda, pero no hay que
 * desinstalar nada.
 *
 * Se pregunta a la API de GitHub y no al archivo de la version: los archivos de las
 * publicaciones no se pueden leer desde otra pagina (GitHub no los abre por CORS), en
 * cambio la API si. Eso fue justo lo que impedia que el aviso apareciera.
 */

const REPOSITORIO = 'Ernesto581/mostrador';

/** Devuelve la ultima version publicada. La API de GitHub si permite leerla. */
const API_ULTIMA = `https://api.github.com/repos/${REPOSITORIO}/releases/latest`;

/** Direccion fija de descarga: siempre apunta a la ultima version. */
const DESCARGA = `https://github.com/${REPOSITORIO}/releases/latest/download/mostrador.apk`;

const versionCruda = import.meta.env.VITE_VERSION_CODE;

/** Version de esta instalacion. La pone el flujo de compilacion. */
export const versionActual = versionCruda ? Number(versionCruda) : 0;

export interface VersionNueva {
  versionCode: number;
  versionName: string;
  url: string;
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
    const respuesta = await fetch(API_ULTIMA, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });

    if (!respuesta.ok) {
      // Suele ser el limite de consultas por hora. No es grave: se intenta despues.
      return { estado: 'sinRevisar' };
    }

    const datos = (await respuesta.json()) as { tag_name?: unknown };
    const etiqueta = typeof datos.tag_name === 'string' ? datos.tag_name : '';
    // La etiqueta es del tipo "v7": el numero es lo que interesa.
    const numero = Number(etiqueta.replace(/^v/, ''));

    if (!Number.isFinite(numero) || numero <= 0) {
      return { estado: 'sinRevisar' };
    }

    if (numero <= versionActual) {
      return { estado: 'aldia' };
    }

    return {
      estado: 'nueva',
      version: {
        versionCode: numero,
        versionName: etiqueta || String(numero),
        url: DESCARGA,
      },
    };
  } catch {
    // Sin internet no se molesta a nadie: se revisa cuando vuelva la senal.
    return { estado: 'sinRevisar' };
  }
}

/** Abre la descarga en el navegador del telefono. */
export async function abrirDescarga(url: string): Promise<void> {
  await Browser.open({ url });
}
