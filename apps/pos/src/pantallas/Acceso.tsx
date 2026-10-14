import { useState, type FormEvent } from 'react';
import { api, ErrorApi, guardarToken } from '../api/cliente';
import type { Sesion } from '../api/tipos';

export function Acceso({ onEntrar }: { onEntrar: (sesion: Sesion) => void }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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

  return (
    <div className="acceso">
      <form className="acceso__caja" onSubmit={entrar}>
        <h1 className="acceso__marca">Mostrador</h1>
        <p className="acceso__lema">Ventas · Inventario · Contabilidad</p>

        {error ? <p className="aviso" role="alert">{error}</p> : null}

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

        <p className="acceso__nota">
          Datos de ejemplo: admin / mostrador123
          <br />
          Cambia la contrasena al empezar a usar el sistema
        </p>
      </form>
    </div>
  );
}
