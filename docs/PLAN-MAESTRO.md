# Plan maestro - Mostrador

Sistema de ventas, inventario y contabilidad para punto de venta y tienda.

---

## 1. Decisiones tomadas

| Tema | Decision |
|---|---|
| Modalidad | Hibrida: app movil offline + panel web en la nube |
| Sucursales | 2-3 hoy, hasta 10 |
| Plataformas | Android (app instalable) e iPhone (app web instalada) |
| Distribucion | Sin tiendas: APK propio en Android, app web en iPhone. Costo de tiendas: 0 |
| Celulares | Personales de los empleados (BYOD), varios por sucursal |
| Rol del celular | Solo ventas (cobro, devoluciones, cancelacion, cierre de turno) |
| Inventario (compras, mermas, ajustes, transferencias) | Solo en el panel web |
| Efectivo | Una caja comun por sucursal; cierre consolidado en la web |
| Stock insuficiente offline | Advertir y permitir + alerta de sobreventa en la nube |
| Descuentos | Con limite y PIN de supervisor |
| Costo | Precio de costo capturado + costo promedio automatico |
| Impuestos | Solo internos (sin factura fiscal) |
| Escaneo de codigos | Camara del celular |
| Reportes y contabilidad | Panel web (requieren internet) |

## 2. Arquitectura

```
Celulares (Android/iPhone) - varios por sucursal, personales
  React + Capacitor - IndexedDB (copia local, cola de sincronizacion)
  Pantallas: vender, cobrar, devolver, cancelar, cierre de turno

        | HTTPS (iPhone: al abrir la app)

API central (NestJS) + PostgreSQL gestionado
  - Inventario por sucursal y consolidado
  - Alta de productos, compras, mermas, ajustes, transferencias
  - Contabilidad automatica, reportes, exportacion Excel/PDF
  - Administracion de usuarios, dispositivos, PIN y politicas
```

**Regla de oro:** el celular solo necesita el stock y los precios de **su propia sucursal**.
Por eso puede vender sin internet. Al sincronizar, la nube consolida.

## 3. Principio de diseno del inventario

El stock **no se edita**: es la **suma con signo de sus movimientos**.

- Vender, comprar, mermar, ajustar y transferir **agregan** un movimiento.
- Cancelar o devolver **agregan** un movimiento inverso.
- Fusionar dos sucursales es unir listas: no hay conflictos por el mismo dato.

## 4. Seguridad con telefonos personales (BYOD)

- **Lo que baja al celular:** nombre, codigo de barras, precio de venta, IVA de venta, categoria y stock de su sucursal.
- **Lo que nunca baja:** costo, costo promedio, margenes, utilidad, contabilidad, otras sucursales.
- Base local en **IndexedDB** (sin cifrado propio: IndexedDB no cifra; si el cliente lo exige, hay que definir y probar una solucion), PIN o biometria, aprobacion de dispositivo y **revocacion remota**.
- Borrado de la base local al cerrar sesion o al ser revocado.
- PIN de supervisor offline con caducidad (por ejemplo 7 dias sin sincronizar).

## 5. Modulos

### Punto de venta (movil)
Busqueda por camara, codigo o nombre; carrito; descuentos con limite y PIN; cobro en
efectivo, tarjeta, transferencia y **mixto**; calculo automatico de cambio; venta con folio
por sucursal; cancelacion con motivo; devolucion parcial o total con reingreso de stock;
cierre de turno (ventas por metodo, fondo, retiros, diferencia).

### Inventario (web)
Productos con codigo de barras unico, costo, precio de venta, IVA, categoria, unidad y
minimo; stock por sucursal y almacen con **kardex**; alertas de stock minimo; compras,
ajustes, mermas y transferencias; costo promedio automatico al recibir compras.

### Contabilidad (web)
Catalogo de cuentas; **motor de asientos automaticos** por venta, devolucion, compra y
gasto; registro de gastos y proveedores; periodos con cierre y bloqueo; balance, estado de
resultados y conciliacion de caja; reportes de ventas, utilidad, mas vendidos, rotacion y
valorizacion; exportacion a **Excel y PDF**.

## 6. Modelo de datos (esencial)

- **Organizacion:** `companies`, `branches`, `warehouses`, `users`, `roles`, `permissions`, `user_branch_access`, `devices`, `audit_log`.
- **Catalogo:** `products`, `product_barcodes`, `categories`, `units_of_measure`, `suppliers`, `price_lists`, `product_prices`, `taxes`.
- **Inventario:** `inventory_movements` (libro append-only), `stock_balances` (cache), `stock_min_rules`, `purchase_orders`, `goods_receipts`, `adjustments`, `waste` (mermas), `transfers`.
- **Ventas:** `cash_registers`, `shifts`, `sales`, `sale_lines` (con costo usado), `sale_payments`, `cash_movements`, `cash_closures`, `returns`, `sale_voids`.
- **Contabilidad:** `chart_of_accounts`, `journal_entries`, `journal_lines`, `accounting_rules`, `expenses`, `accounts_payable`, `accounting_periods`.
- **Sincronizacion:** `sync_outbox`, `sync_cursors`, `sync_conflicts`, `device_registry`.

