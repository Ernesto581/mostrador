import type {
  Categoria,
  CierreCaja,
  DetalleVenta,
  FilaStock,
  FilaStockGeneral,
  MetodoPago,
  Movimiento,
  Producto,
  ResumenTurno,
  Rol,
  Sesion,
  Sucursal,
  Turno,
  TurnoAbiertoResumen,
  UsuarioDelPanel,
  VentaResumen,
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
      ? (datos as { error?: { codigo?: string; mensaje?: string; detalle?: string } } | null)?.error
      : undefined;

    const mensaje = error
      ? [error.mensaje, error.detalle].filter(Boolean).join(' — ')
      : esJson
        ? 'No se pudo completar la operacion'
        : `El servidor respondio una pagina en vez de datos (HTTP ${respuesta.status}). El API no esta publicado en esta direccion.`;

    throw new ErrorApi(mensaje, error?.codigo ?? 'ERROR', respuesta.status);
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

function parametros(valores: Record<string, string | number | boolean | undefined>): string {
  const busqueda = new URLSearchParams();
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor !== undefined && valor !== '') {
      busqueda.set(clave, String(valor));
    }
  }
  const texto = busqueda.toString();
  return texto ? `?${texto}` : '';
}

export const api = {
  /* ---------- Sesion ---------- */

  iniciarSesion: (username: string, password: string) =>
    pedir<{ token: string; usuario: { id: string; username: string; nombre: string } }>(
      '/auth/login',
      { metodo: 'POST', cuerpo: { username, password } },
    ),

  sesion: () => pedir<Sesion>('/auth/me'),

  cambiarMiPassword: (actual: string, nueva: string) =>
    pedir<{ actualizado: boolean }>('/auth/password', {
      metodo: 'POST',
      cuerpo: { actual, nueva },
    }),

  /* ---------- Mostrador ---------- */

  buscarProductos: (buscar: string, sucursalId: string, limite = 24) =>
    pedir<{ productos: Producto[] }>(
      `/products${parametros({ sucursalId, limite, ...(buscar.trim() ? { buscar } : {}) })}`,
    ),

  porCodigo: (codigo: string, sucursalId: string) =>
    pedir<{ producto: Producto }>(
      `/products/barcode/${encodeURIComponent(codigo)}${parametros({ sucursalId })}`,
    ),

  registrarVenta: (cuerpo: {
    sucursalId: string;
    /** Turno de caja al que pertenece la venta (para el cierre). */
    turnoId?: string;
    /** Folio generado en el telefono cuando se vendio sin conexion. */
    folio?: string;
    /** Momento real de la venta (para las ventas hechas sin conexion). */
    vendidoEn?: string;
    lineas: { productoId: string; cantidad: number; descuentoPorcentaje?: number | undefined }[];
    pagos: { metodo: MetodoPago; monto: number; referencia?: string | undefined }[];
  }) => pedir<{ venta: VentaRespuesta }>('/sales', { metodo: 'POST', cuerpo }),

  /** Estado del API. Sirve para saber si hay conexion de verdad. */
  salud: () => pedir<{ estado: string; baseDeDatos: string }>('/health'),

  /* ---------- Catalogo ---------- */

  categorias: () => pedir<{ categorias: Categoria[] }>('/categories'),

  crearCategoria: (nombre: string) =>
    pedir<{ categoria: { id: string; nombre: string } }>('/categories', {
      metodo: 'POST',
      cuerpo: { nombre },
    }),

  crearProducto: (cuerpo: {
    sku: string;
    nombre: string;
    descripcion?: string;
    categoriaId?: string;
    esServicio?: boolean;
    precioCosto: number;
    precioVenta: number;
    stockMinimo: number;
    codigosBarras: string[];
    stockInicial: number;
    sucursalId?: string;
  }) => pedir<{ producto: { id: string; sku: string; nombre: string } }>('/products', {
    metodo: 'POST',
    cuerpo,
  }),

  editarProducto: (
    id: string,
    cuerpo: {
      sku?: string;
      nombre?: string;
      categoriaId?: string;
      precioCosto?: number;
      precioVenta?: number;
      stockMinimo?: number;
    },
  ) => pedir<{ producto: { id: string } }>(`/products/${id}`, { metodo: 'PATCH', cuerpo }),

  agregarCodigo: (id: string, codigo: string) =>
    pedir<{ productoId: string; codigo: string }>(`/products/${id}/barcodes`, {
      metodo: 'POST',
      cuerpo: { codigo },
    }),

  /* ---------- Inventario ---------- */

  stock: (sucursalId: string, buscar?: string, soloBajoMinimo?: boolean, limite = 200) =>
    pedir<{ sucursalId: string; conAlerta: number; stock: FilaStock[] }>(
      `/inventory/stock${parametros({ sucursalId, buscar, soloBajoMinimo, limite })}`,
    ),

  stockGeneral: (buscar?: string, soloBajoMinimo?: boolean, limite = 200) =>
    pedir<{ conAlerta: number; sucursales: Sucursal[]; stock: FilaStockGeneral[] }>(
      `/inventory/stock-general${parametros({ buscar, soloBajoMinimo, limite })}`,
    ),

  movimientos: (filtros: { productoId?: string; sucursalId?: string; limite?: number }) =>
    pedir<{ movimientos: Movimiento[] }>(`/inventory/movements${parametros(filtros)}`),

  registrarMovimiento: (cuerpo: {
    sucursalId: string;
    productoId: string;
    tipo: string;
    cantidad: number;
    costoUnitario?: number;
    motivo?: string;
  }) => pedir<{ movimiento: unknown }>('/inventory/movements', { metodo: 'POST', cuerpo }),

  transferir: (cuerpo: {
    origenSucursalId: string;
    destinoSucursalId: string;
    motivo?: string;
    lineas: { productoId: string; cantidad: number }[];
  }) => pedir<{ movimientos: unknown[] }>('/inventory/transfers', { metodo: 'POST', cuerpo }),

  /* ---------- Ventas ---------- */

  ventas: (filtros: { sucursalId?: string; desde?: string; hasta?: string; limite?: number }) =>
    pedir<{ ventas: VentaResumen[] }>(`/sales${parametros(filtros)}`),

  venta: (id: string) => pedir<DetalleVenta>(`/sales/${id}`),

  cancelarVenta: (id: string, motivo: string) =>
    pedir<{ venta: { id: string; folio: string; estado: string } }>(`/sales/${id}/void`, {
      metodo: 'POST',
      cuerpo: { motivo },
    }),

  devolverVenta: (
    id: string,
    cuerpo: {
      motivo: string;
      metodoReembolso?: MetodoPago;
      lineas: { lineaId: string; cantidad: number; reingresar?: boolean }[];
    },
  ) =>
    pedir<{ devolucion: { id: string; folio: string; total: number } }>(`/sales/${id}/returns`, {
      metodo: 'POST',
      cuerpo,
    }),

  /* ---------- Usuarios ---------- */

  usuarios: () => pedir<{ usuarios: UsuarioDelPanel[] }>('/users'),

  roles: () => pedir<{ roles: Rol[] }>('/roles'),

  sucursales: () => pedir<{ sucursales: Sucursal[] }>('/branches'),

  crearUsuario: (cuerpo: {
    username: string;
    nombre: string;
    password: string;
    email?: string;
    rol: string;
    sucursalIds: string[];
  }) =>
    pedir<{ usuario: { id: string; username: string; nombre: string } }>('/users', {
      metodo: 'POST',
      cuerpo,
    }),

  editarUsuario: (
    id: string,
    cuerpo: {
      nombre?: string;
      email?: string;
      activo?: boolean;
      rol?: string;
      sucursalIds?: string[];
    },
  ) => pedir<{ usuario: { id: string } }>(`/users/${id}`, { metodo: 'PATCH', cuerpo }),

  cambiarPasswordDeUsuario: (id: string, password: string) =>
    pedir<{ usuario: { id: string } }>(`/users/${id}/password`, {
      metodo: 'POST',
      cuerpo: { password },
    }),

  /* ---------- Caja y turnos ---------- */

  turnoActual: (sucursalId: string) =>
    pedir<{ turno: Turno | null; resumen: ResumenTurno | null }>(
      `/shifts/actual${parametros({ sucursalId })}`,
    ),

  abrirTurno: (cuerpo: { sucursalId: string; fondoInicial: number; notas?: string }) =>
    pedir<{ turno: Turno }>('/shifts', { metodo: 'POST', cuerpo }),

  resumenTurno: (id: string) => pedir<{ resumen: ResumenTurno }>(`/shifts/${id}/resumen`),

  cerrarTurno: (id: string, cuerpo: { contado: number; notas?: string }) =>
    pedir<{
      cierre: { id: string; folio: string; esperado: number; contado: number; diferencia: number };
      resumen: ResumenTurno;
    }>(`/shifts/${id}/cerrar`, { metodo: 'POST', cuerpo }),

  registrarMovimientoCaja: (cuerpo: {
    sucursalId: string;
    turnoId: string;
    tipo: 'ingreso' | 'retiro' | 'gasto';
    monto: number;
    motivo: string;
  }) => pedir<{ movimiento: { id: string } }>('/cash-movements', { metodo: 'POST', cuerpo }),

  cierres: (filtros: { sucursalId?: string; desde?: string; hasta?: string; limite?: number }) =>
    pedir<{ cierres: CierreCaja[] }>(`/cash-closures${parametros(filtros)}`),

  turnosAbiertos: () => pedir<{ turnos: TurnoAbiertoResumen[] }>('/shifts/abiertos'),
};
