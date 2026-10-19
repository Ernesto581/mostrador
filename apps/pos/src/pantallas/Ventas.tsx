import { useState } from 'react';
import { api } from '../api/cliente';
import type { DetalleVenta, MetodoPago, Sesion, VentaResumen } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { dinero, hora } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
}

const ETIQUETA_PAGO: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Ventas({ sesion, sucursalId }: Props) {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [abierta, setAbierta] = useState<VentaResumen | null>(null);
  const [detalle, setDetalle] = useState<DetalleVenta | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [devolver, setDevolver] = useState(false);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [reembolso, setReembolso] = useState<MetodoPago>('efectivo');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const puedeCancelar = sesion.permisos.includes('sale.void');

  const { datos, cargando, error: errorLista, recargar } = useCarga(
    () =>
      api.ventas({
        sucursalId,
        desde: new Date(`${desde}T00:00:00`).toISOString(),
        hasta: new Date(`${hasta}T23:59:59`).toISOString(),
        limite: 200,
      }),
    [sucursalId, desde, hasta],
  );

  const ventas = datos?.ventas ?? [];
  const vendido = ventas
    .filter((venta) => venta.estado === 'completada')
    .reduce((total, venta) => total + venta.total, 0);
  const cambioTotal = ventas
    .filter((venta) => venta.estado === 'completada')
    .reduce((total, venta) => total + venta.cambio, 0);

  async function abrir(venta: VentaResumen): Promise<void> {
    setAbierta(venta);
    setDetalle(null);
    setMotivo('');
    setDevolver(false);
    setCantidades({});
    setError(null);
    setCargandoDetalle(true);

    try {
      setDetalle(await api.venta(venta.id));
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setCargandoDetalle(false);
    }
  }

  async function cancelar(): Promise<void> {
    if (!abierta || motivo.trim().length < 3) {
      setError('Escribe el motivo de la cancelacion (al menos 3 letras)');
      return;
    }

    setProcesando(true);
    setError(null);

    try {
      await api.cancelarVenta(abierta.id, motivo.trim());
      setAbierta(null);
      await recargar();
      setOk('Venta cancelada y stock devuelto al inventario.');
      window.setTimeout(() => setOk(null), 4000);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setProcesando(false);
    }
  }

  async function registrarDevolucion(): Promise<void> {
    if (!detalle || motivo.trim().length < 3) {
      setError('Escribe el motivo de la devolucion (al menos 3 letras)');
      return;
    }

    const lineas = detalle.lineas
      .map((linea) => ({ lineaId: linea.id, cantidad: Number(cantidades[linea.id] ?? 0) }))
      .filter((linea) => Number.isInteger(linea.cantidad) && linea.cantidad > 0);

    if (lineas.length === 0) {
      setError('Indica cuantas piezas se devuelven');
      return;
    }

    setProcesando(true);
    setError(null);

    try {
      const resultado = await api.devolverVenta(detalle.venta.id, {
        motivo: motivo.trim(),
        metodoReembolso: reembolso,
        lineas,
      });

      setAbierta(null);
      await recargar();
      setOk(`Devolucion ${resultado.devolucion.folio} por ${dinero(resultado.devolucion.total)}.`);
      window.setTimeout(() => setOk(null), 5000);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Ventas</h1>
          <p className="panel__nota">
            {ventas.length} ventas · {dinero(vendido)} vendido · {dinero(cambioTotal)} entregado de cambio
          </p>
        </div>
      </div>

      <div className="barra-filtros ventas__filtros">
        <label className="campo-ancho ventas__fecha">
          <span>Desde</span>
          <input className="entrada" type="date" value={desde} onChange={(evento) => setDesde(evento.target.value)} />
        </label>
        <label className="campo-ancho ventas__fecha">
          <span>Hasta</span>
          <input className="entrada" type="date" value={hasta} onChange={(evento) => setHasta(evento.target.value)} />
        </label>
        <button
          type="button"
          className="boton ventas__hoy"
          onClick={() => {
            setDesde(hoy());
            setHasta(hoy());
          }}
        >
          Hoy
        </button>
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && ventas.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">No hay ventas en ese rango de fechas.</p>
        </div>
      ) : null}

      {ventas.length > 0 ? (
        <div className="tabla-envoltura tabla-envoltura--tarjetas">
          <table className="tabla tabla--responsive">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Hora</th>
                <th className="numero">Articulos</th>
                <th className="numero">Total</th>
                <th className="numero">Cambio</th>
                <th>Vendedor</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ventas.map((venta) => (
                <tr key={venta.id}>
                  <td className="codigo" data-label="Folio">{venta.folio}</td>
                  <td data-label="Hora">{hora(venta.vendidoEn)}</td>
                  <td className="numero" data-label="Articulos">{venta.articulos}</td>
                  <td className="numero" data-label="Total">{dinero(venta.total)}</td>
                  <td className="numero" data-label="Cambio">{dinero(venta.cambio)}</td>
                  <td data-label="Vendedor">{venta.vendidoPor}</td>
                  <td data-label="Estado">
                    <span className={venta.estado === 'cancelada' ? 'insignia insignia--agotado' : 'insignia insignia--ok'}>
                      {venta.estado === 'cancelada' ? 'Cancelada' : 'Completada'}
                    </span>
                  </td>
                  <td data-label="Acciones">
                    <button type="button" className="boton" onClick={() => void abrir(venta)}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {abierta ? (
        <Modal
          titulo={`Venta ${abierta.folio}`}
          nota={
            abierta.estado === 'cancelada'
              ? 'Esta venta esta cancelada: el stock ya volvio al inventario.'
              : 'Cancelar devuelve todo el stock. Devolver permite elegir cuantas piezas regresan.'
          }
          onCerrar={() => setAbierta(null)}
        >
          {cargandoDetalle ? <p className="panel__nota">Cargando…</p> : null}

          {detalle ? (
            <>
              <div className="tabla-envoltura tabla-envoltura--tarjetas">
                <table className="tabla tabla--responsive">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="numero">Cant.</th>
                      <th className="numero">Precio</th>
                      <th className="numero">Importe</th>
                      {devolver ? <th className="numero">Devolver</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.lineas.map((linea) => (
                      <tr key={linea.id}>
                        <td data-label="Producto">
                          {linea.name}
                          {linea.discountAmount > 0 ? (
                            <span className="insignia" style={{ marginLeft: '0.4rem' }}>
                              desc. {dinero(linea.discountAmount)}
                            </span>
                          ) : null}
                        </td>
                        <td className="numero" data-label="Cantidad">{linea.quantity}</td>
                        <td className="numero" data-label="Precio">{dinero(linea.unitPrice)}</td>
                        <td className="numero" data-label="Importe">{dinero(linea.total)}</td>
                        {devolver ? (
                          <td className="numero" data-label="Devolver">
                            <input
                              className="entrada entrada--numero"
                              style={{ width: '5rem' }}
                              inputMode="numeric"
                              placeholder="0"
                              value={cantidades[linea.id] ?? ''}
                              onChange={(evento) =>
                                setCantidades({ ...cantidades, [linea.id]: evento.target.value })
                              }
                            />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="tarjeta" style={{ marginTop: '0.8rem' }}>
                <p className="tarjeta__titulo">Pagos</p>
                {detalle.pagos.map((pago) => (
                  <div className="total-fila" key={pago.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--texto-tenue)', fontSize: '0.84rem' }}>
                      {ETIQUETA_PAGO[pago.method] ?? pago.method}
                    </span>
                    <span className="numero" style={{ fontSize: '0.9rem' }}>
                      {dinero(pago.amount)}
                    </span>
                  </div>
                ))}
                <div className="total-fila" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem' }}>
                  <strong style={{ fontSize: '0.86rem' }}>Total</strong>
                  <strong className="numero">{dinero(detalle.venta.total)}</strong>
                </div>
              </div>
            </>
          ) : null}

          {puedeCancelar && abierta.estado !== 'cancelada' ? (
            <div style={{ marginTop: '1rem' }}>
              <label className="campo-ancho">
                <span>Motivo</span>
                <input
                  className="entrada"
                  placeholder="Ej. El cliente se arrepintio, error de cobro"
                  value={motivo}
                  onChange={(evento) => setMotivo(evento.target.value)}
                />
              </label>

              {devolver ? (
                <label className="campo-ancho" style={{ marginTop: '0.7rem' }}>
                  <span>Forma del reembolso</span>
                  <select
                    className="entrada"
                    value={reembolso}
                    onChange={(evento) => setReembolso(evento.target.value as MetodoPago)}
                  >
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setAbierta(null)}>
              Cerrar
            </button>

            {puedeCancelar && abierta.estado !== 'cancelada' ? (
              <>
                <button
                  type="button"
                  className="boton"
                  onClick={() => {
                    setDevolver(!devolver);
                    setCantidades({});
                    setError(null);
                  }}
                >
                  {devolver ? 'Devolver otra cosa' : 'Devolver piezas'}
                </button>

                {devolver ? (
                  <button type="button" className="boton boton--acento" onClick={() => void registrarDevolucion()} disabled={procesando}>
                    {procesando ? 'Guardando…' : 'Registrar devolucion'}
                  </button>
                ) : (
                  <button type="button" className="boton boton--acento" onClick={() => void cancelar()} disabled={procesando}>
                    {procesando ? 'Cancelando…' : 'Cancelar venta completa'}
                  </button>
                )}
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
