# API

Servidor de la nube: **Fastify + Zod**, con PostgreSQL (PGlite en desarrollo, sin instalar nada).

## Como arrancarlo

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"

# 1) Crear los datos iniciales (empresa, sucursal, roles y administrador)
$env:PGLITE_DIR='./.data/pglite'; npm run db:seed -w @mostrador/api

# 2) Levantar el servidor en modo desarrollo (recarga automatica)
$env:PGLITE_DIR='./.data/pglite'; npm run dev -w @mostrador/api
```

Al sembrar se imprime el usuario y la contrasena (`admin` / `mostrador123`).
**Cambiala en cuanto entres.**

Prueba rapida:

```powershell
curl http://127.0.0.1:3000/api/v1/health
```

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

## Endpoints

### Publicos

| Metodo | Ruta | Que hace |
|---|---|---|
| `GET` | `/api/v1/health` | Estado del servicio y de la base de datos |
| `POST` | `/api/v1/auth/login` | Inicia sesion y devuelve el token |

```json
POST /api/v1/auth/login
{ "username": "admin", "password": "mostrador123" }

200 OK
{
  "token": "eyJhbGciOi...",
  "usuario": { "id": "01J...", "username": "admin", "nombre": "Administrador" }
}
```

### Requieren token

Se envia en la cabecera: `Authorization: Bearer <token>`

| Metodo | Ruta | Que hace |
|---|---|---|
| `GET` | `/api/v1/auth/me` | Usuario, roles, permisos y sucursales |

```json
200 OK
{
  "usuario": { "id": "01J...", "username": "admin", "nombre": "Administrador" },
  "roles": ["administrador"],
  "permisos": ["accounting.close_period", "cash.close", "catalog.manage", "..."],
  "sucursales": [{ "id": "01J...", "codigo": "CENTRO", "nombre": "Sucursal Principal", "tipo": "tienda" }]
}
```

## Errores

Todas las respuestas de error tienen la misma forma:

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
| `DATOS_INVALIDOS` | 422 | Falta un campo o tiene formato incorrecto |
| `SIN_ACCESO` | 401 | Usuario o contrasena incorrectos, o token invalido |
| `SIN_PERMISO` | 403 | La sesion es valida pero no tiene el permiso |
| `NO_ENCONTRADO` | 404 | La ruta o el recurso no existen |
| `ERROR_INTERNO` | 500 | Falla inesperada (no se muestra el detalle al cliente) |

## Seguridad

- **Contrasenas y PIN con scrypt** (`node:crypto`), nunca en texto plano. La comparacion
  es en tiempo constante y el hash jamas se devuelve al cliente.
- **El token lleva solo el id del usuario.** Los permisos y las sucursales se consultan
  frescos en cada peticion, para que revocar el acceso tenga efecto de inmediato.
- **Permisos en el servidor.** Ocultar un boton en la pantalla no es seguridad.

## Permisos

`sale.sell`, `sale.discount`, `sale.void`, `cash.close`, `inventory.adjust`,
`inventory.transfer`, `catalog.manage`, `suppliers.manage`, `report.profit`,
`accounting.close_period`, `users.manage`, `devices.approve`.

Roles por defecto: `administrador`, `cajero`, `almacenista`, `contador`.

## Pendiente

- Catalogo: productos, codigos de barras, categorias, precios.
- Inventario: kardex, compras, mermas, ajustes, transferencias, alertas de minimo.
- Ventas: registro de venta con cobro mixto, devoluciones, cancelacion, cierre de caja.
- Sincronizacion: `push` del celular y `pull` por cursor desde `change_feed`.
- Aprobacion y revocacion de dispositivos.
