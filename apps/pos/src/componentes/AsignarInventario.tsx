import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Sesion } from '../api/tipos';
import { Modal, mensajeDe } from '../util/pantalla';

interface Props {
  sesion: Sesion;
  sucursalId: string;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

interface ProductoGeneral {
  productoId: string;
  sku: string;
  nombre: string;
  stock: number;
}

/**
 * Asignar existencia del inventario general a una sucursal.
 *
 * El producto ya existe y tiene stock en el deposito general. Aqui solo se elige
 * cuanto se manda a cada punto de venta; no es una compra, por eso no crea stock
 * nuevo: lo mueve de lugar.
 */
export function AsignarInventario({ sesion, sucursalId, onCerrar, onGuardado }: Props) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<ProductoGeneral[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<ProductoGeneral | null>(null);
  const [destino, setDestino] = useState(sucursalId);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            const { stock } = await api.stockEnGeneral(texto.trim(), 8);
            if (vigente) {
              setResultados(stock);
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
  }, [texto, elegido]);

  async function guardar(): Promise<void> {
    if (!elegido) {
      setError('Elige el producto que quieres asignar');
      return;
    }
    if (!destino) {
      setError('Elige la sucursal que recibe la mercancia');
      return;
    }

    const piezas = Number(cantidad);
    if (!Number.isInteger(piezas) || piezas <= 0) {
      setError('La cantidad debe ser un numero entero mayor a cero');
      return;
    }
    if (piezas > elegido.stock) {
      setError(`Solo hay ${elegido.stock} en el inventario general`);
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.asignarSucursal({
        productoId: elegido.productoId,
        sucursalId: destino,
        cantidad: piezas,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      });

      const sucursal = sesion.sucursales.find((opcion) => opcion.id === destino);
      onGuardado(
        `Asignacion: ${piezas} de ${elegido.sku} a ${sucursal?.nombre ?? 'la sucursal'}.`,
      );
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Asignar a sucursal"
      nota="Mueve existencia del inventario general a una sucursal. No es una compra: el total del negocio no cambia."
      onCerrar={onCerrar}
    >
      <div className="formulario">
        {elegido ? (
          <div className="alta-inventario__elegido campo-ancho campo-ancho--ancho">
            <div>
              <p className="panel__nota">{elegido.sku}</p>
              <p className="alta-inventario__nombre">{elegido.nombre}</p>
              <p className="panel__nota">{elegido.stock} disponibles en el inventario general</p>
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
                  ? 'Sin resultados con existencia en el inventario general.'
                  : 'Escribe para buscar un producto del inventario general.'}
              </p>
            ) : null}

            {resultados.length > 0 ? (
              <div className="alta-inventario__resultados campo-ancho campo-ancho--ancho">
                {resultados.map((producto) => (
                  <button
                    key={producto.productoId}
                    type="button"
                    className="alta-inventario__resultado"
                    onClick={() => {
                      setElegido(producto);
                      setError(null);
                    }}
                  >
                    <span className="alta-inventario__resultado-nombre">{producto.nombre}</span>
                    <span className="panel__nota">
                      {producto.sku} · {producto.stock} en general
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}

        <label className="campo-ancho">
          <span>Sucursal que recibe</span>
          <select
            className="entrada"
            value={destino}
            onChange={(evento) => setDestino(evento.target.value)}
          >
            {sesion.sucursales.map((opcion) => (
              <option key={opcion.id} value={opcion.id}>
                {opcion.nombre}
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

        <label className="campo-ancho campo-ancho--ancho">
          <span>Motivo (queda en el historial)</span>
          <input
            className="entrada"
            placeholder="Ej. Reparto a la tienda"
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
          {guardando ? 'Asignando…' : 'Asignar'}
        </button>
      </div>
    </Modal>
  );
}
