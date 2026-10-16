import { useState } from 'react';
import { api } from '../api/cliente';
import type { FilaStock, Movimiento, Sesion, TipoMovimiento } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { aCentavos, dinero, fechaLarga } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
}

const TIPOS: { valor: TipoMovimiento; etiqueta: string }[] = [
  { valor: 'entrada_compra', etiqueta: 'Entrada por compra' },
  { valor: 'merma', etiqueta: 'Merma (se perdio o se rompio)' },
  { valor: 'ajuste_positivo', etiqueta: 'Ajuste que suma' },
  { valor: 'ajuste_negativo', etiqueta: 'Ajuste que resta' },
  { valor: 'devolucion_proveedor', etiqueta: 'Devolucion a proveedor' },
  { valor: 'inventario_inicial', etiqueta: 'Inventario inicial' },
];

const ETIQUETA_TIPO: Record<string, string> = {
  inventario_inicial: 'Inventario inicial',
  entrada_compra: 'Entrada por compra',
  salida_venta: 'Venta',
  devolucion_cliente: 'Devolucion de cliente',
  devolucion_proveedor: 'Devolucion a proveedor',
  ajuste_positivo: 'Ajuste que suma',
  ajuste_negativo: 'Ajuste que resta',
  merma: 'Merma',
  transferencia_entrada: 'Entrada por transferencia',
  transferencia_salida: 'Salida por transferencia',
};

const RESTAN = new Set([
  'salida_venta',
  'devolucion_proveedor',
  'ajuste_negativo',
  'merma',
  'transferencia_salida',
]);

interface FormularioMovimiento {
  producto: FilaStock;
  tipo: TipoMovimiento;
  cantidad: string;
  costo: string;
  motivo: string;
}

