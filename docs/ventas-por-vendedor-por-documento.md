# Ventas por vendedor sobre documentos, y las notas de crédito en Contabilidad

Dos cambios del 01/10/2026 que van juntos:

1. La pantalla **Ventas por vendedor** (`/vendedores/ventas`) muestra plata y no órdenes, tomando los documentos de venta como hace Contabilidad → Reportes → «Ventas por Documento (DGI)».
2. Los **reportes de ventas de Contabilidad** pasan a restar las notas de crédito, igual que esa pantalla.

Estado: **implementado y probado en local el 01/10/2026. Sin deployar.** Los números son de la copia de producción del 30/09 a las 13:27.

## Decisiones de Santiago (01/10 y 02/10)

1. **Documentos:** todos los de venta, estén o no aceptados por DGI. La primera versión tenía el selector Sin DGI / Todo / DGI de Contabilidad; pidió sacarlo.
2. **Notas:** las de crédito restan y las de débito suman. Primero solo en Vendedores; después dijo «el criterio debería ser el de total unificado, las notas de crédito se deben de restar» y eligió aplicarlo también en Contabilidad.
3. **Fila «Mostrador / sin identificar»:** se muestra, para que el total cierre con Contabilidad.
4. **Anticipos:** quedan afuera, igual que en Contabilidad. Cuentan cuando se factura lo consumido.
5. **Columna «Total unificado en US$»:** lo vendido en dólares más lo vendido en pesos pasado a dólares. El nombre lo eligió él (pasó por «Total unificado US$» y «Total US$»), sin aclaraciones en el encabezado. La cotización se muestra arriba, con un botón al lado para actualizarla.
   - Antes pasó por «Cobrado total US$» y por una columna aparte sin restar las notas («Vendido total US$»). Las dos se sacaron: la primera la cambió por lo vendido, y la segunda dejó de hacer falta cuando Contabilidad empezó a restar las notas.
6. **Cobrado y pendiente:** van en una sola columna por moneda, con el encabezado «cobrado» sobre «pendiente» y una línea entre los dos. En cada celda, el cobrado arriba en verde (emerald 500) y el pendiente abajo en rojo (red 500), con la misma línea entre los dos que el encabezado. Los números van centrados en el alto de la fila. «Pendiente» es lo que antes se llamaba «sin cobrar». Antes eran dos columnas: pidió sacarlas y las volvió a pedir el mismo día.
7. **Fotos de los vendedores:** cuadradas, de todo el alto de la fila y pegadas a la izquierda (02/10); las mismas del registro del portal (`public/assets/images/asesores/<cédula>.webp`, ver `RegisterPage.jsx`). Sin foto va la inicial. La página ocupa todo el ancho.
8. **Orden por total, con animación (02/10):** «cuando se cargue ordená por total de mayor a menor, cada card completa y con animación». Los vendedores van por el total unificado, de mayor a menor. Al cargar, las filas aparecen como llegan (por nombre) y arrancan a moverse enseguida, todas juntas: cada fila se desliza entera hasta su lugar, con una sombra mientras se mueve; las que suben pasan por encima de las que bajan. Al principio había una pausa de 350 ms antes de moverse y cada fila salía 50 ms después de la anterior: hizo sacar las dos esperas el 02/10. Las filas que no son de un vendedor («Mostrador / sin identificar», «Clientes sin vendedor») quedan siempre al final. Sin cotización no hay total y quedan como llegan.
9. **Franjas de comisión (02/10):** sobre el total unificado en US$ (lo vendido, no lo cobrado), el % de la franja alcanzada se aplica a todo el total, no por tramos: desde 50.000, 0,8 %; desde 75.000, 1 %; desde 100.000, 1,2 %; desde 125.000, 1,3 %; por debajo de 50.000, nada. Una barra por vendedor que se llena al cargar y va completando las franjas, con la pastilla del %, cuánto le falta para la próxima y la comisión debajo del total. Quién ve la comisión de quién no lo definió: la pantalla la muestra a todos, como el resto de los números.
10. **Cotización (02/10):** «la del día si estás dentro del mes y, si el mes ya pasó, la última de ese mes».
11. **«Otras ventas» (02/10):** lo que no es de ningún vendedor (clientes sin vendedor del área, mostrador) va en una sola fila al final, sin foto, sin ícono y sin sangría; al tocarla se despliega cada parte con sus números. No quiere ver los documentos. «Sin vendedor» como nombre no le gustó.
12. **Desde junio 2026 (02/10):** «antes no hay datos o no son confiables, así que no importan». La pantalla no deja ir más atrás, y los ganadores se cuentan desde ahí.
13. **Ganador del mes y racha (02/10):** el primero por total unificado. Una tira arriba de la tabla con el ganador de cada mes, con límite (6 meses) y flechas para ver los anteriores; los meses seguidos del mismo vendedor van unidos con la racha. En la fila del primero, corona, «Ganó <mes>» y los meses seguidos; en el mes en curso, solo «Va ganando», sin racha (pidió sacar la segunda pastilla).
14. **Animación al cambiar de mes (02/10):** el nombre del mes y la tabla entran deslizándose desde el lado hacia el que se fue. La ventaja sobre el segundo, en las dos filas. Los textos no dicen «ganador» ni «ganadora»: el sistema no sabe el género de cada vendedor.

