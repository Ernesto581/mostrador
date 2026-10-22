import { schema, type Db } from '@mostrador/db-cloud';
import { centavos } from '@mostrador/domain';
import {
  PERMISOS_ADMINISTRADOR,
  PERMISOS_ALMACENISTA,
  PERMISOS_CAJERO,
  PERMISOS_CONTADOR,
} from '../auth/permisos.js';
import { hashearSecreto } from '../auth/password.js';
import { nuevoId } from '../util/id.js';
import { aplicarMovimiento } from '../modules/inventario/servicio.js';

export interface OpcionesSemilla {
  nombreEmpresa?: string;
  usuario?: string;
  nombreUsuario?: string;
  password?: string;
  /** Cuenta de mostrador: es la que cobra y cierra el turno en la sucursal. */
  usuarioCajero?: string;
  passwordCajero?: string;
  /** Crea categorias y 20 productos de abarrotes con stock inicial. */
  conProductosEjemplo?: boolean;
}

export interface ProductoEjemplo {
  id: string;
  sku: string;
  codigo: string;
  nombre: string;
  precioVenta: number;
}

export interface ResultadoSemilla {
  empresaId: string;
  sucursalId: string;
  pisoId: string;
  almacenId: string;
  sucursalSecundariaId: string;
  almacenSecundariaId: string;
  usuarioId: string;
  usuario: string;
  password: string;
  /** Cajero de ejemplo: sirve para vender sin usar la cuenta del administrador. */
  cajeroId: string;
  usuarioCajero: string;
  passwordCajero: string;
  productos: ProductoEjemplo[];
}

interface DefinicionProducto {
  sku: string;
  nombre: string;
  codigo: string;
  costo: number;
  venta: number;
  inicial: number;
  minimo: number;
  categoria: string;
}

const CATEGORIAS = ['Bebidas', 'Botanas', 'Abarrotes', 'Limpieza', 'Dulces'];

