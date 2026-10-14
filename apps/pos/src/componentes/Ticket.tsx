import type { TotalesVenta } from '@mostrador/domain';
import type { LineaCarrito } from '../tipos';
import { cifra, dinero } from '../util/dinero';

interface Props {
  lineas: LineaCarrito[];
  totales: TotalesVenta | null;
  sucursal: string;
  vendedor: string;
  onCantidad: (productoId: string, delta: number) => void;
  onQuitar: (productoId: string) => void;
  onDescuento: (productoId: string) => void;
}

/** El ticket: papel crema, cifras alineadas a la derecha, como en la vida real. */
export function Ticket({ lineas, totales, sucursal, vendedor, onCantidad, onQuitar, onDescuento }: Props) {
  const ahora = new Date();
  const hora = ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <div className="ticket__cabecera">
        <h2 className="ticket__titulo">Ticket de venta</h2>
        <p className="ticket__meta">
          {sucursal} · {vendedor} · {hora}
        </p>
      </div>

      {lineas.length === 0 ? (
        <div className="ticket__vacio">
          <strong>El ticket esta vacio</strong>
          Busca o escanea un producto
          <br />y aparecera aqui
        </div>
      ) : (
        <ul className="lineas">
          {lineas.map((linea) => (
            <li className="linea" key={linea.producto.id}>
              <p className="linea__nombre">{linea.producto.nombre}</p>
              <span className="linea__importe">
                {dinero(linea.producto.precioVenta * linea.cantidad)}
              </span>

              <div className="linea__controles">
                <button
                  type="button"
                  className="paso"
                  onClick={() => onCantidad(linea.producto.id, -1)}
                  aria-label={`Quitar una pieza de ${linea.producto.nombre}`}
                >
                  −
                </button>
                <span className="linea__cantidad">{linea.cantidad}</span>
                <button
                  type="button"
                  className="paso"
                  onClick={() => onCantidad(linea.producto.id, 1)}
                  aria-label={`Agregar una pieza de ${linea.producto.nombre}`}
                >
                  +
                </button>
                <span className="linea__unitario">× {cifra(linea.producto.precioVenta)}</span>
                <button
                  type="button"
                  className={linea.descuentoPorcentaje > 0 ? 'descuento descuento--activo' : 'descuento'}
                  onClick={() => onDescuento(linea.producto.id)}
                  aria-label={`Descuento de ${linea.producto.nombre}`}
                >
                  {linea.descuentoPorcentaje > 0 ? `−${linea.descuentoPorcentaje}%` : 'desc.'}
                </button>
              </div>

              <button
                type="button"
                className="quitar"
                onClick={() => onQuitar(linea.producto.id)}
                style={{ justifySelf: 'end' }}
                aria-label={`Quitar ${linea.producto.nombre} del ticket`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {totales ? (
        <div className="totales">
          <div className="total-fila">
            <span>Subtotal</span>
            <span className="total-fila__valor">{cifra(totales.importeBruto)}</span>
          </div>

          {totales.descuentoTotal > 0 ? (
            <div className="total-fila total-fila--descuento">
              <span>Descuento</span>
              <span className="total-fila__valor">−{cifra(totales.descuentoTotal)}</span>
            </div>
          ) : null}

          {totales.impuestos > 0 ? (
            <div className="total-fila">
              <span>Impuesto (incluido)</span>
              <span className="total-fila__valor">{cifra(totales.impuestos)}</span>
            </div>
          ) : null}

          <div className="total-gran">
            <span className="total-gran__etiqueta">Total</span>
            <span className="total-gran__valor">{dinero(totales.total)}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
