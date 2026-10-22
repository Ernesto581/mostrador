import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearDbDePrueba, type DbPglite } from '../src/client.js';
import * as t from '../src/schema/index.js';

let db: DbPglite;

const ID = {
  empresa: '01JEMPRESA000000000000000001',
  sucursalNorte: '01JSUCURSALNORTE000000000001',
  sucursalSur: '01JSUCURSALSUR0000000000002',
  almacenNorte: '01JALMACENNORTE000000000001',
  almacenSur: '01JALMACENSUR0000000000002',
  usuario: '01JUSUARIO0000000000000000001',
  rol: '01JROL000000000000000000000001',
  producto: '01JPRODUCTO0000000000000000001',
  producto2: '01JPRODUCTO0000000000000000002',
  turno: '01JTURNO0000000000000000000001',
  venta: '01JVENTA0000000000000000000001',
};

/** Tipos de movimiento que RESTAN stock. */
const SALIDAS = sql`('salida_venta','devolucion_proveedor','ajuste_negativo','merma','transferencia_salida')`;

beforeAll(async () => {
  db = await crearDbDePrueba();

  await db.insert(t.companies).values({
    id: ID.empresa,
    name: 'Mi Tienda',
    currency: 'CUP',
    pricesIncludeTax: true,
    defaultTaxRate: 0,
  });

  await db.insert(t.branches).values([
    { id: ID.sucursalNorte, companyId: ID.empresa, code: 'NORTE', name: 'Sucursal Norte' },
    {
      id: ID.sucursalSur,
      companyId: ID.empresa,
      code: 'SUR',
      name: 'Sucursal Sur',
      type: 'almacen',
    },
  ]);

  await db.insert(t.warehouses).values([
    { id: ID.almacenNorte, branchId: ID.sucursalNorte, code: 'P1', name: 'Principal' },
    { id: ID.almacenSur, branchId: ID.sucursalSur, code: 'P1', name: 'Principal' },
  ]);

  await db.insert(t.users).values({
    id: ID.usuario,
    companyId: ID.empresa,
    username: 'ernesto',
    fullName: 'Ernesto',
  });

  await db.insert(t.roles).values({
    id: ID.rol,
    companyId: ID.empresa,
    code: 'cajero',
    name: 'Cajero',
    permissions: ['sale.sell', 'sale.void'],
  });

  await db.insert(t.products).values([
    {
      id: ID.producto,
      companyId: ID.empresa,
      sku: 'REF-001',
      name: 'Refresco 600 ml',
      costPrice: 800,
      averageCost: 800,
      salePrice: 1500,
      minStock: 12,
    },
    {
      id: ID.producto2,
      companyId: ID.empresa,
      sku: 'GAL-002',
      name: 'Galletas',
      costPrice: 500,
      averageCost: 500,
      salePrice: 1000,
    },
  ]);

  await db.insert(t.productBarcodes).values({
    id: '01JBARCODE0000000000000000001',
    companyId: ID.empresa,
    productId: ID.producto,
    barcode: '7501234567890',
    isPrimary: true,
  });

  await db.insert(t.inventoryMovements).values([
    {
      id: '01JMOV00000000000000000000001',
      companyId: ID.empresa,
      branchId: ID.sucursalNorte,
      warehouseId: ID.almacenNorte,
      productId: ID.producto,
      type: 'inventario_inicial',
      quantity: 40,
      unitCost: 800,
      occurredAt: new Date('2026-10-01T09:00:00Z'),
    },
    {
      id: '01JMOV00000000000000000000002',
      companyId: ID.empresa,
      branchId: ID.sucursalNorte,
      warehouseId: ID.almacenNorte,
      productId: ID.producto,
      type: 'salida_venta',
      quantity: 3,
      unitCost: 800,
      occurredAt: new Date('2026-10-01T10:00:00Z'),
    },
    {
      id: '01JMOV00000000000000000000003',
      companyId: ID.empresa,
      branchId: ID.sucursalSur,
      warehouseId: ID.almacenSur,
      productId: ID.producto,
      type: 'inventario_inicial',
      quantity: 10,
      unitCost: 800,
      occurredAt: new Date('2026-10-01T09:00:00Z'),
    },
  ]);

  await db.insert(t.shifts).values({
    id: ID.turno,
    branchId: ID.sucursalNorte,
    openedByUserId: ID.usuario,
    openedAt: new Date('2026-10-01T09:00:00Z'),
    initialCash: 20000,
  });

  await db.insert(t.sales).values({
    id: ID.venta,
    companyId: ID.empresa,
    branchId: ID.sucursalNorte,
    shiftId: ID.turno,
    folio: 'NORTE-20261001-0001',
    soldByUserId: ID.usuario,
    subtotal: 2500,
    discountTotal: 0,
    taxTotal: 0,
    total: 2500,
    paidTotal: 3000,
    changeGiven: 500,
    itemCount: 2,
    soldAt: new Date('2026-10-01T10:00:00Z'),
  });

  await db.insert(t.saleLines).values([
    {
      id: '01JLINEA00000000000000000001',
      saleId: ID.venta,
      productId: ID.producto,
      lineNumber: 1,
      name: 'Refresco 600 ml',
      quantity: 1,
      unitPrice: 1500,
      total: 1500,
      unitCost: 800,
    },
    {
      id: '01JLINEA00000000000000000002',
      saleId: ID.venta,
      productId: ID.producto2,
      lineNumber: 2,
      name: 'Galletas',
      quantity: 1,
      unitPrice: 1000,
      total: 1000,
      unitCost: 500,
    },
  ]);

  await db.insert(t.salePayments).values([
    {
      id: '01JPAGO000000000000000000001',
      saleId: ID.venta,
      method: 'efectivo',
      amount: 2000,
    },
    {
      id: '01JPAGO000000000000000000002',
      saleId: ID.venta,
      method: 'tarjeta',
      amount: 1000,
      reference: 'AUT-123',
    },
  ]);
});

