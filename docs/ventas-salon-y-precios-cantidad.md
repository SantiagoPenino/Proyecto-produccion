# Precios por cantidad y Ventas de salón (con sus comisiones)

Dos pantallas nuevas pedidas el 19/10/2026, más la de comisiones de salón.

Estado: **implementado y probado en local el 19/10/2026. Sin commit y sin deployar.** El SQL ya corrió en la base local.

## 1. Precios por cantidad (`/vendedores/precios-cantidad`)

Solo lectura, como la planilla de precios. Muestra **todo el nomenclador**: los artículos activos, tengan o no precio de lista. No tiene tabla propia ni guarda nada: se arma cada vez que se abre, con `PreciosBase` y los perfiles de precios.

- **«Todas»** (la pestaña que abre) muestra un cuadro por área, uno debajo del otro, cada uno con sus propias franjas. Además hay una pestaña por área y **«Otros (sin área)»** para los artículos sin área en `ConfigMapeoERP` (los productos de la tienda, grupo 2.1, y algunos sueltos).
- Por artículo:
  - el precio de lista y su moneda. Sin precio cargado o en 0, dice «Sin precio»;
  - el precio en cada franja de cantidad («Desde 10 m», «Desde 25 m»…), con el % que baja respecto de la lista.
- **«Incluir inactivos»** suma los artículos con `Mostrar = 0`, marcados «INACTIVO». Los borrados no aparecen nunca.

**De dónde salen los números.**

- El motor de precios calcula cada celda (`pricingService.calculatePrice`), sin cliente. Es lo que paga un cliente que no tiene excepciones ni perfiles propios.
- Las franjas (las columnas) son los mínimos de los perfiles globales que el motor aplica a esa área, con el mismo criterio de `Categoria` que usa el motor.
- El % se calcula a partir de la lista y del precio, así que sirve igual para una regla de % y para una de precio fijo (TPU).
- Al pasar el mouse por un precio se ve qué perfil lo da.

**Reglas.**

- **El área se le pasa al motor.** Si no, la toma de la primera orden del artículo, y un artículo que nunca se pidió no recibiría los descuentos del área.
- **Bordado y Estampado no se cobran por la lista** (sus listas están en 0). Van sus artículos con un aviso que dice cómo se cobran:
  - Bordado, por puntadas: $ 50 hasta 5.000 puntadas y $ 10 más cada 1.000;
  - Estampado, por bajadas: $ 150 en total si son menos de 10 y $ 15 por bajada desde ahí.
  - Los valores salen de `ConfiguracionPrecios`.
- **«Otros» no tiene franjas:** sin área no les aplica ningún perfil por área.

**Rendimiento (local).** DTF tarda 0,2 s (3 artículos × 3 franjas), Sublimación 0,7 s (37 × 3) y «Todas» 0,9 s (1,1 s con inactivos, 292 filas), con seis cálculos a la vez. El motor solo se llama en las áreas con franjas. Para no llenar el log con cientos de trazas por pantalla, el motor acepta `variables.sinTraza`.

**Cómo queda hoy (base local):**

| Área | Franjas | Ejemplo |
|---|---|---|
| DTF | 10, 25, 100 m | Lista US$ 22,00 → 19,80 (−10 %), 18,70 (−15 %), 16,50 (−25 %) |
| Sublimación | 100, 250, 500 m | Lista US$ 10,00 → 9,00, 8,50, 7,50 |
| TPU | 15, 100, 1.000 u. | Parche 10×8: lista US$ 2,50 → 2,50 (sin descuento), 2,25, 2,00 |
| ECOUV, Corte, Costura, Impresión Directa, Otros | ninguna | Todos pagan la lista |
| Bordado, Estampado | ninguna | Lista en 0: aviso con la tarifa por puntadas o por bajadas |

**Escalas de ECOUV (19/10, en local; falta producción).** Desde 10 m² 10 %, desde 50 m² 15 %, desde 100 m² 25 %, como en la planilla.

- **Script:** `backend/scripts/sync_escalas_ecouv_prod.sql`. Es idempotente, va en una transacción y no hace falta reiniciar nada.
- **Perfil:** se cargan en «ECOUV ESCALONADOS» (ID 14), que pasa a ser global.
  - Antes solo tenía un recargo del 25 % desde 1 unidad y no se aplicaba a nadie; el script lo borra.
  - El script se frena si ese perfil es el de urgencia o el de tinta, o si está asignado a algún cliente.
