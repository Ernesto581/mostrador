# Despliegue gratis: Vercel + Supabase

Como queda todo funcionando en internet sin pagar nada:

```
Navegador  ->  https://tu-app.vercel.app
                |
                +-- la aplicacion (React, sitio estatico)
                +-- /api/v1/...  ->  una funcion que ejecuta el API
                                          |
                                          v
                                    Supabase (PostgreSQL)
```

Una sola direccion para todo: la aplicacion y el API viven juntos, asi que **no hay
problemas de CORS**. La base de datos esta en Supabase.

**Costo: 0.** Vercel gratis (sitio + funciones) y Supabase gratis (500 MB de base).

---

## Antes de empezar

Necesitas tres cuentas gratis y el proyecto ya en tu PC.

- [GitHub](https://github.com) — para guardar el codigo
- [Supabase](https://supabase.com) — la base de datos
- [Vercel](https://vercel.com) — donde se publica

---

## Paso 1 — Crear la base de datos en Supabase

1. Entra a Supabase y elige **New project**.
   - **Name:** `mostrador`
   - **Database Password:** genera una larga y **guardala en un lugar seguro**.
   - **Region:** la mas cercana a ti.
   - Espera a que termine de crearse (1-2 minutos).

2. En el panel del proyecto, ve a **Project Settings → Database → Connection string**.
   Copia **dos** cadenas y en cada una reemplaza `[YOUR-PASSWORD]` por tu contrasena:

   | Cadena | Puerto | Para que sirve |
   |---|---|---|
   | **Transaction pooler** | `6543` | La usa la aplicacion en Vercel |
   | **Session pooler** | `5432` | La usas tu, para crear las tablas |

   A la del **6543** agregale `?pgbouncer=true` al final si no lo trae.

---

## Paso 2 — Crear las tablas y los datos (desde tu PC, una sola vez)

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"

# 1) Crear las 37 tablas. Usa la cadena del puerto 5432.
$env:DATABASE_URL='postgresql://postgres.tuproyecto:TU_PASSWORD@aws-0-xx.pooler.supabase.com:5432/postgres'
npm run db:migrate

# 2) Crear la empresa, las sucursales, los roles y el administrador.
#    Aqui eliges tu usuario y tu contrasena de verdad.
$env:SEED_EMPRESA='Mi Tienda'
$env:SEED_USUARIO='admin'
$env:SEED_PASSWORD='pon-aqui-una-contrasena-larga'
npm run db:seed
```

Si no quieres los 20 productos de ejemplo, agrega `$env:SEED_SIN_PRODUCTOS='true'`.

**Comprobar:** en Supabase, abre **Table Editor** y veras las 37 tablas con datos en
`products`, `branches` y `users`.

> Las migraciones **nunca** se corren desde Vercel. Se corren desde tu PC, que es la
> unica que tiene la cadena de administracion. Asi no hay dos instancias peleando.

---

## Paso 3 — Subir el codigo a GitHub

1. En GitHub, crea un repositorio **privado** y **vacio** (sin README ni .gitignore).
2. En tu PC:

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"
git remote add origin https://github.com/TU_USUARIO/mostrador.git
git branch -M main
git push -u origin main
```

---

## Paso 4 — Publicar en Vercel

1. Entra a Vercel y elige **Add New → Project**.
2. **Import Git Repository** y elige el repositorio que acabas de subir.
3. En la configuracion del proyecto:
   - **Framework Preset:** `Other`
   - **Root Directory:** dejalo en la raiz (`./`)
   - **Build Command** y **Output Directory:** dejalo como esta; Vercel lee `vercel.json`.
4. Abre **Environment Variables** y agrega estas cuatro (marcando Production, Preview
   y Development):

| Nombre | Valor |
|---|---|
| `DATABASE_URL` | La cadena del **Transaction pooler (6543)**, con `?pgbouncer=true` |
| `JWT_SECRET` | Una cadena larga y secreta (abajo te digo como generarla) |
| `NODE_ENV` | `production` |
| `MIGRAR_AL_ARRANCAR` | `false` |

Genera el `JWT_SECRET` con:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

5. **Deploy** y espera. Al terminar te da una direccion como
   `https://mostrador-tuusuario.vercel.app`.

---

## Paso 5 — Entrar

Abre la direccion de Vercel y entra con el usuario y la contrasena que pusiste en el
Paso 2. Ya puedes vender.

Si te equivocaste en la contrasena, vuelve a correr el Paso 2 con otros valores: creara
otro administrador (la base admite varios usuarios).

---

## Cosas que conviene saber

- **El primer acceso tarda un poco** (1-3 segundos). Es una funcion sin estado: se
  "apaga" cuando nadie la usa y despierta en la siguiente peticion. Despues vuela.
- **Supabase gratis se pausa** si pasan unos dias sin uso. Si la aplicacion deja de
  responder tras unas vacaciones, entra al panel de Supabase y reactiva el proyecto.
- **Respaldos:** en el plan gratis conviene exportar de vez en cuando desde
  **Table Editor → Export**. En planes de pago Supabase hace respaldos diarios.
- **No hay pantalla para cambiar la contrasena** todavia (el API si lo permite). Por
  ahora, elige una buena contrasena en el Paso 2.

---

## Actualizar despues de un cambio

| Cambio | Que hacer |
|---|---|
| Aplicacion o API | `git push` y Vercel vuelve a publicar solo |
| Tablas (esquema) | `npm run db:generate -w @mostrador/db-cloud`, commit, `git push`, y luego `npm run db:migrate` desde tu PC |

---

## Si algo falla

| Sintoma | Causa probable |
|---|---|
| "No hay conexion con el servidor" | `DATABASE_URL` mal copiada. Debe ser la del **6543** |
| El API responde 500 | Revisa **Deployments → Functions** en Vercel, ahi sale el error real |
| Nada responde tras unos dias | El proyecto de Supabase se pauso. Reactivalo |
| "Contrasena incorrecta" y estas seguro | Vuelve a correr el seed del Paso 2 |

---

## Alternativa

Si algun dia el plan gratis de Vercel se queda corto, el API tambien corre **tal cual**
en un servicio con servidor permanente (Render, Railway, Fly.io): se sube el mismo
codigo y se definen las mismas variables. No hay que cambiar nada mas.
