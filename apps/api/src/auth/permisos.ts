/**
 * Permisos granulares.
 *
 * Se validan SIEMPRE en el servidor; el celular solo los usa para mostrar u
 * ocultar botones. Ocultar un boton no es seguridad.
 */
export const PERMISOS = {
  VENDER: 'sale.sell',
  APLICAR_DESCUENTO: 'sale.discount',
  CANCELAR_VENTA: 'sale.void',
  CERRAR_CAJA: 'cash.close',
  AJUSTAR_INVENTARIO: 'inventory.adjust',
  TRANSFERIR_INVENTARIO: 'inventory.transfer',
  GESTIONAR_CATALOGO: 'catalog.manage',
  GESTIONAR_PROVEEDORES: 'suppliers.manage',
  VER_UTILIDAD: 'report.profit',
  CERRAR_PERIODO: 'accounting.close_period',
  GESTIONAR_USUARIOS: 'users.manage',
  APROBAR_DISPOSITIVOS: 'devices.approve',
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

export const PERMISOS_ADMINISTRADOR: readonly Permiso[] = Object.values(PERMISOS);

export const PERMISOS_CAJERO: readonly Permiso[] = [
  PERMISOS.VENDER,
  PERMISOS.APLICAR_DESCUENTO,
  PERMISOS.CERRAR_CAJA,
];

export const PERMISOS_ALMACENISTA: readonly Permiso[] = [
  PERMISOS.AJUSTAR_INVENTARIO,
  PERMISOS.TRANSFERIR_INVENTARIO,
  PERMISOS.GESTIONAR_CATALOGO,
];

export const PERMISOS_CONTADOR: readonly Permiso[] = [
  PERMISOS.VER_UTILIDAD,
  PERMISOS.CERRAR_PERIODO,
  PERMISOS.GESTIONAR_PROVEEDORES,
];
