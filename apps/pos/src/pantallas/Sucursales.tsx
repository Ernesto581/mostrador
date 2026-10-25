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

interface HorarioDia {
  desde: string;
  hasta: string;
  activo: boolean;
}

interface Borrador {
  id: string | null;
  codigo: string;
  nombre: string;
  descripcion: string;
  tipoNegocio: string;
  fotoUrl: string;
  tipo: 'tienda' | 'almacen';
  direccion: string;
  provincia: string;
  municipio: string;
  telefono: string;
  whatsapp: string;
  lat: string;
  lng: string;
  ventaDesdeAlmacen: boolean;
  horarios: Record<string, HorarioDia>;
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

const HORARIOS_VACIOS: Record<string, HorarioDia> = Object.fromEntries(
  DIAS.map((d) => [d, { desde: '09:00', hasta: '18:00', activo: true }]),
);

const BORRADOR_VACIO: Borrador = {
  id: null,
  codigo: '',
  nombre: '',
  descripcion: '',
  tipoNegocio: 'tienda',
  fotoUrl: '',
  tipo: 'tienda',
  direccion: '',
  provincia: '',
  municipio: '',
  telefono: '',
  whatsapp: '',
  lat: '',
  lng: '',
  ventaDesdeAlmacen: false,
  horarios: { ...HORARIOS_VACIOS },
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
          ventaDesdeAlmacen: borrador.tipo === 'tienda' && borrador.ventaDesdeAlmacen,
          descripcion: borrador.descripcion.trim(),
          tipoNegocio: borrador.tipoNegocio,
          ...(borrador.fotoUrl.trim() ? { fotoUrl: borrador.fotoUrl.trim() } : {}),
          ...(borrador.provincia.trim() ? { provincia: borrador.provincia.trim() } : {}),
          ...(borrador.municipio.trim() ? { municipio: borrador.municipio.trim() } : {}),
          ...(borrador.whatsapp.trim() ? { whatsapp: borrador.whatsapp.trim() } : {}),
          ...(borrador.lat.trim() ? { lat: Number(borrador.lat) } : {}),
          ...(borrador.lng.trim() ? { lng: Number(borrador.lng) } : {}),
          horarios: borrador.horarios,
        });
        terminarCon('Sucursal actualizada.');
      } else {
        const creada = await api.crearSucursal({
          codigo: borrador.codigo.trim().toUpperCase(),
          nombre: borrador.nombre.trim(),
          tipo: borrador.tipo,
          ...(borrador.direccion.trim() ? { direccion: borrador.direccion.trim() } : {}),
          ...(borrador.telefono.trim() ? { telefono: borrador.telefono.trim() } : {}),
          descripcion: borrador.descripcion.trim(),
          tipoNegocio: borrador.tipoNegocio,
          ...(borrador.fotoUrl.trim() ? { fotoUrl: borrador.fotoUrl.trim() } : {}),
          ...(borrador.provincia.trim() ? { provincia: borrador.provincia.trim() } : {}),
          ...(borrador.municipio.trim() ? { municipio: borrador.municipio.trim() } : {}),
          ...(borrador.whatsapp.trim() ? { whatsapp: borrador.whatsapp.trim() } : {}),
          ...(borrador.lat.trim() ? { lat: Number(borrador.lat) } : {}),
          ...(borrador.lng.trim() ? { lng: Number(borrador.lng) } : {}),
          horarios: borrador.horarios,
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

      {cargando ? <p className="panel__nota">Cargandoâ€¦</p> : null}

      {!cargando && sucursales.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">Todavia no hay sucursales.</p>
        </div>
      ) : null}

      {sucursales.length > 0 ? (
        <div className="tabla-envoltura tabla-envoltura--tarjetas">
          <table className="tabla tabla--responsive">
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
                  <td className="codigo" data-label="Codigo">{sucursal.codigo}</td>
                  <td data-label="Nombre">{sucursal.nombre}</td>
                  <td data-label="Tipo">{sucursal.tipo === 'almacen' ? 'Bodega' : 'Tienda'}</td>
                  <td data-label="Direccion">{sucursal.direccion ?? 'â€”'}</td>
                  <td data-label="Estado">
                    <span className={sucursal.activa ? 'insignia insignia--ok' : 'insignia insignia--agotado'}>
                      {sucursal.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td data-label="Acciones">
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
                            descripcion: sucursal.descripcion ?? '',
                            tipoNegocio: sucursal.tipoNegocio ?? 'tienda',
                            fotoUrl: sucursal.fotoUrl ?? '',
                            tipo: sucursal.tipo === 'almacen' ? 'almacen' : 'tienda',
                            direccion: sucursal.direccion ?? '',
                            provincia: sucursal.provincia ?? '',
                            municipio: sucursal.municipio ?? '',
                            telefono: sucursal.telefono ?? '',
                            whatsapp: sucursal.whatsapp ?? '',
                            lat: sucursal.lat != null ? String(sucursal.lat) : '',
                            lng: sucursal.lng != null ? String(sucursal.lng) : '',
                            ventaDesdeAlmacen: sucursal.ventaDesdeAlmacen,
                            horarios: sucursal.horarios ?? { ...HORARIOS_VACIOS },
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

            <label className="campo-ancho campo-ancho--ancho">
              <span>Descripcion</span>
              <input
                className="entrada"
                value={borrador.descripcion}
                onChange={(evento) => setBorrador({ ...borrador, descripcion: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Tipo de negocio</span>
              <select
                className="entrada"
                value={borrador.tipoNegocio}
                onChange={(evento) => setBorrador({ ...borrador, tipoNegocio: evento.target.value })}
              >
                <option value="tienda">Tienda</option>
                <option value="restaurante">Restaurante</option>
                <option value="farmacia">Farmacia</option>
                <option value="ferreteria">Ferreteria</option>
                <option value="otro">Otro</option>
              </select>
            </label>

            <label className="campo-ancho">
              <span>Foto (URL)</span>
              <input
                className="entrada"
                value={borrador.fotoUrl}
                onChange={(evento) => setBorrador({ ...borrador, fotoUrl: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Provincia</span>
              <input
                className="entrada"
                value={borrador.provincia}
                onChange={(evento) => setBorrador({ ...borrador, provincia: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Municipio</span>
              <input
                className="entrada"
                value={borrador.municipio}
                onChange={(evento) => setBorrador({ ...borrador, municipio: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>WhatsApp</span>
              <input
                className="entrada"
                value={borrador.whatsapp}
                onChange={(evento) => setBorrador({ ...borrador, whatsapp: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Latitud</span>
              <input
                className="entrada"
                value={borrador.lat}
                onChange={(evento) => setBorrador({ ...borrador, lat: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Longitud</span>
              <input
                className="entrada"
                value={borrador.lng}
                onChange={(evento) => setBorrador({ ...borrador, lng: evento.target.value })}
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

            {borrador.id && borrador.tipo === 'tienda' ? (
              <label className="opcion-casilla campo-ancho">
                <input
                  type="checkbox"
                  checked={borrador.ventaDesdeAlmacen}
                  onChange={(evento) =>
                    setBorrador({ ...borrador, ventaDesdeAlmacen: evento.target.checked })
                  }
                />
                <span>Vender tambien del almacen si el piso de venta no alcanza</span>
              </label>
            ) : null}
          </div>

          <div className="campo-ancho campo-ancho--ancho">
            <span>Horarios de trabajo</span>
            {DIAS.map((dia) => (
              <label className="opcion-casilla" key={dia} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="checkbox" checked={borrador.horarios[dia]?.activo ?? false} onChange={(evento) => setBorrador({ ...borrador, horarios: { ...borrador.horarios, [dia]: { ...(borrador.horarios[dia] ?? { desde: '09:00', hasta: '18:00', activo: true }), activo: evento.target.checked } } })} />
                <span style={{ minWidth: '6rem' }}>{dia}</span>
                <input className="entrada" type="time" value={borrador.horarios[dia]?.desde ?? '09:00'} onChange={(evento) => setBorrador({ ...borrador, horarios: { ...borrador.horarios, [dia]: { ...(borrador.horarios[dia] ?? { desde: '09:00', hasta: '18:00', activo: true }), desde: evento.target.value } } })} />
                <span>a</span>
                <input className="entrada" type="time" value={borrador.horarios[dia]?.hasta ?? '18:00'} onChange={(evento) => setBorrador({ ...borrador, horarios: { ...borrador.horarios, [dia]: { ...(borrador.horarios[dia] ?? { desde: '09:00', hasta: '18:00', activo: true }), hasta: evento.target.value } } })} />
              </label>
            ))}
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
              {guardando ? 'Guardandoâ€¦' : 'Guardar'}
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
            Â¿Seguro que quieres quitar <strong>{porQuitar.nombre}</strong>?
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
              {guardando ? 'Quitandoâ€¦' : 'Si, quitarla'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