export function Inventario({ sesion, sucursalId }: Props) {
  const [buscar, setBuscar] = useState('');
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);
  const [formulario, setFormulario] = useState<FormularioMovimiento | null>(null);
  const [kardex, setKardex] = useState<FilaStock | null>(null);
  const [transferencia, setTransferencia] = useState<{ producto: FilaStock; cantidad: string; destinoId: string; motivo: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const puedeMover = sesion.permisos.includes('inventory.adjust');
  const puedeTransferir = sesion.permisos.includes('inventory.transfer');

  const { datos, cargando, error: errorLista, recargar } = useCarga(
    () => api.stock(sucursalId, buscar, soloBajoMinimo),
    [sucursalId, buscar, soloBajoMinimo],
  );

  const { datos: datosKardex, cargando: cargandoKardex } = useCarga(
    () => (kardex ? api.movimientos({ productoId: kardex.productoId, limite: 60 }) : Promise.resolve({ movimientos: [] as Movimiento[] })),
    [kardex],
  );

  const filas = datos?.stock ?? [];
  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);

  function cerrarConMensaje(texto: string): void {
    setOk(texto);
    setFormulario(null);
    setTransferencia(null);
    window.setTimeout(() => setOk(null), 4000);
  }

  async function registrarMovimiento(): Promise<void> {
    if (!formulario) {
      return;
    }

    const cantidad = Number(formulario.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setError('La cantidad debe ser un numero entero mayor a cero');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.registrarMovimiento({
        sucursalId,
        productoId: formulario.producto.productoId,
        tipo: formulario.tipo,
        cantidad,
        ...(formulario.costo.trim() ? { costoUnitario: aCentavos(formulario.costo) } : {}),
        ...(formulario.motivo.trim() ? { motivo: formulario.motivo.trim() } : {}),
      });

      await recargar();
      cerrarConMensaje(`Movimiento registrado: ${ETIQUETA_TIPO[formulario.tipo] ?? formulario.tipo}`);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function transferir(): Promise<void> {
    if (!transferencia) {
      return;
    }

    const cantidad = Number(transferencia.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      setError('La cantidad debe ser un numero entero mayor a cero');
      return;
    }
    if (!transferencia.destinoId) {
      setError('Elige la sucursal de destino');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.transferir({
        origenSucursalId: sucursalId,
        destinoSucursalId: transferencia.destinoId,
        ...(transferencia.motivo.trim() ? { motivo: transferencia.motivo.trim() } : {}),
        lineas: [{ productoId: transferencia.producto.productoId, cantidad }],
      });

      await recargar();
      cerrarConMensaje('Transferencia registrada');
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  function claseStock(fila: FilaStock): string {
    if (fila.stock <= 0) {
      return 'insignia insignia--agotado';
    }
    return fila.bajoMinimo ? 'insignia insignia--baja' : 'insignia insignia--ok';
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Inventario</h1>
          <p className="panel__nota">
            Sucursal {sucursal?.codigo ?? '—'} · {datos?.conAlerta ?? 0} productos por debajo del minimo
          </p>
        </div>

        <label className="opcion-casilla">
          <input
            type="checkbox"
            checked={soloBajoMinimo}
            onChange={(evento) => setSoloBajoMinimo(evento.target.checked)}
          />
          Solo los que estan bajo el minimo
        </label>
      </div>

      <div className="barra-filtros">
        <input
          className="entrada"
          style={{ maxWidth: '22rem' }}
          placeholder="Buscar producto"
          value={buscar}
          onChange={(evento) => setBuscar(evento.target.value)}
        />
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && filas.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">
            {soloBajoMinimo
              ? 'Ningun producto esta por debajo de su minimo. Todo en orden.'
              : 'No hay productos que coincidan.'}
          </p>
        </div>
      ) : null}

      {filas.length > 0 ? (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th className="numero">Stock</th>
                <th className="numero">Minimo</th>
                <th className="numero">Venta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.productoId}>
                  <td className="numero" style={{ textAlign: 'left' }}>
                    {fila.sku}
                  </td>
                  <td>{fila.nombre}</td>
                  <td className="numero">
                    <span className={claseStock(fila)}>{fila.stock}</span>
                  </td>
                  <td className="numero">{fila.stockMinimo}</td>
                  <td className="numero">{dinero(fila.precioVenta)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button type="button" className="boton" onClick={() => setKardex(fila)}>
                        Kardex
                      </button>
                      {puedeMover ? (
                        <button
                          type="button"
                          className="boton"
                          onClick={() => {
                            setError(null);
                            setFormulario({
                              producto: fila,
                              tipo: 'entrada_compra',
                              cantidad: '',
                              costo: '',
                              motivo: '',
                            });
                          }}
                        >
                          Movimiento
                        </button>
                      ) : null}
                      {puedeTransferir && sesion.sucursales.length > 1 ? (
                        <button
                          type="button"
                          className="boton"
                          onClick={() => {
                            setError(null);
                            setTransferencia({ producto: fila, cantidad: '', destinoId: '', motivo: '' });
                          }}
                        >
                          Transferir
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {formulario ? (
        <Modal
          titulo="Registrar movimiento"
          nota={`${formulario.producto.sku} · ${formulario.producto.nombre} · hay ${formulario.producto.stock}`}
          onCerrar={() => setFormulario(null)}
        >
          <div className="formulario">
            <label className="campo-ancho campo-ancho--ancho">
              <span>Tipo de movimiento</span>
              <select
                className="entrada"
                value={formulario.tipo}
                onChange={(evento) => setFormulario({ ...formulario, tipo: evento.target.value as TipoMovimiento })}
              >
                {TIPOS.map((tipo) => (
                  <option key={tipo.valor} value={tipo.valor}>
                    {tipo.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Cantidad</span>
              <input
                className="entrada entrada--numero"
                inputMode="numeric"
                value={formulario.cantidad}
                onChange={(evento) => setFormulario({ ...formulario, cantidad: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Costo unitario (opcional)</span>
              <input
                className="entrada entrada--numero"
                inputMode="decimal"
                placeholder="Como en la factura"
                value={formulario.costo}
                onChange={(evento) => setFormulario({ ...formulario, costo: evento.target.value })}
              />
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>Motivo (queda en el kardex)</span>
              <input
                className="entrada"
                placeholder="Ej. Compra a proveedor, producto vencido, conteo fisico"
                value={formulario.motivo}
                onChange={(evento) => setFormulario({ ...formulario, motivo: evento.target.value })}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setFormulario(null)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--acento" onClick={() => void registrarMovimiento()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {transferencia ? (
        <Modal
          titulo="Transferir a otra sucursal"
          nota={`${transferencia.producto.sku} · ${transferencia.producto.nombre} · hay ${transferencia.producto.stock}`}
          onCerrar={() => setTransferencia(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Cantidad</span>
              <input
                className="entrada entrada--numero"
                inputMode="numeric"
                value={transferencia.cantidad}
                onChange={(evento) => setTransferencia({ ...transferencia, cantidad: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Sucursal destino</span>
              <select
                className="entrada"
                value={transferencia.destinoId}
                onChange={(evento) => setTransferencia({ ...transferencia, destinoId: evento.target.value })}
              >
                <option value="">Elige…</option>
                {sesion.sucursales
                  .filter((opcion) => opcion.id !== sucursalId)
                  .map((opcion) => (
                    <option key={opcion.id} value={opcion.id}>
                      {opcion.codigo} · {opcion.nombre}
                    </option>
                  ))}
              </select>
            </label>

            <label className="campo-ancho campo-ancho--ancho">
              <span>Motivo</span>
              <input
                className="entrada"
                value={transferencia.motivo}
                onChange={(evento) => setTransferencia({ ...transferencia, motivo: evento.target.value })}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setTransferencia(null)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--acento" onClick={() => void transferir()} disabled={guardando}>
              {guardando ? 'Transfiriendo…' : 'Transferir'}
            </button>
          </div>
        </Modal>
      ) : null}

      {kardex ? (
        <Modal
          titulo="Kardex"
          nota={`${kardex.sku} · ${kardex.nombre} · la historia no se borra nunca`}
          onCerrar={() => setKardex(null)}
        >
          {cargandoKardex ? <p className="panel__nota">Cargando…</p> : null}

          {(datosKardex?.movimientos ?? []).length === 0 && !cargandoKardex ? (
            <p className="vacio">Este producto todavia no tiene movimientos.</p>
          ) : null}

          {(datosKardex?.movimientos ?? []).length > 0 ? (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cuando</th>
                    <th>Movimiento</th>
                    <th className="numero">Cantidad</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {(datosKardex?.movimientos ?? []).map((movimiento) => (
                    <tr key={movimiento.id}>
                      <td>{fechaLarga(movimiento.ocurridoEn)}</td>
                      <td>{ETIQUETA_TIPO[movimiento.tipo] ?? movimiento.tipo}</td>
                      <td className="numero">
                        {RESTAN.has(movimiento.tipo) ? `−${movimiento.cantidad}` : `+${movimiento.cantidad}`}
                      </td>
                      <td>{movimiento.motivo ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
