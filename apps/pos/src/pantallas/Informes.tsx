import { useState } from 'react';
import { api } from '../api/cliente';
import type { Sesion, VentaResumen } from '../api/tipos';
import { Aviso, useCarga } from '../util/pantalla';
import { dinero, fechaLarga } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
}

type Periodo = 'hoy' | 'semana' | 'mes';
type Alcance = 'todas' | 'sucursal';

function rangoDe(periodo: Periodo): { desde: string; hasta: string } {
  const ahora = new Date();
  const hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999);
  const desde = new Date(hasta);

  if (periodo === 'hoy') {
    desde.setHours(0, 0, 0, 0);
  } else if (periodo === 'semana') {
    const dia = desde.getDay();
    const hastaLunes = dia === 0 ? 6 : dia - 1;
    desde.setDate(desde.getDate() - hastaLunes);
    desde.setHours(0, 0, 0, 0);
  } else {
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);
  }

  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

function pesos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

function descargarCsv(nombre: string, filas: string[][]): void {
  const texto = filas
    .map((fila) => fila.map((celda) => `"${celda.replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([`\uFEFF${texto}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
}

export function Informes({ sesion, sucursalId }: Props) {
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const [alcance, setAlcance] = useState<Alcance>('todas');
  const { desde, hasta } = rangoDe(periodo);
  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);

  const { datos, cargando, error } = useCarga(
    () =>
      api.ventas({
        ...(alcance === 'sucursal' ? { sucursalId } : {}),
        desde,
        hasta,
        limite: 200,
      }),
    [periodo, alcance, sucursalId],
  );

  const ventas = datos?.ventas ?? [];
  const completadas = ventas.filter((venta) => venta.estado === 'completada');
  const vendido = completadas.reduce((total, venta) => total + venta.total, 0);
  const nombreSucursal = new Map(sesion.sucursales.map((opcion) => [opcion.id, opcion.nombre]));

  function exportar(): void {
    const filas = [
      ['Folio', 'Fecha', 'Estado', 'Sucursal', 'Vendedor', 'Articulos', 'Total CUP'],
      ...ventas.map((venta) => [
        venta.folio,
        fechaLarga(venta.vendidoEn),
        venta.estado,
        nombreSucursal.get(venta.sucursalId) ?? venta.sucursalId,
        venta.vendidoPor,
        String(venta.articulos),
        pesos(venta.total),
      ]),
    ];
    const dia = new Date().toISOString().slice(0, 10);
    descargarCsv(`ventas-${dia}.csv`, filas);
  }

  return (
    <div className="panel">
      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Informes</h1>
          <p className="panel__nota">
            Ventas, utilidad, productos más vendidos y exportación a Excel/PDF.
          </p>
        </div>
        <div className="barra-filtros">
          <button type="button" className="boton" onClick={exportar} disabled={ventas.length === 0}>
            Exportar Excel (CSV)
          </button>
          <button type="button" className="boton" onClick={() => window.print()}>
            Imprimir / PDF
          </button>
        </div>
      </div>

      <div className="barra-filtros">
        <div className="pestanas" aria-label="Período">
          {(
            [
              ['hoy', 'Hoy'],
              ['semana', 'Semana'],
              ['mes', 'Mes'],
            ] as const
          ).map(([id, etiqueta]) => (
            <button
              key={id}
              type="button"
              className={periodo === id ? 'pestana pestana--activa' : 'pestana'}
              onClick={() => setPeriodo(id)}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        <div className="pestanas" aria-label="Alcance">
          <button
            type="button"
            className={alcance === 'todas' ? 'pestana pestana--activa' : 'pestana'}
            onClick={() => setAlcance('todas')}
          >
            Todas
          </button>
          <button
            type="button"
            className={alcance === 'sucursal' ? 'pestana pestana--activa' : 'pestana'}
            onClick={() => setAlcance('sucursal')}
          >
            {sucursal?.codigo ?? 'Sucursal'}
          </button>
        </div>
      </div>

      <Aviso error={error} />

      <div className="rejilla-tarjetas">
        <div className="tarjeta tarjeta--destacada">
          <p className="tarjeta__titulo">Ventas</p>
          <p className="cifra-grande">{cargando ? '…' : dinero(vendido)}</p>
          <p className="panel__nota">{completadas.length} operaciones completadas</p>
        </div>
        <div className="tarjeta">
          <p className="tarjeta__titulo">Utilidad</p>
          <p className="cifra-grande">—</p>
          <p className="panel__nota">Hace falta el costo de cada línea vendida. No se estima a ojo.</p>
        </div>
        <div className="tarjeta">
          <p className="tarjeta__titulo">Más vendidos</p>
          <p className="cifra-grande">—</p>
          <p className="panel__nota">El listado de ventas no trae el detalle de productos.</p>
        </div>
      </div>

      {cargando ? <p className="panel__nota">Cargando…</p> : null}

      {!cargando && ventas.length === 0 ? (
        <div className="tarjeta">
          <p className="vacio">No hay ventas en este período.</p>
        </div>
      ) : null}

      {ventas.length > 0 ? (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Folio</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Sucursal</th>
                <th className="numero">Artículos</th>
                <th className="numero">Total</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((venta: VentaResumen) => (
                <tr key={venta.id}>
                  <td className="codigo">{venta.folio}</td>
                  <td>{fechaLarga(venta.vendidoEn)}</td>
                  <td>{venta.estado}</td>
                  <td>{nombreSucursal.get(venta.sucursalId) ?? '—'}</td>
                  <td className="numero">{venta.articulos}</td>
                  <td className="numero">{dinero(venta.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
