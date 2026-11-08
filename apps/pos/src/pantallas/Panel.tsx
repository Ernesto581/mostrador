import { api } from '../api/cliente';
import type { Sesion } from '../api/tipos';
import { useCarga } from '../util/pantalla';
import { dinero } from '../util/dinero';

interface Props {
  sesion: Sesion;
  onIr?: (seccion: 'inventario' | 'informes' | 'movimientos') => void;
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
 * Ventas, compras, gastos y utilidad salen del reporte del servidor. Las alertas
 * y los traslados se consultan aparte para no mezclar peras con manzanas.
 */
export function Panel({ sesion, onIr }: Props) {
  const { desde, hasta } = rangoDeHoy();
  const reporte = useCarga(
    () => api.reporteResumen({ desde, hasta, por: 'importe' }),
    [],
  );
  const alertas = useCarga(() => api.stockGeneral({ soloBajoMinimo: true, limite: 8 }), []);
  const traslados = useCarga(() => api.transferencias({ estado: 'en_transito', limite: 20 }), []);

  const resumen = reporte.datos?.resumen;
  const reporteListo = !reporte.cargando && !reporte.error;
  const tickets = resumen?.tickets ?? 0;
  const ingresos = resumen?.ventaBruta ?? 0;
  const ticketMedio = resumen?.ticketPromedio ?? 0;
  const bajoMinimo = alertas.datos?.stock ?? [];
  const enTransito = traslados.datos?.transferencias ?? [];
  const margen = Math.round((resumen?.margen ?? 0) * 1000) / 10;

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Panel</h1>
          <p className="panel__nota">
            Resumen de ventas, compras, gastos, utilidad y alertas de inventario.
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
          <p className="cifra-grande">{reporteListo ? dinero(ingresos) : '—'}</p>
          <p className="panel__nota">
            {reporte.error
              ? reporte.error
              : reporte.cargando
                ? 'Cargando…'
                : `${tickets} ventas completadas · ticket medio ${dinero(ticketMedio)}`}
          </p>
        </div>

        <div className="tarjeta">
          <p className="tarjeta__titulo">Compras de mercancia</p>
          <p className="cifra-grande">{reporteListo ? dinero(resumen?.compras ?? 0) : '—'}</p>
          <p className="panel__nota">Entradas de inventario con su costo.</p>
        </div>

        <div className="tarjeta">
          <p className="tarjeta__titulo">Gastos</p>
          <p className="cifra-grande">{reporteListo ? dinero(resumen?.gastos ?? 0) : '—'}</p>
          <p className="panel__nota">Gastos pagados de caja y gastos registrados.</p>
        </div>

        <div className="tarjeta">
          <p className="tarjeta__titulo">Utilidad bruta</p>
          <p className="cifra-grande">{reporteListo ? dinero(resumen?.utilidad ?? 0) : '—'}</p>
          <p className="panel__nota">
            {reporteListo
              ? `Despues de gastos: ${dinero(resumen?.utilidadNeta ?? 0)} · margen ${margen}%`
              : 'No se pudo cargar el resumen del dia.'}
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

      {reporte.datos && reporte.datos.porSucursal.length > 0 ? (
        <div className="tarjeta">
          <p className="tarjeta__titulo">Ventas por sucursal</p>
          {reporte.datos.porSucursal.map((fila) => (
            <div className="fila-dato" key={fila.sucursalId}>
              <span>
                {fila.codigo} · {fila.nombre}
                <br />
                <span className="panel__nota">{fila.tickets} ventas</span>
              </span>
              <span className="numero">{dinero(fila.ventaBruta)}</span>
            </div>
          ))}
        </div>
      ) : null}

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
                {fila.reparto.some((parte) => parte.bajoMinimo)
                  ? fila.reparto
                      .filter((parte) => parte.bajoMinimo)
                      .map((parte) => `${parte.codigo} ${parte.cantidad}/${parte.minimo}`)
                      .join(' · ')
                  : `${fila.stock} / ${fila.stockMinimo}`}
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
          <p className="tarjeta__titulo">Traslados en tránsito</p>
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
            <button type="button" className="boton boton--fantasma" onClick={() => onIr('movimientos')}>
              Ver movimientos
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
