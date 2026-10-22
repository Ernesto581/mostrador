import { calcularCobro, calcularTotales, centavos } from '@mostrador/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ErrorApi } from '../api/cliente';
import type { MetodoPago, Producto, Sesion, VentaRespuesta } from '../api/tipos';
import { Buscador } from '../componentes/Buscador';
import { Comprobante } from '../componentes/Comprobante';
import { PanelCobro } from '../componentes/PanelCobro';
import { Ticket } from '../componentes/Ticket';
import { DESCUENTOS, type LineaCarrito, type PagoLocal } from '../tipos';
import { aCentavos } from '../util/dinero';
import { useCarga } from '../util/pantalla';
import { useConexion } from '../servicios/conexion';
import {
  buscarEnCatalogo,
  descontarDelCatalogo,
  encolarVenta,
  guardarCatalogo,
  guardarTurno,
  leerTurno,
  siguienteFolioLocal,
} from '../servicios/almacenLocal';

interface Props {
  sesion: Sesion;
  sucursalId: string;
}

export function Vender({ sesion, sucursalId }: Props) {
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
  const { enLinea, refrescar } = useConexion();

  /* Turno de caja: para vender hace falta uno abierto. */
  const {
    datos: datosTurno,
    cargando: cargandoTurno,
    recargar: recargarTurno,
  } = useCarga(async () => {
    try {
      const respuesta = await api.turnoActual(sucursalId);
      guardarTurno(sucursalId, respuesta.turno);
      return respuesta;
    } catch (fallo) {
      // Sin internet se usa la copia del turno que quedo guardada en el telefono:
      // asi las ventas sin conexion entran al cierre cuando se suban.
      if (fallo instanceof ErrorApi && fallo.codigo === 'SIN_CONEXION') {
        return { turno: leerTurno(sucursalId), resumen: null };
      }
      throw fallo;
    }
  }, [sucursalId]);

  const turno = datosTurno?.turno ?? null;
  const [ventaPendiente, setVentaPendiente] = useState(false);

  /* Copia del catalogo en el telefono: permite buscar y vender sin internet. */
  useEffect(() => {
    if (!enLinea || !turno) {
      return;
    }

    void (async () => {
      try {
        const { productos } = await api.buscarProductos('', sucursalId, 500);
        guardarCatalogo(sucursalId, productos);
      } catch {
        // Si falla se sigue con la copia que ya hubiera en el telefono.
      }
    })();
  }, [enLinea, sucursalId, turno]);
  const [fondoTurno, setFondoTurno] = useState('200.00');
  const [abriendoTurno, setAbriendoTurno] = useState(false);
  const [errorTurno, setErrorTurno] = useState<string | null>(null);

  async function abrirTurno(): Promise<void> {
    setAbriendoTurno(true);
    setErrorTurno(null);

    try {
      await api.abrirTurno({ sucursalId, fondoInicial: aCentavos(fondoTurno) });
      await recargarTurno();
    } catch (fallo) {
      setErrorTurno(fallo instanceof ErrorApi ? fallo.message : 'No se pudo abrir el turno');
    } finally {
      setAbriendoTurno(false);
    }
  }

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
        // Si no hay internet, se busca en la copia del catalogo del telefono.
        if (fallo instanceof ErrorApi && fallo.codigo === 'SIN_CONEXION') {
          const locales = buscarEnCatalogo(sucursalId, termino);
          if (marca === ultimaBusqueda.current) {
            setResultados(locales);
            setErrorBusqueda(null);
          }
          return locales;
        }

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
    if (!turno) {
      setAviso('Abre tu turno de caja antes de cobrar.');
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

    const lineas = carrito.map((linea) => ({
      productoId: linea.producto.id,
      cantidad: linea.cantidad,
      ...(linea.descuentoPorcentaje > 0
        ? { descuentoPorcentaje: linea.descuentoPorcentaje }
        : {}),
    }));

    try {
      const { venta: registrada } = await api.registrarVenta({
        sucursalId,
        turnoId: turno.id,
        lineas,
        pagos: pagosEnviar,
      });

      setVenta(registrada);
      setVentaPendiente(false);
      setCarrito([]);
      setPagos([]);
      void buscar(texto);
    } catch (fallo) {
      // Si se cayo el internet, la venta no se pierde: se guarda en el telefono y se
      // sube sola al recuperar la senal.
      if (fallo instanceof ErrorApi && fallo.codigo === 'SIN_CONEXION') {
        await guardarVentaSinConexion(lineas, pagosEnviar);
        return;
      }
      setAviso(fallo instanceof ErrorApi ? fallo.message : 'No se pudo cerrar la venta');
    } finally {
      setProcesando(false);
    }
  }

  /** Guarda la venta en el telefono, con su folio, para subirla despues. */
  async function guardarVentaSinConexion(
    lineas: { productoId: string; cantidad: number; descuentoPorcentaje?: number }[],
    pagosEnviar: { metodo: MetodoPago; monto: number }[],
  ): Promise<void> {
    if (!totales || !turno || !sucursal) {
      return;
    }

    const vendidoEn = new Date();
    const cobro = calcularCobro(
      totales.total,
      pagosEnviar.map((pago) => ({ metodo: pago.metodo, monto: centavos(pago.monto) })),
    );
    // El identificador de la venta no puede repetirse: IndexedDB reemplaza la venta
    // que tenga el mismo id.
    const id = `local-${vendidoEn.getTime()}-${Math.random().toString(36).slice(2, 10)}`;

    let folio: string;
    try {
      folio = await siguienteFolioLocal(sucursal.codigo, vendidoEn);
    } catch {
      setAviso('No se pudo guardar la venta en el telefono. No la cierres: revisa el almacenamiento.');
      return;
    }

    const ventaLocal: VentaRespuesta = {
      id,
      folio,
      estado: 'completada',
      vendidoEn: vendidoEn.toISOString(),
      subtotal: totales.base,
      descuentoTotal: totales.descuentoTotal,
      impuestos: totales.impuestos,
      total: totales.total,
      pagado: cobro.pagado,
      cambio: cobro.cambio,
      articulos: totales.lineas.reduce((suma, linea) => suma + linea.cantidad, 0),
      advertencias: [],
      lineas: totales.lineas.map((linea) => ({
        productoId: linea.productoId,
        nombre: linea.nombre,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario,
        descuento: linea.descuento,
        impuesto: linea.impuesto,
        total: linea.total,
        costoUnitario: 0,
      })),
      pagos: pagosEnviar.map((pago) => ({ metodo: pago.metodo, monto: pago.monto })),
    };

    // Primero queda guardada en el telefono; recien entonces se muestra como vendida.
    try {
      await encolarVenta({
        id,
        folio,
        sucursalId,
        turnoId: turno.id,
        vendidoEn: vendidoEn.toISOString(),
        lineas,
        pagos: pagosEnviar,
        venta: ventaLocal,
      });
    } catch {
      setAviso('No se pudo guardar la venta en el telefono. No la cierres: revisa el almacenamiento.');
      return;
    }

    descontarDelCatalogo(sucursalId, lineas);

    // Que el indicador muestre de inmediato cuantas van pendientes.
    refrescar();

    setVenta(ventaLocal);
    setVentaPendiente(true);
    setCarrito([]);
    setPagos([]);
  }

  return (
    <>
      {cargandoTurno ? (
        <div className="cargando">
          <div className="cargando__rueda" />
          <p className="cargando__texto">Revisando la caja</p>
        </div>
      ) : null}

      {!cargandoTurno && !turno ? (
        <div className="panel" style={{ maxWidth: '32rem', margin: '3rem auto' }}>
          <div className="tarjeta">
            <h2 className="panel__titulo">Abre tu turno para vender</h2>
            <p className="panel__nota">
              Cuenta el efectivo con el que arranca la caja y escribelo. Al cerrar el turno
              el sistema te dira cuanto deberia haber, para que compares.
            </p>

            <label className="campo-ancho" style={{ marginTop: '0.9rem' }}>
              <span>Fondo inicial en la caja</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                value={fondoTurno}
                onChange={(evento) => setFondoTurno(evento.target.value)}
              />
            </label>

            {errorTurno ? (
              <p className="aviso" role="alert" style={{ marginTop: '0.9rem' }}>
                {errorTurno}
              </p>
            ) : null}

            <button
              type="button"
              className="cobrar"
              style={{ marginTop: '0.9rem' }}
              onClick={() => void abrirTurno()}
              disabled={abriendoTurno}
            >
              {abriendoTurno ? 'Abriendo…' : 'Abrir turno'}
            </button>
          </div>
        </div>
      ) : null}

      {!cargandoTurno && turno ? (
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
      ) : null}

      {venta ? (
        <Comprobante
          venta={venta}
          sucursal={sucursal?.codigo ?? ''}
          vendedor={sesion.usuario.nombre}
          pendiente={ventaPendiente}
          onNuevaVenta={() => setVenta(null)}
        />
      ) : null}
    </>
  );
}
