import { useRef, useState } from 'react';
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
  nombre: string;
  descripcion: string;
  tipoNegocio: string;
  fotoUrl: string;
  tipo: 'tienda' | 'almacen';
  activa: boolean;
  direccion: string;
  provincia: string;
  municipio: string;
  telefono: string;
  whatsapp: string;
  lat: string;
  lng: string;
  horarios: Record<string, HorarioDia>;
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

const HORARIOS_VACIOS: Record<string, HorarioDia> = Object.fromEntries(
  DIAS.map((d) => [d, { desde: '09:00', hasta: '18:00', activo: true }]),
);

const BORRADOR_VACIO: Borrador = {
  id: null,
  nombre: '',
  descripcion: '',
  tipoNegocio: 'tienda',
  fotoUrl: '',
  tipo: 'tienda',
  activa: true,
  direccion: '',
  provincia: '',
  municipio: '',
  telefono: '',
  whatsapp: '',
  lat: '',
  lng: '',
  horarios: { ...HORARIOS_VACIOS },
};

/** Reduce la foto antes de subirla para no llenar el almacenamiento. */
async function prepararImagen(archivo: File): Promise<File> {
  try {
    const mapa = await createImageBitmap(archivo);
    const mayor = Math.max(mapa.width, mapa.height);
    const escala = Math.min(1, 1200 / mayor);

    if (escala === 1 && archivo.size <= 600 * 1024) {
      mapa.close();
      return archivo;
    }

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(mapa.width * escala));
    lienzo.height = Math.max(1, Math.round(mapa.height * escala));
    const contexto = lienzo.getContext('2d');
    if (!contexto) {
      mapa.close();
      return archivo;
    }

    contexto.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
    mapa.close();

    const reducida = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, 'image/jpeg', 0.82),
    );
    if (!reducida) {
      return archivo;
    }

    return new File([reducida], archivo.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    return archivo;
  }
}

