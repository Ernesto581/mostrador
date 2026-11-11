import { useEffect, useState } from 'react';
import { api } from '../api/cliente';
import type { Producto, Sesion } from '../api/tipos';
import { Modal, mensajeDe } from '../util/pantalla';

interface Props {
  sesion: Sesion;
  sucursalId: string;
  /** Ubicacion interna que representa a la sucursal. */
  ubicacionDe: (sucursalId: string) => string;
  onCerrar: () => void;
  onGuardada: (mensaje: string) => void;
}

interface Linea {
  producto: Producto;
  cantidad: string;
}

/**
 * Transferencia entre sucursales con varios productos.
 *
 * El stock se maneja por sucursal: se elige el origen, el destino y se agregan
 * productos del catalogo. La transferencia se registra de inmediato.
 */
export function NuevaTransferencia({
  sesion,
  sucursalId,
  ubicacionDe,
  onCerrar,
  onGuardada,
}: Props) {
  const [origenSucursalId, setOrigenSucursalId] = useState(sucursalId);
  const [destinoSucursalId, setDestinoSucursalId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disponibles = resultados.filter((producto) => (producto.stock ?? 0) > 0);

  useEffect(() => {
    let vigente = true;
    const temporizador = window.setTimeout(
      () => {
        void (async () => {
          setBuscando(true);
          try {
            const { productos } = await api.buscarProductos(texto.trim(), origenSucursalId, 20);
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
  }, [texto, origenSucursalId]);

  function cambiarOrigen(valor: string): void {
    setOrigenSucursalId(valor);
    setLineas([]);
    setTexto('');
    setResultados([]);
    if (destinoSucursalId === valor) {
      setDestinoSucursalId('');
    }
    setError(null);
  }

  function agregar(producto: Producto): void {
    setLineas((actual) => {
      const existe = actual.find((linea) => linea.producto.id === producto.id);
      if (existe) {
        return actual.map((linea) =>
          linea.producto.id === producto.id
            ? { ...linea, cantidad: String((Number(linea.cantidad) || 0) + 1) }
            : linea,
        );
      }
      return [...actual, { producto, cantidad: '1' }];
    });
    setTexto('');
    setResultados([]);
    setError(null);
  }

  function cambiarCantidad(productoId: string, cantidad: string): void {
    setLineas((actual) =>
      actual.map((linea) =>
        linea.producto.id === productoId ? { ...linea, cantidad } : linea,
      ),
    );
  }

  function quitar(productoId: string): void {
    setLineas((actual) => actual.filter((linea) => linea.producto.id !== productoId));
  }

  async function guardar(): Promise<void> {
    if (!destinoSucursalId) {
      setError('Elige la sucursal de destino');
      return;
    }
    if (destinoSucursalId === origenSucursalId) {
      setError('Elige dos sucursales distintas');
      return;
    }
    if (lineas.length === 0) {
      setError('Agrega al menos un producto a la transferencia');
      return;
    }

    const sinCantidad = lineas.find((linea) => {
      const cantidad = Number(linea.cantidad);
      return !Number.isInteger(cantidad) || cantidad <= 0;
    });
    if (sinCantidad) {
      setError(`La cantidad de ${sinCantidad.producto.nombre} debe ser un entero mayor a cero`);
      return;
    }

    const sinStock = lineas.find(
      (linea) => Number(linea.cantidad) > (linea.producto.stock ?? 0),
    );
    if (sinStock) {
      setError(
        `${sinStock.producto.nombre}: solo hay ${sinStock.producto.stock ?? 0} y se intentan mover ${sinStock.cantidad}`,
      );
      return;
    }

    const origenUbicacionId = ubicacionDe(origenSucursalId);
    const destinoUbicacionId = ubicacionDe(destinoSucursalId);
    if (!origenUbicacionId || !destinoUbicacionId) {
      setError('Las sucursales todavia no tienen una ubicacion configurada');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      const { transferencia } = await api.transferirDirecto({
        origenUbicacionId,
        destinoUbicacionId,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        lineas: lineas.map((linea) => ({
          productoId: linea.producto.id,
          cantidad: Number(linea.cantidad),
        })),
      });

      onGuardada(
        `Transferencia ${transferencia.folio} realizada: la mercancia ya esta en el destino.`,
      );
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Nueva transferencia"
      nota="Mueve mercancia entre sucursales. Puedes agregar varios productos; la transferencia se registra al momento."
      onCerrar={onCerrar}
    >
      <div className="formulario">
        <label className="campo-ancho">
          <span>Desde</span>
          <select
            className="entrada"
            value={origenSucursalId}
            onChange={(evento) => cambiarOrigen(evento.target.value)}
          >
            {sesion.sucursales.map((opcion) => (
              <option key={opcion.id} value={opcion.id}>
                {opcion.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="campo-ancho">
          <span>Hacia</span>
          <select
            className="entrada"
            value={destinoSucursalId}
            onChange={(evento) => setDestinoSucursalId(evento.target.value)}
          >
            <option value="">Elige…</option>
            {sesion.sucursales
              .filter((opcion) => opcion.id !== origenSucursalId)
              .map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.nombre}
                </option>
              ))}
          </select>
        </label>

        <label className="campo-ancho campo-ancho--ancho">
          <span>Motivo (opcional)</span>
          <input
            className="entrada"
            placeholder="Ej. Reabasto de la tienda"
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
          />
        </label>
      </div>

      <div className="transferencia__productos">
        <label className="campo-ancho campo-ancho--ancho">
          <span>Agregar producto</span>
          <input
            className="entrada"
            placeholder="Busca por nombre, SKU o codigo de barras"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            autoFocus
          />
        </label>

        {buscando ? <p className="panel__nota">Buscando…</p> : null}

        {!buscando && disponibles.length === 0 ? (
          <p className="panel__nota">No hay productos con existencia en la sucursal de origen.</p>
        ) : null}

        {!buscando && disponibles.length > 0 ? (
          <div className="alta-inventario__resultados transferencia__resultados">
            {disponibles.map((producto) => (
              <button
                key={producto.id}
                type="button"
                className="alta-inventario__resultado"
                onClick={() => agregar(producto)}
              >
                <span className="alta-inventario__resultado-nombre">{producto.nombre}</span>
                <span className="panel__nota">
                  {producto.sku} · stock {producto.stock ?? 0}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {lineas.length > 0 ? (
        <div className="transferencia__lineas">
          <p className="tarjeta__titulo">Productos a mover</p>
          {lineas.map((linea) => (
            <div className="transferencia__linea" key={linea.producto.id}>
              <span className="transferencia__linea-datos">
                <span>{linea.producto.nombre}</span>
                <span className="panel__nota">
                  {linea.producto.sku} · stock {linea.producto.stock ?? 0}
                </span>
              </span>
              <input
                className="entrada entrada--numero transferencia__cantidad"
                inputMode="numeric"
                aria-label={`Cantidad de ${linea.producto.nombre}`}
                value={linea.cantidad}
                onChange={(evento) => cambiarCantidad(linea.producto.id, evento.target.value)}
              />
              <button
                type="button"
                className="boton boton--fantasma"
                onClick={() => quitar(linea.producto.id)}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel__nota">Todavia no has agregado productos.</p>
      )}

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
          disabled={guardando}
        >
          {guardando ? 'Transfiriendo…' : 'Transferir'}
        </button>
      </div>
    </Modal>
  );
}
