import { useState } from 'react';
import { useConexion } from '../servicios/conexion';
import { fechaLarga, hora, dinero } from '../util/dinero';
import { Modal } from '../util/pantalla';

/**
 * Estado de la conexion, siempre a la vista.
 *
 * Cuando no hay internet dice cuantas ventas estan esperando, y deja ver la lista.
 * Si alguna fue rechazada, avisa en rojo: eso hay que revisarlo.
 */
export function IndicadorConexion() {
  const {
    enLinea,
    pendientes,
    conError,
    sincronizando,
    revisando,
    comprobar,
    sincronizar,
    descartar,
    reintentar,
  } = useConexion();

  const [abierto, setAbierto] = useState(false);

  const total = pendientes.length;
  const clase = !enLinea
    ? 'conexion conexion--sin'
    : conError > 0
      ? 'conexion conexion--error'
      : total > 0
        ? 'conexion conexion--espera'
        : 'conexion conexion--ok';

  const etiqueta = !enLinea
    ? `Sin internet${total > 0 ? ` · ${total} por subir` : ''}`
    : sincronizando
      ? `Subiendo ${total}…`
      : conError > 0
        ? `${conError} con problema`
        : total > 0
          ? `${total} por subir`
          : 'En linea';

  // Cuando todo esta subido no hay nada que enseñar: el aviso es solo informativo y
  // tocarlo no hace nada. La lista se abre solo si de verdad hay algo que revisar.
  const hayAlgoQueVer = !enLinea || total > 0 || conError > 0;

  const aviso = (
    <>
      <span className="conexion__punto" aria-hidden="true" />
      {etiqueta}
    </>
  );

  if (!hayAlgoQueVer) {
    return (
      <span className={clase} title="Todo esta subido">
        {aviso}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={clase}
        onClick={() => setAbierto(true)}
        title={revisando ? 'Revisando la conexion…' : 'Ver las ventas por subir'}
      >
        {aviso}
      </button>

      {abierto ? (
        <Modal
          titulo="Ventas guardadas en este dispositivo"
          nota={
            total === 0
              ? 'Todo esta subido. No hay nada pendiente.'
              : 'Se suben solas al recuperar internet. Si alguna fue rechazada, aparece en rojo con el motivo.'
          }
          onCerrar={() => setAbierto(false)}
        >
          <div className="barra-filtros" style={{ marginBottom: '0.8rem' }}>
            <button type="button" className="boton" onClick={() => void comprobar()}>
              {revisando ? 'Revisando…' : 'Revisar ahora'}
            </button>
            {total > 0 ? (
              <button type="button" className="boton boton--acento" onClick={() => void sincronizar()} disabled={sincronizando}>
                {sincronizando ? 'Subiendo…' : 'Subir ahora'}
              </button>
            ) : null}
          </div>

          {total === 0 ? (
            <p className="vacio">No hay ventas pendientes.</p>
          ) : (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Cuando</th>
                    <th className="numero">Total</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((venta) => (
                    <tr key={venta.id}>
                      <td className="codigo">{venta.folio}</td>
                      <td>
                        {fechaLarga(venta.vendidoEn)} {hora(venta.vendidoEn)}
                      </td>
                      <td className="numero">{dinero(venta.venta.total)}</td>
                      <td>
                        {venta.error ? (
                          <span className="insignia insignia--agotado" title={venta.error}>
                            Rechazada
                          </span>
                        ) : (
                          <span className="insignia insignia--baja">Por subir</span>
                        )}
                      </td>
                      <td>
                        <div className="acciones-fila">
                          {venta.error ? (
                            <>
                              <button type="button" className="boton" onClick={() => reintentar(venta.id)}>
                                Reintentar
                              </button>
                              <button type="button" className="boton" onClick={() => descartar(venta.id)}>
                                Descartar
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {conError > 0 ? (
            <p className="aviso" style={{ marginTop: '0.9rem' }}>
              Hay {conError} venta(s) que el servidor rechazo. Mira el motivo poniendo el cursor
              sobre la insignia roja. Lo mas probable es que ya no hubiera existencia suficiente;
              se resuelve ajustando el inventario o descartando la venta.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
