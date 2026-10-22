# Mostrador

Sistema de **ventas, inventario y contabilidad** para un punto de venta y una tienda.

## Como funciona

- **App movil offline** (Android, instalable sin tienda; iPhone como app web instalada).
  El vendedor registra ventas aunque no tenga internet. Al recuperar la red, sincroniza.
- **Panel web en la nube** para inventario, contabilidad, reportes y exportacion a Excel/PDF.
- **Inventario por sucursal** con kardex completo: el stock es la suma de sus movimientos.

## Estructura del repositorio

```
mostrador/
  apps/
    pos/           Punto de venta: vender, cobrar y devolver
    api/           API en la nube (catalogo, inventario, ventas)
    web/           Panel de administracion, contabilidad y reportes
  packages/
    domain/        Reglas de negocio compartidas (dinero, impuestos, ventas, cobros, kardex)
    db-cloud/      Modelo de datos de la nube (PostgreSQL) y cliente de base de datos
    storage/       Adaptador de almacenamiento local (SQLite nativo / web)
    sync/          Protocolo de sincronizacion (cola, cursores, conflictos)
  docs/
    PLAN-MAESTRO.md
    MODELO-DATOS.md
    API.md
    PUNTO-DE-VENTA.md
    DESPLIEGUE.md
```

## Estado actual

En construccion. Fase 0 (diseno) y base del proyecto.

| Paquete | Estado |
|---|---|
| `@mostrador/domain` | Reglas de nucleo implementadas con pruebas |
| `@mostrador/db-cloud` | Modelo de datos completo (39 tablas) con migraciones y pruebas |
| `apps/api` | Catalogo, inventario (kardex) y ventas con cobro mixto |
| `apps/pos` | Punto de venta, panel de administracion (productos, inventario, ventas, usuarios) y **caja con cierre de turno** |
| `@mostrador/storage` | Pendiente |
| `@mostrador/sync` | Pendiente |
| `apps/web` | Pendiente |

Ver tambien `docs/MODELO-DATOS.md` y `docs/API.md`.

## Publicar en internet (gratis)

Con **Vercel + Supabase** la aplicacion y el API quedan en una sola direccion publica,
sin pagar nada. Los pasos completos estan en **`docs/DESPLIEGUE.md`**.

## Probar el punto de venta

Necesitas dos terminales. En la primera, el API; en la segunda, la aplicacion.

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"

# Terminal 1: crear los datos de ejemplo (solo la primera vez) y levantar el API
$env:PGLITE_DIR='./.data/pglite'; npm run db:seed -w @mostrador/api
$env:PGLITE_DIR='./.data/pglite'; npm run dev -w @mostrador/api

# Terminal 2: levantar el punto de venta
npm run dev -w @mostrador/pos
```

Abre <http://127.0.0.1:5173> y entra con **admin / mostrador123**.

Atajos del mostrador: **F2** busca, **F4** va al cobro, **Enter** agrega el unico
resultado de la busqueda (asi funciona el lector de codigos), **Esc** limpia el cobro.

## Requisitos

- Node.js 22 o superior
- npm 10 o superior

## Comandos

```bash
npm install        # instala dependencias de todos los paquetes
npm test           # ejecuta las pruebas de todos los paquetes
npm run typecheck  # verifica los tipos
npm run build      # compila todos los paquetes
```

## Principios del proyecto

1. **El dinero se maneja en centavos enteros.** Nunca con decimales flotantes.
2. **El inventario es un libro de movimientos.** El stock es la suma con signo de esos movimientos.
3. **Las ventas son inmutables.** Cancelar o devolver agrega un movimiento, nunca borra.
4. **El telefono nunca recibe costos, margenes ni datos contables.**
5. **La app funciona sin internet y sincroniza despues.** El mostrador nunca se detiene.

Ver `docs/PLAN-MAESTRO.md` para el diseno completo.
