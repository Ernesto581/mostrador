import { describe, expect, it } from 'vitest';
import type { Sesion, VentaRespuesta } from '../src/api/tipos';
import {
  construirEscPos,
  datosTicketDesdeVenta,
  leerConfigImpresora,
  lineasTicket,
  type DatosTicket,
} from '../src/servicios/impresion';

const datos: DatosTicket = {
  empresa: 'Bodega La Esquina',
  sucursal: 'Sucursal Centro',
  direccion: 'Calle 23 esquina 10, Vedado',
  telefono: '+53 5555 1234',
  moneda: 'CUP',
  folio: 'CENTRO-20261106-0001',
  fecha: '2026-11-06T14:30:00.000Z',
  vendedor: 'Ana Pérez',
  lineas: [
    { nombre: 'Arroz grano largo 1 kg', cantidad: 2, precioUnitario: 1200, descuento: 0, total: 2400 },
    { nombre: 'Refresco de cola 500 ml', cantidad: 1, precioUnitario: 800, descuento: 80, total: 720 },
  ],
  subtotal: 3200,
  descuentoTotal: 80,
  impuestos: 0,
  total: 3120,
  pagado: 5000,
  cambio: 1880,
  pagos: [{ metodo: 'efectivo', monto: 5000 }],
};

describe('ticket', () => {
  it('arma un ticket de 58 mm sin pasarse del ancho', () => {
    const lineas = lineasTicket(datos, 58);
    expect(lineas.every((linea) => linea.length <= 32)).toBe(true);
    expect(lineas.join('\n')).toContain('TICKET DE VENTA');
    expect(lineas.join('\n')).toContain('CENTRO-20261106-0001');
    expect(lineas.join('\n')).toContain('TOTAL');
    expect(lineas.join('\n')).toContain('31.20');
  });

  it('usa mas columnas en 80 mm', () => {
    const lineas = lineasTicket(datos, 80);
    expect(lineas.some((linea) => linea.length > 32)).toBe(true);
    expect(lineas.every((linea) => linea.length <= 48)).toBe(true);
  });

  it('incluye pagos, cambio y datos de la sucursal', () => {
    const texto = lineasTicket(datos, 58).join('\n');
    expect(texto).toContain('Efectivo');
    expect(texto).toContain('50.00');
    expect(texto).toContain('Cambio');
    expect(texto).toContain('18.80');
    expect(texto).toContain('Vedado');
    expect(texto).toContain('Ana Pérez');
  });

  it('genera comandos ESC/POS con inicializacion y corte', () => {
    const bytes = construirEscPos(datos, 58);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(bytes.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]);

    const texto = String.fromCharCode(...bytes);
    expect(texto).not.toContain('á');
    expect(texto).not.toContain('é');
    expect(texto).not.toContain('ó');
    expect(texto).not.toContain('−');
  });

  it('convierte una venta cobrada en datos de ticket', () => {
    const venta: VentaRespuesta = {
      id: 'venta-1',
      folio: 'CENTRO-20261106-0007',
      estado: 'completada',
      vendidoEn: '2026-11-06T15:00:00.000Z',
      subtotal: 2400,
      descuentoTotal: 0,
      impuestos: 240,
      total: 2400,
      pagado: 3000,
      cambio: 600,
      articulos: 2,
      advertencias: [],
      lineas: [
        {
          productoId: 'prod-1',
          nombre: 'Arroz',
          cantidad: 2,
          precioUnitario: 1200,
          descuento: 0,
          impuesto: 240,
          total: 2400,
          costoUnitario: 900,
        },
      ],
      pagos: [{ metodo: 'efectivo', monto: 3000 }],
    };

    const sesion: Sesion = {
      empresa: { nombre: 'Mi Tienda', moneda: 'CUP', preciosConImpuestoIncluido: true },
      usuario: { id: 'u1', username: 'ana', nombre: 'Ana', email: null },
      roles: ['cajero'],
      permisos: ['sale.sell'],
      sucursales: [
        {
          id: 's1',
          codigo: 'CENTRO',
          nombre: 'Sucursal Centro',
          tipo: 'tienda',
          direccion: 'Calle 1',
          telefono: '555',
        },
      ],
    };

    const convertida = datosTicketDesdeVenta(venta, sesion, 's1');
    expect(convertida.empresa).toBe('Mi Tienda');
    expect(convertida.sucursal).toBe('Sucursal Centro');
    expect(convertida.direccion).toBe('Calle 1');
    expect(convertida.vendedor).toBe('Ana');
    expect(convertida.lineas[0]?.total).toBe(2400);
    expect(convertida.pagos[0]?.metodo).toBe('efectivo');
  });
});

describe('configuracion de impresora', () => {
  it('usa navegador y 58 mm por defecto', () => {
    expect(leerConfigImpresora()).toEqual({ modo: 'navegador', ancho: 58 });
  });
});
