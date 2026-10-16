import type { MetodoPago, Producto, Turno, VentaRespuesta } from '../api/tipos';

/**
 * Almacenamiento local del dispositivo.
 *
 * Aqui vive lo que permite vender sin internet: una copia del catalogo, la cola de
 * ventas por subir, el contador de folios y el turno abierto.
 *
 * Se usa el almacenamiento del navegador (que en la app de Android es la del telefono).
 * Todo va envuelto en try/catch: si el almacenamiento no esta disponible, la aplicacion
 * sigue funcionando, solo que sin modo sin conexion.
 */

const CLAVE_CATALOGO = 'mostrador.catalogo';
const CLAVE_COLA = 'mostrador.cola';
const CLAVE_FOLIOS = 'mostrador.folios';
const CLAVE_TURNO = 'mostrador.turno';
const CLAVE_DISPOSITIVO = 'mostrador.dispositivo';

export interface VentaPendiente {
  /** Identificador local de la venta en la cola. */
  id: string;
  folio: string;
  sucursalId: string;
  turnoId?: string | undefined;
  vendidoEn: string;
  lineas: { productoId: string; cantidad: number; descuentoPorcentaje?: number | undefined }[];
  pagos: { metodo: MetodoPago; monto: number; referencia?: string | undefined }[];
  /** Como se ve el comprobante en el telefono. */
  venta: VentaRespuesta;
  /** Si el servidor la rechazo, aqui queda el motivo. */
  error?: string | undefined;
}

function leer<T>(clave: string, porDefecto: T): T {
  try {
    const texto = localStorage.getItem(clave);
    return texto ? (JSON.parse(texto) as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function escribir(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento no hay modo sin conexion, pero la aplicacion sigue.
  }
}

/* ---------- Catalogo (para buscar sin internet) ---------- */

export function guardarCatalogo(sucursalId: string, productos: Producto[]): void {
  escribir(`${CLAVE_CATALOGO}.${sucursalId}`, productos);
}

export function leerCatalogo(sucursalId: string): Producto[] {
  return leer<Producto[]>(`${CLAVE_CATALOGO}.${sucursalId}`, []);
}

/** Busca en la copia local: nombre, SKU o codigo de barras exacto. */
export function buscarEnCatalogo(sucursalId: string, termino: string, limite = 200): Producto[] {
  const productos = leerCatalogo(sucursalId);
  const limpio = termino.trim().toLowerCase();

  const encontrados = limpio
    ? productos.filter(
        (producto) =>
          producto.nombre.toLowerCase().includes(limpio) ||
          producto.sku.toLowerCase().includes(limpio),
      )
    : productos;

  return encontrados.slice(0, limite);
}

/** Descuenta del catalogo local lo que se acaba de vender sin conexion. */
export function descontarDelCatalogo(
  sucursalId: string,
  lineas: { productoId: string; cantidad: number }[],
): void {
  const productos = leerCatalogo(sucursalId);
  if (productos.length === 0) {
    return;
  }

  const porProducto = new Map(lineas.map((linea) => [linea.productoId, linea.cantidad]));
  guardarCatalogo(
    sucursalId,
    productos.map((producto) => {
      const cantidad = porProducto.get(producto.id);
      if (cantidad === undefined || producto.stock === null) {
        return producto;
      }
      return { ...producto, stock: Math.max(0, producto.stock - cantidad) };
    }),
  );
}

/* ---------- Cola de ventas por subir ---------- */

export function leerCola(): VentaPendiente[] {
  return leer<VentaPendiente[]>(CLAVE_COLA, []);
}

export function encolarVenta(venta: VentaPendiente): void {
  escribir(CLAVE_COLA, [...leerCola(), venta]);
}

export function quitarDeLaCola(id: string): void {
  escribir(
    CLAVE_COLA,
    leerCola().filter((venta) => venta.id !== id),
  );
}

export function marcarErrorEnCola(id: string, error: string): void {
  escribir(
    CLAVE_COLA,
    leerCola().map((venta) => (venta.id === id ? { ...venta, error } : venta)),
  );
}

export function limpiarErrorDeCola(id: string): void {
  escribir(
    CLAVE_COLA,
    leerCola().map((venta) => {
      if (venta.id !== id) {
        return venta;
      }
      const { error, ...resto } = venta;
      void error;
      return resto;
    }),
  );
}

/* ---------- Folios que no chocan con los del servidor ---------- */

/** Codigo corto del dispositivo: distingue sus folios de los que hace el servidor. */
export function codigoDeDispositivo(): string {
  const guardado = leer<string | null>(CLAVE_DISPOSITIVO, null);
  if (guardado) {
    return guardado;
  }

  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let indice = 0; indice < 4; indice += 1) {
    codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }

  escribir(CLAVE_DISPOSITIVO, codigo);
  return codigo;
}

/**
 * Folio generado en el telefono.
 *
 * Lleva el codigo del dispositivo al final para que nunca choque con un folio creado
 * por el servidor, y para que al subirlo el servidor lo reconozca y no lo duplique.
 */
export function siguienteFolioLocal(codigoSucursal: string, fecha: Date): string {
  const dia = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(
    fecha.getDate(),
  ).padStart(2, '0')}`;
  const clave = `${codigoSucursal}-${dia}`;

  const contadores = leer<Record<string, number>>(CLAVE_FOLIOS, {});
  const siguiente = (contadores[clave] ?? 0) + 1;
  escribir(CLAVE_FOLIOS, { ...contadores, [clave]: siguiente });

  return `${codigoSucursal}-${dia}-${String(siguiente).padStart(4, '0')}-${codigoDeDispositivo()}`;
}

/* ---------- Turno abierto (para poder vender sin conexion) ---------- */

export function guardarTurno(sucursalId: string, turno: Turno | null): void {
  if (turno) {
    escribir(`${CLAVE_TURNO}.${sucursalId}`, turno);
  } else {
    try {
      localStorage.removeItem(`${CLAVE_TURNO}.${sucursalId}`);
    } catch {
      // nada
    }
  }
}

export function leerTurno(sucursalId: string): Turno | null {
  return leer<Turno | null>(`${CLAVE_TURNO}.${sucursalId}`, null);
}