- **A qué artículos:** solo a los materiales que se venden por m² (`StockArt.UM = 'M2'`).
  - En local son 17 (14 activos): lonas, vinilos, canvas, papel y PET.
  - Lo que se vende por unidad (cuadros, columneras, pasacalles, roll up, bastidores) no lleva escala.
  - Un material por m² nuevo no la toma solo: hay que volver a correr el script o cargarla en Precios Estándar.
- **Verificado con el motor (local):**
  - Vinilo brillo, lista US$ 9,00: 9,00 hasta 9,99 m², 8,10 desde 10, 7,65 desde 50 y 6,75 desde 100; en pesos, $ 360 → $ 270 en 100 m².
  - Un cuadro canvas no cambia.
  - Un cliente con −20 % de excepción paga el mejor de los dos: 20 % en 10 m² y 25 % en 100 m².
  - El código 28 de Sublimación (Rib), que comparte código con Back pet de ECOUV, no se toca.

### Tarifa de bordado de la guía de Emblemas (19/10, en local; falta producción)

Decisión del 19/10: vale la tarifa de la guía de Emblemas, no la que tenía el motor ($ 50 hasta 5.000 puntadas y $ 10 cada 1.000 más).

**La tarifa nueva, por bordado:**
- $ 8 cada 1.000 puntadas o fracción, hasta 10.000;
- $ 6 cada 1.000 o fracción de ahí en más;
- matriz $ 200 por diseño, sin cargo desde 10 bordados;
- mínimo 5 bordados por diseño.

Ejemplos: 5.000 puntadas $ 40, 10.000 $ 80, 10.001 $ 86, 26.125 $ 182 (antes $ 270) y 30.000 $ 200.

**Cambios en el motor (`pricingService.js`):**
- **La tarifa:** `tarifaBordado()` la calcula y la usan el motor y la tabla de esta pantalla. Las claves están en `ConfiguracionPrecios`; si faltan, el motor usa los valores de la guía.
- **Los cargos van por su lista, no por puntadas:** matriz, relieve 3D y aplicación (`BOR_CARGOS_CON_LISTA`). Antes caían en la tarifa y salían a $ 50 cada uno sin puntadas.
- **Matriz sin cargo** (`BOR_COD_MATRIZ`, `BOR_MATRIZ_GRATIS_DESDE`): si la orden lleva 10 bordados o más, la matriz sale como descuento del 100 % sobre su lista, igual que una reposición.
  - El sync le pasa la cantidad de bordados (`erpSyncService.js`, `cantidadBordados`).
  - El modal de cotización la calcula a partir de la orden: piezas de los diseños de bordado o, si no hay, la Magnitud.
- **Script:** `backend/scripts/sync_tarifa_bordado_prod.sql`. Carga las claves, borra las 3 de la tarifa vieja (antes las muestra) y pone la matriz a $ 200 de lista. Es idempotente y va en una transacción.

**En pantalla.** Bordado muestra el aviso con la tarifa y una tabla «Tarifa por puntadas», de 3.000 a 30.000 puntadas, con el precio por bordado y la cuenta. Los artículos que se cobran por puntadas dicen «Por puntadas» y la matriz, $ 200,00.

**Verificado con el motor (local):** 19 pruebas, sin fallas. Puntadas de 0 a 30.000, matriz con 5 y con 10 bordados (por cantidad y por orden), matriz en dólares, relieve 3D sin lista y DTF sin cambios.

**Dónde se cambia la tarifa (19/10).** En Perfiles de Precios → Precios Estándar, al elegir el grupo «1.4 (Bordado)».
- **Recuadro «Tarifa por puntadas»:** arriba de la tabla.
  - Se editan cuatro valores: $ cada 1.000 puntadas, desde cuántas puntadas cambia, $ cada 1.000 desde ahí y desde cuántos bordados la matriz va sin cargo.
  - Debajo va la misma tabla «Tarifa por puntadas» que en Precios por cantidad, y se recalcula mientras se escribe.
    - Las puntadas van de 3.000 a 10.000 de mil en mil, y después 12.000, 15.000, 20.000, 25.000 y 30.000. Es una sola lista, `PUNTADAS_REFERENCIA_BORDADO` en `pricesController.js`.
    - La tabla es un único componente para las dos pantallas: `src/components/pages/TablaTarifa.jsx`, con las cuentas en `tarifasCobro.js`.
  - El botón «Guardar tarifa» pide confirmación.
  - Endpoints: `GET/PUT /api/prices/tarifa/bordado`, que escriben en `ConfiguracionPrecios`.
  - Cada cambio queda en la tabla `Auditoria` («Tarifa de bordado», con el antes y el después).
  - Rige para todo lo que se cotice desde que se guarda.