describe('modelo de datos', () => {
  it('guarda empresa, sucursales, almacenes, usuarios y roles', async () => {
    const empresa = await db.select().from(t.companies);
    const sucursales = await db.select().from(t.branches);
    const roles = await db.select().from(t.roles);

    expect(empresa).toHaveLength(1);
    expect(empresa[0]?.currency).toBe('CUP');
    expect(sucursales).toHaveLength(2);
    expect(sucursales.map((s) => s.code).sort()).toEqual(['NORTE', 'SUR']);
    expect(roles[0]?.permissions).toContain('sale.sell');
  });

  it('el stock es la suma con signo de los movimientos, separado por sucursal', async () => {
    const filas = await db
      .select({
        productId: t.inventoryMovements.productId,
        branchId: t.inventoryMovements.branchId,
        saldo: sql<number>`sum(case when ${t.inventoryMovements.type} in ${SALIDAS} then -${t.inventoryMovements.quantity} else ${t.inventoryMovements.quantity} end)`,
      })
      .from(t.inventoryMovements)
      .groupBy(t.inventoryMovements.productId, t.inventoryMovements.branchId);

    const norte = filas.find((f) => f.branchId === ID.sucursalNorte);
    const sur = filas.find((f) => f.branchId === ID.sucursalSur);

    expect(Number(norte?.saldo)).toBe(37);
    expect(Number(sur?.saldo)).toBe(10);
  });

  it('el kardex es append-only: no tiene columnas de edicion ni borrado', async () => {
    const columnas = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'inventory_movements'`,
    );
    const nombres = columnas.rows.map((fila) => fila.column_name);

    expect(nombres).not.toContain('updated_at');
    expect(nombres).not.toContain('deleted_at');
    expect(nombres).toContain('quantity');
  });

  it('rechaza un codigo de barras repetido en la empresa', async () => {
    await expect(
      db.insert(t.productBarcodes).values({
        id: '01JBARCODE0000000000000000002',
        companyId: ID.empresa,
        productId: ID.producto2,
        barcode: '7501234567890',
      }),
    ).rejects.toThrow();
  });

  it('rechaza dos sucursales con el mismo codigo', async () => {
    await expect(
      db.insert(t.branches).values({
        id: '01JSUCURSALREPETIDA0000000001',
        companyId: ID.empresa,
        code: 'NORTE',
        name: 'Otra',
      }),
    ).rejects.toThrow();
  });

  it('una venta cuadra con sus lineas y sus pagos', async () => {
    const venta = (await db.select().from(t.sales))[0];
    const lineas = await db.select().from(t.saleLines);
    const pagos = await db.select().from(t.salePayments);

    const sumaLineas = lineas.reduce((total, linea) => total + linea.total, 0);
    const sumaPagos = pagos.reduce((total, pago) => total + pago.amount, 0);
    // Utilidad = lo vendido menos el costo guardado en cada linea: (1500-800) + (1000-500).
    const utilidad = lineas.reduce(
      (total, linea) => total + linea.total - linea.unitCost * linea.quantity,
      0,
    );

    expect(venta?.total).toBe(sumaLineas);
    expect(venta?.paidTotal).toBe(sumaPagos);
    expect(venta?.changeGiven).toBe(sumaPagos - (venta?.total ?? 0));
    expect(utilidad).toBe(1200);
  });

  it('el cobro mixto queda registrado por metodo', async () => {
    const pagos = await db.select().from(t.salePayments);
    const porMetodo = new Map(pagos.map((pago) => [pago.method, pago.amount]));
    expect(porMetodo.get('efectivo')).toBe(2000);
    expect(porMetodo.get('tarjeta')).toBe(1000);
  });

  it('la bitacora de cambios avanza con un consecutivo creciente', async () => {
    await db.insert(t.changeFeed).values([
      {
        companyId: ID.empresa,
        entity: 'sales',
        entityId: ID.venta,
        operation: 'upsert',
        payload: { folio: 'NORTE-20261001-0001' },
      },
      {
        companyId: ID.empresa,
        entity: 'inventory_movements',
        entityId: '01JMOV00000000000000000000002',
        operation: 'upsert',
        payload: { type: 'salida_venta' },
      },
    ]);

    const filas = await db.select().from(t.changeFeed);
    expect(filas).toHaveLength(2);
    expect(Number(filas[1]!.seq)).toBeGreaterThan(Number(filas[0]!.seq));
    expect(filas[0]?.payload).toEqual({ folio: 'NORTE-20261001-0001' });
  });
});
