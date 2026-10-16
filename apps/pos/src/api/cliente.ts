import type {
  MetodoPago,
  Producto,
  Sesion,
  VentaRespuesta,
} from './tipos';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const CLAVE_TOKEN = 'mostrador.token';

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    readonly codigo: string,
    readonly status: number,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

export function guardarToken(token: string | null): void {
  if (token) {
    localStorage.setItem(CLAVE_TOKEN, token);
  } else {
    localStorage.removeItem(CLAVE_TOKEN);
  }
}

export function leerToken(): string | null {
  return localStorage.getItem(CLAVE_TOKEN);
}

interface OpcionesPeticion {
  metodo?: 'GET' | 'POST' | 'PATCH';
  cuerpo?: unknown;
}

async function pedir<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const cabeceras: Record<string, string> = {};

  if (opciones.cuerpo !== undefined) {
    cabeceras['content-type'] = 'application/json';
  }
  const token = leerToken();
  if (token) {
    cabeceras.authorization = `Bearer ${token}`;
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}/api/v1${ruta}`, {
      method: opciones.metodo ?? 'GET',
      headers: cabeceras,
      ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
    });
  } catch {
    throw new ErrorApi(
      'No hay conexion con el servidor. Revisa la red e intentalo de nuevo.',
      'SIN_CONEXION',
      0,
    );
  }

  const texto = await respuesta.text();
  let datos: unknown = null;
  let esJson = true;

  if (texto) {
    try {
      datos = JSON.parse(texto);
    } catch {
      esJson = false;
    }
  }

  if (!respuesta.ok) {
    const error = esJson
      ? (datos as { error?: { codigo?: string; mensaje?: string } } | null)?.error
      : undefined;

    throw new ErrorApi(
      error?.mensaje ??
        (esJson
          ? 'No se pudo completar la operacion'
          : `El servidor respondio una pagina en vez de datos (HTTP ${respuesta.status}). El API no esta publicado en esta direccion.`),
      error?.codigo ?? 'ERROR',
      respuesta.status,
    );
  }

  if (!esJson) {
    throw new ErrorApi(
      `El servidor respondio una pagina en vez de datos (HTTP ${respuesta.status}). El API no esta publicado en esta direccion.`,
      'RESPUESTA_INVALIDA',
      respuesta.status,
    );
  }

  return datos as T;
}

export const api = {
  iniciarSesion: (username: string, password: string) =>
    pedir<{ token: string; usuario: { id: string; username: string; nombre: string } }>(
      '/auth/login',
      { metodo: 'POST', cuerpo: { username, password } },
    ),

  sesion: () => pedir<Sesion>('/auth/me'),

  buscarProductos: (buscar: string, sucursalId: string, limite = 24) => {
    const parametros = new URLSearchParams({ sucursalId, limite: String(limite) });
    if (buscar.trim()) {
      parametros.set('buscar', buscar.trim());
    }
    return pedir<{ productos: Producto[] }>(`/products?${parametros.toString()}`);
  },

  porCodigo: (codigo: string, sucursalId: string) => {
    const parametros = new URLSearchParams({ sucursalId });
    return pedir<{ producto: Producto }>(
      `/products/barcode/${encodeURIComponent(codigo)}?${parametros.toString()}`,
    );
  },

  registrarVenta: (cuerpo: {
    sucursalId: string;
    lineas: { productoId: string; cantidad: number; descuentoPorcentaje?: number }[];
    pagos: { metodo: MetodoPago; monto: number; referencia?: string }[];
  }) => pedir<{ venta: VentaRespuesta }>('/sales', { metodo: 'POST', cuerpo }),
};