## «Mostrador / sin identificar» (dentro de «Otras ventas»)

Son los documentos emitidos con la ficha genérica de mostrador (2089 u 8741) que no se pueden atribuir a ningún cliente: sus líneas no traen código de orden y el RUC del receptor no está en ninguna ficha. En setiembre son 32 documentos, por $ 382.916 y US$ 50:

- 9 e-facturas a empresas que no tienen ficha con ese RUC: $ 362.520 y US$ 35. Las más grandes: Muslera Rodríguez Lautaro Emanuel ($ 227.354 en FA-1576 y FA-1577), Froma SAS ($ 50.000), LOTANIR SA ($ 46.835) y Teresita Gallo SAS ($ 19.440).
- 20 e-tickets a consumidor final: $ 18.396.
- 3 Pedidos Caja: $ 2.000 y US$ 15.

Otros 6 documentos con ficha genérica sí se atribuyeron, por el RUC. Si a una de esas empresas se le carga el RUC en su ficha de cliente, sus facturas pasan solas al vendedor de esa cartera.

## Cómo queda setiembre en Ventas por vendedor

| Vendedor | $ vendido | $ cobrado | $ pendiente | US$ vendido | US$ cobrado | US$ pendiente | Total US$ |
|---|---|---|---|---|---|---|---|
| Agustín Palmero | 162.994,85 | 162.994,85 | 0,00 | 7.368,52 | 6.820,83 | 547,69 | 11.354,70 |
| Fabiana Limpias | 1.424.989,16 | 1.272.197,86 | 152.791,30 | 48.549,89 | 44.771,87 | 3.778,02 | 83.399,22 |
| Lucas Fernández | 973.367,92 | 904.066,37 | 69.301,55 | 28.443,90 | 22.252,01 | 6.191,89 | 52.248,45 |
| Matías siri | 1.676.174,14 | 1.392.242,28 | 283.931,86 | 57.068,86 | 44.084,71 | 12.984,15 | 98.061,14 |
| Sergio Bresque | 587.227,67 | 587.227,67 | 0,00 | 4.870,55 | 4.860,01 | 10,54 | 19.231,71 |
| Soledad Ferreri | 1.653.887,06 | 1.632.153,78 | 21.733,28 | 66.591,68 | 61.497,67 | 5.094,01 | 107.038,91 |
| Mostrador / sin identificar | 382.916,00 | 382.916,00 | 0,00 | 50,00 | 49,76 | 0,24 | 9.414,54 |
| **Total** | 6.861.556,80 | 6.333.798,81 | 527.757,99 | 212.943,40 | 184.336,86 | 28.606,54 | 380.748,65 |

- El total unificado está a $ 40,89, la cotización del 01/10.
- Las notas del mes restan $ 56.385,10 y US$ 3.362,47. Ya están dentro del vendido, y la pantalla lo dice al pie.
- El total es el de Contabilidad al centavo: Ventas por Documento y Ventas por Área dan $ 6.861.556,80 y US$ 212.943,40, con $ 527.757,99 y US$ 28.606,54 pendientes.
- Lo que la pantalla no muestra, pero el endpoint calcula si se le pide: con el filtro DGI, $ 4.575.683,75 y US$ 102.374,84; con Sin DGI, $ 2.285.873,05 y US$ 110.568,56.

## De dónde sale cada número

