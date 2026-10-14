import { useEffect, useRef, type FormEvent } from 'react';
import type { Producto } from '../api/tipos';
import { dinero } from '../util/dinero';

interface Props {
  resultados: Producto[];
  buscando: boolean;
  error: string | null;
  termino: string;
  enCarrito: Map<string, number>;
  onCambiarTermino: (termino: string) => void;
  onBuscar: (termino: string) => void;
  onLimpiar: () => void;
  onAgregar: (producto: Producto) => void;
}

/** Clase de la etiqueta de existencia segun el stock disponible. */
function claseExistencia(disponible: number, minimo: number): string {
  if (disponible <= 0) {
    return 'existencia existencia--agotado';
  }
  if (disponible <= minimo) {
    return 'existencia existencia--baja';
  }
  return 'existencia';
}

export function Buscador({
  resultados,
  buscando,
  error,
  termino,
  enCarrito,
  onCambiarTermino,
  onBuscar,
  onLimpiar,
  onAgregar,
}: Props) {
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    entrada.current?.focus();
  }, []);

  useEffect(() => {
    const alPresionar = (evento: KeyboardEvent): void => {
      if (evento.key === 'F2') {
        evento.preventDefault();
        entrada.current?.focus();
        entrada.current?.select();
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, []);

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    const limpio = termino.trim();
    if (limpio) {
      onBuscar(limpio);
    }
  }

  return (
    <div className="panel-busqueda">
      <form className="buscador" onSubmit={enviar} role="search">
        <svg
          className="buscador__lupa"
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.6-3.6" />
        </svg>
        <input
          ref={entrada}
          className="buscador__entrada"
          value={termino}
          onChange={(evento) => onCambiarTermino(evento.target.value)}
          placeholder="Escanea el codigo o escribe el nombre del producto"
          aria-label="Buscar producto por codigo o nombre"
          autoComplete="off"
        />
        {termino ? (
          <button
            type="button"
            className="boton boton--fantasma"
            onClick={() => {
              onCambiarTermino('');
              onLimpiar();
              entrada.current?.focus();
            }}
            aria-label="Limpiar busqueda"
          >
            Limpiar
          </button>
        ) : (
          <span className="buscador__tecla">F2</span>
        )}
      </form>

      {error ? <p className="aviso" role="alert">{error}</p> : null}

      {!error && !buscando && resultados.length === 0 ? (
        <p className="pista">
          {termino.trim()
            ? 'Sin resultados. Prueba con otro nombre o revisa el codigo.'
            : 'Escanea o escribe para ver productos. Con un solo resultado, Enter lo agrega al ticket.'}
        </p>
      ) : null}

      <div className="rejilla">
        {resultados.map((producto, indice) => {
          const apartadas = enCarrito.get(producto.id) ?? 0;
          const disponible = (producto.stock ?? 0) - apartadas;
          const agotado = disponible <= 0 && !producto.esServicio;

          return (
            <button
              key={producto.id}
              type="button"
              className="producto"
              style={{ animationDelay: `${Math.min(indice, 12) * 22}ms` }}
              onClick={() => onAgregar(producto)}
              disabled={agotado}
              title={agotado ? 'Sin existencias en esta sucursal' : 'Agregar al ticket'}
            >
              <span className="producto__sku">{producto.sku}</span>
              <p className="producto__nombre">{producto.nombre}</p>
              <span className="producto__pie">
                <span className="producto__precio">{dinero(producto.precioVenta)}</span>
                <span className={claseExistencia(disponible, producto.stockMinimo)}>
                  {producto.esServicio ? 'Servicio' : `${disponible} pz`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
