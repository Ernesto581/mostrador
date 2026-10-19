import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Sesion } from '../api/tipos';
import { AvisoActualizacion } from '../componentes/AvisoActualizacion';
import { IndicadorConexion } from '../componentes/IndicadorConexion';
import { buscarActualizacion, versionActual, type VersionNueva } from '../servicios/actualizacion';
import { Caja } from './Caja';
import { Inventario } from './Inventario';
import { Sucursales } from './Sucursales';
import { Usuarios } from './Usuarios';
import { Vender } from './Vender';
import { Ventas } from './Ventas';

type Pestana = 'mostrador' | 'caja' | 'inventario' | 'ventas' | 'usuarios' | 'sucursales';

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
/**
 * Secciones del panel, segun lo que puede hacer cada quien.
 *
 * El administrador GESTIONA: cobrar y cerrar turno son de la cuenta de mostrador, asi
 * que esas secciones solo aparecen si de verdad se tiene el permiso. El servidor lo
 * valida igual: esconder el boton no es seguridad.
 */
function opcionesDe(sesion: Sesion): { id: Pestana; etiqueta: string }[] {
  const permisos = new Set(sesion.permisos);

  return [
    ...(permisos.has('sale.sell') ? [{ id: 'mostrador' as Pestana, etiqueta: 'Mostrador' }] : []),
    ...(permisos.has('cash.close') ? [{ id: 'caja' as Pestana, etiqueta: 'Caja' }] : []),
    ...(permisos.has('inventory.adjust') || permisos.has('catalog.manage')
      ? [{ id: 'inventario' as Pestana, etiqueta: 'Inventario' }]
      : []),
    ...(permisos.has('sale.void') ? [{ id: 'ventas' as Pestana, etiqueta: 'Ventas' }] : []),
    ...(permisos.has('users.manage') ? [{ id: 'usuarios' as Pestana, etiqueta: 'Usuarios' }] : []),
    ...(permisos.has('branches.manage')
      ? [{ id: 'sucursales' as Pestana, etiqueta: 'Sucursales' }]
      : []),
  ];
}

/** Iconos del menu de escritorio, dibujados en linea para no agregar dependencias. */
function IconoSeccion({ seccion }: { seccion: Pestana }) {
  const trazos: Record<Pestana, ReactNode> = {
    mostrador: <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 1.9-1.5L22 8H6M10 21h.01M18 21h.01" />,
    caja: <><path d="M3 9h18v11H3zM7 9V5h10v4" /><path d="M8 13h8" /></>,
    inventario: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8M12 13v9" /></>,
    ventas: <><path d="M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21z" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    usuarios: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5" /></>,
    sucursales: <><path d="M3 10h18v10H3zM2 10l2-6h16l2 6M8 20v-6h5v6" /><path d="M7 8h.01M12 8h.01M17 8h.01" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {trazos[seccion]}
    </svg>
  );
}

