import { useState, type FormEvent } from 'react';
import { api, ErrorApi, guardarToken } from '../api/cliente';
import type { Sesion } from '../api/tipos';
import {
  guardarSesion,
  guardarVerificador,
  leerSesion,
  verificarSinConexion,
} from '../servicios/sesionLocal';
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

    const limpio = usuario.trim();

    try {
      const { token } = await api.iniciarSesion(limpio, password);
      guardarToken(token);

      const sesion = await api.sesion();
      guardarSesion(sesion);
      // Se guarda la huella de la contrasena para poder entrar sin internet despues.
      void guardarVerificador(limpio, password);

      onEntrar(sesion);
    } catch (fallo) {
      // Sin internet: se entra con los datos que ya se validaron en este telefono.
      if (fallo instanceof ErrorApi && fallo.codigo === 'SIN_CONEXION') {
        const guardada = leerSesion();
        const coincide = await verificarSinConexion(limpio, password);

        if (guardada && coincide) {
          onEntrar(guardada);
          return;
        }

        setError(
          guardada
            ? 'Sin internet. Revisa tu usuario y contrasena: se estan comprobando con los datos guardados en este telefono.'
            : 'Sin internet y este telefono todavia no tiene una sesion guardada. Conectalo una vez para poder entrar sin red.',
        );
        setEnviando(false);
        return;
      }

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
