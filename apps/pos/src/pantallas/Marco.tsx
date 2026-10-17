import { useEffect, useState } from 'react';
import type { Sesion } from '../api/tipos';
import { AvisoActualizacion } from '../componentes/AvisoActualizacion';
import { IndicadorConexion } from '../componentes/IndicadorConexion';
import { Caja } from './Caja';
import { Inventario } from './Inventario';
import { Productos } from './Productos';
import { Usuarios } from './Usuarios';
import { Vender } from './Vender';
import { Ventas } from './Ventas';

type Pestana = 'mostrador' | 'caja' | 'productos' | 'inventario' | 'ventas' | 'usuarios';

interface Props {
  sesion: Sesion;
  onSalir: () => void;
}

/**
 * Marco de la aplicacion.
 *
 * Las pestanas se muestran segun los permisos del rol: el vendedor solo ve el
 * mostrador; el administrador ve ademas productos, inventario, ventas y usuarios.
 * Aunque alguien forzara una pestana, el servidor valida cada accion de todos modos.
 *
 * En el telefono las pestanas no caben en una fila, asi que se guardan en un menu que
 * sale desde la izquierda, una debajo de otra. En tablet y monitor siguen a la vista.
 */
export function Marco({ sesion, onSalir }: Props) {
  const [pestana, setPestana] = useState<Pestana>('mostrador');
  const [sucursalId, setSucursalId] = useState(sesion.sucursales[0]?.id ?? '');
  const [menuAbierto, setMenuAbierto] = useState(false);

  const permisos = new Set(sesion.permisos);
  const opciones: { id: Pestana; etiqueta: string }[] = [
    { id: 'mostrador', etiqueta: 'Mostrador' },
    ...(permisos.has('cash.close') ? [{ id: 'caja' as Pestana, etiqueta: 'Caja' }] : []),
    ...(permisos.has('catalog.manage') ? [{ id: 'productos' as Pestana, etiqueta: 'Productos' }] : []),
    ...(permisos.has('inventory.adjust') ? [{ id: 'inventario' as Pestana, etiqueta: 'Inventario' }] : []),
    ...(permisos.has('sale.void') ? [{ id: 'ventas' as Pestana, etiqueta: 'Ventas' }] : []),
    ...(permisos.has('users.manage') ? [{ id: 'usuarios' as Pestana, etiqueta: 'Usuarios' }] : []),
  ];

  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);
  const actual = opciones.find((opcion) => opcion.id === pestana);

  // El menu solo tiene sentido en el telefono: si la ventana se agranda (o el
  // telefono se acuesta y ya cabe la barra completa) se cierra solo.
  useEffect(() => {
    const ancho = window.matchMedia('(min-width: 701px)');
    const alCambiar = () => {
      if (ancho.matches) {
        setMenuAbierto(false);
      }
    };
    ancho.addEventListener('change', alCambiar);
    return () => ancho.removeEventListener('change', alCambiar);
  }, []);

  // Con el menu abierto el fondo no se mueve, y Escape lo cierra.
  useEffect(() => {
    if (!menuAbierto) {
      return;
    }

    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        setMenuAbierto(false);
      }
    };
    window.addEventListener('keydown', alTeclear);

    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener('keydown', alTeclear);
    };
  }, [menuAbierto]);

  const elegir = (id: Pestana) => {
    setPestana(id);
    setMenuAbierto(false);
    // Cada seccion es una pantalla distinta: se empieza desde arriba.
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="app">
      <header className="barra">
        <button
          type="button"
          className="boton-menu"
          aria-label="Abrir el menu"
          aria-expanded={menuAbierto}
          aria-controls="menu-lateral"
          onClick={() => setMenuAbierto(true)}
        >
          <span className="boton-menu__rayas" aria-hidden="true" />
        </button>

        <div className="marca">
          <span className="marca__punto" aria-hidden="true" />
          {sesion.empresa.nombre || 'Mostrador'}
          <span>punto de venta</span>
        </div>

        {/* En el telefono la barra no lleva pestanas: aqui se ve donde estas. */}
        <span className="barra__seccion">
          <span className="marca__punto" aria-hidden="true" />
          <span className="barra__seccion-texto">{actual?.etiqueta}</span>
        </span>

        <nav className="pestanas" aria-label="Secciones">
          {opciones.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              className={opcion.id === pestana ? 'pestana pestana--activa' : 'pestana'}
              onClick={() => elegir(opcion.id)}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </nav>

        <div className="barra__datos">
          <IndicadorConexion />
          {sesion.sucursales.length > 1 ? (
            <select
              className="selector"
              value={sucursalId}
              onChange={(evento) => setSucursalId(evento.target.value)}
              aria-label="Sucursal"
            >
              {sesion.sucursales.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.codigo} · {opcion.nombre}
                </option>
              ))}
            </select>
          ) : (
            <span className="vendedor">
              {sucursal?.codigo} · {sucursal?.nombre}
            </span>
          )}
          <span className="vendedor">{sesion.usuario.nombre}</span>
          <button type="button" className="boton boton--fantasma barra__salir" onClick={onSalir}>
            Salir
          </button>
        </div>
      </header>

      {/* Fuera de la barra a proposito: la barra tiene desenfoque y eso atrapa a
          los hijos, asi que el menu no podria taparlo. */}
      <div
        className={menuAbierto ? 'telon telon--visible' : 'telon'}
        onClick={() => setMenuAbierto(false)}
        aria-hidden="true"
      />

      <aside
        id="menu-lateral"
        className={menuAbierto ? 'menu-lateral menu-lateral--abierto' : 'menu-lateral'}
        aria-label="Menu"
      >
        <div className="menu-lateral__cabecera">
          <div className="marca">
            <span className="marca__punto" aria-hidden="true" />
            {sesion.empresa.nombre || 'Mostrador'}
            <span>punto de venta</span>
          </div>
          <button
            type="button"
            className="cerrar-menu"
            aria-label="Cerrar el menu"
            onClick={() => setMenuAbierto(false)}
          >
            ×
          </button>
        </div>

        <nav className="menu-lateral__opciones" aria-label="Secciones">
          {opciones.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              className={opcion.id === pestana ? 'menu-opcion menu-opcion--activa' : 'menu-opcion'}
              aria-current={opcion.id === pestana ? 'page' : undefined}
              onClick={() => elegir(opcion.id)}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </nav>

        <div className="menu-lateral__pie">
          {sesion.sucursales.length > 1 ? (
            <label className="menu-lateral__campo">
              <span>Sucursal</span>
              <select
                className="selector"
                value={sucursalId}
                onChange={(evento) => setSucursalId(evento.target.value)}
              >
                {sesion.sucursales.map((opcion) => (
                  <option key={opcion.id} value={opcion.id}>
                    {opcion.codigo} · {opcion.nombre}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="vendedor">
              {sucursal?.codigo} · {sucursal?.nombre}
            </span>
          )}

          <span className="vendedor">{sesion.usuario.nombre}</span>

          <button type="button" className="boton" onClick={onSalir}>
            Salir
          </button>
        </div>
      </aside>

      <AvisoActualizacion />

      {pestana === 'mostrador' ? <Vender sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'caja' ? <Caja sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'productos' ? <Productos sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'inventario' ? <Inventario sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'ventas' ? <Ventas sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'usuarios' ? <Usuarios /> : null}
    </div>
  );
}
