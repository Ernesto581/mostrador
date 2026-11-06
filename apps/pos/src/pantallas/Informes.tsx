import { useState } from 'react';
import { api } from '../api/cliente';
import type { ReporteResumen, Sesion } from '../api/tipos';
import { Aviso, useCarga } from '../util/pantalla';
import { dinero } from '../util/dinero';

interface Props {
  sesion: Sesion;
  sucursalId: string;
}

type Periodo = 'hoy' | 'semana' | 'mes';
type Alcance = 'todas' | 'sucursal';
type OrdenProductos = 'importe' | 'cantidad';

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

function porcentaje(valor: number): string {
  return `${(valor * 100).toFixed(1)}%`;
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
  const [por, setPor] = useState<OrdenProductos>('importe');
  const { desde, hasta } = rangoDe(periodo);
  const sucursal = sesion.sucursales.find((opcion) => opcion.id === sucursalId);

  const { datos, cargando, error } = useCarga(
    () =>
      api.reporteResumen({
        ...(alcance === 'sucursal' ? { sucursalId } : {}),
        desde,
        hasta,
        por,
      }),
    [periodo, alcance, sucursalId, por],
  );

  const reporte: ReporteResumen | null = datos;
  const resumen = reporte?.resumen;
  const tickets = resumen?.tickets ?? 0;

  function exportar(): void {
    if (!reporte) {
      return;
    }

    const filas: string[][] = [
      ['Reporte de ventas'],
      ['Empresa', sesion.empresa.nombre],
      ['Desde', new Date(reporte.rango.desde).toLocaleString('es-ES')],
      ['Hasta', new Date(reporte.rango.hasta).toLocaleString('es-ES')],
      ['Moneda', reporte.moneda],
      [],
      ['Resumen', 'Valor'],
      ['Tickets', String(reporte.resumen.tickets)],
      ['Articulos', String(reporte.resumen.articulos)],
      ['Venta bruta', pesos(reporte.resumen.ventaBruta)],
      ['Venta neta', pesos(reporte.resumen.ventaNeta)],
      ['Impuestos', pesos(reporte.resumen.impuestos)],
      ['Descuentos', pesos(reporte.resumen.descuentos)],
      ['Costo de lo vendido', pesos(reporte.resumen.costo)],
      ['Utilidad', pesos(reporte.resumen.utilidad)],
      ['Margen', porcentaje(reporte.resumen.margen)],
      ['Ticket promedio', pesos(reporte.resumen.ticketPromedio)],
      [],
      ['Pagos', 'Monto', 'Participacion'],
      ...reporte.pagos.map((pago) => [pago.metodo, pesos(pago.monto), porcentaje(pago.porcentaje)]),
      [],
      ['Producto', 'SKU', 'Cantidad', 'Venta', 'Costo', 'Utilidad'],
      ...reporte.masVendidos.map((producto) => [
        producto.nombre,
        producto.sku,
        String(producto.cantidad),
        pesos(producto.venta),
        pesos(producto.costo),
        pesos(producto.utilidad),
      ]),
      [],
      ['Sucursal', 'Tickets', 'Venta bruta', 'Venta neta'],
      ...reporte.porSucursal.map((fila) => [
        `${fila.codigo} - ${fila.nombre}`,
        String(fila.tickets),
        pesos(fila.ventaBruta),
        pesos(fila.ventaNeta),
      ]),
      [],
      ['Dia', 'Tickets', 'Venta bruta'],
      ...reporte.porDia.map((fila) => [fila.dia, String(fila.tickets), pesos(fila.ventaBruta)]),
    ];

    const dia = new Date().toISOString().slice(0, 10);
    descargarCsv(`reporte-ventas-${dia}.csv`, filas);
  }

  return (
    <div className="panel">
      <div className="solo-impresion">
        <h2>{sesion.empresa.nombre}</h2>
        <p>
          Reporte de ventas · {new Date(desde).toLocaleDateString('es-ES')} a{' '}
          {new Date(hasta).toLocaleDateString('es-ES')}
          {alcance === 'sucursal' ? ` · ${sucursal?.nombre ?? ''}` : ''}
        </p>
      </div>

      <div className="panel__cabecera">
        <div>
          <h1 className="panel__titulo">Informes</h1>
          <p className="panel__nota">
            Ventas, utilidad, productos más vendidos y exportación a Excel/PDF.
          </p>
        </div>
        <div className="barra-filtros no-imprimir">
          <button type="button" className="boton" onClick={exportar} disabled={tickets === 0}>
            Exportar reporte (CSV)
          </button>
          <button type="button" className="boton" onClick={() => window.print()}>
            Imprimir / PDF
          </button>
        </div>
      </div>

      <div className="barra-filtros no-imprimir">
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

      {cargando ? <p className="panel__nota">Calculando…</p> : null}

      {!cargando && reporte ? (
        <>
          <div className="rejilla-tarjetas">
            <div className="tarjeta tarjeta--destacada">
              <p className="tarjeta__titulo">Ventas</p>
              <p className="cifra-grande">{dinero(reporte.resumen.ventaBruta)}</p>
              <p className="panel__nota">
                {reporte.resumen.tickets} tickets · {reporte.resumen.articulos} artículos
              </p>
            </div>
            <div className="tarjeta">
              <p className="tarjeta__titulo">Utilidad bruta</p>
              <p className="cifra-grande">{dinero(reporte.resumen.utilidad)}</p>
              <p className="panel__nota">
                Margen {porcentaje(reporte.resumen.margen)} · costo{' '}
                {dinero(reporte.resumen.costo)}
              </p>
            </div>
            <div className="tarjeta">
              <p className="tarjeta__titulo">Ticket promedio</p>
              <p className="cifra-grande">{dinero(reporte.resumen.ticketPromedio)}</p>
              <p className="panel__nota">Impuestos {dinero(reporte.resumen.impuestos)}</p>
            </div>
            <div className="tarjeta">
              <p className="tarjeta__titulo">Descuentos</p>
              <p className="cifra-grande">{dinero(reporte.resumen.descuentos)}</p>
              <p className="panel__nota">Cambio entregado {dinero(reporte.resumen.cambio)}</p>
            </div>
          </div>

          {tickets === 0 ? (
            <div className="tarjeta">
              <p className="vacio">No hay ventas en este período.</p>
            </div>
          ) : (
            <>
              <div className="rejilla-dos">
                <div className="tarjeta">
                  <p className="tarjeta__titulo">Cobros por forma de pago</p>
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Forma</th>
                        <th className="numero">Monto</th>
                        <th className="numero">Participación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reporte.pagos.map((pago) => (
                        <tr key={pago.metodo}>
                          <td>{pago.metodo}</td>
                          <td className="numero">{dinero(pago.monto)}</td>
                          <td className="numero">{porcentaje(pago.porcentaje)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {reporte.porSucursal.length > 1 ? (
                  <div className="tarjeta">
                    <p className="tarjeta__titulo">Ventas por sucursal</p>
                    <table className="tabla">
                      <thead>
                        <tr>
                          <th>Sucursal</th>
                          <th className="numero">Tickets</th>
                          <th className="numero">Venta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reporte.porSucursal.map((fila) => (
                          <tr key={fila.sucursalId}>
                            <td>{fila.nombre}</td>
                            <td className="numero">{fila.tickets}</td>
                            <td className="numero">{dinero(fila.ventaBruta)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              <div className="tarjeta" style={{ marginTop: '0.8rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.8rem',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <p className="tarjeta__titulo" style={{ margin: 0 }}>
                    Productos más vendidos
                  </p>
                  <div className="pestanas no-imprimir" aria-label="Ordenar productos">
                    <button
                      type="button"
                      className={por === 'importe' ? 'pestana pestana--activa' : 'pestana'}
                      onClick={() => setPor('importe')}
                    >
                      Por importe
                    </button>
                    <button
                      type="button"
                      className={por === 'cantidad' ? 'pestana pestana--activa' : 'pestana'}
                      onClick={() => setPor('cantidad')}
                    >
                      Por cantidad
                    </button>
                  </div>
                </div>

                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>SKU</th>
                      <th className="numero">Cantidad</th>
                      <th className="numero">Venta</th>
                      <th className="numero">Utilidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reporte.masVendidos.map((producto) => (
                      <tr key={`${producto.productoId}-${producto.nombre}`}>
                        <td>{producto.nombre}</td>
                        <td className="codigo">{producto.sku}</td>
                        <td className="numero">{producto.cantidad}</td>
                        <td className="numero">{dinero(producto.venta)}</td>
                        <td className="numero">{dinero(producto.utilidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {reporte.porDia.length > 1 ? (
                <div className="tarjeta" style={{ marginTop: '0.8rem' }}>
                  <p className="tarjeta__titulo">Ventas por día</p>
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Día</th>
                        <th className="numero">Tickets</th>
                        <th className="numero">Venta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reporte.porDia.map((fila) => (
                        <tr key={fila.dia}>
                          <td>
                            {new Date(`${fila.dia}T00:00:00`).toLocaleDateString('es-ES')}
                          </td>
                          <td className="numero">{fila.tickets}</td>
                          <td className="numero">{dinero(fila.ventaBruta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
