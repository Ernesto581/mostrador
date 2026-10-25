import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Sesion } from '../api/tipos';
import { AvisoActualizacion } from '../componentes/AvisoActualizacion';
import { IndicadorConexion } from '../componentes/IndicadorConexion';
import { buscarActualizacion, versionActual, type VersionNueva } from '../servicios/actualizacion';
import { Caja } from './Caja';
import { Gastos } from './Gastos';
import { Informes } from './Informes';
import { Inventario } from './Inventario';
import { Panel } from './Panel';
import { Sucursales } from './Sucursales';
import { Usuarios } from './Usuarios';
import { Vender } from './Vender';
import { Ventas } from './Ventas';

type Seccion =
  | 'panel'
  | 'productos'
  | 'inventario'
  | 'transferencias'
  | 'cajas'
  | 'gastos'
  | 'informes'
  | 'mostrador'
  | 'caja'
  | 'ventas'
  | 'usuarios'
  | 'sucursales';

interface OpcionMenu {
  id: Seccion;
  etiqueta: string;
  etiquetaCorta: string;
  descripcion?: string;
  grupo: 'principal' | 'configuracion' | 'mostrador';
}

interface Props {
  sesion: Sesion;
  onSalir: () => void;
}

/**
 * Marco de la aplicacion.
 *
 * Quien cobra ve el mostrador. Quien administra ve el panel: las siete secciones
 * del negocio, con usuarios y sucursales aparte para no perderlos.
 * El servidor valida cada accion igual: esconder un boton no es seguridad.
 */
function esAdministracion(sesion: Sesion): boolean {
  return !sesion.permisos.includes('sale.sell');
}

function opcionesDe(sesion: Sesion): OpcionMenu[] {
  const permisos = new Set(sesion.permisos);

  if (!esAdministracion(sesion)) {
    return [
      ...(permisos.has('sale.sell')
        ? [{ id: 'mostrador' as const, etiqueta: 'Mostrador', etiquetaCorta: 'Mostrador', grupo: 'mostrador' as const }]
        : []),
      ...(permisos.has('cash.close')
        ? [{ id: 'caja' as const, etiqueta: 'Caja', etiquetaCorta: 'Caja', grupo: 'mostrador' as const }]
        : []),
      ...(permisos.has('inventory.adjust') || permisos.has('catalog.manage')
        ? [{ id: 'inventario' as const, etiqueta: 'Inventario', etiquetaCorta: 'Inventario', grupo: 'mostrador' as const }]
        : []),
      ...(permisos.has('sale.void')
        ? [{ id: 'ventas' as const, etiqueta: 'Ventas', etiquetaCorta: 'Ventas', grupo: 'mostrador' as const }]
        : []),
      ...(permisos.has('users.manage')
        ? [{ id: 'usuarios' as const, etiqueta: 'Usuarios', etiquetaCorta: 'Usuarios', grupo: 'configuracion' as const }]
        : []),
      ...(permisos.has('branches.manage')
        ? [{ id: 'sucursales' as const, etiqueta: 'Sucursales', etiquetaCorta: 'Sucursales', grupo: 'configuracion' as const }]
        : []),
    ];
  }

  return [
    {
      id: 'panel',
      etiqueta: 'Panel',
      etiquetaCorta: 'Panel',
      descripcion: 'Resumen de ventas, ingresos, gastos, utilidad y alertas de inventario.',
      grupo: 'principal',
    },
    ...(permisos.has('inventory.adjust')
      ? [
          {
            id: 'inventario' as const,
            etiqueta: 'Inventario',
            etiquetaCorta: 'Inventario',
            descripcion: 'Existencias por ubicaciÃ³n, entradas, salidas, mermas y stock mÃ­nimo.',
            grupo: 'principal' as const,
          },
        ]
      : []),
    ...(permisos.has('inventory.transfer')
      ? [
          {
            id: 'transferencias' as const,
            etiqueta: 'Transferencias',
            etiquetaCorta: 'Transferencias',
            descripcion: 'Traslados de productos entre tiendas y almacenes.',
            grupo: 'principal' as const,
          },
        ]
      : []),
    ...(permisos.has('sale.void') || permisos.has('report.profit') || permisos.has('cash.close')
      ? [
          {
            id: 'cajas' as const,
            etiqueta: 'Cajas y turnos',
            etiquetaCorta: 'Cajas',
            descripcion: 'Aperturas, cierres, efectivo esperado, diferencias y pagos.',
            grupo: 'principal' as const,
          },
        ]
      : []),
    ...(permisos.has('suppliers.manage') || permisos.has('accounting.close_period')
      ? [
          {
            id: 'gastos' as const,
            etiqueta: 'Gastos y compras',
            etiquetaCorta: 'Gastos',
            descripcion: 'Registro de gastos, compras a proveedores y cuentas asociadas.',
            grupo: 'principal' as const,
          },
        ]
      : []),
    ...(permisos.has('report.profit') || permisos.has('sale.void')
      ? [
          {
            id: 'informes' as const,
            etiqueta: 'Informes',
            etiquetaCorta: 'Informes',
            descripcion: 'Ventas, utilidad, productos mÃ¡s vendidos y exportaciÃ³n a Excel/PDF.',
            grupo: 'principal' as const,
          },
        ]
      : []),
    ...(permisos.has('users.manage')
      ? [{ id: 'usuarios' as const, etiqueta: 'Usuarios', etiquetaCorta: 'Usuarios', grupo: 'configuracion' as const }]
      : []),
    ...(permisos.has('branches.manage')
      ? [
          {
            id: 'sucursales' as const,
            etiqueta: 'Sucursales',
            etiquetaCorta: 'Sucursales',
            grupo: 'configuracion' as const,
          },
        ]
      : []),
  ];
}

