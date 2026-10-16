import { useState, type FormEvent } from 'react';
import { api, ErrorApi, guardarToken } from '../api/cliente';
import type { Sesion } from '../api/tipos';
import {
  esAplicacionNativa,
  faltaConfigurarServidor,
  guardarServidor,
  obtenerServidor,
} from '../servicios/servidor';

export function Acceso({ onEntrar }: { onEntrar: (sesion: Sesion) => void }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /** Dentro del APK hay que decirle una vez a que servidor conectarse. */
  const [configurando, setConfigurando] = useState(() => faltaConfigurarServidor());
  const [direccion, setDireccion] = useState(() => obtenerServidor());

  function guardarDireccion(evento: FormEvent): void {
    evento.preventDefault();
    if (direccion.trim().length < 8) {
      setError('Escribe la direccion completa, por ejemplo https://mi-tienda.vercel.app');
      return;
    }
    guardarServidor(direccion);
    setError(null);
    setConfigurando(false);
  }

  async function entrar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      const { token } = await api.iniciarSesion(usuario.trim(), password);
      guardarToken(token);
      onEntrar(await api.sesion());
    } catch (fallo) {
      guardarToken(null);
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo iniciar sesion');
      setEnviando(false);
    }
  }

  if (configurando) {
    return (
      <div className="acceso">
        <form className="acceso__caja" onSubmit={guardarDireccion}>
          <h1 className="acceso__marca">
            <span className="acceso__punto" aria-hidden="true" />
            Mostrador
          </h1>
          <p className="acceso__lema">Configurar el servidor</p>

          <p className="panel__nota" style={{ color: '#6b5b4a', marginBottom: '1rem' }}>
            Escribe la direccion de tu sistema. Es la que te dio Vercel al publicarlo.
          </p>

          {error ? (
            <p className="aviso" role="alert">
              {error}
            </p>
          ) : null}

          <label className="campo">
            <span className="campo__etiqueta">Direccion del servidor</span>
            <input
              className="campo__entrada"
              value={direccion}
              onChange={(evento) => setDireccion(evento.target.value)}
              placeholder="https://mi-tienda.vercel.app"
              autoComplete="url"
              autoFocus
            />
          </label>

          <button className="acceso__boton" type="submit">
            Guardar y continuar
          </button>

          <p className="acceso__nota">Solo se pide una vez, en cada telefono.</p>
        </form>
      </div>
    );
  }

  return (
    <div className="acceso">
      <form className="acceso__caja" onSubmit={entrar}>
        <h1 className="acceso__marca">
          <span className="acceso__punto" aria-hidden="true" />
          Mostrador
        </h1>
        <p className="acceso__lema">Ventas · Inventario · Contabilidad</p>

        {error ? (
          <p className="aviso" role="alert">
            {error}
          </p>
        ) : null}

        <label className="campo">
          <span className="campo__etiqueta">Usuario</span>
          <input
            className="campo__entrada"
            value={usuario}
            onChange={(evento) => setUsuario(evento.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="campo">
          <span className="campo__etiqueta">Contrasena</span>
          <input
            className="campo__entrada"
            type="password"
            value={password}
            onChange={(evento) => setPassword(evento.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="acceso__boton" type="submit" disabled={enviando}>
          {enviando ? 'Entrando...' : 'Entrar al mostrador'}
        </button>

        {esAplicacionNativa() ? (
          <button
            type="button"
            className="boton boton--fantasma"
            style={{ marginTop: '0.8rem', width: '100%' }}
            onClick={() => {
              setError(null);
              setDireccion(obtenerServidor());
              setConfigurando(true);
            }}
          >
            Cambiar servidor
          </button>
        ) : (
          <p className="acceso__nota">
            Datos de ejemplo: admin / mostrador123
            <br />
            Cambia la contrasena al empezar a usar el sistema
          </p>
        )}
      </form>
    </div>
  );
}
