# Análisis App "BORDADO (EMBLEMA)" — Google Apps Script

> Resumen funcional completo de la web app de gestión de producción de bordado (Apps Script + Google Sheets), para evaluar qué funcionalidades adaptar al proyecto actual (portal React + backend Node/SQL Server).

---

## 1. Qué es

Web app interna (Apps Script `doGet` + HtmlService) para gestionar la **producción de un taller de bordado/emblemas**. La "base de datos" es un Google Spreadsheet con varias hojas. Tiene login con roles (ADMIN / OPERARIO), tablero de órdenes con estados de producción, asignación a operarios, cálculo de costos por diseño, escáner de códigos para recepción de paquetes, moneda dual ($ / U$S) e importación de órdenes desde una planilla externa de Sublimación.

**Archivos:** `Código.gs` (backend), `index.html` (layout + modales), `css.html`, `js.html` (lógica frontend, objeto `app`), `import_xsb.html` (módulo importación XSB, objeto `appXsb`), `login.html` (legacy, NO se incluye — el login vigente está inline en index/js).

---

## 2. Modelo de datos (hojas del Spreadsheet)

### Hojas de órdenes: `BASE` y `ORDEN_XSB`
Dos hojas con la misma estructura de columnas que se **unifican en un solo tablero**, mezcladas y ordenadas por fecha (col B) descendente. `BASE` = órdenes propias de bordado (códigos `PRE-`, moneda $). `ORDEN_XSB` = órdenes que vienen de Sublimación (códigos `XSB-`/`RXSB`, moneda U$S).

| Col | Campo | Uso |
|---|---|---|
| A (1) | ID orden | Clave de búsqueda (PRE-xxx / XSB-xxx) |
| B (2) | Fecha/timestamp | Ordenamiento cronológico del tablero |
| E,I,J (según headers 1,4,8,9) | Datos del pedido | Se muestran como "Especificaciones" en el detalle |
| F (6) | Links Drive archivos | Archivos de producción (visor + descarga) |
| G (7) | Links Drive visuales | Bocetos/diseños → carrusel de imágenes |
| H (8) | Nota de atención | Si existe, campanita roja animada en el detalle |
| J (10) / Q (17) | Cantidad prendas (qtyJ/qtyQ) | Para la calculadora de costos |
| K (11) | `costoDetalle` | Detalle por diseño: `D1 \| 5000 pts \| 12 u. \| Bordado: $X \| Matriz: $Y \| Total: $Z` separado por `\|\|\|` |
| L (12) | Historial de costos | Log: `[MANUAL: $x]`, `[SUBLIMACION: U$S x]`, `[PRODUCCIÓN: fecha]`, `[MANUAL: DESACTIVADO]` separado por `\|\|\|` |
| M (13) | `costoTotal` | Número final (en $ para BASE, U$S para XSB) |
| N (14) | Estado | Estado de producción actual |
| O (15) | Historial de estados | `ESTADO [dd/MM HH:mm] \|\|\| ...` → timeline |
| P (16) | Paquetes escaneados | Códigos acumulados con `\|\|\|` (+ fecha en XSB) |
| R (18) | Operario asignado | |
| S (19) | Flag Matriz | "INGRESADO" = matriz disponible |
| T (20) | Flag Prueba | "APROBADO" = pruebas aprobadas |
| U (21) | Nota/alias de usuario | Reemplaza el ID como título visible en tarjetas |
| W (23) en BASE / X (24) en XSB | Producto | Determina el costo unitario |

**Patrón clave:** campos "historial" son strings acumulativos con separador `|||` y metadatos entre `[ ]` — parseados por el frontend. (En SQL esto serían tablas hijas con filas por evento.)

### Hojas auxiliares
- **`DATOS`**: col A = operarios (usuarios), col B = contraseñas (texto plano), col C = estados, col D = color hex del estado, **F2 = cotización del dólar** (editable desde la UI).
- **`COSTOS`**: matriz de tarifas por cliente. Col A = cliente (fila especial `COMUN` = tarifa por defecto/fallback), col B = costo de matriz, cols C+ = costo unitario por producto (los nombres de producto son los encabezados de fila 1 → también alimentan el selector de productos).
- **`MATRIZ`**: registros por orden: links Drive a archivos **DST** y **EMB** + fecha (archivos de la matriz de bordado descargables).
- **`PAQUETES`**: log de escaneos: código, cliente, paquete `(Bn/m)`, fecha. Inserción siempre arriba (fila 2).
- **`NOTAS`**: notas de producción por orden (ID, texto, fecha) — tipo chat.
- **Planilla externa** (`openById('17O8R946...')`, hoja `EMBLEMA`): fuente de datos de Sublimación para importar órdenes XSB.

