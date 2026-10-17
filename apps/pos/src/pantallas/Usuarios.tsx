import { useState } from 'react';
import { api } from '../api/cliente';
import type { Rol, UsuarioDelPanel } from '../api/tipos';
import { Aviso, Modal, mensajeDe, useCarga } from '../util/pantalla';

interface Borrador {
  id: string | null;
  username: string;
  nombre: string;
  email: string;
  password: string;
  rol: string;
  sucursalIds: string[];
  activo: boolean;
}

function borradorVacio(rolPorDefecto: string): Borrador {
  return {
    id: null,
    username: '',
    nombre: '',
    email: '',
    password: '',
    rol: rolPorDefecto,
    sucursalIds: [],
    activo: true,
  };
}

export function Usuarios() {
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [contraUsuario, setContraUsuario] = useState<UsuarioDelPanel | null>(null);
  const [porBorrar, setPorBorrar] = useState<UsuarioDelPanel | null>(null);
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { datos, cargando, error: errorLista, recargar } = useCarga(() => api.usuarios(), []);
  const { datos: datosRoles } = useCarga(() => api.roles(), []);
  const { datos: datosSucursales } = useCarga(() => api.sucursales(), []);

  const usuarios = datos?.usuarios ?? [];
  const roles: Rol[] = datosRoles?.roles ?? [];
  const sucursales = datosSucursales?.sucursales ?? [];

  function terminarCon(texto: string): void {
    setOk(texto);
    setBorrador(null);
    setContraUsuario(null);
    setPorBorrar(null);
    setNuevaPassword('');
    window.setTimeout(() => setOk(null), 4000);
  }

  async function borrar(): Promise<void> {
    if (!porBorrar) {
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.borrarUsuario(porBorrar.id);
      await recargar();
      terminarCon(`La cuenta de ${porBorrar.username} quedo borrada: ya no puede entrar.`);
    } catch (fallo) {
      setError(mensajeDe(fallo));
      setPorBorrar(null);
    } finally {
      setGuardando(false);
    }
  }

  async function guardar(): Promise<void> {
    if (!borrador) {
      return;
    }

    if (borrador.nombre.trim().length === 0) {
      setError('Escribe el nombre completo');
      return;
    }
    if (borrador.sucursalIds.length === 0) {
      setError('Asigna al menos una sucursal');
      return;
    }
    if (!borrador.id && (borrador.username.trim().length < 3 || borrador.password.length < 8)) {
      setError('El usuario necesita 3 letras y la contrasena al menos 8');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      if (borrador.id) {
        await api.editarUsuario(borrador.id, {
          nombre: borrador.nombre.trim(),
          ...(borrador.email.trim() ? { email: borrador.email.trim() } : {}),
          activo: borrador.activo,
          rol: borrador.rol,
          sucursalIds: borrador.sucursalIds,
        });
        terminarCon('Usuario actualizado.');
      } else {
        await api.crearUsuario({
          username: borrador.username.trim(),
          nombre: borrador.nombre.trim(),
          password: borrador.password,
          ...(borrador.email.trim() ? { email: borrador.email.trim() } : {}),
          rol: borrador.rol,
          sucursalIds: borrador.sucursalIds,
        });
        terminarCon('Usuario creado. Ya puede entrar con su usuario y contrasena.');
      }

      await recargar();
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarPassword(): Promise<void> {
    if (!contraUsuario) {
      return;
    }
    if (nuevaPassword.length < 8) {
      setError('La contrasena necesita al menos 8 caracteres');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await api.cambiarPasswordDeUsuario(contraUsuario.id, nuevaPassword);
      terminarCon(`Contrasena de ${contraUsuario.username} actualizada.`);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setGuardando(false);
    }
  }

  function abrirEdicion(usuario: UsuarioDelPanel): void {
    setError(null);
    setBorrador({
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre,
      email: usuario.email ?? '',
      password: '',
      rol: usuario.roles[0] ?? roles[0]?.codigo ?? '',
      sucursalIds: usuario.sucursales.map((sucursal) => sucursal.id),
      activo: usuario.activo,
    });
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Usuarios</h1>
          <p className="panel__nota">
            Quien puede entrar y que alcanza a hacer. El rol decide los permisos.
          </p>
        </div>

        <button
          type="button"
          className="boton boton--acento"
          onClick={() => {
            setError(null);
            setBorrador(borradorVacio(roles[0]?.codigo ?? 'cajero'));
          }}
        >
          Nuevo usuario
        </button>
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {usuarios.length > 0 ? (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Sucursales</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((usuario) => (
                <tr key={usuario.id}>
                  <td className="codigo">{usuario.username}</td>
                  <td>{usuario.nombre}</td>
                  <td>{usuario.rolNombres.join(', ') || '—'}</td>
                  <td>{usuario.sucursales.map((sucursal) => sucursal.codigo).join(', ') || '—'}</td>
                  <td>
                    <span className={usuario.activo ? 'insignia insignia--ok' : 'insignia insignia--agotado'}>
                      {usuario.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="acciones-fila">
                      <button type="button" className="boton" onClick={() => abrirEdicion(usuario)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="boton"
                        onClick={() => {
                          setError(null);
                          setNuevaPassword('');
                          setContraUsuario(usuario);
                        }}
                      >
                        Contrasena
                      </button>
                      <button
                        type="button"
                        className="boton"
                        onClick={() => {
                          setError(null);
                          setPorBorrar(usuario);
                        }}
                      >
                        Borrar
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
          titulo={borrador.id ? `Editar ${borrador.username}` : 'Nuevo usuario'}
          nota={
            borrador.id
              ? 'El nombre de usuario no se cambia. Para la contrasena usa el boton Contrasena.'
              : 'Con esta cuenta podra entrar desde su celular o desde el navegador.'
          }
          onCerrar={() => setBorrador(null)}
        >
          <div className="formulario">
            {!borrador.id ? (
              <label className="campo-ancho">
                <span>Usuario</span>
                <input
                  className="entrada"
                  value={borrador.username}
                  onChange={(evento) => setBorrador({ ...borrador, username: evento.target.value })}
                />
              </label>
            ) : null}

            <label className="campo-ancho">
              <span>Nombre completo</span>
              <input
                className="entrada"
                value={borrador.nombre}
                onChange={(evento) => setBorrador({ ...borrador, nombre: evento.target.value })}
              />
            </label>

            {!borrador.id ? (
              <label className="campo-ancho">
                <span>Contrasena</span>
                <input
                  className="entrada"
                  type="password"
                  value={borrador.password}
                  onChange={(evento) => setBorrador({ ...borrador, password: evento.target.value })}
                />
              </label>
            ) : null}

            <label className="campo-ancho">
              <span>Correo (opcional)</span>
              <input
                className="entrada"
                value={borrador.email}
                onChange={(evento) => setBorrador({ ...borrador, email: evento.target.value })}
              />
            </label>

            <label className="campo-ancho">
              <span>Rol</span>
              <select
                className="entrada"
                value={borrador.rol}
                onChange={(evento) => setBorrador({ ...borrador, rol: evento.target.value })}
              >
                {roles.map((rol) => (
                  <option key={rol.id} value={rol.codigo}>
                    {rol.nombre}
                  </option>
                ))}
              </select>
            </label>

            {borrador.id ? (
              <label className="opcion-casilla" style={{ alignSelf: 'end', paddingBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={borrador.activo}
                  onChange={(evento) => setBorrador({ ...borrador, activo: evento.target.checked })}
                />
                Puede entrar
              </label>
            ) : null}

            <div className="campo-ancho campo-ancho--ancho">
              <span>Sucursales donde trabaja</span>
              <div className="opciones-lista">
                {sucursales.map((sucursal) => (
                  <label className="opcion-casilla" key={sucursal.id}>
                    <input
                      type="checkbox"
                      checked={borrador.sucursalIds.includes(sucursal.id)}
                      onChange={(evento) =>
                        setBorrador({
                          ...borrador,
                          sucursalIds: evento.target.checked
                            ? [...borrador.sucursalIds, sucursal.id]
                            : borrador.sucursalIds.filter((id) => id !== sucursal.id),
                        })
                      }
                    />
                    {sucursal.codigo} · {sucursal.nombre}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setBorrador(null)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--acento" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </Modal>
      ) : null}

      {contraUsuario ? (
        <Modal
          titulo={`Contrasena de ${contraUsuario.username}`}
          nota="Se cambia de inmediato: la anterior deja de servir."
          onCerrar={() => setContraUsuario(null)}
        >
          <label className="campo-ancho">
            <span>Contrasena nueva</span>
            <input
              className="entrada"
              type="password"
              value={nuevaPassword}
              onChange={(evento) => setNuevaPassword(evento.target.value)}
            />
          </label>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setContraUsuario(null)}>
              Cancelar
            </button>
            <button type="button" className="boton boton--acento" onClick={() => void cambiarPassword()} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Cambiar contrasena'}
            </button>
          </div>
        </Modal>
      ) : null}
      {porBorrar ? (
        <Modal
          titulo={`Borrar ${porBorrar.username}`}
          nota="La cuenta deja de poder entrar. Sus ventas, turnos y movimientos se conservan: la historia no se pierde."
          onCerrar={() => setPorBorrar(null)}
        >
          <p className="panel__nota">
            ¿Seguro que quieres borrar la cuenta de <strong>{porBorrar.nombre}</strong> (
            {porBorrar.username})?
          </p>
          <p className="panel__nota">
            Si esa persona sigue trabajando contigo, mejor marcala como inactiva desde{' '}
            <strong>Editar</strong>: asi deja de entrar pero la puedes reactivar despues. Borrarla
            no se puede deshacer.
          </p>

          <div className="modal__acciones">
            <button type="button" className="boton" onClick={() => setPorBorrar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton boton--acento"
              onClick={() => void borrar()}
              disabled={guardando}
            >
              {guardando ? 'Borrando…' : 'Si, borrarla'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