- **En la tabla:** los artículos que se cobran por puntadas muestran «Por puntadas» y UYU fijo, sin campo de precio ni botón de otra moneda, porque el motor no usa ese precio. La matriz, el relieve 3D y la aplicación de parche siguen editables como antes.
- **Cómo sabe la pantalla qué es de Bordado:** `/api/prices/base` ahora también devuelve `AreaGrupo`, el área del grupo.
- **Probado:**
  - el endpoint, contra la base local: lectura, valores inválidos rechazados, el motor usa el valor nuevo en el momento y la auditoría queda registrada. Se volvió a dejar la tarifa como estaba;
  - la pantalla, en el arnés con los datos reales de `/prices/base`.

**Lo que queda distinto o pendiente:**
- **Una orden sin puntadas sale en $ 0.** Antes cobraba $ 50 de mínimo. Pasa cuando el cliente no hace el prediseño y el área todavía no cargó las puntadas.
- **El relieve 3D y la aplicación de parche no tienen precio de lista.** Salen en $ 0 hasta que se les cargue uno en Precios Estándar. Antes salían a $ 50 por puntadas.
- **Los combos de gorros (147, 148) y «SUBLIMACION + BORDADO» (163)** se siguen cobrando por puntadas, como antes, con la tarifa nueva.
- **El mínimo de 5 bordados no lo controla nadie.** El motor no lo cobra y el formulario del portal deja pedir desde 1.

### Tarifa de estampado por bajadas (19/10)

Igual que Bordado, con la tarifa que ya tenía el motor. No hay una guía publicada que la fije.

**La tarifa, por trabajo:** $ 150 fijo si el trabajo tiene menos de 10 bajadas en total; desde 10, $ 15 por bajada. Las bajadas en total son las bajadas por prenda × las prendas. Las claves (`EST_CARGO_FIJO_UYU`, `EST_UMBRAL_BAJADAS`, `EST_PRECIO_BAJADA_UYU`) ya existían en `ConfiguracionPrecios`.

**En pantalla:**
- **Precios por cantidad (Estampado):** el aviso y la tabla «Tarifa por bajadas», de 1 a 200 bajadas en total, con el precio del trabajo y el precio por bajada. Cada artículo muestra «15,00 por bajada».
- **Precios Estándar (1.5 Estampado):** el recuadro «Tarifa por bajadas» con los tres valores editables y la misma tabla.
  - El precio de los artículos **sigue editable**: es el que se cobra si la orden no trae bajadas.
  - Debajo dice «Por bajadas si la orden las trae; si no, este precio».

**Código compartido con Bordado:**
- **Endpoints:** uno para las dos tarifas, `GET/PUT /api/prices/tarifa/:tipo` (`bordado` | `estampado`). Reemplaza a `/tarifa-bordado`, que no llegó a deployarse. Valida los valores, registra cada cambio en `Auditoria` y lo arma `TARIFAS` en `pricesController.js`.
- **Motor:** `pricingService.tarifaEstampado()` hace la cuenta (antes estaba suelta dentro de `calculatePrice`; el resultado es el mismo).
- **Front:**
  - `src/components/pages/tarifasCobro.js` tiene los campos, los textos y las cuentas de las dos tablas. Comparadas con las del motor en 65 casos, dan lo mismo.
  - `TablaTarifa.jsx` es la tabla. `TarifaPuntadasTabla.jsx` se borró.

**Cómo se cobra hoy el estampado:**
- **Ninguna orden trae las bajadas cargadas.** Las de junio se cobraron $ 0 (lista en 0). Las de octubre son «Comprar y personalizar» y se cobran dentro de la orden de producto (PRO).
- **La tarifa por bajadas, en la práctica, todavía no se aplica.**