- **Documentos que cuentan:** los mismos que en Contabilidad (`condEsVenta` en `contabilidadReportesController.js`).
  - E-tickets y e-facturas, contado y crédito.
  - Pedidos Caja.
  - Sin los anulados. Quedan afuera recibos, anticipos y egresos.
- **Notas:** `signoExpr`: la de crédito resta y la de débito suma.
  - Si no restaran, una factura anulada con nota de crédito quedaría como vendida y cobrada.
  - La nota cuenta en el mes en que se emite, que puede no ser el de su factura.
- **Mes:** por fecha de emisión del documento, con el mismo corte de día que usa Contabilidad.
- **Vendido:** el total del documento, en la moneda del documento.
- **Pendiente:** la deuda viva del documento (pendiente, vencida o parcial), solo en documentos a crédito y Pedidos Caja. Es la misma regla que «pendiente de cobro» de Contabilidad.
- **Cobrado:** vendido menos pendiente. En la pantalla van en la misma columna, cobrado arriba y pendiente abajo.
- **Vendedor:** el de la cartera del cliente del documento (`Clientes.VendedorID`), como antes.
  - `DocumentosContables.DocVendedorId` existe, pero no se llena nunca.
  - Si el documento salió con la ficha genérica de mostrador (2089 u 8741), se busca el cliente real como hace Top Clientes: primero el dueño de la orden y después el RUC del receptor.
  - En setiembre: 3.948 documentos con ficha propia, 5 resueltos por RUC y 32 sin resolver ($ 382.916 y US$ 50).
  - Todos los clientes con documentos tienen vendedor del área. Si alguno no lo tuviera, aparece la fila «Clientes sin vendedor del área».
- **Filtro de DGI** (lo acepta el endpoint; la pantalla siempre pide Todo): el `condDgi` de Contabilidad. DGI = aceptado por DGI; Sin DGI = todo lo demás, que incluye los Pedidos Caja.
- **Total unificado en US$:** US$ vendido + $ vendido ÷ cotización. Es la única columna que mezcla monedas, y se calcula en la pantalla.
- **Comisión:** el % de la franja alcanzada × el total unificado, al centavo; la franja se mira con el total ya redondeado. La fila de totales suma las comisiones ya redondeadas.
- **Ganador:** `GET /api/vendedor-360/ganadores` arma, de junio 2026 al mes en curso, el total unificado de cada vendedor con la última cotización del mes (en el mes en curso, la del día) y devuelve el primero y el segundo. La pantalla toma al primero de su propia tabla y cuenta la racha con esa lista: el mes que se mira más los meses cerrados seguidos que ganó antes.
- **Vendido en pesos, en dólares:** debajo del vendido en pesos (y de su total) va, en letra chica, el importe ÷ cotización del día. Es informativo y se calcula en la pantalla. Cobrado y pendiente no lo llevan.
- **Orden de las filas:** se arma en la pantalla (el servidor las sigue mandando por nombre). El movimiento es un `useLayoutEffect` que compara el lugar de cada fila con el de antes y la anima con `element.animate` (`useOrdenAnimado` en el mismo archivo); respeta «reducir movimiento» del sistema.
  - Con la misma cotización da lo mismo que el «Total facturado» del «Resumen unificado en dólares» de Contabilidad (allá es la del día y se puede cambiar a mano).
  - La cotización: en el mes en curso, la del día, la misma de Caja (tabla `Cotizaciones`, una por día; `GET /api/apicotizaciones/hoy`); en un mes cerrado, la última de ese mes (`GET /api/apicotizaciones/hasta?fecha=<último día del mes>`, nueva). Nunca la de cada documento.
  - El botón (solo en el mes en curso) llama a `GET /api/apicotizaciones/bcu`: si la de hoy ya está cargada devuelve esa; si no, la busca en el BCU y la guarda. La carga sola un job a las 09:10 y a las 13:30, de lunes a viernes.

## Las notas de crédito en los reportes de Contabilidad

Hasta el 01/10 solo las restaba Top Clientes. Ventas por Área, Ventas por Documento, Resumen Mensual, Top Productos y el árbol de ventas las dejaban afuera: no las restaban ni las contaban como venta negativa.

