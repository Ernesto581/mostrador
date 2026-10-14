export interface Empresa {
  nombre: string;
  moneda: string;
  preciosConImpuestoIncluido: boolean;
}

export interface Usuario {
  id: string;
  username: string;
  nombre: string;
  email: string | null;
}

export interface Sucursal {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
}

export interface Sesion {
  empresa: Empresa;
  usuario: Usuario;
  roles: string[];
  permisos: string[];
  sucursales: Sucursal[];
}

export interface Producto {
  id: string;
  sku: string;
  nombre: string;
  precioCosto: number;
  costoPromedio: number;
  precioVenta: number;
  tasaImpuesto: number;
  stockMinimo: number;
  esServicio: boolean;
  categoriaId: string | null;
  stock: number | null;
}

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';

export interface LineaVentaRespuesta {
  productoId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuento: number;
  impuesto: number;
  total: number;
  costoUnitario: number;
}

export interface PagoRespuesta {
  metodo: MetodoPago;
  monto: number;
  referencia?: string;
}

export interface VentaRespuesta {
  id: string;
  folio: string;
  estado: string;
  vendidoEn: string;
  subtotal: number;
  descuentoTotal: number;
  impuestos: number;
  total: number;
  pagado: number;
  cambio: number;
  articulos: number;
  advertencias: string[];
  lineas: LineaVentaRespuesta[];
  pagos: PagoRespuesta[];
}
