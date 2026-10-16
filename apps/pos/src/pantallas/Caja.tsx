import { useState } from 'react';
import { api } from '../api/cliente';
import type { CierreCaja, ResumenTurno, Sesion } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { aCentavos, dinero, fechaLarga } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
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

export function Caja({ sesion, sucursalId }: Props) {
  const [abrir, setAbrir] = useState(false);
  const [movimiento, setMovimiento] = useState<null | 'ingreso' | 'retiro' | 'gasto'>(null);
  const [cerrar, setCerrar] = useState(false);
  const [fondo, setFondo] = useState('200.00');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [contado, setContado] = useState('');
  const [notas, setNotas] = useState('');
  const [resultado, setResultado] = useState<CierreCaja | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);

  const { datos, cargando, error: errorLista, recargar } = useCarga(
    () => api.turnoActual(sucursalId),
    [sucursalId],
  );

  const { datos: datosCierres, recargar: recargarCierres } = useCarga(
    () => api.cierres({ sucursalId, limite: 30 }),
    [sucursalId],
  );

  const { datos: datosAbiertos } = useCarga(() => api.turnosAbiertos(), []);

  const turno = datos?.turno ?? null;
  const resumen: ResumenTurno | null = datos?.resumen ?? null;
  const cierres = datosCierres?.cierres ?? [];

  function avisoRapido(texto: string): void {
    setOk(texto);
    window.setTimeout(() => setOk(null), 4500);
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
        sucursal: sucursal?.codigo ?? '',
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
          <h1 className="panel__titulo">Caja</h1>
          <p className="panel__nota">
            Sucursal {sucursal?.codigo ?? '—'} ·{' '}
            {turno ? 'turno abierto' : 'sin turno abierto'}
          </p>
        </div>

        {turno ? (
          <div className="barra-filtros">
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
        ) : (
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
        )}
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
            </div>
          </div>
        </>
      ) : null}

      {!cargando && !turno ? (
        <div className="tarjeta">
          <p className="vacio">
            No hay turno abierto en esta sucursal.
            <br />
            Abre uno para empezar a vender y llevar el control del efectivo.
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

      {(datosAbiertos?.turnos ?? []).length > 1 ? (
        <div className="tarjeta">
          <p className="tarjeta__titulo">Turnos abiertos en otras sucursales</p>
          {(datosAbiertos?.turnos ?? []).map((otro) => (
            <div className="fila-dato" key={otro.id}>
              <span>
                {otro.sucursal} · {otro.abiertoPor}
              </span>
              <span className="numero">{dinero(otro.fondoInicial)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <h2 className="panel__titulo" style={{ marginBottom: '0.6rem' }}>
          Historial de cierres
        </h2>

        {cierres.length === 0 ? (
          <div className="tarjeta">
            <p className="vacio">Todavia no hay cierres registrados.</p>
          </div>
        ) : (
          <div className="tabla-envoltura">
            <table className="tabla">
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
                </tr>
              </thead>
              <tbody>
                {cierres.map((cierre) => (
                  <tr key={cierre.id}>
                    <td className="codigo">{fechaLarga(cierre.cerradoEn)}</td>
                    <td>{cierre.sucursal}</td>
                    <td className="numero">{dinero(cierre.ventasTotal)}</td>
                    <td className="numero">{dinero(cierre.esperado)}</td>
                    <td className="numero">{dinero(cierre.contado)}</td>
                    <td className="numero">
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
                    <td>{cierre.cerradoPor}</td>
                    <td>{cierre.notas ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {abrir ? (
        <Modal
          titulo="Abrir turno"
          nota="Cuenta el efectivo con el que arranca la caja y escribelo aqui."
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
    </div>
  );
}