export function Marco({ sesion, onSalir }: Props) {
  const opciones = opcionesDe(sesion);
  // Se abre en la primera seccion que le toca a esta cuenta.
  const [pestana, setPestana] = useState<Pestana>(() => opcionesDe(sesion)[0]?.id ?? 'inventario');
  const [sucursalId, setSucursalId] = useState(sesion.sucursales[0]?.id ?? '');
  const [busquedaInventario, setBusquedaInventario] = useState('');
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [nueva, setNueva] = useState<VersionNueva | null>(null);
  const [revision, setRevision] = useState<'inicial' | 'revisando' | 'aldia' | 'nueva' | 'sinRevisar'>(
    'inicial',
  );
  const [avisoOculto, setAvisoOculto] = useState(false);

  /** Pregunta si hay una version mas nueva. Tambien se puede lanzar a mano. */
  const revisar = useCallback(async () => {
    setRevision('revisando');
    const resultado = await buscarActualizacion();

    if (resultado.estado === 'nueva') {
      setNueva(resultado.version);
      setAvisoOculto(false);
      setRevision('nueva');
      return;
    }

    setRevision(resultado.estado === 'aldia' ? 'aldia' : 'sinRevisar');
  }, []);

  // Al abrir, y de nuevo si vuelve la senal: en el telefono es comun abrir la app
  // sin internet, y si no se reintentara nunca se enteraria de las versiones nuevas.
  useEffect(() => {
    void revisar();

    const alVolver = () => {
      void revisar();
    };
    window.addEventListener('online', alVolver);

    return () => window.removeEventListener('online', alVolver);
  }, [revisar]);

  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);
  // Si la seccion guardada no existe para esta cuenta, se muestra la primera.
  const seccion = opciones.find((opcion) => opcion.id === pestana) ?? opciones[0];

  // El menu solo tiene sentido en el telefono: si la ventana se agranda (o el
  // telefono se acuesta y ya cabe la barra completa) se cierra solo.
  useEffect(() => {
    const ancho = window.matchMedia('(min-width: 768px)');
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
      <aside className="barra-lateral-escritorio" aria-label="Navegacion principal">
        <div className="barra-lateral__marca">
          <svg className="barra-lateral__carrito" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M3 5h3l3.2 16.1a2.8 2.8 0 0 0 2.7 2.2h12.2a2.8 2.8 0 0 0 2.7-2.1L30 10H8" />
            <circle cx="13" cy="28" r="1.5" />
            <circle cx="24" cy="28" r="1.5" />
          </svg>
          <span className="barra-lateral__nombre">{sesion.empresa.nombre || 'MI TIENDA'}</span>
          <span className="barra-lateral__lema">PUNTO DE VENTA</span>
        </div>

        <nav className="barra-lateral__opciones" aria-label="Secciones">
          {opciones.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              className={opcion.id === pestana ? 'barra-lateral__opcion barra-lateral__opcion--activa' : 'barra-lateral__opcion'}
              aria-current={opcion.id === pestana ? 'page' : undefined}
              onClick={() => elegir(opcion.id)}
            >
              <IconoSeccion seccion={opcion.id} />
              <span>{opcion.etiqueta}</span>
            </button>
          ))}
        </nav>

        <div className="barra-lateral__pie">
          <span className="barra-lateral__estado">
            <span className="barra-lateral__estado-punto" aria-hidden="true" />
            Sucursal activa
          </span>
          <span>{sucursal?.codigo} · {sucursal?.nombre}</span>
        </div>
      </aside>

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

        <div className="marca barra__marca">
          <span className="marca__punto" aria-hidden="true" />
          <span className="marca__nombre">{sesion.empresa.nombre || 'Mostrador'}</span>
          <span className="marca__lema">punto de venta</span>
        </div>

        <nav className="pestanas barra__pestanas" aria-label="Secciones">
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

        {seccion?.id === 'inventario' ? (
          <label className="barra__busqueda">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              value={busquedaInventario}
              onChange={(evento) => setBusquedaInventario(evento.target.value)}
              placeholder="Buscar productos..."
              aria-label="Buscar productos del inventario"
            />
          </label>
        ) : null}

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
            <span className="marca__nombre">{sesion.empresa.nombre || 'Mostrador'}</span>
            <span className="marca__lema">punto de venta</span>
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

          <div className="menu-lateral__version">
            <span className="vendedor">
              {versionActual ? `Version ${versionActual}` : 'Version de desarrollo'}
            </span>
            <button
              type="button"
              className="boton boton--fantasma"
              onClick={() => void revisar()}
              disabled={revision === 'revisando'}
            >
              {revision === 'revisando' ? 'Revisando…' : 'Buscar actualizacion'}
            </button>
            {revision === 'aldia' ? (
              <span className="menu-lateral__nota">Esta es la ultima version</span>
            ) : null}
            {revision === 'nueva' ? (
              <span className="menu-lateral__nota menu-lateral__nota--nueva">
                Hay una version nueva: usa el aviso de arriba
              </span>
            ) : null}
            {revision === 'sinRevisar' ? (
              <span className="menu-lateral__nota">No se pudo revisar: sin internet</span>
            ) : null}
          </div>
        </div>
      </aside>

      {nueva && !avisoOculto ? (
        <AvisoActualizacion version={nueva} onDescartar={() => setAvisoOculto(true)} />
      ) : null}

      {seccion?.id === 'mostrador' ? <Vender sesion={sesion} sucursalId={sucursalId} /> : null}
      {seccion?.id === 'caja' ? <Caja sesion={sesion} sucursalId={sucursalId} /> : null}
      {seccion?.id === 'inventario' ? (
        <Inventario
          sesion={sesion}
          sucursalId={sucursalId}
          busquedaExterna={busquedaInventario}
          alCambiarBusqueda={setBusquedaInventario}
        />
      ) : null}
      {seccion?.id === 'ventas' ? <Ventas sesion={sesion} sucursalId={sucursalId} /> : null}
      {seccion?.id === 'usuarios' ? <Usuarios /> : null}
      {seccion?.id === 'sucursales' ? <Sucursales /> : null}
    </div>
  );
}
