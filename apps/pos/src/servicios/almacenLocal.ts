import type { MetodoPago, Producto, Turno, VentaRespuesta } from '../api/tipos';

/**
 * Almacenamiento local del dispositivo: IndexedDB.
 *
 * Aqui vive lo que permite vender sin internet: una copia del catalogo, la cola de
 * ventas por subir, el contador de folios, el turno abierto y el codigo del dispositivo.
 *
 * Al arrancar, `abrirAlmacen` carga todo en memoria para que las lecturas sean
 * inmediatas. Cada cambio se escribe en IndexedDB. Una venta sin conexion y su folio
 * se esperan a que queden guardados antes de mostrarse como registrados: si el
 * telefono se apaga, la venta sigue ahi.
 *
 * Si IndexedDB no esta disponible, no se puede vender sin conexion: la venta se
 * rechaza con un aviso en vez de perderse. Los datos que quedaron en localStorage
 * de versiones anteriores se pasan a IndexedDB la primera vez.
 */

const NOMBRE_BASE = 'mostrador-local';
const VERSION_BASE = 1;

const TIENDA = {
  catalogo: 'catalogo',
  cola: 'cola',
  folios: 'folios',
  turnos: 'turnos',
  meta: 'meta',
} as const;

type Tienda = (typeof TIENDA)[keyof typeof TIENDA];

/* Claves de localStorage de la version anterior: solo se usan para migrar. */
const PREFIJO_ANTIGUO_CATALOGO = 'mostrador.catalogo.';
const CLAVE_ANTIGUA_COLA = 'mostrador.cola';
const CLAVE_ANTIGUA_FOLIOS = 'mostrador.folios';
const PREFIJO_ANTIGUO_TURNO = 'mostrador.turno.';
const CLAVE_ANTIGUA_DISPOSITIVO = 'mostrador.dispositivo';

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

interface RegistroCatalogo {
  sucursalId: string;
  productos: Producto[];
}

interface RegistroFolio {
  clave: string;
  valor: number;
}

interface RegistroTurno {
  sucursalId: string;
  turno: Turno;
}

interface RegistroMeta {
  clave: string;
  valor: unknown;
}

/* Copia en memoria de lo que hay en IndexedDB. */
const memoria = {
  catalogo: new Map<string, Producto[]>(),
  cola: new Map<string, VentaPendiente>(),
  folios: new Map<string, number>(),
  turnos: new Map<string, Turno>(),
  meta: new Map<string, unknown>(),
};

let base: IDBDatabase | null = null;
let apertura: Promise<void> | null = null;