/** Iconos del menu, dibujados en linea para no agregar dependencias. */
function IconoSeccion({ seccion }: { seccion: Seccion }) {
  const trazos: Record<Seccion, ReactNode> = {
    panel: (
      <>
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.4" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4" />
      </>
    ),
    productos: (
      <>
        <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3" />
        <path d="M8 8v8M11 8v8M13 8v8M16 8v8" />
      </>
    ),
    inventario: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="M3 8v9l9 5 9-5V8M12 13v9" />
      </>
    ),
    transferencias: (
      <>
        <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
        <path d="M17 4.5V9M7 15v4.5" />
      </>
    ),
    cajas: (
      <>
        <path d="M3 9h18v11H3zM7 9V5h10v4" />
        <path d="M8 13h8" />
      </>
    ),
    gastos: (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M15 3v3h3M9 11h6M9 15h6M9 19h3" />
      </>
    ),
    informes: (
      <>
        <path d="M4 19V5M4 19h16" />
        <path d="M8 16v-5M12 16V8M16 16v-3" />
      </>
    ),
    mostrador: <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 1.9-1.5L22 8H6M10 21h.01M18 21h.01" />,
    caja: (
      <>
        <path d="M3 9h18v11H3zM7 9V5h10v4" />
        <path d="M8 13h8" />
      </>
    ),
    ventas: (
      <>
        <path d="M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21z" />
        <path d="M8 8h8M8 12h8M8 16h4" />
      </>
    ),
    usuarios: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5" />
      </>
    ),
    sucursales: (
      <>
        <path d="M3 10h18v10H3zM2 10l2-6h16l2 6M8 20v-6h5v6" />
        <path d="M7 8h.01M12 8h.01M17 8h.01" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {trazos[seccion]}
    </svg>
  );
}

