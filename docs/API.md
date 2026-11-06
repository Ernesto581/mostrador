# API

Servidor de la nube: **Fastify + Zod**, con PostgreSQL (PGlite en desarrollo, sin instalar nada).

## Como arrancarlo

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"

# 1) Crear los datos iniciales (empresa, 2 sucursales, roles, administrador y 20 productos)
$env:PGLITE_DIR='./.data/pglite'; npm run db:seed -w @mostrador/api

# 2) Levantar el servidor en modo desarrollo (recarga automatica)
$env:PGLITE_DIR='./.data/pglite'; npm run dev -w @mostrador/api
```

Al sembrar se imprime el usuario y la contrasena (`admin` / `mostrador123`).
**Cambiala en cuanto entres.**

## Variables de entorno

| Variable | Para que sirve | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `HOST` | Direccion de escucha | `0.0.0.0` |
| `LOG_LEVEL` | Nivel de registro | `info` |
| `DATABASE_URL` | Si se define, usa PostgreSQL real | (vacio: PGlite) |
| `PGLITE_DIR` | Carpeta de la base PGlite. Sin valor, vive en memoria | (vacio) |
| `JWT_SECRET` | Firma de los tokens. Obligatorio en produccion | secreto de desarrollo |
| `JWT_EXPIRA` | Duracion de la sesion | `12h` |

## Convenciones

- **Todo el dinero va en centavos enteros.** `1800` son 18.00 pesos. Nunca decimales.
- **Las cantidades son piezas enteras.** El sistema no maneja fracciones.
- **El servidor recalcula los totales.** Al registrar una venta no se mandan totales:
  el servidor los calcula con las reglas de `@mostrador/domain`, asi el mostrador y
  la nube nunca discrepan.
- **El stock es la suma con signo de los movimientos.** El tipo de movimiento define
  el signo: `entrada_compra` suma, `merma` resta, etc.

## Endpoints publicos

| Metodo | Ruta | Que hace |
|---|---|---|
| `GET` | `/api/v1/health` | Estado del servicio y de la base de datos |
| `POST` | `/api/v1/auth/login` | Inicia sesion y devuelve el token |

## Con token

Se envia en la cabecera: `Authorization: Bearer <token>`

### Sesion

| Metodo | Ruta | Permiso | Que hace |
|---|---|---|---|
| `GET` | `/api/v1/auth/me` | — | Usuario, roles, permisos y sucursales |

### Catalogo

| Metodo | Ruta | Permiso | Que hace |
|---|---|---|---|
| `GET` | `/api/v1/products` | — | Lista productos. Filtros: `buscar`, `categoriaId`, `sucursalId`, `limite` |
| `GET` | `/api/v1/products/barcode/:codigo` | — | Busca por codigo escaneado. Opcional: `sucursalId` |
| `POST` | `/api/v1/products` | `catalog.manage` | Da de alta un producto, con codigos de barras y stock inicial |
| `PATCH` | `/api/v1/products/:id` | `catalog.manage` | Edita nombre, precios, minimo, categoria |
| `POST` | `/api/v1/products/:id/barcodes` | `catalog.manage` | Agrega otro codigo de barras |
| `GET` | `/api/v1/categories` | — | Lista categorias |
| `POST` | `/api/v1/categories` | `catalog.manage` | Crea una categoria |

`buscar` encuentra por nombre, por SKU **y por codigo de barras**: es justo lo que
necesita el lector del mostrador.

```json
POST /api/v1/products
{
  "sku": "NUE-001",
  "nombre": "Producto nuevo",
  "precioCosto": 1000,
  "precioVenta": 2000,
  "stockMinimo": 3,
  "codigosBarras": ["9999999999999"],
  "stockInicial": 7,
  "sucursalId": "01J..."
}
```

**Sobre los costos:** `precioCosto` y `costoPromedio` solo se devuelven a roles con
`report.profit`, `catalog.manage` o `inventory.adjust`. El vendedor recibe unicamente
precio de venta, impuesto y stock de su sucursal: si pierde el telefono no se lleva los
costos ni el margen del negocio.

**Sobre las fotos:** `POST /api/v1/uploads/producto` recibe `multipart/form-data` con el
campo `archivo` (JPG, PNG o WebP, hasta 4 MB), lo sube a Supabase Storage y devuelve
`{ "url": "https://..." }`. Requiere `catalog.manage`. Tambien se puede guardar una URL
externa directamente en `imagenUrl` al crear o editar el producto.

### Inventario

| Metodo | Ruta | Permiso | Que hace |
|---|---|---|---|
| `GET` | `/api/v1/inventory/stock` | — | Stock de la sucursal. Filtros: `sucursalId`, `buscar`, `soloBajoMinimo`, `limite` |
| `GET` | `/api/v1/inventory/stock-general` | `report.profit`, `catalog.manage` o `inventory.adjust` | Inventario consolidado y reparto por sucursal |
| `GET` | `/api/v1/inventory/movements` | — | **Kardex**: historia de movimientos. Solo de las sucursales de la sesion |
| `POST` | `/api/v1/inventory/movements` | `inventory.adjust` | Registra compra, ajuste, merma o devolucion a proveedor |
| `POST` | `/api/v1/inventory/transfers` | `inventory.transfer` | Mueve stock entre sucursales |

Tipos de movimiento que se pueden registrar a mano: `inventario_inicial`,
`entrada_compra`, `ajuste_positivo`, `ajuste_negativo`, `merma`, `devolucion_proveedor`.

```json
POST /api/v1/inventory/movements
{
  "sucursalId": "01J...",
  "productoId": "01J...",
  "tipo": "merma",
  "cantidad": 2,
  "motivo": "Producto vencido"
}
```

`GET /inventory/stock` devuelve `bajoMinimo` ya resuelto, para que la alerta de stock
no dependa de que el cliente sepa la regla:

```json
{
  "sucursalId": "01J...",
  "conAlerta": 2,
  "stock": [
    { "productoId": "01J...", "sku": "BOT-003", "nombre": "Galletas de chocolate",
      "precioVenta": 1600, "costoPromedio": 850, "stock": 5, "stockMinimo": 12,
      "bajoMinimo": true }
  ]
}
```

### Ventas

| Metodo | Ruta | Permiso | Que hace |
|---|---|---|---|
| `POST` | `/api/v1/sales` | `sale.sell` (+ `sale.discount` si hay descuento) | Registra la venta: recalcula total, cambio y descuenta el stock |
| `GET` | `/api/v1/sales` | — | Listado. Filtros: `sucursalId`, `desde`, `hasta`, `limite` |
| `GET` | `/api/v1/sales/:id` | — | Detalle con lineas y pagos |
| `POST` | `/api/v1/sales/:id/void` | `sale.void` | Cancela la venta y devuelve el stock |
| `POST` | `/api/v1/sales/:id/returns` | `sale.void` | Devuelve productos: parcial o total, con reingreso de stock |

```json
POST /api/v1/sales
{
  "sucursalId": "01J...",
  "lineas": [{ "productoId": "01J...", "cantidad": 3, "descuentoPorcentaje": 10 }],
  "pagos": [
    { "metodo": "tarjeta", "monto": 2000, "referencia": "AUT-999" },
    { "metodo": "efectivo", "monto": 2000 }
  ]
}
```

```json
201 Created
{
  "venta": {
    "id": "01J...", "folio": "CENTRO-20261014-0001", "estado": "completada",
    "total": 3600, "pagado": 4000, "cambio": 400, "articulos": 3,
    "advertencias": [],
    "lineas": [{ "productoId": "01J...", "cantidad": 3, "total": 3600, "costoUnitario": 600 }],
    "pagos": [{ "metodo": "tarjeta", "monto": 2000 }, { "metodo": "efectivo", "monto": 2000 }]
  }
}
```

**Sobre el stock insuficiente:** la politica acordada es *advertir y permitir*. Si no
alcanza el stock, la venta se registra igual y se devuelve el motivo en `advertencias`.
Asi el vendedor nunca se queda sin poder cobrar cuando varios celulares trabajan sin red.

**Sobre los descuentos:** se valida contra los precios reales del catalogo, no contra lo
que mande el telefono. Hace falta el permiso `sale.discount` y el maximo es **15% por
linea** (cubre tanto `descuentoPorcentaje` como `descuentoMonto`). Si se supera responde
`422 DESCUENTO_EXCEDIDO`. Descuentos mayores requeriran PIN de supervisor.

**Sobre el alcance:** una sesion solo puede listar, ver, cancelar o devolver ventas de las
sucursales que tiene asignadas. Sin `sucursalId` se listan solo esas; con una sucursal
ajena responde `403 SIN_PERMISO`.

**Sobre las devoluciones:** se devuelve por linea de la venta, y no se puede devolver
mas de lo vendido (ni contar dos veces una devolucion ya hecha). `reingresar: false`
sirve para producto dañado, que no vuelve al inventario.

### Reportes

| Metodo | Ruta | Permiso | Que hace |
|---|---|---|---|
| `GET` | `/api/v1/reports/resumen` | `report.profit` | Ventas, utilidad bruta, ticket promedio, cobros por forma de pago, mas vendidos y ventas por sucursal/dia |

Parametros: `desde`, `hasta` (obligatorios), `sucursalId` (opcional) y `por`
(`importe` o `cantidad`, para ordenar los mas vendidos).

La utilidad se calcula con el **costo guardado en cada linea al vender**, no con el
costo actual del producto. La venta neta excluye impuestos. Cada sesion solo ve sus
sucursales.

## Errores

```json
{
  "error": {
    "codigo": "DATOS_INVALIDOS",
    "mensaje": "Los datos enviados no son validos",
    "detalles": [{ "campo": "username", "mensaje": "Escribe tu usuario" }]
  }
}
```

| Codigo | HTTP | Cuando |
|---|---|---|
| `DATOS_INVALIDOS` | 422 | Falta un campo, tiene mal formato, o una regla de negocio no se cumple |
| `SIN_ACCESO` | 401 | Credenciales incorrectas, token invalido o sesion revocada |
| `SIN_PERMISO` | 403 | La sesion es valida pero le falta el permiso, o no tiene esa sucursal |
| `NO_ENCONTRADO` | 404 | La ruta o el recurso no existen |
| `DUPLICADO` | 409 | Codigo de barras o SKU repetido |
| `VENTA_YA_CANCELADA` | 409 | Se intento cancelar dos veces la misma venta |
| `DESCUENTO_EXCEDIDO` | 422 | El descuento supera el 15% permitido por linea |
| `CANTIDAD_EXCEDIDA` | 409 | Se intenta devolver mas de lo vendido |
| `ERROR_INTERNO` | 500 | Falla inesperada (no se muestra el detalle al cliente) |

## Seguridad

- **Contrasenas y PIN con scrypt** (`node:crypto`), nunca en texto plano. La comparacion
  es en tiempo constante y el hash jamas se devuelve al cliente.
- **El token lleva solo el id del usuario.** Los permisos y las sucursales se leen frescos
  de la base en cada peticion, asi que revocar el acceso tiene efecto inmediato.
- **Los permisos se validan en el servidor**, no ocultando botones.
- **Cada sesion opera solo en sus sucursales.** Ventas, kardex, turnos y cierres se
  filtran por `user_branch_access`; pedir una sucursal ajena responde `403`.
- **Los costos no viajan al telefono del vendedor.** Catalogo, stock y kardex omiten
  `precioCosto`, `costoPromedio` y `costoUnitario` salvo para roles autorizados.

## Permisos

`sale.sell`, `sale.discount`, `sale.void`, `cash.close`, `inventory.adjust`,
`inventory.transfer`, `catalog.manage`, `suppliers.manage`, `report.profit`,
`accounting.close_period`, `users.manage`, `devices.approve`.

Roles por defecto: `administrador`, `cajero`, `almacenista`, `contador`.

## Pendiente

- Cierre de caja por turno y consolidado del dia.
- Compras y proveedores (ordenes, recepcion, costo promedio automatico).
- Contabilidad: asientos automaticos, gastos, periodos y reportes.
- Sincronizacion: `push` del celular y `pull` por cursor desde `change_feed`.
- Aprobacion y revocacion de dispositivos.
