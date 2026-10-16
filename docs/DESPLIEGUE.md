# Despliegue gratis: Vercel + Supabase

Como queda todo funcionando en internet sin pagar nada:

```
Navegador  →  https://tu-app.vercel.app
                ├── la aplicacion (React, sitio estatico)
                ├── /estado.html      (estado del API y de la base de datos)
                └── /api/v1/...  →    una funcion que ejecuta el API
                                          │
                                          ▼
                                    Supabase (PostgreSQL)
```

**Un solo proyecto, una sola direccion.** La aplicacion y el API viven juntos, asi que
**no hay problemas de CORS** y no hay que configurar direcciones entre ellos.

**Costo: 0.** Vercel gratis (sitio + funciones) y Supabase gratis (500 MB de base).

---

## Antes de empezar

Necesitas tres cuentas gratis:

- [GitHub](https://github.com) — guarda el codigo
- [Supabase](https://supabase.com) — la base de datos
- [Vercel](https://vercel.com) — publica todo

---

## Paso 1 — Crear la base de datos en Supabase

1. Entra a Supabase y elige **New project**.
   - **Name:** `mostrador`
   - **Database Password:** genera una larga y **guardala**.
   - **Region:** la mas cercana.
2. En **Project Settings → Database → Connection string** copia **dos** cadenas y
   reemplaza `[YOUR-PASSWORD]` por tu contrasena:

   | Cadena | Puerto | Para que |
   |---|---|---|
   | **Session pooler** | `5432` | Crear las tablas (desde tu PC) |
   | **Transaction pooler** | `6543` | La aplicacion en Vercel |

> **Sobre `sslmode`.** Si la cadena trae `?sslmode=require`, da igual: el sistema lo
> descarta solo. Node-postgres interpreta ese parametro como "verificar el certificado
> a fondo" y la conexion falla. El cifrado se pide de forma explicita en el codigo, asi
> que la conexion **siempre va cifrada**.

---

## Paso 2 — Crear las tablas y los datos (desde tu PC, una sola vez)

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"

# 1) Crear las 37 tablas. Usa la cadena del puerto 5432.
$env:DATABASE_URL='postgresql://postgres.tuproyecto:TU_PASSWORD@aws-0-xx.pooler.supabase.com:5432/postgres'
npm run db:migrate

# 2) Crear la empresa, sucursales, roles y el administrador.
$env:SEED_EMPRESA='Mi Tienda'
$env:SEED_USUARIO='admin'
$env:SEED_PASSWORD='pon-aqui-una-contrasena-larga'
npm run db:seed
```

Si no quieres los 20 productos de ejemplo: `$env:SEED_SIN_PRODUCTOS='true'`.

**Comprobar:** en Supabase → **Table Editor** deben aparecer las tablas con datos en
`products`, `branches` y `users`.

> Las migraciones **nunca** se corren desde Vercel. Se corren desde tu PC, que es la
> unica con la cadena de administracion.

---

## Paso 3 — Subir el codigo a GitHub

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"
git remote add origin https://github.com/TU_USUARIO/mostrador.git
git branch -M main
git push -u origin main
```

---

## Paso 4 — Publicar en Vercel (un solo proyecto)

1. Vercel → **Add New → Project** → importa el repositorio.
2. En la configuracion:
   - **Root Directory:** `apps/api`
   - **Framework Preset:** `Other`
   - Build Command y Output Directory: dejalo como esta; los toma de
     `apps/api/vercel.json`.
3. **Environment Variables** — agrega **exactamente estas tres** (marca Production,
   Preview y Development):

| Nombre | Valor |
|---|---|
| `DATABASE_URL` | La cadena del **Transaction pooler (6543)**, con `?pgbouncer=true` |
| `JWT_SECRET` | Una cadena larga y secreta (abajo te digo como generarla) |
| `MIGRAR_AL_ARRANCAR` | `false` |

> **NO agregues `NODE_ENV`.** Vercel ya lo pone solo cuando la aplicacion corre, y al
> ponerlo como variable del proyecto tambien afecta al momento de instalar: `npm` se
> salta las herramientas de desarrollo y la compilacion falla con `tsc: command not found`.
>
> Tampoco hace falta `VITE_API_URL`: la aplicacion llama al API en la misma direccion
> donde vive.

Genera el `JWT_SECRET` con:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

4. **Deploy** y espera. Al terminar te da una direccion como
   `https://mostrador-tuusuario.vercel.app` con todo dentro:

| Ruta | Que hay |
|---|---|
| `/` | El punto de venta |
| `/estado.html` | Estado del API y de la base de datos |
| `/api/v1/...` | El API |

---

## Paso 5 — Entrar

Abre la direccion de Vercel y entra con el usuario y la contrasena del Paso 2.
Ya puedes vender.

---

## Como funciona por dentro (no lo cambies sin leer esto)

| Pieza | Como esta resuelto | Por que |
|---|---|---|
| Reparto del trafico | `/api/...` va a la funcion; lo demas son archivos estaticos | Definido en `apps/api/vercel.json` |
| Funcion del API | `apps/api/api/index.ts` importa todo **de forma diferida** dentro de un `try` | Si algo falla al cargar, responde el **motivo real** en JSON en vez de una pagina 500 muda |
| Instalacion | `installCommand` entra desde `apps/api` a la **raiz del repositorio** | `npm install` dentro de una carpeta del workspace **no instala las herramientas de la raiz** (TypeScript) |
| Paquetes compartidos | `postinstall` de la raiz compila `domain`, `db-cloud` y el API | Asi el orden de compilacion deja de importar |
| Contenido web | `buildCommand` arma `public/` con `apps/pos/dist` + `estado.html` | Vercel exige una carpeta de salida estatica |
| `cookie` | Fijado en la 1.x con `overrides` | `cookie@2` es solo ESM y Vercel ejecuta el API en CommonJS: `require()` reventaria |
| Conexion a la base | SSL explicito sin validar certificado | No depende del almacen de certificados de la plataforma |

---

## Actualizar despues de un cambio

| Cambio | Que hacer |
|---|---|
| Aplicacion o API | `git push` y Vercel publica solo |
| Tablas (esquema) | `npm run db:generate -w @mostrador/db-cloud`, commit, `git push`, y luego `npm run db:migrate` desde tu PC |

---

## Si algo falla

| Sintoma | Causa probable |
|---|---|
| `tsc: command not found` | Volvio a colarse `NODE_ENV` en las variables. Borrala |
| `require() of ES Module .../cookie/...` | Se perdio el `overrides` de `cookie` en el `package.json` |
| `No Output Directory "public"` | Fallo el `buildCommand` de `apps/api/vercel.json` |
| `The page could not be found` | La funcion no existe; revisa que la carpeta `apps/api/api/` este y que el `rewrites` apunte a `api/index` |
| "No hay conexion con el servidor" | `DATABASE_URL` mal copiada; debe ser la del **6543** |
| Sale JSON con `ARRANQUE_FALLIDO` | **Lee el `detalle`**: ahi esta el motivo exacto |
| Nada responde tras unos dias | El proyecto de Supabase se pauso. Reactivalo en su panel |

> **La pantalla `/estado.html`** dice en un segundo si el API y la base de datos estan
> bien, sin entrar a los registros de Vercel.
>
> Para verificar que la conexion va cifrada:
> `select ssl from pg_stat_ssl where pid = pg_backend_pid()` debe decir `true`.

---

## Alternativa

Si algun dia el plan gratis de Vercel se queda corto, el API tambien corre **tal cual**
en un servicio con servidor permanente (Render, Railway, Fly.io): se sube el mismo
codigo y se definen las mismas variables.
