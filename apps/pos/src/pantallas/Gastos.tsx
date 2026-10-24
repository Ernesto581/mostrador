/**
 * Sección de gastos y compras.
 *
 * El menú ya existe. El servidor todavía no expone proveedores, facturas ni
 * gastos, así que aquí no se simula un registro que no se guardaría.
 */
export function Gastos() {
  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Gastos y compras</h1>
          <p className="panel__nota">
            Registro de gastos, compras a proveedores y cuentas asociadas.
          </p>
        </div>
      </div>

      <div className="rejilla-tarjetas">
        <article className="tarjeta">
          <p className="tarjeta__titulo">Gastos</p>
          <p className="panel__nota">
            Alquiler, electricidad, transporte, salarios, reparaciones y otras salidas,
            con fecha, importe, local y método de pago.
          </p>
        </article>
        <article className="tarjeta">
          <p className="tarjeta__titulo">Compras a proveedores</p>
          <p className="panel__nota">
            Pedidos y recepciones. El inventario sube cuando la mercancía entra a una
            ubicación, no cuando se hace el pedido.
          </p>
        </article>
        <article className="tarjeta">
          <p className="tarjeta__titulo">Cuentas asociadas</p>
          <p className="panel__nota">
            Lo pagado, lo pendiente y la deuda con cada proveedor, separados de las ventas
            y de la utilidad.
          </p>
        </article>
      </div>

      <div className="tarjeta">
        <p className="vacio">
          Esta sección ya está en el panel.
          <br />
          El registro todavía no está conectado al servidor, así que aquí no se guardan gastos ni compras.
        </p>
      </div>
    </div>
  );
}
