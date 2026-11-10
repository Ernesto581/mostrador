import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Producto, Sesion, TipoMovimiento } from '../api/tipos';
import { Modal, mensajeDe } from '../util/pantalla';
import { aCentavos } from '../util/dinero';
import { TIPOS_MANUALES } from '../util/movimientos';

interface Props {
  sesion: Sesion;
  sucursalId: string;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

/**
 * Agregar un producto a una sucursal.
 *
 * Primero se busca el producto en el catalogo y despues se elige la sucursal, el
 * tipo de movimiento y la cantidad. Sirve para dar entrada a la mercancia que
 * llega, sin tener que buscarla antes en la tabla de existencias.
 */
export function AltaInventario({ sesion, sucursalId, onCerrar, onGuardado }: Props) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<Producto | null>(null);
  const [destino, setDestino] = useState(sucursalId);
  const [tipo, setTipo] = useState<TipoMovimiento>('entrada_compra');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca mientras se escribe. Al elegir un producto se deja de buscar para que la
  // lista no tape el formulario.
  useEffect(() => {
    if (elegido) {
      return;
    }

    let vigente = true;
    const temporizador = window.setTimeout(
      () => {
        void (async () => {
          setBuscando(true);
          try {
            const { productos } = await api.buscarProductos(texto.trim(), destino, 8);
            if (vigente) {
              setResultados(productos);
              setError(null);
            }
          } catch (fallo) {
            if (vigente) {
              setError(mensajeDe(fallo));
            }
          } finally {
            if (vigente) {
              setBuscando(false);
            }
          }
        })();
      },
      texto ? 250 : 0,
    );

    return () => {
      vigente = false;
      window.clearTimeout(temporizador);
    };
  }, [texto, destino, elegido]);

  function etiquetaDe(valor: TipoMovimiento): string {
    return TIPOS_MANUALES.find((opcion) => opcion.valor === valor)?.etiqueta ?? valor;
  }

  async function guardar(): Promise<void> {
    if (!elegido) {
      setError('Elige el producto que quieres agregar al inventario');
      return;
    }

    const piezas = Number(cantidad);
    if (!Number.isInteger(piezas) || piezas <= 0) {
      setError('La cantidad debe ser un numero entero mayor a cero');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.registrarMovimiento({
        sucursalId: destino,
        productoId: elegido.id,
        tipo,
        cantidad: piezas,
        ...(costo.trim() ? { costoUnitario: aCentavos(costo) } : {}),
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      });

      const sucursal = sesion.sucursales.find((opcion) => opcion.id === destino);
      onGuardado(
        `${etiquetaDe(tipo)}: ${piezas} de ${elegido.sku} en ${sucursal?.nombre ?? 'la sucursal'}.`,
      );
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Nuevo movimiento de inventario"
      nota="Busca el producto, elige la sucursal y el tipo de movimiento. Si todavia no existe, crealo primero en Productos."
      onCerrar={onCerrar}
    >
      <div className="formulario">
        {elegido ? (
          <div className="alta-inventario__elegido campo-ancho campo-ancho--ancho">
            <div>
              <p className="panel__nota">{elegido.sku}</p>
              <p className="alta-inventario__nombre">{elegido.nombre}</p>
            </div>
            <button
              type="button"
              className="boton"
              onClick={() => {
                setElegido(null);
                setTexto('');
                setError(null);
              }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <label className="campo-ancho campo-ancho--ancho">
              <span>Producto</span>
              <input
                className="entrada"
                placeholder="Busca por nombre, SKU o codigo de barras"
                value={texto}
                onChange={(evento) => setTexto(evento.target.value)}
                autoFocus
              />
            </label>

            {buscando ? <p className="panel__nota">Buscando…</p> : null}

            {!buscando && resultados.length === 0 ? (
              <p className="panel__nota">
                {texto.trim()
                  ? 'Sin resultados. Revisa el nombre o crea el producto en Productos.'
                  : 'Escribe para buscar un producto del catalogo.'}
              </p>
            ) : null}

            {resultados.length > 0 ? (
              <div className="alta-inventario__resultados campo-ancho campo-ancho--ancho">
                {resultados.map((producto) => (
                  <button
                    key={producto.id}
                    type="button"
                    className="alta-inventario__resultado"
                    onClick={() => {
                      setElegido(producto);
                      setError(null);
                    }}
                  >
                    <span className="alta-inventario__resultado-nombre">{producto.nombre}</span>
                    <span className="panel__nota">
                      {producto.sku} · stock {producto.stock ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}

        <label className="campo-ancho">
          <span>Sucursal</span>
          <select
            className="entrada"
            value={destino}
            onChange={(evento) => {
              setDestino(evento.target.value);
              setElegido(null);
            }}
          >
            {sesion.sucursales.map((opcion) => (
              <option key={opcion.id} value={opcion.id}>
                {opcion.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="campo-ancho">
          <span>Tipo de movimiento</span>
          <select
            className="entrada"
            value={tipo}
            onChange={(evento) => setTipo(evento.target.value as TipoMovimiento)}
          >
            {TIPOS_MANUALES.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </select>
        </label>

        <label className="campo-ancho">
          <span>Cantidad</span>
          <input
            className="entrada entrada--numero"
            inputMode="numeric"
            value={cantidad}
            onChange={(evento) => setCantidad(evento.target.value)}
          />
        </label>

        <label className="campo-ancho">
          <span>Costo unitario (opcional)</span>
          <input
            className="entrada entrada--numero"
            inputMode="decimal"
            placeholder="Como en la factura"
            value={costo}
            onChange={(evento) => setCosto(evento.target.value)}
          />
        </label>

        <label className="campo-ancho campo-ancho--ancho">
          <span>Motivo (queda en el kardex)</span>
          <input
            className="entrada"
            placeholder="Ej. Compra a proveedor, conteo fisico"
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p className="aviso" role="alert">
          {error}
        </p>
      ) : null}

      <div className="modal__acciones">
        <button type="button" className="boton" onClick={onCerrar}>
          Cancelar
        </button>
        <button
          type="button"
          className="boton boton--acento"
          onClick={() => void guardar()}
          disabled={guardando || !elegido}
        >
          {guardando ? 'Guardando…' : 'Registrar movimiento'}
        </button>
      </div>
    </Modal>
  );
}
