# Modelo de datos

Base de datos de la nube en **PostgreSQL** (paquete `@mostrador/db-cloud`, 39 tablas).
En desarrollo y pruebas se usa **PGlite** (PostgreSQL real embebido), asi que no hace
falta instalar ningun servidor para trabajar.

Las migraciones viven en `packages/db-cloud/drizzle/`.

## Reglas del modelo

1. **Identificadores ULID en texto**, generados por el dispositivo que crea el dato.
   Reenviar la misma operacion no duplica nada: cae siempre en la misma fila.
2. **Los importes van en centavos enteros** (`integer`). Nunca decimales.
3. **Borrado logico** (`deleted_at`): nada se borra de verdad, para no perder historia.
4. **El kardex y las lineas de venta son append-only**: no se actualizan ni se borran.
   El stock y la utilidad se derivan de ellos.
5. Cada entidad sincronizable lleva `origin_branch_id` y `revision` para ordenar y
   resolver empates entre sucursales.

## Tablas por dominio

### Organizacion y acceso
| Tabla | Que guarda |
|---|---|
| `companies` | La empresa: moneda, si el precio ya incluye impuesto, tasa por defecto |
| `branches` | Sucursales (tipo tienda o almacen), con codigo unico por empresa |
| `warehouses` | Ubicaciones de cada sucursal: `piso_venta` (de aqui se vende) o `almacen` (reserva) |
| `users` | Usuarios, con credencial y PIN para el mostrador |
| `roles` | Roles con su lista de permisos |
| `user_roles` | Que roles tiene cada usuario |
| `user_branch_access` | A que sucursales puede entrar cada usuario |
| `devices` | Telefonos autorizados: pendiente, aprobado o revocado |

### Catalogo
| Tabla | Que guarda |
|---|---|
| `categories` | Categorias (con jerarquia) |
| `units_of_measure` | Unidades de medida |
| `suppliers` | Proveedores |
| `customers` | Clientes |
| `products` | Producto: SKU, costo capturado, costo promedio, precio de venta, minimo |
| `product_barcodes` | Codigos de barras (unico por empresa) |

### Inventario
| Tabla | Que guarda |
|---|---|
| `inventory_movements` | **El kardex**: libro de movimientos append-only. El stock es su suma con signo |
| `stock_balances` | Saldo por producto, sucursal y almacen (derivado del kardex) |
| `stock_min_rules` | Minimos, maximos y punto de reorden |
| `transfers` | Transferencias entre ubicaciones: `borrador`, `en_transito`, `recibida`, `rechazada`, `cancelada`. Dentro del mismo local queda `recibida` al crearla |
| `transfer_lines` | Lineas de la transferencia: cantidad enviada y cantidad realmente recibida |

### Ventas
| Tabla | Que guarda |
|---|---|
| `cash_registers` | Cajas fisicas de la sucursal |
| `shifts` | Turnos: fondo inicial, apertura y cierre |
| `sales` | Ventas con folio por sucursal, totales y cambio entregado |
| `sale_lines` | Lineas con nombre, precio y **costo usado al momento de vender** |
| `sale_payments` | Pagos por metodo (permite cobro mixto) |
| `cash_movements` | Ingresos, retiros y gastos pagados de la caja |
| `cash_closures` | Arqueos por turno y consolidado del dia |
| `returns` / `return_lines` | Devoluciones parciales o totales, con reingreso de stock |
| `sale_voids` | Cancelaciones con motivo |

### Contabilidad
| Tabla | Que guarda |
|---|---|
| `accounting_periods` | Periodos mensuales con cierre y bloqueo |
| `chart_of_accounts` | Catalogo de cuentas |
| `journal_entries` / `journal_lines` | Polizas y renglones (debe y haber) |
| `accounting_rules` | Reglas: evento de negocio hacia cuentas |
| `expense_categories` / `expenses` | Categorias y gastos del negocio |
| `accounts_payable` | Cuentas por pagar a proveedores |

### Plataforma
| Tabla | Que guarda |
|---|---|
| `change_feed` | Bitacora con consecutivo creciente; los dispositivos piden cambios por cursor |
| `audit_log` | Quien cambio que, cuando y desde que dispositivo |

## Comandos

```bash
# Regenerar las migraciones despues de cambiar el esquema
npm run db:generate -w @mostrador/db-cloud

# Probar el esquema contra un PostgreSQL real (embebido)
npm test -w @mostrador/db-cloud
```