---

## 3. Login y roles

- `loginUser(user, pass)`: `admin` valida contra ScriptProperties `ADMIN_PASS` (si no existe se auto-crea con default hardcodeado); operarios validan contra hoja DATOS (usuario col A, pass col B, texto plano).
- Sesión persistida en `localStorage` (`produccion_app_session` con `{user, role}`) → auto-login al recargar. Logout con confirm.
- **ADMIN**: ve todo, sidebar con lista de operarios (filtro por operario), reasigna órdenes con un `<select>` directo en cada tarjeta, edita cotización del dólar, importa XSB.
- **OPERARIO**: sin sidebar, sin widget dólar; ve "Mis Pedidos", puede **autoasignarse** órdenes.

---

## 4. Funcionalidades del tablero

1. **Tablero unificado** con 2 vistas (cuadrícula de tarjetas / lista) conmutables. Tarjeta: título (alias o ID), pill de estado con color, cliente, operario. El color del estado tiñe el borde izquierdo.
2. **Filtros por estado** tipo tabs horizontales con **contador por estado** y subrayado del color del estado + tab "TODOS (n)". Al entrar a un operario, los tabs se recalculan solo con sus estados.
3. **Búsqueda global** sobre todos los campos del objeto orden (client-side).
4. **Auto-refresh cada 10 minutos** en segundo plano, que se **salta si hay un modal abierto** (para no pisar al usuario) y conserva filtros/vista actual. Actualiza también la cotización del dólar si el input no tiene foco.
5. **Estados configurables por planilla** (nombre + color) sin tocar código; default "INGRESADO" si está vacío.
6. **Asignación de operarios**:
   - Admin: select en la tarjeta (optimistic update local + guardado async).
   - Operario: botón FAB "+" → modal con órdenes en estado `LISTO PARA BORDAR` sin asignar, multi-selección con checkboxes y vista previa de cada orden antes de tomarla.
   - Al entrar a un operario, si tiene órdenes `LISTO PARA BORDAR` se preselecciona ese filtro.

## 5. Modal de detalle de orden (pantalla principal de trabajo)

- **Header hero** con el color del estado de fondo, ID grande **editable** (alias/nota de usuario que reemplaza al ID visible sin cambiar la clave), badge de estado, cliente y operario.
- **Cambio de estado** vía select en el header → guarda + agrega línea al historial → **timeline de actividad** (estado + fecha parseados de `ESTADO [fecha]`).
- **3 indicadores de checklist** con popovers: **Matriz** (col S; abre modal con archivos DST/EMB descargables desde la hoja MATRIZ), **Prueba** (col T; popover con botón "Aprobar pruebas" → escribe APROBADO), **Paquete** (col P; popover que consulta PAQUETES y calcula bultos: detecta `(Bn/m)`, marca "Completo (3/3)" o "Faltan Paquetes — Falta: B2, B3").
- **Campanita de atención**: si col H tiene contenido, botón rojo con animación shake que abre la nota.
- **Carrusel de diseños**: parsea links de Drive (col G), genera thumbnail (`drive.google.com/thumbnail?id=...&sz=w1000`), navegación con flechas/dots/fade, descarga del visual actual y link al original.
- **Archivos** (col F): chips que abren **visor iframe** (`drive.google.com/file/d/ID/preview`) con botón de descarga directa (`uc?export=download`), y "Descargar Todo".
- **Notas de producción**: modal tipo chat (textarea + historial de tarjetas con fecha), persistidas en hoja NOTAS, inserción optimista al frente.

## 6. Sistema de costos (lo más elaborado)

- **Tarifas por cliente y producto** (hoja COSTOS): costo de matriz (por diseño) + costo unitario según producto; **fallback a cliente `COMUN`** si el cliente no tiene fila propia.
- **Calculadora ("Registro de Producción")**: una fila por diseño/archivo; inputs de puntadas (referencial) y **bordados (unidades)**; costo = `unidades × costoUnitarioProducto + matriz(toggle por diseño)`. El toggle de matriz por diseño se puede activar/desactivar también después desde el detalle (chip clickeable que recalcula y persiste con log "Matriz habilitada/deshabilitada").
- **Producto editable desde la calculadora**: select con la lista de productos (headers de COSTOS); si cambia, botón Guardar → actualiza la col W/X y recarga tarifas.
- **Precarga de valores previos**: al reabrir la calculadora parsea `costoDetalle` y rellena puntadas/unidades y estados de matriz anteriores.
- **Costo manual (override)**: editor que fija un total manual → log `[MANUAL: $x]`; el último registro `[MANUAL:...]` del historial define si el modo manual está activo; "Deshabilitar" vuelve al calculado (`[MANUAL: DESACTIVADO]`). Badge "MODO MANUAL" en amarillo.
- **Historial de costos visual**: parsea la col L y muestra filas con ícono según tipo (manual/sublimación/matriz), monto y fecha.
- **Moneda dual**: prefijo `XSB`/`RXSB` ⇒ U$S; resto ⇒ $. La calculadora computa en $ y al guardar una XSB **divide por la cotización** (`DATOS!F2`); los costos de sublimación escaneados ya vienen en U$S y se suman directo. Cotización **editable desde el header** (widget con input) y refrescada en el auto-refresh. El log de una carga XSB registra `U$S x (Cot: $y)`.

