import { calcularTotales, centavos } from '@mostrador/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import type { MetodoPago, Producto, Sesion, VentaRespuesta } from '../api/tipos';
import { Buscador } from '../componentes/Buscador';
import { Comprobante } from '../componentes/Comprobante';
import { PanelCobro } from '../componentes/PanelCobro';
import { Ticket } from '../componentes/Ticket';
import { DESCUENTOS, type LineaCarrito, type PagoLocal } from '../tipos';
import { aCentavos } from '../util/dinero';

interface Props {
  sesion: Sesion;
  onSalir: () => void;
}

export function Vender({ sesion, onSalir }: Props) {
  const [sucursalId, setSucursalId] = useState(sesion.sucursales[0]?.id ?? '');
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [pagos, setPagos] = useState<PagoLocal[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [venta, setVenta] = useState<VentaRespuesta | null>(null);

  const ultimaBusqueda = useRef(0);

  const buscar = useCallback(
    async (termino: string): Promise<Producto[]> => {
      const marca = ++ultimaBusqueda.current;
      setBuscando(true);

      try {
        const { productos } = await api.buscarProductos(termino, sucursalId);
        if (marca === ultimaBusqueda.current) {
          setResultados(productos);
          setErrorBusqueda(null);
        }
        return productos;
      } catch (fallo) {
        if (marca === ultimaBusqueda.current) {
          setResultados([]);
          setErrorBusqueda(
            fallo instanceof ErrorApi ? fallo.message : 'No se pudo consultar el catalogo',
          );
        }
        return [];
      } finally {
        if (marca === ultimaBusqueda.current) {
          setBuscando(false);
        }
      }
    },
    [sucursalId],
  );

  useEffect(() => {
    const temporizador = setTimeout(() => {
      void buscar(texto);
    }, 220);
    return () => clearTimeout(temporizador);
  }, [texto, buscar]);

  useEffect(() => {
    setCarrito([]);
    setPagos([]);
    setTexto('');
    setAviso(null);
  }, [sucursalId]);

  useEffect(() => {
    const alPresionar = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') {
        return;
      }
      if (venta) {
        setVenta(null);
        return;
      }
      setPagos([]);
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [venta]);

  const totales = useMemo(() => {
    if (carrito.length === 0) {
      return null;
    }
    try {
      return calcularTotales(
        carrito.map((linea) => ({
          productoId: linea.producto.id,
          nombre: linea.producto.nombre,
          precioUnitario: centavos(linea.producto.precioVenta),
          cantidad: linea.cantidad,
          tasaImpuesto: linea.producto.tasaImpuesto,
          ...(linea.descuentoPorcentaje > 0
            ? { descuentoPorcentaje: linea.descuentoPorcentaje }
            : {}),
        })),
        { preciosConImpuestoIncluido: sesion.empresa.preciosConImpuestoIncluido },
      );
    } catch {
      return null;
    }
  }, [carrito, sesion.empresa.preciosConImpuestoIncluido]);

  const enCarrito = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const linea of carrito) {
      mapa.set(linea.producto.id, (mapa.get(linea.producto.id) ?? 0) + linea.cantidad);
    }
    return mapa;
  }, [carrito]);

  const sucursal = sesion.sucursales.find((candidata) => candidata.id === sucursalId);

  function agregar(producto: Producto): void {
    setAviso(null);
    setCarrito((actual) => {
      const yaEsta = actual.find((linea) => linea.producto.id === producto.id);
      if (yaEsta) {
        return actual.map((linea) =>
          linea.producto.id === producto.id ? { ...linea, cantidad: linea.cantidad + 1 } : linea,
        );
      }
      return [...actual, { producto, cantidad: 1, descuentoPorcentaje: 0 }];
    });
  }

  async function alBuscar(termino: string): Promise<void> {
    setTexto(termino);
    const productos = await buscar(termino);
    if (productos.length === 1) {
      agregar(productos[0]!);
      setTexto('');
    }
  }

  function cambiarCantidad(productoId: string, delta: number): void {
    setCarrito((actual) =>
      actual
        .map((linea) =>
          linea.producto.id === productoId
            ? { ...linea, cantidad: linea.cantidad + delta }
            : linea,
        )
        .filter((linea) => linea.cantidad > 0),
    );
  }

  function quitar(productoId: string): void {
    setCarrito((actual) => actual.filter((linea) => linea.producto.id !== productoId));
  }

  function ciclarDescuento(productoId: string): void {
    setCarrito((actual) =>
      actual.map((linea) => {
        if (linea.producto.id !== productoId) {
          return linea;
        }
        const actualIndice = DESCUENTOS.indexOf(linea.descuentoPorcentaje);
        return { ...linea, descuentoPorcentaje: DESCUENTOS[(actualIndice + 1) % DESCUENTOS.length]! };
      }),
    );
  }

  function agregarPago(metodo: MetodoPago): void {
    setPagos((actual) => [...actual, { metodo, monto: '' }]);
  }

  function cambiarMonto(indice: number, monto: string): void {
    setPagos((actual) => actual.map((pago, posicion) => (posicion === indice ? { ...pago, monto } : pago)));
  }

  function quitarPago(indice: number): void {
    setPagos((actual) => actual.filter((_, posicion) => posicion !== indice));
  }

  function fijarEfectivo(montoCentavos: number): void {
    const monto = (montoCentavos / 100).toFixed(2);
    setPagos((actual) => {
      const indice = actual.findIndex((pago) => pago.metodo === 'efectivo');
      if (indice === -1) {
        return [...actual, { metodo: 'efectivo', monto }];
      }
      return actual.map((pago, posicion) => (posicion === indice ? { ...pago, monto } : pago));
    });
  }

  async function cobrar(): Promise<void> {
    if (!totales) {
      return;
    }

    const pagosEnviar = pagos
      .map((pago) => ({ metodo: pago.metodo, monto: aCentavos(pago.monto) }))
      .filter((pago) => pago.monto > 0);

    if (pagosEnviar.length === 0) {
      setAviso('Agrega al menos una forma de cobro para cerrar la venta.');
      return;
    }

    setProcesando(true);
    setAviso(null);

    try {
      const { venta: registrada } = await api.registrarVenta({
        sucursalId,
        lineas: carrito.map((linea) => ({
          productoId: linea.producto.id,
          cantidad: linea.cantidad,
          ...(linea.descuentoPorcentaje > 0
            ? { descuentoPorcentaje: linea.descuentoPorcentaje }
            : {}),
        })),
        pagos: pagosEnviar,
      });

      setVenta(registrada);
      setCarrito([]);
      setPagos([]);
      void buscar(texto);
    } catch (fallo) {
      setAviso(fallo instanceof ErrorApi ? fallo.message : 'No se pudo cerrar la venta');
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="app">
      <header className="barra">
        <div className="marca">
          <span className="marca__punto" aria-hidden="true" />
          {sesion.empresa.nombre || 'Mostrador'}
          <span>punto de venta</span>
        </div>

        <div className="barra__datos">
          {sesion.sucursales.length > 1 ? (
            <select
              className="selector"
              value={sucursalId}
              onChange={(evento) => setSucursalId(evento.target.value)}
              aria-label="Sucursal"
            >
              {sesion.sucursales.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.codigo} · {opcion.nombre}
                </option>
              ))}
            </select>
          ) : (
            <span className="vendedor">
              {sucursal?.codigo} · {sucursal?.nombre}
            </span>
          )}
          <span className="vendedor">{sesion.usuario.nombre}</span>
          <button type="button" className="boton boton--fantasma" onClick={onSalir}>
            Salir
          </button>
        </div>
      </header>

      <main className="mostrador">
        <section>
          <Buscador
            resultados={resultados}
            buscando={buscando}
            error={errorBusqueda}
            termino={texto}
            enCarrito={enCarrito}
            onCambiarTermino={setTexto}
            onBuscar={(termino) => void alBuscar(termino)}
            onLimpiar={() => void buscar('')}
            onAgregar={agregar}
          />
        </section>

        <aside className="columna-ticket">
          <div className="ticket">
            <div className="ticket__borde" />
            <div className="ticket__cuerpo">
              <Ticket
                lineas={carrito}
                totales={totales}
                sucursal={sucursal?.codigo ?? ''}
                vendedor={sesion.usuario.nombre}
                onCantidad={cambiarCantidad}
                onQuitar={quitar}
                onDescuento={ciclarDescuento}
              />

              {aviso ? (
                <p className="aviso" role="alert" style={{ marginTop: '1rem' }}>
                  {aviso}
                </p>
              ) : null}

              <PanelCobro
                total={totales?.total ?? 0}
                pagos={pagos}
                procesando={procesando}
                puedeCobrar={carrito.length > 0}
                onAgregarPago={agregarPago}
                onCambiarMonto={cambiarMonto}
                onQuitarPago={quitarPago}
                onFijarEfectivo={fijarEfectivo}
                onCobrar={() => void cobrar()}
              />
            </div>
            <div className="ticket__borde ticket__borde--abajo" />
          </div>
        </aside>
      </main>

      {venta ? (
        <Comprobante
          venta={venta}
          sucursal={sucursal?.codigo ?? ''}
          vendedor={sesion.usuario.nombre}
          onNuevaVenta={() => setVenta(null)}
        />
      ) : null}
    </div>
  );
}
