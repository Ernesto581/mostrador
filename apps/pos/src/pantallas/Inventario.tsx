import { useState } from 'react';
import { api } from '../api/cliente';
import type { Movimiento, RepartoSucursal, Sesion, TipoMovimiento } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';
import { aCentavos, dinero, fechaLarga } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
}

/** Fila tal como se pinta: sirve tanto para la vista general como para una sucursal. */
interface FilaVista {
  productoId: string;
  sku: string;
  nombre: string;
  precioVenta: number;
  stock: number;
  stockMinimo: number;
  bajoMinimo: boolean;
  reparto?: RepartoSucursal[];
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
  fila: FilaVista;
  sucursalId: string;
  tipo: TipoMovimiento;
  cantidad: string;
  costo: string;
  motivo: string;
}

interface FormularioTransferencia {
  fila: FilaVista;
  origenSucursalId: string;
  destinoSucursalId: string;
  cantidad: string;
  motivo: string;
}

export function Inventario({ sesion, sucursalId }: Props) {
  const [general, setGeneral] = useState(true);
  const [buscar, setBuscar] = useState('');
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);
  const [formulario, setFormulario] = useState<FormularioMovimiento | null>(null);
  const [transferencia, setTransferencia] = useState<FormularioTransferencia | null>(null);
  const [kardex, setKardex] = useState<FilaVista | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const puedeMover = sesion.permisos.includes('inventory.adjust');
  const puedeTransferir = sesion.permisos.includes('inventory.transfer') && sesion.sucursales.length > 1;

  const { datos, cargando, error: errorLista, recargar } = useCarga(async () => {
    if (general) {
      const respuesta = await api.stockGeneral(buscar, soloBajoMinimo);
      return { conAlerta: respuesta.conAlerta, filas: respuesta.stock as FilaVista[] };
    }
    const respuesta = await api.stock(sucursalId, buscar, soloBajoMinimo);
    return { conAlerta: respuesta.conAlerta, filas: respuesta.stock as FilaVista[] };
  }, [general, buscar, soloBajoMinimo, sucursalId]);

  const { datos: datosKardex, cargando: cargandoKardex } = useCarga(
    () =>
      kardex
        ? api.movimientos({ productoId: kardex.productoId, limite: 60 })
        : Promise.resolve({ movimientos: [] as Movimiento[] }),
    [kardex],
  );

  const filas = datos?.filas ?? [];
  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);

  function cerrarConMensaje(texto: string): void {
    setOk(texto);
    setFormulario(null);
    setTransferencia(null);
    window.setTimeout(() => setOk(null), 4500);
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
    if (!formulario.sucursalId) {
      setError('Elige la sucursal donde entra o sale el producto');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.registrarMovimiento({
        sucursalId: formulario.sucursalId,
        productoId: formulario.fila.productoId,
        tipo: formulario.tipo,
        cantidad,
        ...(formulario.costo.trim() ? { costoUnitario: aCentavos(formulario.costo) } : {}),
        ...(formulario.motivo.trim() ? { motivo: formulario.motivo.trim() } : {}),
      });

      await recargar();
      const destino = sesion.sucursales.find((opcion) => opcion.id === formulario.sucursalId);
      cerrarConMensaje(
        `${ETIQUETA_TIPO[formulario.tipo] ?? formulario.tipo}: ${cantidad} en ${destino?.codigo ?? ''}`,
      );
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
    if (!transferencia.destinoSucursalId) {
      setError('Elige la sucursal de destino');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.transferir({
        origenSucursalId: transferencia.origenSucursalId,
        destinoSucursalId: transferencia.destinoSucursalId,
        ...(transferencia.motivo.trim() ? { motivo: transferencia.motivo.trim() } : {}),
        lineas: [{ productoId: transferencia.fila.productoId, cantidad }],
      });

      await recargar();
      cerrarConMensaje('Transferencia registrada');
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  function claseStock(fila: FilaVista): string {
    if (fila.stock <= 0) {
      return 'insignia insignia--agotado';
    }
    return fila.bajoMinimo ? 'insignia insignia--baja' : 'insignia insignia--ok';
  }

  function repartoDe(fila: FilaVista): string {
    if (!fila.reparto || fila.reparto.length === 0) {
      return '—';
    }
    return fila.reparto.map((parte) => `${parte.codigo} ${parte.cantidad}`).join(' · ');
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Inventario</h1>
          <p className="panel__nota">
            {general ? 'Todas las sucursales' : `Sucursal ${sucursal?.codigo ?? '—'}`} ·{' '}
            {datos?.conAlerta ?? 0} productos por debajo del minimo
          </p>
        </div>

        <div className="barra-filtros">
          <div className="pestanas">
            <button
              type="button"
              className={general ? 'pestana pestana--activa' : 'pestana'}
              onClick={() => setGeneral(true)}
            >
              General
            </button>
            <button
              type="button"
              className={general ? 'pestana' : 'pestana pestana--activa'}
              onClick={() => setGeneral(false)}
            >
              {sucursal?.codigo ?? 'Sucursal'}
            </button>
          </div>

          <label className="opcion-casilla">
            <input
              type="checkbox"
              checked={soloBajoMinimo}
              onChange={(evento) => setSoloBajoMinimo(evento.target.checked)}
            />
            Solo bajo el minimo
          </label>
        </div>
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
                <th className="numero">Total</th>
                {general ? <th>Reparto por sucursal</th> : null}
                <th className="numero">Minimo</th>
                <th className="numero">Venta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.productoId}>
                  <td className="codigo">{fila.sku}</td>
                  <td>{fila.nombre}</td>
                  <td className="numero">
                    <span className={claseStock(fila)}>{fila.stock}</span>
                  </td>
                  {general ? <td className="reparto">{repartoDe(fila)}</td> : null}
                  <td className="numero">{fila.stockMinimo}</td>
                  <td className="numero">{dinero(fila.precioVenta)}</td>
                  <td>
                    <div className="acciones-fila">
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
                              fila,
                              sucursalId,
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
                      {puedeTransferir ? (
                        <button
                          type="button"
                          className="boton"
                          onClick={() => {
                            setError(null);
                            setTransferencia({
                              fila,
                              origenSucursalId: sucursalId,
                              destinoSucursalId: '',
                              cantidad: '',
                              motivo: '',
                            });
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
          nota={`${formulario.fila.sku} · ${formulario.fila.nombre} · hay ${formulario.fila.stock} en total`}
          onCerrar={() => setFormulario(null)}
        >
          <div className="formulario">
            <label className="campo-ancho campo-ancho--ancho">
              <span>Tipo de movimiento</span>
              <select
                className="entrada"
                value={formulario.tipo}
                onChange={(evento) =>
                  setFormulario({ ...formulario, tipo: evento.target.value as TipoMovimiento })
                }
              >
                {TIPOS.map((tipo) => (
                  <option key={tipo.valor} value={tipo.valor}>
                    {tipo.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Sucursal</span>
              <select
                className="entrada"
                value={formulario.sucursalId}
                onChange={(evento) => setFormulario({ ...formulario, sucursalId: evento.target.value })}
              >
                {sesion.sucursales.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.codigo} · {opcion.nombre}
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

      {transferencia ? (
        <Modal
          titulo="Transferir a otra sucursal"
          nota={`${transferencia.fila.sku} · ${transferencia.fila.nombre} · hay ${transferencia.fila.stock} en total`}
          onCerrar={() => setTransferencia(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Desde</span>
              <select
                className="entrada"
                value={transferencia.origenSucursalId}
                onChange={(evento) =>
                  setTransferencia({ ...transferencia, origenSucursalId: evento.target.value })
                }
              >
                {sesion.sucursales.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.codigo} · {opcion.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="campo-ancho">
              <span>Hacia</span>
              <select
                className="entrada"
                value={transferencia.destinoSucursalId}
                onChange={(evento) =>
                  setTransferencia({ ...transferencia, destinoSucursalId: evento.target.value })
                }
              >
                <option value="">Elige…</option>
                {sesion.sucursales
                  .filter((opcion) => opcion.id !== transferencia.origenSucursalId)
                  .map((opcion) => (
                    <option key={opcion.id} value={opcion.id}>
                      {opcion.codigo} · {opcion.nombre}
                    </option>
                  ))}
              </select>
            </label>

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
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void transferir()}
              disabled={guardando}
            >
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
                        {RESTAN.has(movimiento.tipo)
                          ? `−${movimiento.cantidad}`
                          : `+${movimiento.cantidad}`}
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