const PRODUCTOS: DefinicionProducto[] = [
  { sku: 'BEB-001', nombre: 'Refresco de cola 600 ml', codigo: '7501001100011', costo: 950, venta: 1800, inicial: 48, minimo: 12, categoria: 'Bebidas' },
  { sku: 'BEB-002', nombre: 'Agua natural 1 L', codigo: '7501001100028', costo: 600, venta: 1200, inicial: 60, minimo: 15, categoria: 'Bebidas' },
  { sku: 'BEB-003', nombre: 'Jugo de naranja 1 L', codigo: '7501001100035', costo: 1400, venta: 2500, inicial: 20, minimo: 10, categoria: 'Bebidas' },
  { sku: 'BEB-004', nombre: 'Bebida energetica 250 ml', codigo: '7501001100042', costo: 2200, venta: 3500, inicial: 8, minimo: 10, categoria: 'Bebidas' },
  { sku: 'BOT-001', nombre: 'Papas fritas 45 g', codigo: '7501001100059', costo: 900, venta: 1700, inicial: 30, minimo: 12, categoria: 'Botanas' },
  { sku: 'BOT-002', nombre: 'Cacahuates salados 50 g', codigo: '7501001100066', costo: 700, venta: 1400, inicial: 25, minimo: 10, categoria: 'Botanas' },
  { sku: 'BOT-003', nombre: 'Galletas de chocolate', codigo: '7501001100073', costo: 850, venta: 1600, inicial: 5, minimo: 12, categoria: 'Botanas' },
  { sku: 'ABA-001', nombre: 'Arroz 1 kg', codigo: '7501001100080', costo: 2400, venta: 3600, inicial: 18, minimo: 6, categoria: 'Abarrotes' },
  { sku: 'ABA-002', nombre: 'Frijol 1 kg', codigo: '7501001100097', costo: 2600, venta: 3800, inicial: 15, minimo: 6, categoria: 'Abarrotes' },
  { sku: 'ABA-003', nombre: 'Aceite vegetal 1 L', codigo: '7501001100103', costo: 3200, venta: 4600, inicial: 12, minimo: 6, categoria: 'Abarrotes' },
  { sku: 'ABA-004', nombre: 'Azucar 1 kg', codigo: '7501001100110', costo: 2100, venta: 3000, inicial: 20, minimo: 8, categoria: 'Abarrotes' },
  { sku: 'ABA-005', nombre: 'Sal 1 kg', codigo: '7501001100127', costo: 900, venta: 1500, inicial: 14, minimo: 6, categoria: 'Abarrotes' },
  { sku: 'ABA-006', nombre: 'Cafe molido 250 g', codigo: '7501001100134', costo: 4500, venta: 6500, inicial: 9, minimo: 4, categoria: 'Abarrotes' },
  { sku: 'ABA-007', nombre: 'Atun en agua 140 g', codigo: '7501001100141', costo: 1800, venta: 2800, inicial: 24, minimo: 10, categoria: 'Abarrotes' },
  { sku: 'LIM-001', nombre: 'Jabon de barra', codigo: '7501001100158', costo: 1100, venta: 1900, inicial: 16, minimo: 8, categoria: 'Limpieza' },
  { sku: 'LIM-002', nombre: 'Detergente 1 kg', codigo: '7501001100165', costo: 3500, venta: 5200, inicial: 10, minimo: 5, categoria: 'Limpieza' },
  { sku: 'LIM-003', nombre: 'Cloro 1 L', codigo: '7501001100172', costo: 1500, venta: 2400, inicial: 11, minimo: 6, categoria: 'Limpieza' },
  { sku: 'DUL-001', nombre: 'Chicles 10 piezas', codigo: '7501001100189', costo: 600, venta: 1200, inicial: 40, minimo: 15, categoria: 'Dulces' },
  { sku: 'DUL-002', nombre: 'Chocolate 40 g', codigo: '7501001100196', costo: 1300, venta: 2200, inicial: 22, minimo: 12, categoria: 'Dulces' },
  { sku: 'DUL-003', nombre: 'Paleta de caramelo', codigo: '7501001100202', costo: 300, venta: 700, inicial: 60, minimo: 20, categoria: 'Dulces' },
];