**Doble conteo de bajadas (arreglado el 19/10, en local):**
- **El problema:** el sync arma la cantidad de una orden de estampado como prendas × bajadas por prenda + adicionales, tanto en la línea principal como en los servicios 110/113, y le pasa además las bajadas por prenda. El motor volvía a multiplicar, y 20 prendas con 2 bajadas salían $ 1.200 en vez de $ 600. Al modal de cotización le pasaba lo mismo. No afectó a ninguna orden, porque ninguna traía bajadas.
- **La corrección**, solo en `pricingService.js`: el motor toma la cantidad de la línea como las bajadas en total. Las bajadas por prenda ya no multiplican; solo indican que la línea se cobra por bajadas. El precio unitario de la línea es el precio por bajada.
- **Probado con el motor (local):** 12 pruebas, sin fallas.
  - Llamadas como las del sync (línea principal y servicio 110) y como la del modal: 20 × 2 = $ 600, 3 × 2 = $ 150 fijo, 10 × 1 + 5 adicionales = $ 225, y sin bajadas, la lista.
  - DTF, ECOUV y Bordado sin cambios.
- **Si la orden no trae bajadas:** la cantidad de la línea son las prendas y se cobra el **precio de lista por prenda**. Es el campo de precio de los artículos 110 (Estampado) y 157 (Estampado de TPU) en Precios Estándar, hoy en 0. Con 0, esas órdenes salen $ 0.

**Perfil «EST PRECIOS»:** no es global ni está asignado, pero Precios Estándar lo muestra en el grupo Estampado (la columna «Min 10 baj.»). Sus reglas (150 % y 15 %) parecen un intento viejo de cargar esta tarifa como perfil. No se tocó.

## 2. Ventas de salón (`/vendedores/salon`)

Acá los vendedores de salón cargan las ventas de promos que hacen.

**Qué se carga:**

- la fecha;
- el vendedor (un usuario del sistema);
- el cliente con ficha o «Consumidor final»;
- la moneda ($ o US$) y el monto;
- las observaciones.

**Quién puede qué.** Se decide por las entradas del menú del rol. Admin puede todo.

- **«Ventas de salón»** (Admin, VENTAS, Atención al Cliente):
  - cada vendedor carga y ve **sus** ventas;
  - las corrige o anula mientras la venta sea del mes en curso, porque un mes cerrado ya se comisionó;
  - no puede cargar ventas con fecha de otro mes.
- **«Comisiones de salón»** (Admin, Administracion), el supervisor:
  - ve y carga las ventas de todos, a nombre de cualquier usuario y con cualquier fecha hasta hoy;
  - corrige o anula cualquier venta.
- **Franjas de comisión:** solo un Admin las cambia.

**Reglas.**

- **Anular:**
  - pide el motivo;
  - la venta queda en la lista, tachada, con quién la anuló y por qué, y deja de contar;
  - si otro la anuló mientras alguien la corregía, el servidor devuelve 409 y no la pisa.
- **Clientes:**
  - elegir las fichas genéricas 2089 u 8741 es lo mismo que «Consumidor final»;
  - el cliente se guarda por `CliIdCliente`. El buscador de Solicitudes ahora también lo devuelve; Solicitudes sigue usando `CodCliente`.
- **Arriba de la lista** se ve lo vendido en el mes, el total unificado en US$ y, si se mira a un solo vendedor, su franja y la comisión que lleva.

## 3. Comisiones de salón (`/vendedores/salon-comisiones`)

Mismo formato que Ventas por vendedor.

**Qué muestra.**

- Por vendedor:
  - $ vendido, con su equivalente en US$ debajo;
  - US$ vendido;
  - la cantidad de ventas;
  - el total unificado en US$ con su comisión.
- **Ganadores:** el primero de cada mes, con la racha y la ventaja sobre el segundo.
- **Detalle:** al tocar un vendedor se ven sus ventas del mes.

**Reglas.**