function abrirBase(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(NOMBRE_BASE, VERSION_BASE);

    peticion.onupgradeneeded = () => {
      const bd = peticion.result;
      bd.createObjectStore(TIENDA.catalogo, { keyPath: 'sucursalId' });
      bd.createObjectStore(TIENDA.cola, { keyPath: 'id' });
      bd.createObjectStore(TIENDA.folios, { keyPath: 'clave' });
      bd.createObjectStore(TIENDA.turnos, { keyPath: 'sucursalId' });
      bd.createObjectStore(TIENDA.meta, { keyPath: 'clave' });
    };
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

function leerTodo<T>(bd: IDBDatabase, tienda: Tienda): Promise<T[]> {
  return new Promise((resolver, rechazar) => {
    const peticion = bd.transaction(tienda, 'readonly').objectStore(tienda).getAll();
    peticion.onsuccess = () => resolver(peticion.result as T[]);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

/**
 * Ejecuta una operacion en una transaccion. Resuelve cuando IndexedDB confirma que
 * quedo escrito en disco; si no hay base, rechaza.
 */
function escribir(tienda: Tienda, operacion: (almacen: IDBObjectStore) => void): Promise<void> {
  const bd = base;
  if (!bd) {
    return Promise.reject(new Error('El almacenamiento del telefono no esta disponible'));
  }

  return new Promise((resolver, rechazar) => {
    const transaccion = bd.transaction(tienda, 'readwrite');
    operacion(transaccion.objectStore(tienda));
    transaccion.oncomplete = () => resolver();
    transaccion.onerror = () => rechazar(transaccion.error);
    transaccion.onabort = () => rechazar(transaccion.error);
  });
}

/** Escrituras que no hacen esperar a quien las pide: si fallan, queda aviso en consola. */
function sinEsperar(escritura: Promise<void>): void {
  void escritura.catch((error: unknown) => {
    console.warn('No se pudo guardar en el telefono', error);
  });
}

function codigoNuevo(): string {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let indice = 0; indice < 4; indice += 1) {
    codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }
  return codigo;
}

/** Pasa a IndexedDB lo que guardaba la version anterior en localStorage, y lo borra de ahi. */
async function migrarDesdeLocalStorage(): Promise<void> {
  if (memoria.meta.get('migrado') === true) {
    return;
  }

  const claves: string[] = [];
  for (let indice = 0; indice < localStorage.length; indice += 1) {
    const clave = localStorage.key(indice);
    if (clave) {
      claves.push(clave);
    }
  }

  const relevantes = claves.filter(
    (clave) =>
      clave.startsWith(PREFIJO_ANTIGUO_CATALOGO) ||
      clave.startsWith(PREFIJO_ANTIGUO_TURNO) ||
      clave === CLAVE_ANTIGUA_COLA ||
      clave === CLAVE_ANTIGUA_FOLIOS ||
      clave === CLAVE_ANTIGUA_DISPOSITIVO,
  );

  const leerAntiguo = (clave: string): unknown => {
    try {
      return JSON.parse(localStorage.getItem(clave) ?? 'null');
    } catch {
      return null;
    }
  };

  for (const clave of relevantes) {
    const valor = leerAntiguo(clave);

    if (clave.startsWith(PREFIJO_ANTIGUO_CATALOGO) && Array.isArray(valor)) {
      const sucursalId = clave.slice(PREFIJO_ANTIGUO_CATALOGO.length);
      memoria.catalogo.set(sucursalId, valor as Producto[]);
      await escribir(TIENDA.catalogo, (almacen) =>
        almacen.put({ sucursalId, productos: valor } satisfies RegistroCatalogo),
      );
    } else if (clave.startsWith(PREFIJO_ANTIGUO_TURNO) && valor) {
      const sucursalId = clave.slice(PREFIJO_ANTIGUO_TURNO.length);
      memoria.turnos.set(sucursalId, valor as Turno);
      await escribir(TIENDA.turnos, (almacen) =>
        almacen.put({ sucursalId, turno: valor as Turno } satisfies RegistroTurno),
      );
    } else if (clave === CLAVE_ANTIGUA_COLA && Array.isArray(valor)) {
      for (const venta of valor as VentaPendiente[]) {
        memoria.cola.set(venta.id, venta);
        await escribir(TIENDA.cola, (almacen) => almacen.put(venta));
      }
    } else if (clave === CLAVE_ANTIGUA_FOLIOS && valor && typeof valor === 'object') {
      for (const [contador, valorContador] of Object.entries(valor as Record<string, number>)) {
        memoria.folios.set(contador, valorContador);
        await escribir(TIENDA.folios, (almacen) =>
          almacen.put({ clave: contador, valor: valorContador } satisfies RegistroFolio),
        );
      }
    } else if (clave === CLAVE_ANTIGUA_DISPOSITIVO && typeof valor === 'string') {
      memoria.meta.set('dispositivo', valor);
      await escribir(TIENDA.meta, (almacen) =>
        almacen.put({ clave: 'dispositivo', valor } satisfies RegistroMeta),
      );
    }
  }

  memoria.meta.set('migrado', true);
  await escribir(TIENDA.meta, (almacen) =>
    almacen.put({ clave: 'migrado', valor: true } satisfies RegistroMeta),
  );

  for (const clave of relevantes) {
    localStorage.removeItem(clave);
  }
}

/** Cierra la base y olvida la copia en memoria: como si la app se hubiera cerrado. */
export async function cerrarAlmacen(): Promise<void> {
  base?.close();
  base = null;
  apertura = null;
  for (const mapa of Object.values(memoria)) {
    mapa.clear();
  }
}

/**
 * Abre IndexedDB y carga lo guardado en memoria. Debe llamarse antes de pintar la app.
 * Nunca rechaza: si el telefono no tiene IndexedDB, la app abre sin modo sin conexion.
 */
export function abrirAlmacen(): Promise<void> {
  apertura ??= (async () => {
    try {
      base = await abrirBase();
    } catch (error) {
      console.warn('IndexedDB no esta disponible: no habra modo sin conexion', error);
      return;
    }

    const bd = base;
    const [catalogo, cola, folios, turnos, meta] = await Promise.all([
      leerTodo<RegistroCatalogo>(bd, TIENDA.catalogo),
      leerTodo<VentaPendiente>(bd, TIENDA.cola),
      leerTodo<RegistroFolio>(bd, TIENDA.folios),
      leerTodo<RegistroTurno>(bd, TIENDA.turnos),
      leerTodo<RegistroMeta>(bd, TIENDA.meta),
    ]);

    for (const registro of catalogo) {
      memoria.catalogo.set(registro.sucursalId, registro.productos);
    }
    for (const venta of cola) {
      memoria.cola.set(venta.id, venta);
    }
    for (const registro of folios) {
      memoria.folios.set(registro.clave, registro.valor);
    }
    for (const registro of turnos) {
      memoria.turnos.set(registro.sucursalId, registro.turno);
    }
    for (const registro of meta) {
      memoria.meta.set(registro.clave, registro.valor);
    }

    await migrarDesdeLocalStorage();

    if (!memoria.meta.has('dispositivo')) {
      const codigo = codigoNuevo();
      memoria.meta.set('dispositivo', codigo);
      await escribir(TIENDA.meta, (almacen) =>
        almacen.put({ clave: 'dispositivo', valor: codigo } satisfies RegistroMeta),
      );
    }
  })();

  return apertura;
}

/* ---------- Catalogo (para buscar sin internet) ---------- */

export function guardarCatalogo(sucursalId: string, productos: Producto[]): void {
  memoria.catalogo.set(sucursalId, productos);
  sinEsperar(
    escribir(TIENDA.catalogo, (almacen) =>
      almacen.put({ sucursalId, productos } satisfies RegistroCatalogo),
    ),
  );
}

export function leerCatalogo(sucursalId: string): Producto[] {
  return memoria.catalogo.get(sucursalId) ?? [];
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

/** Ventas pendientes, de la mas antigua a la mas reciente. */
export function leerCola(): VentaPendiente[] {
  return [...memoria.cola.values()].sort((a, b) => a.vendidoEn.localeCompare(b.vendidoEn));
}

/** Guarda la venta en IndexedDB. Solo resuelve cuando ya quedo guardada en el telefono. */
export async function encolarVenta(venta: VentaPendiente): Promise<void> {
  memoria.cola.set(venta.id, venta);
  try {
    await escribir(TIENDA.cola, (almacen) => almacen.put(venta));
  } catch (error) {
    memoria.cola.delete(venta.id);
    throw error;
  }
}

export function quitarDeLaCola(id: string): void {
  memoria.cola.delete(id);
  sinEsperar(escribir(TIENDA.cola, (almacen) => almacen.delete(id)));
}

export function marcarErrorEnCola(id: string, error: string): void {
  const venta = memoria.cola.get(id);
  if (!venta) {
    return;
  }
  const marcada = { ...venta, error };
  memoria.cola.set(id, marcada);
  sinEsperar(escribir(TIENDA.cola, (almacen) => almacen.put(marcada)));
}

export function limpiarErrorDeCola(id: string): void {
  const venta = memoria.cola.get(id);
  if (!venta) {
    return;
  }
  const { error, ...resto } = venta;
  void error;
  memoria.cola.set(id, resto);
  sinEsperar(escribir(TIENDA.cola, (almacen) => almacen.put(resto)));
}

/* ---------- Folios que no chocan con los del servidor ---------- */

/** Codigo corto del dispositivo: distingue sus folios de los que hace el servidor. */
export function codigoDeDispositivo(): string {
  const guardado = memoria.meta.get('dispositivo');
  if (typeof guardado === 'string') {
    return guardado;
  }

  const codigo = codigoNuevo();
  memoria.meta.set('dispositivo', codigo);
  sinEsperar(
    escribir(TIENDA.meta, (almacen) =>
      almacen.put({ clave: 'dispositivo', valor: codigo } satisfies RegistroMeta),
    ),
  );
  return codigo;
}

/**
 * Folio generado en el telefono.
 *
 * Lleva el codigo del dispositivo al final para que nunca choque con un folio creado
 * por el servidor, y para que al subirlo el servidor lo reconozca y no lo duplique.
 * El contador se guarda antes de usar el folio: si el telefono se apaga, el siguiente
 * arranque no repite un numero.
 */
export async function siguienteFolioLocal(codigoSucursal: string, fecha: Date): Promise<string> {
  const dia = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(
    fecha.getDate(),
  ).padStart(2, '0')}`;
  const clave = `${codigoSucursal}-${dia}`;

  const anterior = memoria.folios.get(clave) ?? 0;
  const siguiente = anterior + 1;
  memoria.folios.set(clave, siguiente);

  try {
    await escribir(TIENDA.folios, (almacen) =>
      almacen.put({ clave, valor: siguiente } satisfies RegistroFolio),
    );
  } catch (error) {
    memoria.folios.set(clave, anterior);
    throw error;
  }

  return `${codigoSucursal}-${dia}-${String(siguiente).padStart(4, '0')}-${codigoDeDispositivo()}`;
}

/* ---------- Turno abierto (para poder vender sin conexion) ---------- */

export function guardarTurno(sucursalId: string, turno: Turno | null): void {
  if (turno) {
    memoria.turnos.set(sucursalId, turno);
    sinEsperar(
      escribir(TIENDA.turnos, (almacen) =>
        almacen.put({ sucursalId, turno } satisfies RegistroTurno),
      ),
    );
  } else {
    memoria.turnos.delete(sucursalId);
    sinEsperar(escribir(TIENDA.turnos, (almacen) => almacen.delete(sucursalId)));
  }
}

export function leerTurno(sucursalId: string): Turno | null {
  return memoria.turnos.get(sucursalId) ?? null;
}