export function Sucursales({ onActualizarSesion }: { onActualizarSesion: () => Promise<void> }) {
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const archivoFoto = useRef<HTMLInputElement>(null);
  const [codigosPais] = useState<string[]>(['+53', '+1', '+52', '+34', '+54', '+57', '+56', '+51', '+55', '+58', '+33', '+49', '+39', '+44']);

  // Los codigos de pais se cargan de una lista fija para evitar bloqueos CORS
  // al consultar servicios externos desde el navegador.
  const [porQuitar, setPorQuitar] = useState<SucursalDelPanel | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
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

  async function subirFoto(archivo: File): Promise<void> {
    setSubiendoFoto(true);
    setError(null);
    try {
      const reducida = await prepararImagen(archivo);
      const { url } = await api.subirImagenSucursal(reducida);
      setBorrador((actual) => (actual ? { ...actual, fotoUrl: url } : actual));
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setSubiendoFoto(false);
    }
  }

  async function guardar(): Promise<void> {
    if (!borrador) {
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
          activa: borrador.activa,
          ...(borrador.direccion.trim() ? { direccion: borrador.direccion.trim() } : {}),
          ...(borrador.telefono.trim() ? { telefono: borrador.telefono.trim() } : {}),
          descripcion: borrador.descripcion.trim(),
          tipoNegocio: borrador.tipoNegocio,
          fotoUrl: borrador.fotoUrl.trim() || null,
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
        // El selector de sucursal se refresca al vuelo con la sesion nueva.
        terminarCon(`Se agrego la sucursal ${creada.sucursal.nombre}.`);
      }

      await recargar();
      try {
        await onActualizarSesion();
      } catch {
        // La lista ya se actualizo; el menu tomara el cambio al volver a entrar.
      }
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
      try {
        await onActualizarSesion();
      } catch {
        // El historial ya se conserva; el menu se corrige al volver a entrar.
      }
      terminarCon(`Se quito ${porQuitar.nombre}. Su historial de ventas y turnos se conserva.`);
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
        <div className="tabla-envoltura tabla-envoltura--tarjetas">
          <table className="tabla tabla--responsive">
            <thead>
              <tr>
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
                  <td data-label="Nombre">
                    <div className="sucursal__nombre">
                      {sucursal.fotoUrl ? (
                        <img
                          className="sucursal__miniatura"
                          src={sucursal.fotoUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="sucursal__miniatura sucursal__miniatura--vacia" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M3 21V8l9-5 9 5v13" />
                            <path d="M9 21v-6h6v6" />
                          </svg>
                        </span>
                      )}
                      <span>{sucursal.nombre}</span>
                    </div>
                  </td>
                  <td data-label="Tipo">{sucursal.tipo === 'almacen' ? 'Bodega' : 'Tienda'}</td>
                  <td data-label="Direccion">{sucursal.direccion ?? '—'}</td>
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
                            nombre: sucursal.nombre,
                            descripcion: sucursal.descripcion ?? '',
                            tipoNegocio: sucursal.tipoNegocio ?? 'tienda',
                            fotoUrl: sucursal.fotoUrl ?? '',
                            tipo: sucursal.tipo === 'almacen' ? 'almacen' : 'tienda',
                            activa: sucursal.activa,
                            direccion: sucursal.direccion ?? '',
                            provincia: sucursal.provincia ?? '',
                            municipio: sucursal.municipio ?? '',
                            telefono: sucursal.telefono ?? '',
                            whatsapp: sucursal.whatsapp ?? '',
                            lat: sucursal.lat != null ? String(sucursal.lat) : '',
                            lng: sucursal.lng != null ? String(sucursal.lng) : '',
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
          titulo={borrador.id ? `Editar ${borrador.nombre}` : 'Nueva sucursal'}
          nota={
            borrador.id
              ? 'El nombre identifica la sucursal en todo el sistema y en los reportes.'
              : 'Escribe el nombre de la sucursal. El sistema se encarga del resto.'
          }
          onCerrar={() => setBorrador(null)}
        >
          <div className="formulario">
            <label className="campo-ancho">
              <span>Nombre</span>
              <input
                className="entrada"
                placeholder="Sucursal Centro"
                value={borrador.nombre}
                onChange={(evento) => setBorrador({ ...borrador, nombre: evento.target.value })}
              />
            </label>

            {!borrador.id ? (
              <label className="campo-ancho">
                <span>Tipo de sucursal</span>
                <select
                  className="entrada"
                  value={borrador.tipo}
                  onChange={(evento) =>
                    setBorrador({ ...borrador, tipo: evento.target.value as 'tienda' | 'almacen' })
                  }
                >
                  <option value="tienda">Tienda</option>
                  <option value="almacen">Bodega</option>
                </select>
              </label>
            ) : null}

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

            {borrador.id ? (
              <label className="opcion-casilla" style={{ alignSelf: 'end', paddingBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={borrador.activa}
                  onChange={(evento) => setBorrador({ ...borrador, activa: evento.target.checked })}
                />
                Activa
              </label>
            ) : null}

            <div className="campo-ancho campo-ancho--ancho">
              <span>Foto</span>
              <div style={{ border: '1px solid var(--tinta-borde)', borderRadius: 'var(--radio-chico)', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                {borrador.fotoUrl ? (
                  <img src={borrador.fotoUrl} alt="Foto de la sucursal" style={{ maxWidth: '100%', maxHeight: '160px', borderRadius: 'var(--radio-chico)' }} />
                ) : (
                  <div style={{ width: '100%', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--texto-tenue)', fontSize: '0.8rem' }}>
                    Sin foto
                  </div>
                )}
                <input
                  ref={archivoFoto}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={(evento) => {
                    const archivo = evento.target.files?.[0];
                    if (archivo) {
                      void subirFoto(archivo);
                    }
                    evento.target.value = '';
                  }}
                />
                <div className="acciones-fila">
                  <button
                    type="button"
                    className="boton"
                    onClick={() => archivoFoto.current?.click()}
                    disabled={subiendoFoto}
                  >
                    {subiendoFoto
                      ? 'Subiendo…'
                      : borrador.fotoUrl
                        ? 'Cambiar imagen'
                        : 'Seleccionar imagen'}
                  </button>
                  {borrador.fotoUrl ? (
                    <button
                      type="button"
                      className="boton"
                      onClick={() =>
                        setBorrador((actual) => (actual ? { ...actual, fotoUrl: '' } : actual))
                      }
                      disabled={subiendoFoto}
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <label className="campo-ancho campo-ancho--ancho">
              <span>Direccion / Calle</span>
              <input
                className="entrada"
                value={borrador.direccion}
                onChange={(evento) => setBorrador({ ...borrador, direccion: evento.target.value })}
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

            <label className="campo-ancho campo-ancho--ancho">
              <span>WhatsApp</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  className="entrada"
                  list="codigos-pais"
                  placeholder="+53"
                  value={borrador.whatsapp.startsWith('+') ? borrador.whatsapp.split(' ')[0] : ''}
                  onChange={(evento) => {
                    const numero = borrador.whatsapp.replace(/^\+\d+\s*/, '');
                    setBorrador({ ...borrador, whatsapp: `${evento.target.value} ${numero}`.trim() });
                  }}
                  style={{ maxWidth: '7rem' }}
                />
                <datalist id="codigos-pais">
                  {codigosPais.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <input
                  className="entrada"
                  placeholder="numero"
                  value={borrador.whatsapp.replace(/^\+\d+\s*/, '')}
                  onChange={(evento) => {
                    const codigo = borrador.whatsapp.startsWith('+') ? borrador.whatsapp.split(' ')[0] : '+53';
                    setBorrador({ ...borrador, whatsapp: `${codigo} ${evento.target.value}`.trim() });
                  }}
                />
              </div>
            </label>
          </div>

          <div className="campo-ancho campo-ancho--ancho" style={{ marginTop: "1rem" }}>
            <span>Horarios de trabajo</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
              <span style={{ minWidth: '6rem' }}></span>
              <span style={{ flex: 1, textAlign: 'center', fontSize: '0.75rem', color: 'var(--texto-tenue)' }}>Desde</span>
              <span style={{ flex: 1, textAlign: 'center', fontSize: '0.75rem', color: 'var(--texto-tenue)' }}>Hasta</span>
            </div>
            {DIAS.map((dia) => (
              <label className="opcion-casilla" key={dia} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="checkbox" checked={borrador.horarios[dia]?.activo ?? false} onChange={(evento) => setBorrador({ ...borrador, horarios: { ...borrador.horarios, [dia]: { ...(borrador.horarios[dia] ?? { desde: '09:00', hasta: '18:00', activo: true }), activo: evento.target.checked } } })} />
                <span style={{ minWidth: '6rem' }}>{dia}</span>
                <input className="entrada" type="time" style={{ flex: 1, textAlign: "center" }} value={borrador.horarios[dia]?.desde ?? '09:00'} onChange={(evento) => setBorrador({ ...borrador, horarios: { ...borrador.horarios, [dia]: { ...(borrador.horarios[dia] ?? { desde: '09:00', hasta: '18:00', activo: true }), desde: evento.target.value } } })} />
                <input className="entrada" type="time" style={{ flex: 1, textAlign: "center" }} value={borrador.horarios[dia]?.hasta ?? '18:00'} onChange={(evento) => setBorrador({ ...borrador, horarios: { ...borrador.horarios, [dia]: { ...(borrador.horarios[dia] ?? { desde: '09:00', hasta: '18:00', activo: true }), hasta: evento.target.value } } })} />
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
              disabled={guardando || subiendoFoto}
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {porQuitar ? (
        <Modal
          titulo={`Quitar ${porQuitar.nombre}`}
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

