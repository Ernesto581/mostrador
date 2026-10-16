import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ErrorApi } from '../api/cliente';
import {
  leerCola,
  limpiarErrorDeCola,
  marcarErrorEnCola,
  quitarDeLaCola,
  type VentaPendiente,
} from './almacenLocal';

/**
 * Estado de la conexion y cola de ventas por subir.
 *
 * Mientras hay internet, todo va normal. Si se cae, las ventas se guardan en el
 * telefono y se suben solas al recuperar la senal. El indicador muestra siempre en
 * que situacion esta, para que nadie se quede con ventas sin respaldo.
 */

interface EstadoConexion {
  enLinea: boolean;
  revisando: boolean;
  pendientes: VentaPendiente[];
  conError: number;
  sincronizando: boolean;
  comprobar: () => Promise<void>;
  sincronizar: () => Promise<void>;
  /** Vuelve a leer la cola: se usa al guardar una venta sin conexion. */
  refrescar: () => void;
  descartar: (id: string) => void;
  reintentar: (id: string) => void;
}

const Contexto = createContext<EstadoConexion | null>(null);

const ESPERA_EN_LINEA = 30_000;
const ESPERA_SIN_LINEA = 8_000;

export function ProveedorConexion({ children }: { children: ReactNode }) {
  const [enLinea, setEnLinea] = useState(true);
  const [revisando, setRevisando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [pendientes, setPendientes] = useState<VentaPendiente[]>(() => leerCola());

  const sincronizandoRef = useRef(false);

  /** Sube las ventas guardadas. Si el servidor ya las tiene, las da por subidas. */
  const sincronizar = useCallback(async () => {
    if (sincronizandoRef.current) {
      return;
    }

    const cola = leerCola();
    if (cola.length === 0) {
      setPendientes([]);
      return;
    }

    sincronizandoRef.current = true;
    setSincronizando(true);

    try {
      for (const venta of cola) {
        try {
          await api.registrarVenta({
            sucursalId: venta.sucursalId,
            ...(venta.turnoId ? { turnoId: venta.turnoId } : {}),
            folio: venta.folio,
            vendidoEn: venta.vendidoEn,
            lineas: venta.lineas,
            pagos: venta.pagos,
          });
          quitarDeLaCola(venta.id);
        } catch (fallo) {
          const codigo = fallo instanceof ErrorApi ? fallo.codigo : 'ERROR';

          if (codigo === 'DUPLICADO') {
            // Ya estaba en el servidor: no se sube dos veces.
            quitarDeLaCola(venta.id);
            continue;
          }

          if (fallo instanceof ErrorApi && fallo.status === 409) {
            // El servidor la rechaza por un motivo de negocio (por ejemplo, ya no hay
            // existencia). No se pierde: queda marcada para que el dueno la resuelva.
            marcarErrorEnCola(venta.id, fallo.message);
            continue;
          }

          // Se cayo la conexion otra vez: se intenta despues.
          break;
        }
      }
    } finally {
      sincronizandoRef.current = false;
      setSincronizando(false);
      setPendientes(leerCola());
    }
  }, []);

  /** Comprueba si hay internet de verdad (no basta con que el navegador lo diga). */
  const comprobar = useCallback(async () => {
    setRevisando(true);
    try {
      await api.salud();
      setEnLinea(true);
      await sincronizar();
    } catch {
      setEnLinea(false);
    } finally {
      setPendientes(leerCola());
      setRevisando(false);
    }
  }, [sincronizar]);

  const refrescar = useCallback(() => {
    setPendientes(leerCola());
  }, []);

  useEffect(() => {
    void comprobar();

    const temporizador = window.setInterval(() => {
      void comprobar();
    }, enLinea ? ESPERA_EN_LINEA : ESPERA_SIN_LINEA);

    const alVolver = (): void => {
      void comprobar();
    };

    window.addEventListener('online', alVolver);
    window.addEventListener('offline', alVolver);

    return () => {
      window.clearInterval(temporizador);
      window.removeEventListener('online', alVolver);
      window.removeEventListener('offline', alVolver);
    };
  }, [comprobar, enLinea]);

  function descartar(id: string): void {
    quitarDeLaCola(id);
    setPendientes(leerCola());
  }

  function reintentar(id: string): void {
    limpiarErrorDeCola(id);
    setPendientes(leerCola());
    void comprobar();
  }

  const valor: EstadoConexion = {
    enLinea,
    revisando,
    pendientes,
    conError: pendientes.filter((venta) => venta.error).length,
    sincronizando,
    comprobar,
    sincronizar,
    refrescar,
    descartar,
    reintentar,
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useConexion(): EstadoConexion {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error('useConexion necesita estar dentro de ProveedorConexion');
  }
  return contexto;
}