## 7. Escáner (recepción de paquetes)

- Modal con inputs dinámicos (Enter agrega el siguiente campo → escaneo continuo con pistola) y proceso batch.
- Formato del código: tokens separados por `$*`; token 1 = código de orden con sufijo opcional `(Bn/m)` (bulto n de m); token 7 = costo de sublimación (para XSB).
- **Regla por prefijo (aislamiento de hojas):**
  - `PRE-` → registra en hoja PAQUETES (código, cliente, bulto, fecha) y acumula el código en col P **solo de BASE**.
  - `XSB-` → busca **solo en ORDEN_XSB**; **rechaza duplicados** (si el token ya está en col P); acumula token+fecha en P, suma el costo de sublimación (U$S) al total (col M) y agrega `[SUBLIMACION: U$S x]` al historial (col L).
- Resultado por línea (éxito/error con mensaje) y refresh del tablero.
- **Historial de paquetes** global: modal con búsqueda, agrupado por código, contando bultos únicos vs. esperados (`(Bn/m)`) → badge Completo/Incompleto, expandible con detalle por bulto y fecha.

## 8. Importación XSB (integración entre planillas)

- Modal 2 pestañas: "Planilla Sublimación" (fuente externa, rango B2:J) y "Hoja ORDEN_XSB" (vista de lo ya guardado).
- **Anti-duplicado**: carga primero los IDs ya guardados y **oculta** de la lista los que ya existen ("Todas las órdenes están actualizadas" si no queda nada).
- Selección con checkboxes (+ seleccionar todo) → `saveXsbOrders`: inserta cada fila **arriba** (fila 2) con **mapeo de columnas explícito** (fuente 0..8 → destino A,B,D,E,F,H,W→23?,G,X) — el "producto" se extrae del último token si el campo viene concatenado con `$*` o `\|` — y estado inicial `INGRESADO`.
- Al terminar refresca el tablero principal.

---

## 9. Reglas de negocio destacables (para adaptar)

1. **Dos orígenes, un tablero**: unificación de dos "tablas" heterogéneas con ordenamiento por fecha y campo `_origen`, manteniendo reglas separadas por prefijo de código (moneda, hoja destino del escáner).
2. **Moneda por tipo de orden** con cotización global editable en vivo y conversión solo al persistir (el cálculo se hace en $).
3. **Override manual de precio con historial y reversibilidad** (activar/desactivar sin perder el calculado).
4. **Matriz cobrable por diseño con toggle** — análogo al cobro de matriz TPU del proyecto actual (art. 156): acá es por archivo/diseño y reversible con log.
5. **Checklist de gates visuales** (matriz lista / prueba aprobada / paquetes completos) en el detalle — el operario ve de un vistazo si puede producir.
6. **Control de bultos (Bn/m)** con detección de faltantes — mismo concepto que "Esperando Bultos" del proyecto actual, pero acá solo informativo (no bloquea estados).
7. **Tarifario cliente/producto con fila fallback `COMUN`** — análogo a precios especiales por cliente con precio de lista por defecto.
8. **Alias visible editable sin tocar la clave** (col U reemplaza al ID en pantalla).
9. **Auto-asignación por el propio operario** de un pool "LISTO PARA BORDAR" + reasignación directa del admin desde la tarjeta.
10. **Notas de producción tipo chat por orden** en tabla separada (equivalente directo a una tabla `OrdenNotas`).

## 10. Deudas / cosas a NO copiar

- Contraseñas en texto plano en la planilla + password admin default hardcodeado en el código.
- "Sesión" solo en localStorage sin token/expiración (cualquiera con la URL y F12 podría saltarse el login; la autorización real depende del deployment de Apps Script).
- Datos transaccionales como strings concatenados con `|||` y parseo con `indexOf/split` (frágil; en SQL: tablas de detalle/eventos).
- Identificación de filas por búsqueda lineal del ID en col A en cada operación (sin locking → riesgo de concurrencia).
- `login.html` es código muerto (el login vigente está en index + js).
- El monto "manual activo" se deduce parseando el ÚLTIMO registro del historial L — estado implícito en un log.
