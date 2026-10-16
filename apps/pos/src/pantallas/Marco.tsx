import { useState } from 'react';
import type { Sesion } from '../api/tipos';
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
 */
export function Marco({ sesion, onSalir }: Props) {
  const [pestana, setPestana] = useState<Pestana>('mostrador');
  const [sucursalId, setSucursalId] = useState(sesion.sucursales[0]?.id ?? '');

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

  return (
    <div className="app">
      <header className="barra">
        <div className="marca">
          <span className="marca__punto" aria-hidden="true" />
          {sesion.empresa.nombre || 'Mostrador'}
          <span>punto de venta</span>
        </div>

        <nav className="pestanas" aria-label="Secciones">
          {opciones.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              className={opcion.id === pestana ? 'pestana pestana--activa' : 'pestana'}
              onClick={() => setPestana(opcion.id)}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </nav>

        <div className="barra__datos">
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
          <button type="button" className="boton boton--fantasma" onClick={onSalir}>
            Salir
          </button>
        </div>
      </header>

      {pestana === 'mostrador' ? <Vender sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'caja' ? <Caja sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'productos' ? <Productos sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'inventario' ? <Inventario sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'ventas' ? <Ventas sesion={sesion} sucursalId={sucursalId} /> : null}
      {pestana === 'usuarios' ? <Usuarios /> : null}
    </div>
  );
}
