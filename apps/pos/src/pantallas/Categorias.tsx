import { useState } from 'react';
import { api } from '../api/cliente';
import type { Categoria } from '../api/tipos';
import { Aviso, useCarga } from '../util/pantalla';

/**
 * Categorias del catalogo.
 *
 * Se administran aparte para que el inventario y el alta de productos no carguen
 * con una tarea que se hace de vez en cuando. Borrar una categoria usada por
 * productos lo impide el servidor y el motivo se muestra aqui.
 */
export function Categorias() {
  const [nueva, setNueva] = useState('');
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  const [porBorrar, setPorBorrar] = useState<Categoria | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const { datos, cargando, error: errorLista, recargar } = useCarga(
    () => api.categorias(),
    [],
  );
  const categorias: Categoria[] = datos?.categorias ?? [];

  async function ejecutar(accion: () => Promise<unknown>, mensaje: string): Promise<void> {
    setGuardando(true);
    setError(null);
    setOk(null);

    try {
      await accion();
      await recargar();
      setOk(mensaje);
      window.setTimeout(() => setOk(null), 3500);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo completar la operacion');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Categorias</h1>
          <p className="panel__nota">
            Agrupan los productos para ordenar el catalogo y los reportes. Cada producto
            puede tener una.
          </p>
        </div>
      </div>

      <div className="barra-filtros" style={{ marginBottom: '0.9rem' }}>
        <input
          className="entrada"
          style={{ maxWidth: '22rem' }}
          placeholder="Nombre de la nueva categoria"
          value={nueva}
          onChange={(evento) => setNueva(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter' && nueva.trim().length > 0 && !guardando) {
              evento.preventDefault();
              void ejecutar(async () => {
                await api.crearCategoria(nueva.trim());
                setNueva('');
              }, 'Categoria agregada.');
            }
          }}
        />
        <button
          type="button"
          className="boton boton--acento"
          disabled={guardando || nueva.trim().length === 0}
          onClick={() =>
            void ejecutar(async () => {
              await api.crearCategoria(nueva.trim());
              setNueva('');
            }, 'Categoria agregada.')
          }
        >
          {guardando ? 'Guardando…' : 'Agregar categoria'}
        </button>
      </div>

      <Aviso error={error ?? errorLista} ok={ok} />

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && categorias.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">
            Todavia no hay categorias. Agrega la primera para clasificar tus productos.
          </p>
        </div>
      ) : null}

      {categorias.length > 0 ? (
        <div className="tabla-envoltura">
          <table className="tabla tabla--responsive">
            <thead>
              <tr>
                <th>Categoria</th>
                <th className="col-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((categoria) => (
                <tr key={categoria.id}>
                  <td data-label="Categoria">
                    {editando?.id === categoria.id ? (
                      <input
                        className="entrada"
                        value={editando.nombre}
                        autoFocus
                        onChange={(evento) =>
                          setEditando({ id: categoria.id, nombre: evento.target.value })
                        }
                        onKeyDown={(evento) => {
                          if (evento.key === 'Escape') {
                            setEditando(null);
                          }
                        }}
                      />
                    ) : (
                      categoria.nombre
                    )}
                  </td>
                  <td className="col-acciones" data-label="Acciones">
                    <div className="acciones-fila">
                      {editando?.id === categoria.id ? (
                        <>
                          <button
                            type="button"
                            className="boton boton--acento"
                            disabled={guardando || editando.nombre.trim().length === 0}
                            onClick={() =>
                              void ejecutar(async () => {
                                await api.editarCategoria(categoria.id, editando.nombre.trim());
                                setEditando(null);
                              }, 'Categoria renombrada.')
                            }
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            className="boton"
                            onClick={() => setEditando(null)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : porBorrar?.id === categoria.id ? (
                        <>
                          <button
                            type="button"
                            className="boton boton--acento"
                            disabled={guardando}
                            onClick={() =>
                              void ejecutar(async () => {
                                await api.borrarCategoria(categoria.id);
                                setPorBorrar(null);
                              }, 'Categoria borrada.')
                            }
                          >
                            Confirmar borrar
                          </button>
                          <button
                            type="button"
                            className="boton"
                            onClick={() => setPorBorrar(null)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="boton"
                            onClick={() =>
                              setEditando({ id: categoria.id, nombre: categoria.nombre })
                            }
                          >
                            Renombrar
                          </button>
                          <button
                            type="button"
                            className="boton"
                            onClick={() => setPorBorrar(categoria)}
                          >
                            Borrar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
