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
  GESTIONAR_SUCURSALES: 'branches.manage',
  APROBAR_DISPOSITIVOS: 'devices.approve',
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

/**
 * El administrador GESTIONA, no atiende el mostrador.
 *
 * A proposito no tiene `sale.sell` ni `cash.close`: cobrar y cerrar turno son de las
 * cuentas de las sucursales (rol Cajero). Asi queda claro quien cobro cada venta y
 * quien cerro cada turno, en vez de que una sola cuenta lo pueda todo.
 *
 * Se aplica tambien en el servidor: no es solo esconder botones.
 */
export const PERMISOS_ADMINISTRADOR: readonly Permiso[] = Object.values(PERMISOS).filter(
  (permiso) => permiso !== PERMISOS.VENDER && permiso !== PERMISOS.CERRAR_CAJA,
);

/** La cuenta que se usa en la sucursal para cobrar y cerrar el turno. */
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