## 7. Sincronizacion

1. **Primera instalacion:** login, aprobacion de dispositivo, descarga de catalogo y stock de su sucursal.
2. **Offline:** se vende normal; todo entra a la base local y a la cola de envio.
3. **Con red:** envio idempotente por `op_id` y descarga incremental por cursores, con reintentos.
4. **Folios** `SUC-AAAAMMDD-0001` con contador local: no chocan entre dispositivos ni sucursales.
5. **Reconciliacion:** la nube verifica que el stock = suma de movimientos; cualquier diferencia se marca.
6. **Alerta de sobreventa** cuando varios celulares vendieron de mas sin red.
7. **Indicador visible** de "N ventas sin subir" en la app.

## 8. Reglas transversales

- Dinero en **centavos enteros**; reglas de redondeo explicitas y probadas.
- Impuestos solo para desglose y utilidad internos.
- La venta **guarda el costo usado** al momento de vender.
- Sin stock negativo forzado: se advierte y se permite (politica elegida), con alerta posterior.
- Periodos contables bloqueados: sin esto la contabilidad no cuadra.
- Auditoria de cancelaciones, ajustes, mermas y cambios de precio.

## 9. Roles y permisos

Administrador, Gerente de sucursal, Vendedor/Cajero, Almacenista, Contador, Auditor (solo lectura).

Permisos granulares: `sale.sell`, `sale.discount`, `sale.void`, `cash.close`,
`inventory.adjust`, `report.profit`, `accounting.close_period`. Se validan en el servidor.

## 10. Fases

| Fase | Contenido | Estimado |
|---|---|---|
| F0 | Diseno detallado: modelo, reglas, prototipos, criterios de aceptacion | 2-3 sem |
| F1 | Base offline: Capacitor Android + web, SQLite cifrado, login/PIN, dispositivos, roles, motor de sync, CI | 5-6 sem |
| F2 | Inventario (web): productos, kardex, stock, minimos, compras, mermas, ajustes, transferencias, costo promedio | 6-7 sem |
| F3 | POS movil: busqueda, carrito, descuentos, cobro mixto, cambio, cancelacion, devoluciones, cierre de turno | 6-7 sem |
| F4 | Compras y proveedores: ordenes, recepcion, costo promedio, cuentas por pagar | 3-4 sem |
| F5 | Contabilidad: cuentas, asientos automaticos, gastos, periodos, balance, conciliacion | 6-8 sem |
| F6 | Reportes y exportacion: ventas, utilidad, mas vendidos, rotacion, valorizacion, Excel/PDF | 4-5 sem |
| F7 | Robustez y despliegue: sync endurecido, alertas, respaldos, piloto, despliegue | 5-6 sem |

## 11. Distribucion sin tiendas

- **Android:** se descarga el APK desde el panel web y se autoriza "instalar de esta fuente" una vez. Actualizacion con aviso dentro de la app.
- **iPhone:** se abre el panel web en Safari y se elige "Agregar a pantalla de inicio".
- **Cuidado operativo:** respaldar la firma digital (keystore) del APK. Si se pierde, no se puede actualizar sin desinstalar.
- Sincronizar seguido: es la principal defensa contra perdida de datos.

## 12. Costos operativos

| Concepto | Monto |
|---|---|
| Apple Developer | 0 (no se necesita) |
| Google Play | 0 (no se necesita) |
| Dominio | ~10-15 USD/ano |
| Nube (API + PostgreSQL) | ~10-40 USD/mes |
| **Total en tiendas** | **0** |

## 13. Riesgos

| Riesgo | Mitigacion |
|---|---|
| Sobreventa offline entre varios celulares | Advertir y permitir + alerta en nube + sincronizar seguido |
| Datos del negocio en telefonos personales | Minimizacion de datos, cifrado, revocacion remota, borrado al cerrar sesion |
| iPhone no sincroniza en segundo plano | Sincronizar al abrir la app + aviso visible de pendientes |
| Perdida de la firma del APK | Respaldo del keystore en lugar seguro del negocio |
| Costo promedio vs costo capturado | La venta guarda el costo usado; se corrige al sincronizar |
| Devolucion en dispositivo distinto | Misma terminal cuando sea posible; si no, en la web |