- **Vendido:** la suma de las ventas del mes, por la fecha de la venta y sin las anuladas.
- **Cotización:** la misma que en Ventas por vendedor. En el mes en curso, la del día; en un mes cerrado, la última de ese mes.
- **Franjas:** salen de la tabla `VentasSalonFranjas`, que **arranca vacía**. Mientras esté vacía nadie tiene comisión y la pantalla lo avisa.
  - El Admin las carga con el botón «Franjas de comisión».
  - Igual que en vendedores, el % de la franja alcanzada va sobre todo el total, no por tramos.
- **Ganadores:** desde el primer mes con ventas de salón.

**Piezas compartidas con Ventas por vendedor.** Están en `src/components/pages/ventas/comisionesComunes.jsx` y salieron tal cual de `VendedorVentasMensuales.jsx`:

- fotos y tira de ganadores;
- celdas de plata;
- barra y pastilla de franjas;
- orden animado;
- cotización del mes y selector de mes.

Ventas por vendedor las importa de ahí. Sigue con sus franjas fijas y se ve igual que antes (comparado con los datos reales de setiembre y octubre).

## Qué se tocó

- **SQL:** `scripts/add_ventas_salon_y_precios_cantidad.sql`.
  - Es idempotente y aditivo.
  - Crea las tablas `VentasSalon` y `VentasSalonFranjas`.
  - Agrega 3 entradas de menú colgadas de «Ventas». Los roles van por nombre: se cambian en la lista del script o en la pantalla de Menú.
  - También da el grupo «Ventas» a los roles que reciben las pantallas. En local, eso hizo que Administracion vea el grupo, y con él Beneficios y Solicitudes, que ya tenía permitidas.
- **Backend:**
  - Precios por cantidad: `controllers/pricesController.js` (`getPreciosPorCantidad`), `routes/pricesRoutes.js` (`GET /api/prices/por-cantidad`) y `services/pricingService.js` (una línea: `variables.sinTraza`).
  - Ventas de salón:
    - `services/ventasSalonService.js` tiene las reglas y los permisos;
    - `controllers/ventasSalonController.js` y `routes/ventasSalonRoutes.js` exponen `/api/ventas-salon`: `mi-perfil`, `vendedores`, `franjas` (GET y PUT), `resumen`, `ganadores`, listar, crear, corregir y anular;
    - `server.js` monta la ruta.
- **Front:**
  - Pantallas nuevas: `pages/PreciosPorCantidad.jsx`, `pages/ventas/VentasSalonPage.jsx` y `pages/ventas/VentasSalonComisiones.jsx`.
  - Piezas comunes: `pages/ventas/comisionesComunes.jsx`, que ahora usa `pages/VendedorVentasMensuales.jsx`.
  - `pages/ventas/solicitudesComunes.jsx`: el buscador de clientes también devuelve `CliIdCliente`.
  - `layout/MainAppContent.jsx`: las 3 rutas, solo por menú, sin `<Route>` fija, y los íconos.

## Pruebas (local)

- **Precios por cantidad:**
  - el endpoint, llamado directo, en todas las áreas: DTF, Sublimación y TPU con los valores de arriba, Bordado con su aviso y un área que no existe da 404;
  - en pantalla: DTF y TPU.
- **Ventas de salón, servicio contra la base local: 31 pruebas, sin fallas.**
  - Permisos con usuarios reales de cada rol: Admin, VENTAS, Administracion y DTF (este último sin acceso).
  - Alta propia y a nombre de otro; la ficha 2089 queda como consumidor final.
  - Validaciones: fecha futura, mes cerrado, sin cliente, monto 0 o con 3 decimales, sin moneda, cliente que no existe.
  - Corrección y anulación, propias y ajenas.
  - El resumen sin las anuladas, las franjas (solo Admin, ordenadas, sin repetidas) y los ganadores.
  - Las ventas de prueba se borraron: la tabla quedó vacía.
- **Pantallas,** en un arnés aparte, sin el backend:
  - precios y Ventas por vendedor con respuestas reales de la base local;
  - salón con datos inventados.
  - Se probó cargar una venta, anularla, el resumen con la franja, Comisiones de salón con su detalle desplegado y el editor de franjas, y que Ventas por vendedor se ve igual en setiembre y en octubre.
- **Revisión de código:**
  - ESLint sin variables sin definir ni sin usar;
  - `vite build` compila (con `react-konva` marcado como externo, ver abajo);
  - `node --check` en el backend.

## Para deployar