- **El problema.** Una factura anulada con nota de crédito no cambia de estado, así que seguía contando entera. En setiembre eran 12 facturas, por $ 55.047,49 y US$ 1.098,11. Los documentos en estado ANULADO sí quedaban afuera (7 en setiembre).
- **Cómo entra ahora una nota:**
  - Como una venta en negativo (la de débito, en positivo), el día en que se emite.
  - Con su propio estado de DGI.
  - Repartida entre las áreas y los artículos de sus propias líneas. Se copian de la factura: 33 de las 38 notas que hay tienen las mismas áreas que su factura.
  - En Ventas por Documento va en la fila del tipo de pago de la factura a la que apunta. Si apunta a otra nota (la de débito ND-000001 revierte la NC-000022), se sigue un paso más para que las dos caigan en la misma fila.
- **Las cantidades de documentos no cambian:** siguen contando solo ventas. La tarjeta de cada moneda dice cuántas notas incluye y por cuánto.
- **Con filtro de artículo,** la nota resta si sus líneas son de ese artículo (`DcdProIdProducto`), porque casi nunca traen el código de orden.
- **No cambia:** los cobros (Ingresos), Cobranzas, Antigüedad de deuda y el Libro Contador.

| Setiembre | Antes | Ahora |
|---|---|---|
| Pesos | 6.917.941,90 | 6.861.556,80 |
| Dólares | 216.305,87 | 212.943,40 |
| Unificado a $ 40,89 | US$ 385.490,07 | US$ 380.748,65 |

## Qué cambia respecto de la pantalla anterior de vendedores

- **La venta cuenta cuando se factura,** no cuando la orden entra a Depósito. Las órdenes sin documento (semanas sin facturar, órdenes sin retirar) no aparecen hasta que se facturan.
- **La moneda es la del documento.** La mayoría se factura en pesos aunque la orden esté en dólares.
  - Matías pasa de $ 108.226 y US$ 89.339 (órdenes) a $ 1.676.174 y US$ 57.069 (documentos).
- **Los rollos cuentan cuando se venden:** el plan de metros se carga como un ítem de la venta de caja (`cajaService.js` ~221-290). Antes, las órdenes cubiertas por un plan valían 0.
- **«Coordinacion user» casi deja de pesar:** es de la cartera de Agustín, ingresó 457 órdenes en setiembre y tiene 6 documentos ($ 38.196). Agustín queda en $ 162.995 y US$ 7.369.
- **Un pago parcial cuenta por lo pagado.** Antes, una factura con pago parcial dejaba todas sus órdenes sin cobrar.
- **«Cobrado» no coincide con «Ingresos (Cobrado)» de Contabilidad.** Ese cuenta los pagos enlazados al documento: para setiembre da US$ 148.494 por fecha de factura, contra US$ 184.337 de vendido menos pendiente.
- **No hay más cantidad de órdenes** ni órdenes cobradas o sin cobrar. El criterio de «cobrada» por orden (`SQL_ORDEN_COBRADA`) se sacó del controlador; nunca llegó a un commit.

## Recursos: rollos, billetera y anticipos

Medido sobre setiembre en la misma copia.

- **Rollos / planes de metros: están adentro.**
  - Se venden en caja como un ítem de tipo `RECURSO` y salen en un documento normal: e-ticket, e-factura o Pedidos Caja.
  - En setiembre: 43 cargas de metros a 28 clientes, todas con venta de caja. Importe de esos ítems: US$ 57.179,57 y $ 875.
  - Por vendedor: Soledad US$ 40.360,52, Matías US$ 6.448,94, Lucas US$ 6.287,18 y $ 875, Fabiana US$ 4.060,93, Sergio US$ 22.
  - Cuentan enteros en el mes en que se vende el rollo. Las órdenes que después lo consumen no tienen documento y no vuelven a contar.
  - Dos de esas ventas tienen el documento enlazado a otra transacción de caja (Panda, FA-2018; Le Agency, ET-8006). Igual entran, porque se cuenta el documento.
- **Billetera prepaga facturada («Venta de saldo»): está adentro.**
  - Se factura al cargar. En setiembre: $ 5.100 y US$ 3.233,41.
  - Lo que se consume después (US$ 9.045,87 y $ 833,14 en setiembre) no se factura de nuevo.
- **Anticipos con recibo: quedan afuera.**
  - El `RECIBO ANTICIPO` no es un documento de venta. En setiembre: $ 512.275 y US$ 13.457.
  - La venta cuenta cuando se factura lo consumido («Facturar consumos» o la factura de la semana). Contar el recibo y después la factura sería contar dos veces.
