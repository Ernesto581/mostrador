import { schema, type Db } from '@mostrador/db-cloud';
import { PERMISOS_ADMINISTRADOR, PERMISOS_ALMACENISTA, PERMISOS_CAJERO, PERMISOS_CONTADOR } from '../auth/permisos.js';
import { hashearSecreto } from '../auth/password.js';
import { nuevoId } from '../util/id.js';

export interface OpcionesSemilla {
  nombreEmpresa?: string;
  nombreSucursal?: string;
  codigoSucursal?: string;
  usuario?: string;
  nombreUsuario?: string;
  password?: string;
}

export interface ResultadoSemilla {
  empresaId: string;
  sucursalId: string;
  almacenId: string;
  usuarioId: string;
  usuario: string;
  password: string;
}

/** Crea la empresa, la sucursal, los roles y el usuario administrador inicial. */
export async function sembrarDatosIniciales(
  db: Db,
  opciones: OpcionesSemilla = {},
): Promise<ResultadoSemilla> {
  const nombreEmpresa = opciones.nombreEmpresa ?? 'Mi Tienda';
  const nombreSucursal = opciones.nombreSucursal ?? 'Sucursal Principal';
  const codigoSucursal = opciones.codigoSucursal ?? 'CENTRO';
  const usuario = opciones.usuario ?? 'admin';
  const nombreUsuario = opciones.nombreUsuario ?? 'Administrador';
  const password = opciones.password ?? 'mostrador123';

  const empresaId = nuevoId();
  const sucursalId = nuevoId();
  const almacenId = nuevoId();
  const usuarioId = nuevoId();

  await db.insert(schema.companies).values({
    id: empresaId,
    name: nombreEmpresa,
    currency: 'MXN',
    pricesIncludeTax: true,
    defaultTaxRate: 0,
  });

  await db.insert(schema.branches).values({
    id: sucursalId,
    companyId: empresaId,
    code: codigoSucursal,
    name: nombreSucursal,
    type: 'tienda',
  });

  await db.insert(schema.warehouses).values({
    id: almacenId,
    branchId: sucursalId,
    code: 'P1',
    name: 'Principal',
  });

  const roles = [
    { code: 'administrador', name: 'Administrador', permisos: PERMISOS_ADMINISTRADOR },
    { code: 'cajero', name: 'Cajero', permisos: PERMISOS_CAJERO },
    { code: 'almacenista', name: 'Almacenista', permisos: PERMISOS_ALMACENISTA },
    { code: 'contador', name: 'Contador', permisos: PERMISOS_CONTADOR },
  ].map((rol) => ({ ...rol, id: nuevoId(), companyId: empresaId }));

  await db.insert(schema.roles).values(
    roles.map((rol) => ({
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

  await db.insert(schema.userRoles).values({
    userId: usuarioId,
    roleId: roles[0]!.id,
  });

  await db.insert(schema.userBranchAccess).values({
    userId: usuarioId,
    branchId: sucursalId,
  });

  return { empresaId, sucursalId, almacenId, usuarioId, usuario, password };
}
