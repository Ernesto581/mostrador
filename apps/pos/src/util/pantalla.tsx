import { useCallback, useEffect, useState } from 'react';
import { ErrorApi } from '../api/cliente';
import type { ReactNode } from 'react';

/** Mensaje legible de cualquier error. */
export function mensajeDe(fallo: unknown): string {
  return fallo instanceof ErrorApi ? fallo.message : 'No se pudo completar la operacion';
}

/** Carga datos del API y avisa del estado. */
export function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ejecutar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await cargar());
      setError(null);
    } catch (fallo) {
      setError(mensajeDe(fallo));
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void ejecutar();
  }, [ejecutar]);

  return { datos, cargando, error, recargar: ejecutar };
}

interface PropsModal {
  titulo: string;
  nota?: string | undefined;
  children: ReactNode;
  onCerrar: () => void;
}

/** Dialogo con el mismo lenguaje visual del resto. */
export function Modal({ titulo, nota, children, onCerrar }: PropsModal) {
  return (
    <div className="velo" role="dialog" aria-modal="true" aria-label={titulo} onClick={onCerrar}>
      <div className="modal" onClick={(evento) => evento.stopPropagation()}>
        <h2 className="modal__titulo">{titulo}</h2>
        {nota ? <p className="modal__nota">{nota}</p> : null}
        {children}
      </div>
    </div>
  );
}

interface PropsAviso {
  error?: string | null;
  ok?: string | null;
}

export function Aviso({ error, ok }: PropsAviso) {
  if (error) {
    return (
      <p className="aviso" role="alert">
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p className="aviso aviso--ok" role="status">
        {ok}
      </p>
    );
  }
  return null;
}