- **Recibos de cobranza: quedan afuera.** Son pagos de facturas ya emitidas ($ 1.178.580 y US$ 174.770 en setiembre).

## Qué se tocó

- `backend/controllers/contabilidadReportesController.js`:
  - Exporta `reglasVentas` (`condEsVenta`, `condVentaONota`, `signoExpr`, `condDgi`, `primerToken`, `CLIENTES_GENERICOS`) para la pantalla de vendedores.
  - `getVentasPorArea`, `getVentasPorDocumento`, `getVentasMensuales` y `cteLineasVenta` (Top Productos, su detalle y el árbol) toman ventas y notas (`condVentaONota`) con el signo de la nota.
  - `filtroAreaArticulo` incluye las notas, y el filtro de artículo va por una CTE `LineasArticulo` con `UNION`. Escrito como un `OR` en el `WHERE` tardaba más de 120 s; así tarda 30 ms, como antes.
  - `getIngresos` no cambia.
- `backend/controllers/vendedorVistaController.js`: `getVentasMensuales` lee documentos con esas reglas.
  - `GET /api/vendedor-360/ventas-mensuales?anio&mes&dgi=DGI|SIN_DGI`. Sin `dgi`, o con un valor desconocido, es Todo.
  - Devuelve, por fila, `tipo` (`VENDEDOR`, `SIN_VENDEDOR` o `MOSTRADOR`) y `monedas.UYU` / `monedas.USD` con `vendido`, `cobrado` y `sinCobrar`. Aparte, `notas` con el total de notas del mes por moneda.
  - Los vendedores del área salen siempre, aunque estén en cero. Las otras dos filas, solo si tienen plata.
- `backend/controllers/cotizacionesController.js` y `backend/routes/getwayCotizaciones.js`: `GET /api/apicotizaciones/hasta?fecha=AAAA-MM-DD` devuelve la última cotización cargada hasta esa fecha, con la misma forma que `/hoy`. Sin sesión, como las otras rutas de cotizaciones.
- `src/components/pages/VendedorVentasMensuales.jsx`: vendido en pesos y en dólares, cobrado y pendiente en una misma columna por moneda, «Total unificado en US$» con la cotización del mes, las franjas de comisión, la foto de cada vendedor, «Otras ventas» desplegable, la cotización con su fecha y su botón, y la nota al pie. Sin selector de DGI.
- `backend/controllers/vendedorVistaController.js`: la consulta de plata por vendedor pasa a `consultarPlataPorVendedor` (con `porMes` agrega el mes), que usan `getVentasMensuales` (sin cambios en lo que devuelve) y `getGanadores` (nuevo). `backend/routes/vendedorVistaRoutes.js`: la ruta `/ganadores`.
- `src/components/pages/ContabilidadReportesPage.jsx`: los textos dicen que las notas restan, cada tarjeta de moneda de Ventas por Documento dice cuántas notas incluye, y el gráfico de torta no dibuja porción para un sector que quede en negativo.
- Sin cambios en la base.

## Pruebas (local, solo lectura)

- **Ventas por vendedor: 47 pruebas, sin fallas,** llamando al endpoint real y a los de Contabilidad.
  - Julio, agosto y setiembre, con Todo, DGI y Sin DGI: el vendido da el total de «Ventas por Documento», el pendiente da el pendiente de cobro de Contabilidad, y «Total US$» da el total unificado de Ventas por Documento y de Ventas por Área.
  - En cada fila, vendido = cobrado + pendiente.
  - Setiembre, vendedor por vendedor, contra la exploración previa.
  - Bordes: un mes sin documentos da los 6 vendedores en cero; mes 13 da error 400; un `dgi` desconocido cae en Todo; febrero y diciembre responden; marca «VOS» al vendedor logueado.
