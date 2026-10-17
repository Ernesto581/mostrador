import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  abierto: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  children: ReactNode;
}

/**
 * Menu de tres puntos.
 *
 * En tablet y telefono la tabla se aprieta, asi que las acciones que no caben se
 * guardan aqui en vez de desaparecer. Se cierra al tocar fuera o con Escape.
 */
export function MenuAcciones({ abierto, onAbrir, onCerrar, children }: Props) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) {
      return;
    }

    const alTocarFuera = (evento: MouseEvent): void => {
      if (!caja.current?.contains(evento.target as Node)) {
        onCerrar();
      }
    };

    const alTeclear = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') {
        onCerrar();
      }
    };

    document.addEventListener('mousedown', alTocarFuera);
    document.addEventListener('keydown', alTeclear);

    return () => {
      document.removeEventListener('mousedown', alTocarFuera);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto, onCerrar]);

  return (
    <div className="menu-acciones" ref={caja}>
      <button
        type="button"
        className="boton menu-acciones__disparador"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Mas acciones"
        onClick={() => (abierto ? onCerrar() : onAbrir())}
      >
        <span className="menu-acciones__puntos" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {abierto ? (
        <div className="menu-acciones__lista" role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}
