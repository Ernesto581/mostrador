import { api } from '../api/cliente';
import type { Sesion } from '../api/tipos';
import { useCarga } from '../util/pantalla';
import { dinero } from '../util/dinero';

interface Props {
  sesion: Sesion;
  onIr?: (seccion: 'inventario' | 'informes' | 'transferencias' | 'gastos') => void;
}

function rangoDeHoy(): { desde: string; hasta: string } {
  const ahora = new Date();
  const desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/**
 * Resumen del día para quien administra.
 *
 * Ventas y alertas salen del servidor. Gastos y utilidad no se inventan:
 * todavía no hay un módulo que los calcule.
 */
export function Panel({ sesion, onIr }: Props) {
  const { desde, hasta } = rangoDeHoy();
  const ventas = useCarga(() => api.ventas({ desde, hasta, limite: 200 }), []);
  const alertas = useCarga(() => api.stockGeneral(undefined, true, 8), []);
  const traslados = useCarga(() => api.transferencias({ estado: 'en_transito', limite: 20 }), []);

  const completadas = (ventas.datos?.ventas ?? []).filter((venta) => venta.estado === 'completada');
  const ingresos = completadas.reduce((total, venta) => total + venta.total, 0);
  const ticketMedio = completadas.length === 0 ? 0 : Math.round(ingresos / completadas.length);
  const bajoMinimo = alertas.datos?.stock ?? [];
  const enTransito = traslados.datos?.transferencias ?? [];

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Panel</h1>
          <p className="panel__nota">
            Resumen de ventas, ingresos, gastos, utilidad y alertas de inventario.
            {' '}
            {sesion.empresa.nombre || 'El negocio'} · hoy
          </p>
        </div>
        {onIr ? (
          <button type="button" className="boton" onClick={() => onIr('informes')}>
            Ver informes
          </button>
        ) : null}
      </div>

      <div className="rejilla-tarjetas">
        <div className="tarjeta tarjeta--destacada">
          <p className="tarjeta__titulo">Ingresos por ventas</p>
          <p className="cifra-grande">{ventas.cargando ? '…' : dinero(ingresos)}</p>
          <p className="panel__nota">
            {ventas.error
              ? ventas.error
              : `${completadas.length} ventas completadas · ticket medio ${dinero(ticketMedio)}`}
          </p>
        </div>

        <div className="tarjeta">
          <p className="tarjeta__titulo">Gastos</p>
          <p className="cifra-grande">—</p>
          <p className="panel__nota">
            El registro de gastos y compras todavía no guarda movimientos.
          </p>
          {onIr ? (
            <button type="button" className="boton boton--fantasma" onClick={() => onIr('gastos')}>
              Abrir gastos y compras
            </button>
          ) : null}
        </div>

        <div className="tarjeta">
          <p className="tarjeta__titulo">Utilidad estimada</p>
          <p className="cifra-grande">—</p>
          <p className="panel__nota">
            Se calcula restando el costo de lo vendido. El listado de ventas aún no trae ese costo.
          </p>
        </div>

        <div className="tarjeta">
          <p className="tarjeta__titulo">Alertas de inventario</p>
          <p className="cifra-grande">{alertas.cargando ? '…' : String(alertas.datos?.conAlerta ?? bajoMinimo.length)}</p>
          <p className="panel__nota">
            {alertas.error ? alertas.error : 'Productos por debajo del stock mínimo'}
          </p>
        </div>
      </div>

      <div className="columnas-dos">
        <div className="tarjeta">
          <p className="tarjeta__titulo">Stock bajo</p>
          {alertas.cargando ? <p className="panel__nota">Cargando…</p> : null}
          {!alertas.cargando && bajoMinimo.length === 0 ? (
            <p className="vacio">Ningún producto está por debajo de su mínimo.</p>
          ) : null}
          {bajoMinimo.map((fila) => (
            <div className="fila-dato" key={fila.productoId}>
              <span>
                {fila.nombre}
                <br />
                <span className="codigo">{fila.sku}</span>
              </span>
              <span className="numero">
                {fila.stock} / {fila.stockMinimo}
              </span>
            </div>
          ))}
          {onIr && bajoMinimo.length > 0 ? (
            <button type="button" className="boton boton--fantasma" onClick={() => onIr('inventario')}>
              Ver inventario
            </button>
          ) : null}
        </div>

        <div className="tarjeta">
          <p className="tarjeta__titulo">Transferencias en tránsito</p>
          {traslados.cargando ? <p className="panel__nota">Cargando…</p> : null}
          {traslados.error ? <p className="panel__nota">{traslados.error}</p> : null}
          {!traslados.cargando && !traslados.error && enTransito.length === 0 ? (
            <p className="vacio">No hay mercancía en camino.</p>
          ) : null}
          {enTransito.map((fila) => (
            <div className="fila-dato" key={fila.id}>
              <span>{fila.folio}</span>
              <span className="numero">{fila.lineas.length} productos</span>
            </div>
          ))}
          {onIr && enTransito.length > 0 ? (
            <button type="button" className="boton boton--fantasma" onClick={() => onIr('transferencias')}>
              Ver transferencias
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