/** Crea la empresa, dos sucursales, los roles, el administrador y un catalogo de ejemplo. */
export async function sembrarDatosIniciales(
  db: Db,
  opciones: OpcionesSemilla = {},
): Promise<ResultadoSemilla> {
  const nombreEmpresa = opciones.nombreEmpresa ?? 'Mi Tienda';
  const usuario = opciones.usuario ?? 'admin';
  const nombreUsuario = opciones.nombreUsuario ?? 'Administrador';
  const password = opciones.password ?? 'mostrador123';
  const usuarioCajero = opciones.usuarioCajero ?? 'cajero';
  const passwordCajero = opciones.passwordCajero ?? 'cajero123';
  const conProductosEjemplo = opciones.conProductosEjemplo ?? true;

  const empresaId = nuevoId();
  const sucursalId = nuevoId();
  const pisoId = nuevoId();
  const almacenId = nuevoId();
  const sucursalSecundariaId = nuevoId();
  const almacenSecundariaId = nuevoId();
  const usuarioId = nuevoId();
  const cajeroId = nuevoId();

  await db.insert(schema.companies).values({
    id: empresaId,
    name: nombreEmpresa,
    currency: 'CUP',
    pricesIncludeTax: true,
    defaultTaxRate: 0,
  });

  await db.insert(schema.branches).values([
    { id: sucursalId, companyId: empresaId, code: 'CENTRO', name: 'Sucursal Centro', type: 'tienda' },
    {
      id: sucursalSecundariaId,
      companyId: empresaId,
      code: 'BODEGA',
      name: 'Bodega',
      type: 'almacen',
    },
  ]);

  await db.insert(schema.warehouses).values([
    { id: pisoId, branchId: sucursalId, code: 'PISO', name: 'Piso de venta', kind: 'piso_venta' },
    { id: almacenId, branchId: sucursalId, code: 'ALM', name: 'Almacen', kind: 'almacen' },
    {
      id: almacenSecundariaId,
      branchId: sucursalSecundariaId,
      code: 'P1',
      name: 'Principal',
      kind: 'almacen',
    },
  ]);

  const definicionesRoles = [
    { code: 'administrador', name: 'Administrador', permisos: PERMISOS_ADMINISTRADOR },
    { code: 'cajero', name: 'Cajero', permisos: PERMISOS_CAJERO },
    { code: 'almacenista', name: 'Almacenista', permisos: PERMISOS_ALMACENISTA },
    { code: 'contador', name: 'Contador', permisos: PERMISOS_CONTADOR },
  ].map((rol) => ({ ...rol, id: nuevoId(), companyId: empresaId }));

  await db.insert(schema.roles).values(
    definicionesRoles.map((rol) => ({
      id: rol.id,
      companyId: rol.companyId,
      code: rol.code,
      name: rol.name,
      permissions: [...rol.permisos],
    })),
  );

  await db.insert(schema.users).values({
    id: usuarioId,
    companyId: empresaId,
    username: usuario,
    fullName: nombreUsuario,
    passwordHash: await hashearSecreto(password),
  });

  await db.insert(schema.userRoles).values({ userId: usuarioId, roleId: definicionesRoles[0]!.id });

  await db.insert(schema.userBranchAccess).values([
    { userId: usuarioId, branchId: sucursalId },
    { userId: usuarioId, branchId: sucursalSecundariaId },
  ]);

  // La cuenta de mostrador: cobra y cierra el turno, pero no administra nada.
  await db.insert(schema.users).values({
    id: cajeroId,
    companyId: empresaId,
    username: usuarioCajero,
    fullName: 'Cajero de mostrador',
    passwordHash: await hashearSecreto(passwordCajero),
  });

  await db.insert(schema.userRoles).values({ userId: cajeroId, roleId: definicionesRoles[1]!.id });

  await db.insert(schema.userBranchAccess).values([
    { userId: cajeroId, branchId: sucursalId },
    { userId: cajeroId, branchId: sucursalSecundariaId },
  ]);

  const productos: ProductoEjemplo[] = [];

  if (conProductosEjemplo) {
    const categorias = new Map<string, string>();
    await db.insert(schema.categories).values(
      CATEGORIAS.map((nombre) => {
        const id = nuevoId();
        categorias.set(nombre, id);
        return { id, companyId: empresaId, name: nombre };
      }),
    );

    await db.transaction(async (tx) => {
      for (const definicion of PRODUCTOS) {
        const productoId = nuevoId();

        await tx.insert(schema.products).values({
          id: productoId,
          companyId: empresaId,
          sku: definicion.sku,
          name: definicion.nombre,
          categoryId: categorias.get(definicion.categoria) ?? null,
          costPrice: definicion.costo,
          averageCost: definicion.costo,
          salePrice: definicion.venta,
          taxRate: 0,
          minStock: definicion.minimo,
        });

        await tx.insert(schema.productBarcodes).values({
          id: nuevoId(),
          companyId: empresaId,
          productId: productoId,
          barcode: definicion.codigo,
          isPrimary: true,
        });

        await aplicarMovimiento(tx, {
          empresaId,
          sucursalId,
          almacenId: pisoId,
          productoId,
          tipo: 'inventario_inicial',
          cantidad: definicion.inicial,
          costoUnitario: centavos(definicion.costo),
          motivo: 'Carga inicial de ejemplo',
          documentoTipo: 'inventario_inicial',
        });

        productos.push({
          id: productoId,
          sku: definicion.sku,
          codigo: definicion.codigo,
          nombre: definicion.nombre,
          precioVenta: definicion.venta,
        });
      }
    });
  }

  return {
    empresaId,
    sucursalId,
    pisoId,
    almacenId,
    sucursalSecundariaId,
    almacenSecundariaId,
    usuarioId,
    usuario,
    password,
    cajeroId,
    usuarioCajero,
    passwordCajero,
    productos,
  };
}
