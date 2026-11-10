import { useState } from 'react';
import { api } from '../api/cliente';
import type { CierreCaja, DetalleCierre, ResumenTurno, Sesion } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { aCentavos, dinero, fechaLarga } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
  titulo?: string;
}

const ETIQUETA_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};

const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  ingreso: 'Ingreso de efectivo',
  retiro: 'Retiro de efectivo',
  gasto: 'Gasto pagado de la caja',
};

export function Caja({ sesion, sucursalId, titulo }: Props) {
  const [abrir, setAbrir] = useState(false);
  const [movimiento, setMovimiento] = useState<null | 'ingreso' | 'retiro' | 'gasto'>(null);
  const [cerrar, setCerrar] = useState(false);
  const [fondo, setFondo] = useState('200.00');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const [resultado, setResultado] = useState<CierreCaja | null>(null);
  const [detalle, setDetalle] = useState<DetalleCierre | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [filtroSucursalId, setFiltroSucursalId] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);
  const puedeAbrir = sesion.permisos.includes('sale.sell');
  const puedeCerrar = sesion.permisos.includes('cash.close');
  // El cajero ve su turno y lo que ha vendido; el historial y los turnos de
  // otras sucursales son de supervision.
  const puedeVerHistorial =
    sesion.permisos.includes('sale.void') || sesion.permisos.includes('report.profit');

  const { datos, cargando, error: errorLista, recargar } = useCarga(
    () => api.turnoActual(sucursalId),
    [sucursalId],
  );

  const { datos: datosCierres, recargar: recargarCierres } = useCarga(
    () =>
      puedeVerHistorial
        ? api.cierres({
            ...(filtroSucursalId ? { sucursalId: filtroSucursalId } : {}),
            ...(filtroDesde
              ? { desde: new Date(`${filtroDesde}T00:00:00`).toISOString() }
              : {}),
            ...(filtroHasta
              ? { hasta: new Date(`${filtroHasta}T23:59:59.999`).toISOString() }
              : {}),
            limite: 60,
          })
        : Promise.resolve({ cierres: [] as CierreCaja[] }),
    [puedeVerHistorial, filtroSucursalId, filtroDesde, filtroHasta],
  );

  const { datos: datosAbiertos } = useCarga(
    () =>
      puedeVerHistorial
        ? api.turnosAbiertos()
        : Promise.resolve({ turnos: [] }),
    [puedeVerHistorial],
  );

  const turno = datos?.turno ?? null;
  const resumen: ResumenTurno | null = datos?.resumen ?? null;
  const cierres = datosCierres?.cierres ?? [];

  function avisoRapido(texto: string): void {
    setOk(texto);
    window.setTimeout(() => setOk(null), 4500);
  }

  async function abrirDetalle(id: string): Promise<void> {
    setCargandoDetalle(true);
    setError(null);
    try {
      setDetalle(await api.cierreDetalle(id));
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setCargandoDetalle(false);
    }
  }

  async function abrirTurno(): Promise<void> {
    setGuardando(true);
    setError(null);
    try {
      await api.abrirTurno({
        sucursalId,
        fondoInicial: aCentavos(fondo),
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      });
      setAbrir(false);
      setNotas('');
      await recargar();
      avisoRapido('Turno abierto. Ya se puede vender.');
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function registrarMovimiento(): Promise<void> {
    if (!turno || !movimiento) {
      return;
    }
    if (aCentavos(monto) <= 0) {
      setError('Escribe un monto mayor a cero');
      return;
    }
    if (motivo.trim().length < 3) {
      setError('Escribe el motivo (queda en el historial)');
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      await api.registrarMovimientoCaja({
        sucursalId,
        turnoId: turno.id,
        tipo: movimiento,
        monto: aCentavos(monto),
        motivo: motivo.trim(),
      });
      setMovimiento(null);
      setMonto('');
      setMotivo('');
      await recargar();
      avisoRapido('Movimiento registrado.');
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function cerrarTurno(): Promise<void> {
    if (!turno) {
      return;
    }
    if (contado.trim() === '') {
      setError('Escribe cuanto efectivo contaste');
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const respuesta = await api.cerrarTurno(turno.id, {
        contado: aCentavos(contado),
        ...(notas.trim() ? { notas: notas.trim() } : {}),
      });

      setResultado({
        id: respuesta.cierre.id,
        alcance: 'turno',
        fecha: new Date().toISOString().slice(0, 10),
        sucursalId,
        sucursal: sucursal?.nombre ?? '',
        ventasTotal: respuesta.resumen.ventas.total,
        esperado: respuesta.cierre.esperado,
        contado: respuesta.cierre.contado,
        diferencia: respuesta.cierre.diferencia,
        cerradoEn: new Date().toISOString(),
        cerradoPor: sesion.usuario.nombre,
        notas: notas.trim() || null,
      });

      setCerrar(false);
      setContado('');
      setNotas('');
      await Promise.all([recargar(), recargarCierres()]);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">{titulo ?? 'Caja'}</h1>
          <p className="panel__nota">
            Sucursal {sucursal?.nombre ?? '—'} ·{' '}
            {turno ? 'turno abierto' : 'sin turno abierto'}
          </p>
        </div>

        {turno && puedeCerrar ? (
          <div className="barra-filtros caja__acciones">
            <button
              type="button"
              className="boton"
              onClick={() => {
                setError(null);
                setMonto('');
                setMotivo('');
                setMovimiento('retiro');
              }}
            >
              Retiro o gasto
            </button>
            <button
              type="button"
              className="boton"
              onClick={() => {
                setError(null);
                setMonto('');
                setMotivo('');
                setMovimiento('ingreso');
              }}
            >
              Ingreso
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => {
                setError(null);
                setContado('');
                setNotas('');
                setCerrar(true);
              }}
            >
              Cerrar turno
            </button>
          </div>
        ) : !turno && puedeAbrir ? (
          <button
            type="button"
            className="boton boton--acento"
            onClick={() => {
              setError(null);
              setNotas('');
              setAbrir(true);
            }}
          >
            Abrir turno
          </button>
        ) : null}
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && turno && resumen ? (
        <>
          <div className="rejilla-tarjetas">
            <div className="tarjeta">
              <p className="tarjeta__titulo">Fondo inicial</p>
              <p className="cifra-grande">{dinero(turno.fondoInicial)}</p>
              <p className="panel__nota">Abierto {fechaLarga(turno.abiertoEn)}</p>
            </div>

            <div className="tarjeta">
              <p className="tarjeta__titulo">Vendido en el turno</p>
              <p className="cifra-grande">{dinero(resumen.ventas.total)}</p>
              <p className="panel__nota">
                {resumen.ventas.cantidad} ventas · {resumen.ventas.articulos} articulos
              </p>
            </div>

            <div className="tarjeta tarjeta--destacada">
              <p className="tarjeta__titulo">Efectivo que deberia haber</p>
              <p className="cifra-grande">{dinero(resumen.efectivoEsperado)}</p>
              <p className="panel__nota">Cuentalo antes de cerrar</p>
            </div>
          </div>

          <div className="columnas-dos">
            <div className="tarjeta">
              <p className="tarjeta__titulo">Cobrado por forma de pago</p>
              {Object.entries(resumen.porMetodo).map(([metodo, monto]) => (
                <div className="fila-dato" key={metodo}>
                  <span>{ETIQUETA_METODO[metodo] ?? metodo}</span>
                  <span className="numero">{dinero(monto)}</span>
                </div>
              ))}
              <div className="fila-dato">
                <span>Cambio entregado</span>
                <span className="numero">−{dinero(resumen.ventas.cambio)}</span>
              </div>
            </div>

            <div className="tarjeta">
              <p className="tarjeta__titulo">Movimientos de efectivo</p>
              <div className="fila-dato">
                <span>Ingresos</span>
                <span className="numero">{dinero(resumen.movimientos.ingresos)}</span>
              </div>
              <div className="fila-dato">
                <span>Retiros</span>
                <span className="numero">−{dinero(resumen.movimientos.retiros)}</span>
              </div>
              <div className="fila-dato">
                <span>Gastos pagados de la caja</span>
                <span className="numero">−{dinero(resumen.movimientos.gastos)}</span>
              </div>
              <div className="fila-dato">
                <span>Devoluciones pagadas en efectivo</span>
                <span className="numero">−{dinero(resumen.devoluciones.efectivo)}</span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {!cargando && !turno ? (
        <div className="tarjeta">
          <p className="vacio">
            No hay turno abierto en esta sucursal.
            {puedeAbrir ? (
              <>
                <br />
                Abre uno para empezar a vender y llevar el control del efectivo. El turno se
                cierra automaticamente a las 24 horas.
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {resultado ? (
        <div className={`aviso ${resultado.diferencia === 0 ? 'aviso--ok' : ''}`} role="status">
          <strong>Turno cerrado.</strong> Esperado {dinero(resultado.esperado)} · contado{' '}
          {dinero(resultado.contado)} ·{' '}
          {resultado.diferencia === 0
            ? 'cuadra exacto.'
            : `diferencia ${resultado.diferencia > 0 ? '+' : ''}${dinero(resultado.diferencia)}`}
        </div>
      ) : null}

      {puedeVerHistorial && (datosAbiertos?.turnos ?? []).length > 0 ? (
        <div className="tarjeta">
          <p className="tarjeta__titulo">Turnos abiertos</p>
          {(datosAbiertos?.turnos ?? []).map((otro) => (
            <div className="fila-dato" key={otro.id}>
              <span>
                {otro.sucursal} · {otro.abiertoPor}
                <br />
                <span className="panel__nota">Abierto {fechaLarga(otro.abiertoEn)}</span>
              </span>
              <span className="numero">{dinero(otro.fondoInicial)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {puedeVerHistorial ? (
        <div>
          <div className="inventario__seccion-cabecera" style={{ marginBottom: '0.6rem' }}>
            <h2 className="panel__titulo">Historial de cierres</h2>
            <div className="barra-filtros">
              <select
                className="selector"
                value={filtroSucursalId}
                onChange={(evento) => setFiltroSucursalId(evento.target.value)}
                aria-label="Filtrar cierres por sucursal"
              >
                <option value="">Todas las sucursales</option>
                {sesion.sucursales.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.nombre}
                  </option>
                ))}
              </select>
              <label className="inventario__fecha-campo">
                <span>Desde</span>
                <input
                  className="entrada inventario__fecha"
                  type="date"
                  value={filtroDesde}
                  onChange={(evento) => setFiltroDesde(evento.target.value)}
                  aria-label="Fecha inicial de cierres"
                />
              </label>
              <label className="inventario__fecha-campo">
                <span>Hasta</span>
                <input
                  className="entrada inventario__fecha"
                  type="date"
                  value={filtroHasta}
                  onChange={(evento) => setFiltroHasta(evento.target.value)}
                  aria-label="Fecha final de cierres"
                />
              </label>
            </div>
          </div>

          {cierres.length === 0 ? (
            <div className="tarjeta">
              <p className="vacio">Todavia no hay cierres registrados.</p>
            </div>
          ) : (
            <div className="tabla-envoltura tabla-envoltura--tarjetas">
              <table className="tabla tabla--responsive">
                <thead>
                  <tr>
                    <th>Cerrado</th>
                    <th>Sucursal</th>
                    <th className="numero">Vendido</th>
                    <th className="numero">Esperado</th>
                    <th className="numero">Contado</th>
                    <th className="numero">Diferencia</th>
                    <th>Cerro</th>
                    <th>Notas</th>
                    <th className="col-acciones">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {cierres.map((cierre) => (
                    <tr key={cierre.id}>
                      <td className="codigo" data-label="Cierre">{fechaLarga(cierre.cerradoEn)}</td>
                      <td data-label="Sucursal">{cierre.sucursal}</td>
                      <td className="numero" data-label="Vendido">{dinero(cierre.ventasTotal)}</td>
                      <td className="numero" data-label="Esperado">{dinero(cierre.esperado)}</td>
                      <td className="numero" data-label="Contado">{dinero(cierre.contado)}</td>
                      <td className="numero" data-label="Diferencia">
                        <span
                          className={
                            cierre.diferencia === 0
                              ? 'insignia insignia--ok'
                              : 'insignia insignia--agotado'
                          }
                        >
                          {cierre.diferencia > 0 ? '+' : ''}
                          {dinero(cierre.diferencia)}
                        </span>
                      </td>
                      <td data-label="Cerro">{cierre.cerradoPor}</td>
                      <td data-label="Notas">{cierre.notas ?? '—'}</td>
                      <td className="col-acciones" data-label="Detalle">
                        <button
                          type="button"
                          className="boton"
                          disabled={cargandoDetalle}
                          onClick={() => void abrirDetalle(cierre.id)}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="tarjeta">
          <p className="vacio">
            Aqui ves tu turno y lo que has vendido. El historial de turnos cerrados lo
            consulta el administrador.
          </p>
        </div>
      )}

      {abrir ? (
        <Modal
          titulo="Abrir turno"
          nota="Cuenta el efectivo con el que arranca la caja y escribelo aqui. El turno se cierra automaticamente a las 24 horas."
          onCerrar={() => setAbrir(false)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Fondo inicial</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                value={fondo}
                onChange={(evento) => setFondo(evento.target.value)}
              />
            </label>

            <label className="campo-ancho">
              <span>Notas (opcional)</span>
              <input
                className="entrada"
                value={notas}
                onChange={(evento) => setNotas(evento.target.value)}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setAbrir(false)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--acento" onClick={() => void abrirTurno()} disabled={guardando}>
              {guardando ? 'Abriendo…' : 'Abrir turno'}
            </button>
          </div>
        </Modal>
      ) : null}

      {movimiento ? (
        <Modal
          titulo={ETIQUETA_MOVIMIENTO[movimiento] ?? 'Movimiento de caja'}
          nota="Todo movimiento de efectivo queda en el historial con su motivo."
          onCerrar={() => setMovimiento(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Monto</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                value={monto}
                onChange={(evento) => setMonto(evento.target.value)}
              />
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>Motivo</span>
              <input
                className="entrada"
                placeholder="Ej. Pago al proveedor, retiro del dueno"
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setMovimiento(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void registrarMovimiento()}
              disabled={guardando}
            >
              {guardando ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {cerrar && turno && resumen ? (
        <Modal
          titulo="Cerrar turno"
          nota={`Deberia haber ${dinero(resumen.efectivoEsperado)}. Cuenta el efectivo y escribelo.`}
          onCerrar={() => setCerrar(false)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Efectivo contado</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                value={contado}
                onChange={(evento) => setContado(evento.target.value)}
              />
            </label>

            <label className="campo-ancho">
              <span>Notas (opcional)</span>
              <input
                className="entrada"
                value={notas}
                onChange={(evento) => setNotas(evento.target.value)}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setCerrar(false)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--acento" onClick={() => void cerrarTurno()} disabled={guardando}>
              {guardando ? 'Cerrando…' : 'Cerrar turno'}
            </button>
          </div>
        </Modal>
      ) : null}

      {detalle ? (
        <Modal
          titulo={`Cierre ${detalle.cierre.fecha} · ${detalle.cierre.sucursal}`}
          nota={`Cerrado ${fechaLarga(detalle.cierre.cerradoEn)} por ${detalle.cierre.cerradoPor}`}
          onCerrar={() => setDetalle(null)}
        >
          <div className="rejilla-tarjetas">
            <div className="tarjeta">
              <p className="tarjeta__titulo">Vendido</p>
              <p className="cifra-grande">{dinero(detalle.cierre.ventasTotal)}</p>
              <p className="panel__nota">{detalle.ventas.length} ventas</p>
            </div>
            <div className="tarjeta">
              <p className="tarjeta__titulo">Esperado</p>
              <p className="cifra-grande">{dinero(detalle.cierre.esperado)}</p>
            </div>
            <div className="tarjeta">
              <p className="tarjeta__titulo">Contado</p>
              <p className="cifra-grande">{dinero(detalle.cierre.contado)}</p>
            </div>
            <div className="tarjeta">
              <p className="tarjeta__titulo">Diferencia</p>
              <p className="cifra-grande">
                {detalle.cierre.diferencia > 0 ? '+' : ''}
                {dinero(detalle.cierre.diferencia)}
              </p>
            </div>
          </div>

          {detalle.turno ? (
            <div className="tarjeta" style={{ marginTop: '0.75rem' }}>
              <p className="tarjeta__titulo">Datos del turno</p>
              <div className="columnas-dos">
                <div className="fila-dato">
                  <span>Abierto</span>
                  <span>{fechaLarga(detalle.turno.abiertoEn)}</span>
                </div>
                <div className="fila-dato">
                  <span>Abierto por</span>
                  <span>{detalle.turnoAbiertoPor ?? '—'}</span>
                </div>
                <div className="fila-dato">
                  <span>Fondo inicial</span>
                  <span>{dinero(detalle.turno.fondoInicial)}</span>
                </div>
                <div className="fila-dato">
                  <span>Notas</span>
                  <span>{detalle.cierre.notas ?? '—'}</span>
                </div>
              </div>
            </div>
          ) : null}

          {detalle.resumen ? (
            <div className="columnas-dos" style={{ marginTop: '0.75rem' }}>
              <div className="tarjeta">
                <p className="tarjeta__titulo">Cobrado por forma de pago</p>
                {Object.entries(detalle.resumen.porMetodo).map(([metodo, monto]) => (
                  <div className="fila-dato" key={metodo}>
                    <span>{ETIQUETA_METODO[metodo] ?? metodo}</span>
                    <span className="numero">{dinero(monto)}</span>
                  </div>
                ))}
                <div className="fila-dato">
                  <span>Venta neta</span>
                  <span className="numero">{dinero(detalle.resumen.ventas.ventaNeta)}</span>
                </div>
                <div className="fila-dato">
                  <span>Impuestos</span>
                  <span className="numero">{dinero(detalle.resumen.ventas.impuestos)}</span>
                </div>
                <div className="fila-dato">
                  <span>Descuentos</span>
                  <span className="numero">−{dinero(detalle.resumen.ventas.descuentos)}</span>
                </div>
                <div className="fila-dato">
                  <span>Cambio entregado</span>
                  <span className="numero">−{dinero(detalle.resumen.ventas.cambio)}</span>
                </div>
              </div>

              <div className="tarjeta">
                <p className="tarjeta__titulo">Movimientos de efectivo</p>
                <div className="fila-dato">
                  <span>Ingresos</span>
                  <span className="numero">{dinero(detalle.resumen.movimientos.ingresos)}</span>
                </div>
                <div className="fila-dato">
                  <span>Retiros</span>
                  <span className="numero">−{dinero(detalle.resumen.movimientos.retiros)}</span>
                </div>
                <div className="fila-dato">
                  <span>Gastos</span>
                  <span className="numero">−{dinero(detalle.resumen.movimientos.gastos)}</span>
                </div>
                <div className="fila-dato">
                  <span>Devoluciones en efectivo</span>
                  <span className="numero">−{dinero(detalle.resumen.devoluciones.efectivo)}</span>
                </div>
              </div>
            </div>
          ) : null}

          <h3 className="panel__titulo" style={{ marginTop: '1rem' }}>
            Ventas
          </h3>
          {detalle.ventas.length === 0 ? (
            <p className="vacio">Este turno no tiene ventas registradas.</p>
          ) : (
            <div className="tabla-envoltura">
              <table className="tabla tabla--responsive">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Hora</th>
                    <th className="numero">Articulos</th>
                    <th className="numero">Total</th>
                    <th>Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.ventas.map((venta) => (
                    <tr key={venta.id}>
                      <td className="codigo" data-label="Folio">{venta.folio}</td>
                      <td data-label="Hora">{fechaLarga(venta.vendidoEn)}</td>
                      <td className="numero" data-label="Articulos">{venta.articulos}</td>
                      <td className="numero" data-label="Total">{dinero(venta.total)}</td>
                      <td data-label="Pago">
                        {venta.pagos.length === 0
                          ? '—'
                          : venta.pagos
                              .map(
                                (pago) =>
                                  `${ETIQUETA_METODO[pago.metodo] ?? pago.metodo}: ${dinero(pago.monto)}`,
                              )
                              .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="panel__titulo" style={{ marginTop: '1rem' }}>
            Productos vendidos
          </h3>
          {detalle.productos.length === 0 ? (
            <p className="vacio">No hay productos vendidos en este turno.</p>
          ) : (
            <div className="tabla-envoltura">
              <table className="tabla tabla--responsive">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th className="numero">Cantidad</th>
                    <th className="numero">Venta</th>
                    <th className="numero">Costo</th>
                    <th className="numero">Utilidad</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.productos.map((producto) => (
                    <tr key={`${producto.productoId ?? producto.nombre}-${producto.sku ?? ''}`}>
                      <td data-label="Producto">{producto.nombre}</td>
                      <td className="codigo" data-label="SKU">{producto.sku ?? '—'}</td>
                      <td className="numero" data-label="Cantidad">{producto.cantidad}</td>
                      <td className="numero" data-label="Venta">{dinero(producto.venta)}</td>
                      <td className="numero" data-label="Costo">{dinero(producto.costo)}</td>
                      <td className="numero" data-label="Utilidad">
                        {dinero(producto.venta - producto.costo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="panel__titulo" style={{ marginTop: '1rem' }}>
            Movimientos de caja
          </h3>
          {detalle.movimientos.length === 0 ? (
            <p className="vacio">No hubo ingresos, retiros ni gastos de caja.</p>
          ) : (
            <div className="tabla-envoltura">
              <table className="tabla tabla--responsive">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="numero">Monto</th>
                    <th>Motivo</th>
                    <th>Usuario</th>
                    <th>Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.movimientos.map((movimiento) => (
                    <tr key={movimiento.id}>
                      <td data-label="Tipo">
                        {ETIQUETA_MOVIMIENTO[movimiento.tipo] ?? movimiento.tipo}
                      </td>
                      <td className="numero" data-label="Monto">{dinero(movimiento.monto)}</td>
                      <td data-label="Motivo">{movimiento.motivo ?? '—'}</td>
                      <td data-label="Usuario">{movimiento.usuario ?? '—'}</td>
                      <td data-label="Hora">{fechaLarga(movimiento.ocurridoEn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detalle.devoluciones.length > 0 ? (
            <>
              <h3 className="panel__titulo" style={{ marginTop: '1rem' }}>
                Devoluciones
              </h3>
              <div className="tabla-envoltura">
                <table className="tabla tabla--responsive">
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Motivo</th>
                      <th className="numero">Total</th>
                      <th>Metodo</th>
                      <th>Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.devoluciones.map((devolucion) => (
                      <tr key={devolucion.id}>
                        <td className="codigo" data-label="Folio">{devolucion.folio}</td>
                        <td data-label="Motivo">{devolucion.motivo ?? '—'}</td>
                        <td className="numero" data-label="Total">{dinero(devolucion.total)}</td>
                        <td data-label="Metodo">
                          {devolucion.metodo
                            ? ETIQUETA_METODO[devolucion.metodo] ?? devolucion.metodo
                            : '—'}
                        </td>
                        <td data-label="Hora">{fechaLarga(devolucion.creadoEn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setDetalle(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
