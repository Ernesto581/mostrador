import type { VentaRespuesta } from '../api/tipos';
import { fechaLarga, dinero } from '../util/dinero';

interface Props {
  venta: VentaRespuesta;
  sucursal: string;
  vendedor: string;
  onNuevaVenta: () => void;
}

const ETIQUETAS = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
} as const;

export function Comprobante({ venta, sucursal, vendedor, onNuevaVenta }: Props) {
  const cambio = venta.cambio;

  return (
    <div className="velo" role="dialog" aria-modal="true" aria-label="Comprobante de venta">
      <div className="comprobante">
        <div className="sello">Pagado</div>

        <div className="ticket">
          <div className="ticket__borde" />
          <div className="ticket__cuerpo">
            <div className="ticket__cabecera">
              <h2 className="ticket__titulo">Comprobante</h2>
              <p className="ticket__meta">
                {venta.folio}
                <br />
                {sucursal} · {vendedor}
                <br />
                {fechaLarga(venta.vendidoEn)}
              </p>
            </div>

            <ul className="lineas">
              {venta.lineas.map((linea) => (
                <li className="linea" key={linea.productoId}>
                  <p className="linea__nombre">
                    {linea.nombre}
                    {linea.cantidad > 1 ? <span className="linea__unitario"> × {linea.cantidad}</span> : null}
                  </p>
                  <span className="linea__importe">{dinero(linea.total)}</span>
                </li>
              ))}
            </ul>

            <div className="totales">
              <div className="total-fila">
                <span>Articulos</span>
                <span className="total-fila__valor">{venta.articulos}</span>
              </div>
              {venta.descuentoTotal > 0 ? (
                <div className="total-fila total-fila--descuento">
                  <span>Descuento</span>
                  <span className="total-fila__valor">−{dinero(venta.descuentoTotal)}</span>
                </div>
              ) : null}
              {venta.impuestos > 0 ? (
                <div className="total-fila">
                  <span>Impuesto (incluido)</span>
                  <span className="total-fila__valor">{dinero(venta.impuestos)}</span>
                </div>
              ) : null}
              <div className="total-gran">
                <span className="total-gran__etiqueta">Total</span>
                <span className="total-gran__valor">{dinero(venta.total)}</span>
              </div>
            </div>

            <div className="totales" style={{ borderTop: 'none', paddingTop: '0.6rem' }}>
              {venta.pagos.map((pago, indice) => (
                <div className="total-fila" key={`${pago.metodo}-${indice}`}>
                  <span>{ETIQUETAS[pago.metodo]}</span>
                  <span className="total-fila__valor">{dinero(pago.monto)}</span>
                </div>
              ))}
              {cambio > 0 ? (
                <div className="total-fila">
                  <span>Cambio entregado</span>
                  <span className="total-fila__valor">{dinero(cambio)}</span>
                </div>
              ) : null}
            </div>

            {venta.advertencias.length > 0 ? (
              <div className="advertencias">
                <strong>Revisa el inventario</strong>
                {venta.advertencias.join(' · ')}
              </div>
            ) : null}

            <div className="acciones-comprobante">
              <button type="button" className="boton boton--acento" onClick={onNuevaVenta} autoFocus>
                Nueva venta
              </button>
            </div>
          </div>
          <div className="ticket__borde ticket__borde--abajo" />
        </div>
      </div>
    </div>
  );
}
