/** Adaptador generico de almacenamiento clave-valor. */
export interface AlmacenClaveValor {
  get<T>(clave: string): Promise<T | undefined>;
  set<T>(clave: string, valor: T): Promise<void>;
  remove(clave: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Crea un almacen basado en IndexedDB (navegador).
 * Util para la app web/PWA. En nativo se usara SQLite.
 */
export function crearAlmacenIndexedDB(nombreBD: string): AlmacenClaveValor {
  const abrir = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const solicitud = indexedDB.open(nombreBD, 1);
      solicitud.onupgradeneeded = () => {
        const db = solicitud.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
      };
      solicitud.onsuccess = () => resolve(solicitud.result);
      solicitud.onerror = () => reject(solicitud.error);
    });

  return {
    async get<T>(clave: string): Promise<T | undefined> {
      const db = await abrir();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const store = tx.objectStore('kv');
        const req = store.get(clave);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      });
    },
    async set<T>(clave: string, valor: T): Promise<void> {
      const db = await abrir();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        const req = store.put(valor, clave);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async remove(clave: string): Promise<void> {
      const db = await abrir();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        const req = store.delete(clave);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async keys(): Promise<string[]> {
      const db = await abrir();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const store = tx.objectStore('kv');
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error);
      });
    },
  };
}