- **Cotización de un mes cerrado: 7 pruebas, sin fallas** (`/api/apicotizaciones/hasta` contra el backend local): el último día de julio, agosto y setiembre da la de ese día ($ 40,81, $ 40,89 y $ 40,84); un domingo da la del viernes; fecha mal escrita, 400; antes de la primera cotización, 404; `/hoy` sin cambios.
- **Ganadores: 20 pruebas, sin fallas.** Junio a octubre en orden, la cotización de cada mes, y el ganador y el segundo iguales a la primera y segunda fila de la tabla de ese mes, al centavo. Soledad Ferreri gana de junio a setiembre; octubre (sin documentos en la copia) no tiene ganador. Responde en 0,4 s. Las 47 de ventas-mensuales siguen dando igual después de mover la consulta.
- **Reportes de Contabilidad: 36 pruebas, sin fallas.**
  - Julio, agosto y setiembre, con los tres filtros de DGI: Ventas por Área y Ventas por Documento dan las ventas más las notas, contra una cuenta hecha aparte con SQL directo. Las cantidades de documentos y lo pendiente de cobro quedan iguales.
  - Por sector: Área y Documento cierran entre sí con el filtro puesto, y los sectores suman el total.
  - Las notas caen en el tipo de pago de su factura.
  - Top Productos y el árbol suman lo mismo que Ventas por Área, en pesos, en dólares y unificado. Ningún artículo queda con neto negativo en setiembre.
  - Resumen Mensual da lo mismo que Ventas por Documento en cada mes, también con filtro de sector.
  - Filtro de artículo: Área y Documento dan lo mismo, y la nota resta.
  - Tiempos: 110 a 150 ms Área, Documento y Resumen Mensual; 0,8 s Top Productos; 0,5 s el árbol.
- **Cobrado negativo:** de junio a octubre, con los tres filtros, ninguna fila de vendedores queda con vendido, cobrado o sin cobrar negativo.
- **Notas y deuda:**
  - Una nota de crédito sobre una factura impaga también le baja la deuda. Desde julio hay 3 notas cuya factura sigue con deuda viva, y en las 3 lo pendiente es la factura menos la nota.
  - Ninguna nota tiene deuda propia viva, en toda la historia. Hay una sola nota de débito (ND-000001, $ 15.000, 08/09), que revierte una nota de crédito.
- **Pantallas,** en el navegador integrado y con las respuestas reales de setiembre embebidas:
  - Vendedores, a 1440 y 375 px: no se desborda; en celular la tabla se desliza de costado dentro de su recuadro (necesita 762 px con cobrado y pendiente en la misma columna; separadas eran 1009). El cambio de mes pide los datos sin filtro de DGI, y en las 8 filas vendido = cobrado + pendiente y «Total US$» da lo mismo que la cuenta a mano. El primer renglón de todas las celdas de una fila queda a la misma altura. Las 6 fotos cargan. La cotización se pidió al backend local de verdad ($ 40,89 del 01/10) y el botón la vuelve a pedir. Con la cotización fallando, la columna queda en guiones y avisa.
  - Contabilidad: Ventas por Área y Ventas por Documento muestran US$ 380.748,65 de total unificado y los 2.908 y 1.077 documentos de siempre. Con un sector forzado a negativo el gráfico se dibuja bien.
  - Vendedores, 02/10, con los datos reales de agosto a octubre: la cotización de cada mes, las franjas y las comisiones (setiembre US$ 3.518,81; agosto US$ 4.034,26), las fotos cuadradas (75 × 75) pegadas a la izquierda, el ancho completo y «Otras ventas» abriéndose con clic y con Enter. Los últimos ajustes («Otras ventas» sin foto y a la izquierda, celdas centradas, la línea entre cobrado y pendiente) solo se compilaron.
  - Con sesión iniciada contra el backend local no se abrió ninguna: el navegador integrado no tiene sesión.

## Para deployar

- Backend, necesita reiniciar: `vendedorVistaController.js` y `contabilidadReportesController.js`, juntos. Además `cotizacionesController.js` y `routes/getwayCotizaciones.js` (ruta nueva `/api/apicotizaciones/hasta`).
- Backend, también: `routes/vendedorVistaRoutes.js` (ruta nueva `/api/vendedor-360/ganadores`).
- En el build: `VendedorVentasMensuales.jsx` y `ContabilidadReportesPage.jsx`.
- Backend y build en el mismo deploy.
- Sin SQL.
- Avisarle a Administración que los totales de ventas de los reportes bajan por las notas de crédito.
- Control después del deploy: el total de Ventas por vendedor tiene que dar lo mismo que Contabilidad → Reportes → «Ventas por Documento» con el mismo mes y el mismo filtro de DGI.
