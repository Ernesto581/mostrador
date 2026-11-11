import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Sesion, TipoMovimiento } from '../api/tipos';
import { Modal, mensajeDe } from '../util/pantalla';
import { aCentavos } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
  modo: 'entrada' | 'salida';
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

interface ProductoElegido {
  id: string;
  sku: string;
  nombre: string;
  stock: number;
}

const TIPOS_SALIDA: { valor: TipoMovimiento; etiqueta: string }[] = [
  { valor: 'merma', etiqueta: 'Merma (se perdio o se rompio)' },
  { valor: 'ajuste_negativo', etiqueta: 'Ajuste que resta' },
  { valor: 'devolucion_proveedor', etiqueta: 'Devolucion a proveedor' },
];

/**
 * Registrar una entrada o una salida de inventario.
 *
 * La entrada puede ser una compra nueva o mercancia que ya estaba en el
 * inventario general. La salida sirve para mermas, ajustes negativos y
 * devoluciones a proveedor.
 */
export function AltaInventario({
  sesion,
  sucursalId,
  modo,
  onCerrar,
  onGuardado,
}: Props) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<ProductoElegido[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<ProductoElegido | null>(null);
  const [destino, setDestino] = useState(sucursalId);
  const [origen, setOrigen] = useState<'compra' | 'general'>('compra');
  const [tipoSalida, setTipoSalida] = useState<TipoMovimiento>('merma');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desdeGeneral = modo === 'entrada' && origen === 'general';
  // En una salida o al traer del general solo interesa lo que realmente hay.
  const visibles =
    modo === 'salida' || desdeGeneral
      ? resultados.filter((producto) => producto.stock > 0)
      : resultados;

  // Busca mientras se escribe. Al elegir un producto se deja de buscar para que
  // la lista no tape el formulario.
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
            if (desdeGeneral) {
              const { stock } = await api.stockEnGeneral(texto.trim(), 20);
              if (vigente) {
                setResultados(
                  stock.map((fila) => ({
                    id: fila.productoId,
                    sku: fila.sku,
                    nombre: fila.nombre,
                    stock: fila.stock,
                  })),
                );
              }
            } else {
              const { productos } = await api.buscarProductos(texto.trim(), destino, 20);
              if (vigente) {
                setResultados(
                  productos.map((producto) => ({
                    id: producto.id,
                    sku: producto.sku,
                    nombre: producto.nombre,
                    stock: producto.stock ?? 0,
                  })),
                );
              }
            }
            if (vigente) {
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
  }, [texto, destino, elegido, desdeGeneral]);

  function limpiarSeleccion(): void {
    setElegido(null);
    setTexto('');
    setResultados([]);
    setError(null);
  }

  async function guardar(): Promise<void> {
    if (!elegido) {
      setError('Elige el producto');
      return;
    }

    const piezas = Number(cantidad);
    if (!Number.isInteger(piezas) || piezas <= 0) {
      setError('La cantidad debe ser un numero entero mayor a cero');
      return;
    }

    if ((desdeGeneral || modo === 'salida') && piezas > elegido.stock) {
      setError(
        desdeGeneral
          ? `Solo hay ${elegido.stock} en el inventario general`
          : `Solo hay ${elegido.stock} en la sucursal`,
      );
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      if (desdeGeneral) {
        await api.asignarSucursal({
          productoId: elegido.id,
          sucursalId: destino,
          cantidad: piezas,
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        });
      } else {
        await api.registrarMovimiento({
          sucursalId: destino,
          productoId: elegido.id,
          tipo: modo === 'entrada' ? 'entrada_compra' : tipoSalida,
          cantidad: piezas,
          ...(modo === 'entrada' && costo.trim()
            ? { costoUnitario: aCentavos(costo) }
            : {}),
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        });
      }

      const sucursal = sesion.sucursales.find((opcion) => opcion.id === destino);
      const nombre = sucursal?.nombre ?? 'la sucursal';
      const etiquetaSalida =
        TIPOS_SALIDA.find((tipo) => tipo.valor === tipoSalida)?.etiqueta ?? 'Salida';

      onGuardado(
        modo === 'entrada'
          ? `Entrada: ${piezas} de ${elegido.sku} a ${nombre}${desdeGeneral ? ' desde el inventario general' : ''}.`
          : `${etiquetaSalida}: ${piezas} de ${elegido.sku} en ${nombre}.`,
      );
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={modo === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}
      nota={
        modo === 'entrada'
          ? 'Registra una compra o trae mercancia del inventario general a una sucursal.'
          : 'Registra mermas, ajustes negativos o devoluciones a proveedor en una sucursal.'
      }
      onCerrar={onCerrar}
    >
      <div className="formulario">
        <label className="campo-ancho">
          <span>{modo === 'entrada' ? 'Sucursal que recibe' : 'Sucursal'}</span>
          <select
            className="entrada"
            value={destino}
            onChange={(evento) => {
              setDestino(evento.target.value);
              limpiarSeleccion();
            }}
          >
            {sesion.sucursales.map((opcion) => (
              <option key={opcion.id} value={opcion.id}>
                {opcion.nombre}
              </option>
            ))}
          </select>
        </label>

        {modo === 'entrada' ? (
          <label className="campo-ancho">
            <span>Origen</span>
            <select
              className="entrada"
              value={origen}
              onChange={(evento) => {
                setOrigen(evento.target.value as 'compra' | 'general');
                limpiarSeleccion();
              }}
            >
              <option value="compra">Compra / proveedor</option>
              <option value="general">Inventario general</option>
            </select>
          </label>
        ) : (
          <label className="campo-ancho">
            <span>Motivo de salida</span>
            <select
              className="entrada"
              value={tipoSalida}
              onChange={(evento) => setTipoSalida(evento.target.value as TipoMovimiento)}
            >
              {TIPOS_SALIDA.map((tipo) => (
                <option key={tipo.valor} value={tipo.valor}>
                  {tipo.etiqueta}
                </option>
              ))}
            </select>
          </label>
        )}

        {elegido ? (
          <div className="alta-inventario__elegido campo-ancho campo-ancho--ancho">
            <div>
              <p className="panel__nota">{elegido.sku}</p>
              <p className="alta-inventario__nombre">{elegido.nombre}</p>
              <p className="panel__nota">
                {desdeGeneral
                  ? `${elegido.stock} disponibles en el inventario general`
                  : `${elegido.stock} disponibles en la sucursal`}
              </p>
            </div>
            <button type="button" className="boton" onClick={limpiarSeleccion}>
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

            {!buscando && visibles.length === 0 ? (
              <p className="panel__nota">
                {texto.trim()
                  ? desdeGeneral
                    ? 'Sin resultados con existencia en el inventario general.'
                    : modo === 'salida'
                      ? 'Sin resultados con existencia en la sucursal.'
                      : 'Sin resultados. Revisa el nombre o crea el producto en Productos.'
                  : desdeGeneral
                    ? 'Escribe para buscar un producto del inventario general.'
                    : modo === 'salida'
                      ? 'Escribe para buscar un producto con existencia en la sucursal.'
                      : 'Escribe para buscar un producto del catalogo.'}
              </p>
            ) : null}

            {visibles.length > 0 ? (
              <div className="alta-inventario__resultados campo-ancho campo-ancho--ancho">
                {visibles.map((producto) => (
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
                      {producto.sku}
                      {desdeGeneral
                        ? ` · ${producto.stock} en general`
                        : ` · stock ${producto.stock}`}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}

        <label className="campo-ancho">
          <span>Cantidad</span>
          <input
            className="entrada entrada--numero"
            inputMode="numeric"
            value={cantidad}
            onChange={(evento) => setCantidad(evento.target.value)}
          />
        </label>

        {modo === 'entrada' && origen === 'compra' ? (
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
        ) : null}

        <label className="campo-ancho campo-ancho--ancho">
          <span>Motivo (queda en el historial)</span>
          <input
            className="entrada"
            placeholder={
              modo === 'entrada'
                ? 'Ej. Compra a proveedor, reabasto'
                : 'Ej. Producto vencido, conteo fisico'
            }
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
          {guardando
            ? 'Guardando…'
            : modo === 'entrada'
              ? 'Registrar entrada'
              : 'Registrar salida'}
        </button>
      </div>
    </Modal>
  );
}
