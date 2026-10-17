import { useState } from 'react';
import { api } from '../api/cliente';
import type { SucursalDelPanel } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';

/**
 * Sucursales.
 *
 * Aqui el administrador da de alta las tiendas o bodegas y las quita. Quitar una
 * sucursal no borra su historia: las ventas, los turnos y el kardex siguen guardados.
 */

interface Borrador {
  id: string | null;
  codigo: string;
  nombre: string;
  tipo: 'tienda' | 'almacen';
  direccion: string;
  telefono: string;
}

const BORRADOR_VACIO: Borrador = {
  id: null,
  codigo: '',
  nombre: '',
  tipo: 'tienda',
  direccion: '',
  telefono: '',
};

export function Sucursales() {
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [porQuitar, setPorQuitar] = useState<SucursalDelPanel | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { datos, cargando, error: errorLista, recargar } = useCarga(() => api.sucursales(), []);
  const sucursales = datos?.sucursales ?? [];

  function terminarCon(texto: string): void {
    setOk(texto);
    setBorrador(null);
    setPorQuitar(null);
    window.setTimeout(() => setOk(null), 6000);
  }

  async function guardar(): Promise<void> {
    if (!borrador) {
      return;
    }

    if (!borrador.id && borrador.codigo.trim().length === 0) {
      setError('Escribe el codigo de la sucursal');
      return;
    }
    if (borrador.nombre.trim().length === 0) {
      setError('Escribe el nombre de la sucursal');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      if (borrador.id) {
        await api.editarSucursal(borrador.id, {
          nombre: borrador.nombre.trim(),
          tipo: borrador.tipo,
          ...(borrador.direccion.trim() ? { direccion: borrador.direccion.trim() } : {}),
          ...(borrador.telefono.trim() ? { telefono: borrador.telefono.trim() } : {}),
        });
        terminarCon('Sucursal actualizada.');
      } else {
        const creada = await api.crearSucursal({
          codigo: borrador.codigo.trim().toUpperCase(),
          nombre: borrador.nombre.trim(),
          tipo: borrador.tipo,
          ...(borrador.direccion.trim() ? { direccion: borrador.direccion.trim() } : {}),
          ...(borrador.telefono.trim() ? { telefono: borrador.telefono.trim() } : {}),
        });
        // El selector de sucursal del sistema se arma al entrar, por eso el aviso.
        terminarCon(
          `Se agrego la sucursal ${creada.sucursal.codigo}. Cierra sesion y vuelve a entrar para verla en el selector.`,
        );
      }

      await recargar();
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(): Promise<void> {
    if (!porQuitar) {
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.quitarSucursal(porQuitar.id);
      await recargar();
      terminarCon(`Se quito ${porQuitar.codigo}. Su historial de ventas y turnos se conserva.`);
    } catch (fallo) {
      setError(mensajeDe(fallo));
      setPorQuitar(null);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Sucursales</h1>
          <p className="panel__nota">
            Las tiendas y bodegas de la empresa. Cada una lleva su propio inventario.
          </p>
        </div>

        <button
          type="button"
          className="boton boton--acento"
          onClick={() => {
            setError(null);
            setBorrador({ ...BORRADOR_VACIO });
          }}
        >
          Nueva sucursal
        </button>
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && sucursales.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">Todavia no hay sucursales.</p>
        </div>
      ) : null}

      {sucursales.length > 0 ? (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Direccion</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sucursales.map((sucursal) => (
                <tr key={sucursal.id}>
                  <td className="codigo">{sucursal.codigo}</td>
                  <td>{sucursal.nombre}</td>
                  <td>{sucursal.tipo === 'almacen' ? 'Bodega' : 'Tienda'}</td>
                  <td>{sucursal.direccion ?? '—'}</td>
                  <td>
                    <span className={sucursal.activa ? 'insignia insignia--ok' : 'insignia insignia--agotado'}>
                      {sucursal.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td>
                    <div className="acciones-fila">
                      <button
                        type="button"
                        className="boton"
                        onClick={() => {
                          setError(null);
                          setBorrador({
                            id: sucursal.id,
                            codigo: sucursal.codigo,
                            nombre: sucursal.nombre,
                            tipo: sucursal.tipo === 'almacen' ? 'almacen' : 'tienda',
                            direccion: sucursal.direccion ?? '',
                            telefono: sucursal.telefono ?? '',
                          });
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="boton"
                        onClick={() => {
                          setError(null);
                          setPorQuitar(sucursal);
                        }}
                      >
                        Quitar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {borrador ? (
        <Modal
          titulo={borrador.id ? `Editar ${borrador.codigo}` : 'Nueva sucursal'}
          nota={
            borrador.id
              ? 'El codigo no se cambia: va dentro de los folios de las ventas.'
              : 'El codigo va dentro de los folios (por ejemplo SUC1-20260117-0001): usa letras, numeros o guiones.'
          }
          onCerrar={() => setBorrador(null)}
        >
          <div className="formulario">
            {!borrador.id ? (
              <label className="campo-ancho">
                <span>Codigo</span>
                <input
                  className="entrada"
                  placeholder="SUC1"
                  value={borrador.codigo}
                  onChange={(evento) => setBorrador({ ...borrador, codigo: evento.target.value })}
                />
              </label>
            ) : null}

            <label className="campo-ancho">
              <span>Nombre</span>
              <input
                className="entrada"
                placeholder="Sucursal Centro"
                value={borrador.nombre}
                onChange={(evento) => setBorrador({ ...borrador, nombre: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Tipo</span>
              <select
                className="entrada"
                value={borrador.tipo}
                onChange={(evento) =>
                  setBorrador({ ...borrador, tipo: evento.target.value as 'tienda' | 'almacen' })
                }
              >
                <option value="tienda">Tienda (vende al publico)</option>
                <option value="almacen">Bodega (solo guarda)</option>
              </select>
            </label>

            <label className="campo-ancho">
              <span>Direccion (opcional)</span>
              <input
                className="entrada"
                value={borrador.direccion}
                onChange={(evento) => setBorrador({ ...borrador, direccion: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Telefono (opcional)</span>
              <input
                className="entrada"
                value={borrador.telefono}
                onChange={(evento) => setBorrador({ ...borrador, telefono: evento.target.value })}
              />
            </label>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setBorrador(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void guardar()}
              disabled={guardando}
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {porQuitar ? (
        <Modal
          titulo={`Quitar ${porQuitar.codigo}`}
          nota="Deja de aparecer en el sistema. Las ventas, los turnos y el kardex de esa sucursal se conservan."
          onCerrar={() => setPorQuitar(null)}
        >
          <p className="panel__nota">
            ¿Seguro que quieres quitar <strong>{porQuitar.nombre}</strong>?
          </p>
          <p className="panel__nota">
            Si todavia tiene mercancia en existencia, el sistema no la dejara quitar: primero mueve
            esas piezas a otra sucursal.
          </p>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setPorQuitar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void quitar()}
              disabled={guardando}
            >
              {guardando ? 'Quitando…' : 'Si, quitarla'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