function ListaMenu({
  opciones,
  activa,
  onElegir,
  variante,
}: {
  opciones: OpcionMenu[];
  activa: Seccion;
  onElegir: (id: Seccion) => void;
  variante: 'escritorio' | 'movil';
}) {
  const grupos: OpcionMenu['grupo'][] = ['principal', 'mostrador', 'configuracion'];

  return (
    <>
      {grupos.map((grupo) => {
        const items = opciones.filter((opcion) => opcion.grupo === grupo);
        if (items.length === 0) {
          return null;
        }

        const etiquetaGrupo = grupo === 'configuracion' ? 'Configuración' : null;

        return (
          <div key={grupo}>
            {etiquetaGrupo ? (
              <p className={variante === 'escritorio' ? 'barra-lateral__grupo' : 'menu-lateral__grupo'}>
                {etiquetaGrupo}
              </p>
            ) : null}
            {items.map((opcion) => {
              const seleccionado = opcion.id === activa;
              if (variante === 'escritorio') {
                return (
                  <button
                    key={opcion.id}
                    type="button"
                    className={[
                      'barra-lateral__opcion',
                      seleccionado ? 'barra-lateral__opcion--activa' : '',
                      opcion.descripcion ? 'barra-lateral__opcion--con-nota' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-current={seleccionado ? 'page' : undefined}
                    onClick={() => onElegir(opcion.id)}
                  >
                    <IconoSeccion seccion={opcion.id} />
                    <span className="barra-lateral__opcion-texto">
                      <span className="barra-lateral__opcion-titulo">{opcion.etiqueta}</span>
                      {opcion.descripcion ? (
                        <span className="barra-lateral__opcion-nota">{opcion.descripcion}</span>
                      ) : null}
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={opcion.id}
                  type="button"
                  className={seleccionado ? 'menu-opcion menu-opcion--activa' : 'menu-opcion'}
                  aria-current={seleccionado ? 'page' : undefined}
                  onClick={() => onElegir(opcion.id)}
                >
                  <IconoSeccion seccion={opcion.id} />
                  <span className="menu-opcion__texto">
                    <span>{opcion.etiqueta}</span>
                    {opcion.descripcion ? (
                      <span className="menu-opcion__nota">{opcion.descripcion}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

export function Marco({ sesion, onSalir }: Props) {
  const admin = esAdministracion(sesion);
  const opciones = opcionesDe(sesion);
  const [pestana, setPestana] = useState<Seccion>(() => opcionesDe(sesion)[0]?.id ?? 'panel');
  const [sucursalId, setSucursalId] = useState(sesion.sucursales[0]?.id ?? '');
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
  const lema = admin ? 'administraciÃ³n' : 'punto de venta';

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

  const elegir = (id: Seccion) => {
    if (!opciones.some((opcion) => opcion.id === id)) {
      return;
    }
    setPestana(id);
    setMenuAbierto(false);
    // Cada seccion es una pantalla distinta: se empieza desde arriba.
    window.scrollTo({ top: 0 });
  };

  return (
    <div className={admin ? 'app app--admin' : 'app'}>
      <aside className={admin ? 'barra-lateral-escritorio barra-lateral-escritorio--admin' : 'barra-lateral-escritorio'} aria-label="Navegacion principal">
        <div className="barra-lateral__marca">
          <svg className="barra-lateral__carrito" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M3 5h3l3.2 16.1a2.8 2.8 0 0 0 2.7 2.2h12.2a2.8 2.8 0 0 0 2.7-2.1L30 10H8" />
            <circle cx="13" cy="28" r="1.5" />
            <circle cx="24" cy="28" r="1.5" />
          </svg>
          <span className="barra-lateral__nombre">{sesion.empresa.nombre || 'MI TIENDA'}</span>
          <span className="barra-lateral__lema">{admin ? 'ADMINISTRACION' : 'PUNTO DE VENTA'}</span>
        </div>

        <nav className="barra-lateral__opciones" aria-label="Secciones">
          <ListaMenu opciones={opciones} activa={pestana} onElegir={elegir} variante="escritorio" />
        </nav>

        <div className="barra-lateral__pie">
          <IndicadorConexion />
          <span className="vendedor">{sesion.usuario.nombre}</span>
          <button type="button" className="boton boton--fantasma barra__salir" onClick={onSalir}>
            Salir
          </button>
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
          <span className="marca__lema">{lema}</span>
        </div>

        <nav className="pestanas barra__pestanas" aria-label="Secciones">
          {opciones.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              className={opcion.id === pestana ? 'pestana pestana--activa' : 'pestana'}
              onClick={() => elegir(opcion.id)}
            >
              {opcion.etiquetaCorta}
            </button>
          ))}
        </nav>

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
            <span className="marca__lema">{lema}</span>
          </div>
          <button
            type="button"
            className="cerrar-menu"
            aria-label="Cerrar el menu"
            onClick={() => setMenuAbierto(false)}
          >
            Ã—
          </button>
        </div>

        <nav className="menu-lateral__opciones" aria-label="Secciones">
          <ListaMenu opciones={opciones} activa={pestana} onElegir={elegir} variante="movil" />
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
                    {opcion.codigo} Â· {opcion.nombre}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="vendedor">
              {sucursal?.codigo} Â· {sucursal?.nombre}
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
              {revision === 'revisando' ? 'Revisandoâ€¦' : 'Buscar actualizacion'}
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

      {seccion?.id === 'panel' ? <Panel sesion={sesion} onIr={elegir} /> : null}
      {seccion?.id === 'mostrador' ? <Vender sesion={sesion} sucursalId={sucursalId} /> : null}
      {seccion?.id === 'caja' ? <Caja sesion={sesion} sucursalId={sucursalId} /> : null}
      {seccion?.id === 'cajas' ? (
        <Caja sesion={sesion} sucursalId={sucursalId} titulo="Cajas y turnos" />
      ) : null}
      {seccion?.id === 'inventario' ? (
        <Inventario
          sesion={sesion}
          sucursalId={sucursalId}
          {...(admin ? { vista: 'existencias' as const } : {})}
        />
      ) : null}
      {seccion?.id === 'transferencias' ? (
        <Inventario sesion={sesion} sucursalId={sucursalId} vista="transferencias" />
      ) : null}
      {seccion?.id === 'gastos' ? <Gastos /> : null}
      {seccion?.id === 'informes' ? <Informes sesion={sesion} sucursalId={sucursalId} /> : null}
      {seccion?.id === 'ventas' ? <Ventas sesion={sesion} sucursalId={sucursalId} /> : null}
      {seccion?.id === 'usuarios' ? <Usuarios /> : null}
      {seccion?.id === 'sucursales' ? <Sucursales /> : null}
    </div>
  );
}