1. Correr `scripts/add_ventas_salon_y_precios_cantidad.sql` en producción. Al final lista las 3 pantallas con sus roles y los roles de la lista que no existan en esa base.
2. Backend, con reinicio: `pricesController.js`, `pricingService.js`, `erpSyncService.js`, `pricesRoutes.js`, `ventasSalonService.js`, `ventasSalonController.js`, `ventasSalonRoutes.js` y `server.js`.
   - Junto con este paso, correr `backend/scripts/sync_tarifa_bordado_prod.sql`: con el código nuevo y sin el script, la matriz sale en $ 0.
   - Las escalas de ECOUV (`backend/scripts/sync_escalas_ecouv_prod.sql`) no dependen del deploy: se pueden correr antes o después.
3. Build del front, en el mismo deploy. Incluye `BasePrices.jsx` (Precios Estándar), además de las pantallas nuevas.
4. Los usuarios tienen que volver a entrar para ver las entradas nuevas del menú, porque el menú se carga al iniciar sesión.
5. Un Admin carga las franjas de salón desde «Comisiones de salón» → «Franjas de comisión».

**Aparte:** `react-konva` está en `package.json` pero no en `node_modules` de esta máquina, y sin él `vite build` falla en Marketing › Piezas. Hace falta un `npm install` antes del build.

## Riesgos anotados para más adelante

Quedaron fuera a pedido (19/10). Ninguno bloquea el uso.

1. **Montos a mano, sin respaldo.**
   - Las ventas de salón no se cruzan con ningún ticket ni factura: el monto es el que escribe el vendedor.
   - Opción: pedir el número de documento (o elegirlo de los del día en caja) y avisar si no existe o si el monto no coincide.
2. **Doble comisión.**
   - La misma venta genera su documento en caja. Si el cliente es de la cartera de un vendedor de calle, también le cuenta a él en Ventas por vendedor.
   - Además, un usuario con rol VENTAS puede cargar ventas de salón: cobraría por las dos vías.
   - Hay que decidir si está bien o si una excluye a la otra.
3. **Las promos ya pasan por caja.** Los rollos y planes de metros adelantados se venden en caja como `RECURSO` y quedan en un documento. Si las ventas de salón son esas, se podrían traer solas de caja y que el vendedor solo indique que la venta es suya.
4. **Las franjas no tienen historia.**
   - Cambiarlas cambia la comisión de todos los meses, también los cerrados. La pantalla lo avisa antes de guardar.
   - Lo mismo pasa en Ventas por vendedor, donde las franjas están fijas en el código.
   - Si se pagan comisiones con esto, conviene congelar el resultado del mes al cerrarlo, o guardar las franjas con fecha de vigencia.
5. **Quién es «vendedor de salón».**
   - Es quien tiene la pantalla en el menú de su rol. No hay una lista propia.
   - Los usuarios sin `Usuarios.Cedula` (casi todos fuera de VENTAS) se ven con la inicial en vez de la foto.
6. **Precios por cantidad: lo que la planilla tiene y el sistema no.**
   - **Negociable:** el piso de negociación (8 / 12).
   - **Promos por adelantado:** Emprendedor 20 m, Marcas 50 m, 1 rollo, 3 rollos.
   - **Metros adelantado:** de 10 % a 50 %. Hoy el plan se vende en caja con el precio que se escribe a mano.
   - **Estado de stock:** discontinuada, stock limitado, sin stock, no se vende.
7. **DTF 100 m no coincide.** La planilla dice 15,00 (31,8 %) con encabezado «%25»; el motor da 16,50 (25 %). La pantalla muestra lo del motor.
8. **Tipo de cambio del motor.**
   - El motor convierte monedas con `ConfiguracionGlobal.TIPO_CAMBIO_USD` (40), no con la cotización del BCU.
   - La pantalla de precios muestra cada artículo en su moneda de lista, así que hoy no le afecta. Si se agrega un «equivalente en pesos», hay que elegir cuál de las dos cotizaciones usar.
9. **Perfil de Impresión Directa.** «ESCALONADOS IMPRESION DIRECTA» tiene `Categoria = 'IMD'`, pero el área es `DIRECTA`, así que el motor nunca lo aplica. Hoy no tiene reglas y no importa; si se le cargan, hay que corregir la categoría.
