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

/* ---------- Panel de administracion ---------- */

export interface Categoria {
  id: string;
  nombre: string;
  padreId: string | null;
}

export interface Rol {
  id: string;
  codigo: string;
  nombre: string;
  permisos: string[];
}

export interface FilaStock {
  productoId: string;
  sku: string;
  nombre: string;
  precioVenta: number;
  costoPromedio: number;
  stock: number;
  stockMinimo: number;
  bajoMinimo: boolean;
}

export interface RepartoSucursal {
  sucursalId: string;
  codigo: string;
  nombre: string;
  cantidad: number;
}

export interface FilaStockGeneral {
  productoId: string;
  sku: string;
  nombre: string;
  precioVenta: number;
  costoPromedio: number;
  /** Total sumando todas las sucursales. */
  stock: number;
  stockMinimo: number;
  bajoMinimo: boolean;
  /** Cuanto hay en cada sucursal. */
  reparto: RepartoSucursal[];
}

export type TipoMovimiento =
  | 'inventario_inicial'
  | 'entrada_compra'
  | 'ajuste_positivo'
  | 'ajuste_negativo'
  | 'merma'
  | 'devolucion_proveedor';

export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  cantidad: number;
  costoUnitario: number | null;
  motivo: string | null;
  documentoTipo: string | null;
  documentoFolio: string | null;
  ocurridoEn: string;
  productoId: string;
  producto: string;
  sku: string;
  sucursalId: string;
}

export interface VentaResumen {
  id: string;
  folio: string;
  estado: string;
  vendidoEn: string;
  total: number;
  impuestos: number;
  descuentos: number;
  cambio: number;
  articulos: number;
  sucursalId: string;
  vendidoPor: string;
}

export interface LineaDeVenta {
  id: string;
  saleId: string;
  productId: string | null;
  lineNumber: number;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  baseAmount: number;
  taxAmount: number;
  total: number;
  unitCost: number;
}

export interface PagoDeVenta {
  id: string;
  saleId: string;
  method: MetodoPago;
  amount: number;
  reference: string | null;
}

export interface DetalleVenta {
  venta: {
    id: string;
    folio: string;
    status: string;
    soldAt: string;
    subtotal: number;
    discountTotal: number;
    taxTotal: number;
    total: number;
    paidTotal: number;
    changeGiven: number;
    itemCount: number;
    branchId: string;
  };
  lineas: LineaDeVenta[];
  pagos: PagoDeVenta[];
}

export interface UsuarioDelPanel {
  id: string;
  username: string;
  nombre: string;
  email: string | null;
  activo: boolean;
  roles: string[];
  rolNombres: string[];
  sucursales: Sucursal[];
}
