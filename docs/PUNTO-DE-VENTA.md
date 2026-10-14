# Punto de venta

Aplicacion del vendedor. Hoy corre en el navegador; mas adelante se empaqueta como
app de Android (APK propio, sin tienda) y como app web instalable en iPhone.

## Como arrancarlo

```powershell
cd "G:\Cosas Ernesto\((Trabajo\(((mios\Gestion inventario"

# Terminal 1: datos de ejemplo (solo la primera vez) y el API
$env:PGLITE_DIR='./.data/pglite'; npm run db:seed -w @mostrador/api
$env:PGLITE_DIR='./.data/pglite'; npm run dev -w @mostrador/api

# Terminal 2: la aplicacion
npm run dev -w @mostrador/pos
```

Abre <http://127.0.0.1:5173> y entra con `admin` / `mostrador123`.

Si el API vive en otra direccion, copia `apps/pos/.env.example` como `.env` y ajusta
`VITE_API_URL`.

## Como se usa

### Acceso
Usuario y contrasena. La sesion se guarda en el navegador, asi que al reabrir la
aplicacion entra directo.

### Mostrador
- **Barra superior:** nombre de la empresa, selector de sucursal (aparece cuando hay
  mas de una), vendedor y boton para salir.
- **Izquierda:** el buscador y la rejilla de productos. Cada tarjeta muestra SKU,
  nombre, precio y las piezas disponibles **en esa sucursal**, con aviso en mostaza
  cuando esta en el minimo y en rojo cuando no hay.
- **Derecha:** el ticket, como si fuera papel termico.

### Buscar
- Escribe y espera: la busqueda se hace sola.
- **Con un lector de codigos:** escanea y presiona Enter. Si hay un unico resultado,
  entra directo al ticket.
- Si ya agregaste un producto, las existencias que se muestran ya descuentan lo que
  llevas en el ticket.

### Ticket
- `−` y `+` cambian la cantidad; `×` quita la linea.
- El boton `desc.` recorre los descuentos: 0, 5, 10 y 15 por ciento.
- El total se calcula con **las mismas reglas que el servidor** (`@mostrador/domain`),
  asi que lo que ves en el ticket es exactamente lo que se va a cobrar.

### Cobro
- Botones de **Efectivo**, **Tarjeta** y **Transferencia**. Se pueden combinar: es el
  cobro mixto.
- Atajos rapidos: `Exacto`, `Cubrir faltante` y denominaciones de 50, 100, 200 y 500.
- El renglon grande muestra **Cambio** o **Falta** en tiempo real.
- Si pagas con tarjeta o transferencia mas que el total, avisa: el cambio solo se
  entrega en efectivo.
- El boton **Cobrar** se activa solo cuando el pago alcanza.

### Comprobante
Al cerrar la venta aparece el comprobante con folio, articulos, pagos y cambio, con un
sello **PAGADO**. Si el inventario se quedo corto, aparece la advertencia para que la
revises despues. **Nueva venta** limpia todo y deja listo el siguiente cliente.

## Atajos de teclado

| Tecla | Que hace |
|---|---|
| `F2` | Va al buscador y selecciona el texto |
| `Enter` en el buscador | Agrega el producto si el resultado es unico |
| `F4` | Va al primer monto del cobro |
| `Enter` | Confirma el cobro |
| `Esc` | Limpia los pagos; en el comprobante, lo cierra |

## Decisiones de diseno

- **El servidor manda.** La pantalla calcula los totales para mostrar, pero el cobro
  lo vuelve a calcular el servidor con las mismas reglas. Si alguien manipulase el
  telefono, la venta no cambia.
- **Pensado para estar de pie.** Tipografia grande en las cifras, contraste alto,
  objetivos de toque amplios y atajos de teclado para no soltar el lector.
- **La alerta de minimo no se inventa en el cliente.** Se muestra la que ya resolvio
  el servidor.
- **Avisa antes de fallar.** Si la red no responde, se explica en la pantalla en lugar
  de dejar un boton que no hace nada.

## Pendiente

- **Modo sin conexion:** guardar las ventas en el telefono y subirlas al reconectar.
- **Empaquetado Android** con Capacitor (APK propio) y **app web instalable** en iPhone.
- **Cierre de turno** desde el propio punto de venta.
- **Devoluciones y cancelaciones** desde la pantalla (hoy se hacen por el API).
- **Fuentes propias:** hoy se cargan de Google Fonts; hay que servirlas desde el
  sistema para que el diseno sea identico sin internet.
