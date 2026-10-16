# Motor de precios: lista → descuento/recargo → neto, con transparencia hasta la factura

> Análisis y plan. Fecha: 7 de setiembre de 2026. Evidencia tomada con scripts de solo lectura
> contra la base LOCAL (réplica) y del código en `main` (d3b7643). Nada de esto está
> implementado: es el diagnóstico y el plan para hacerlo.

## 0. Resumen ejecutivo

- **Hoy el motor ya calcula el desglose** (precio de lista, descuento ganador, recargos
  acumulados, neto) pero **lo devuelve como texto** y **solo se congela el neto**. En
  `PedidosCobranzaDetalle` queda `PrecioUnitario = 14,00` y un renglón de texto
  `"Base: USD 22.00 / Descuento: -USD 8.00 (Desc. 36% [Excepción Cliente]) / Total: 14.00"`.
  Ninguna columna numérica guarda lista, %, importe ni origen.
- **`PedidosCobranzaDetalle` NO está preparada.** Le faltan las columnas del desglose
  (lista, tipo/% /importe/origen del descuento, recargos). Todo lo que existe es texto.
- **`DocumentosContablesDetalle` está preparada a medias.** Tiene la convención correcta
  para descuento por línea (`DcdPrecioUnitario` = bruto, `DcdTotalDescuentos`,
  `DcdDescuentoPct`, RN-FAC.10), pero (a) `DcdDescuentoPct` todavía **no está en
  producción** (`add_DcdDescuentoPct.sql` pendiente), (b) **no tiene recargo por línea**
  (urgencia/tinta van escondidos en el unitario), (c) no guarda el **origen** del descuento,
  y (d) solo la usan los flujos manuales (factura manual y cierre de ciclo): en 6 meses,
  de 8.919 líneas de E-Ticket, 8.810 llevan el unitario **ya neteado** y 36 el bruto.
- **Hallazgo grave, previo a todo:** el resolvedor que arma las líneas de la factura
  (`contabilidadCore.resolverLineasDetalle`) **no encuentra el pedido** para las órdenes
  con prefijo (SUB-, DTF-, EUV-, TPU-…): cruza `LEFT(OrdCodigoOrden)` contra
  `PedidosCobranza.NoDocERP` (numérico). En 90 días matchea 8.973 de 24.682 órdenes
  (36 %, solo VEN-/EMB-); cruzando por `Ordenes.NoDocERP` matchearía 19.670 (80 %).
  Para el resto la línea sale de `OrdenesDeposito.OrdCostoFinal` (un solo número neto) y
  la descripción trae el nombre del cliente. **Aunque el pedido tuviera el desglose, la
  factura hoy no lo vería.**
- **DGI/SISNET sí lo soporta:** el tipo `wsItem` del web service tiene `descuentoPct`,
  `descuentoMonto`, `recargoPct`, `recargoMonto` y `descAdicional`. Hoy se manda solo
  `precioUnitario = montoLinea / cantidad` (neto).
- **El PDF ya sabe imprimirlo** (columnas P. Unitario / % / Descuento / P.U. Neto /
  Importe); le falta recargo. El portal no muestra líneas, solo totales.

El cambio es **aditivo y por fases**: primero congelar el desglose en el pedido, después
hacer que la factura lo lea (arreglando el cruce), después el CFE y la presentación. El
neto, los totales, el cuadre pre-DGI y los documentos ya emitidos **no cambian**.

## 0.1 Estado de implementación (11-sep-2026, listo para el testing general)

**Hecho en local, sin commit y sin tocar producción.** El CFE/SISNET no se tocó.

| Pieza | Estado |
|---|---|
| Base local | Corridos los 3 scripts (`add_desglose_PedidosCobranzaDetalle.sql`, `add_recargos_DocumentosContablesDetalle.sql`, `add_EtiquetaFactura_PerfilesPrecios.sql`) + backfill de 16.740 líneas de pedido (`backfill_desglose_pcd.js --apply`). |
| Motor (`pricingService`) | Devuelve `desglose` (lista, override, descuento con origen/regla, recargos uno a uno y suma, prepago, candidatos que perdieron). % del texto con 2 decimales. Etiqueta por perfil (`getEtiquetasPerfiles`). `desgloseManual` y `desgloseSinCargo` para precio a mano y reposiciones. |
| Sync (`erpSyncService`) | Escribe las 11 columnas nuevas en `PedidosCobranzaDetalle` (material, servicios, prepago, override manual, reposición). INV-PRE.03 al guardar (el importe del descuento absorbe). |
| Cotización (`quotationController` + `QuotationEditModal`) | Reinserta el desglose; precio tipeado = MANUAL (`normalizarDesgloseLinea`). Columnas Lista / Descuento / Recargo / Precio U. + origen y reglas perdedoras. **14-sep:** Moneda editable por línea (con lista el motor reconvierte; tipeado solo cambia la etiqueta), Descuento y Recargo editables en % e importe (lista fija, precio = lista − desc + rec), "lista manual" para líneas sin catálogo (`listaManual` en el JSON: retipear el precio mueve la lista, sin descuento fantasma). Regla general: lista 0 = sin lista. |
| Factura (`contabilidadCore`) | `resolverLineasDetalle` enriquece a posteriori (por `Ordenes.NoDocERP` + `OrdenID`, solo si el pedido explica el importe; totales intactos, verificado: 120/120 idénticos con la llave apagada). `crearDocumentoContable` guarda recargo/origen (guardado por existencia de columnas). Descripción sin nombre de cliente ni texto del motor. Llave `PRECIOS_DESGLOSE_EN_FACTURA` ('0' apaga; ausente = encendido). |
| Edición de CFE / factura manual (`cfeController` + `FacturacionManualModal`) | Recargo % por línea, origen; líneas de orden con lista/cantidad/unitario bloqueados; edición reinserta todo; NC/ND clonan pct, recargo y origen. |
| Pre-factura (`CierreCicloPreviewModal` + `contabilidadService`) | Columnas P. Lista / Descuento / Recargo / P. Unitario / Subtotal; solo descuento y recargo editables (% o importe); `DetallesJSON` trae el desglose; el guardado deja la línea del pedido coherente (`desgloseLineaPedido.js`). |
| Caja "Editar órdenes del retiro" | GET `/caja/orden/desglose`; edita cantidad, descuento y recargo; escribe SOLO la línea de esa orden (arreglado el escalado por ratio y el pisado de cantidades); exoneración intacta. |
| Precios | Precios Especiales: columna "Desc. ($)" (regla `subtract`). Perfiles: tipos "Descuento por importe" / "Recargo por importe" y campo "Etiqueta en la factura". |
| PDF | Columnas P. Lista / Cantidad / Descuento (% e importe) / Recargo (% e importe) / P. Unitario / Importe; origen en la descripción; descripción corta. |
| Texto que ve el cliente (etiqueta) | Se define en el perfil ("Etiqueta en la factura": vacío = nombre del perfil, `-` = sin texto, aplica a lo que se cotice de ahí en más) y se puede editar a mano línea por línea en la pre-factura, en la edición del CFE y en el modal de caja (campo de texto debajo del descuento / recargo: vacío = texto automático, `-` = sin texto). El texto editado queda en la línea del pedido (`DescuentoOrigen` / `RecargoOrigen`) y en la de la factura (`DcdDescuentoStr` / `DcdRecargoStr`); el PDF no imprime `-`. |
| Pruebas | Motor: 5 casos reales cierran. Resolvedor: 300 e-tickets, 455 líneas enriquecidas, 0 fallas de invariante; neutralidad 120/120. Helper manual: 7/7. Escritura local: pedido con desglose (borrado) y factura con recargo (rollback) OK. `vite build` OK. Sin pruebas en navegador (regla de no levantar servidores). |

**Para desplegar (en este orden):** 1) correr en producción los 3 scripts SQL (el de
`DcdDescuentoPct` queda incluido); 2) desplegar backend + front; 3) correr
`node backend/scripts/backfill_desglose_pcd.js` (primero sin `--apply`, después con) para
los pedidos anteriores; 4) opcional: cargar "Etiqueta en la factura" en los perfiles
(Urgencia, Tinta UV, Descuento por volumen; `-` para que no se imprima texto). Para apagar solo la presentación en factura:
`ConfiguracionGlobal PRECIOS_DESGLOSE_EN_FACTURA = '0'`.

**Cerrado después (11-sep, tarde):** el Pedido Caja por pago de deuda completa el desglose
de sus líneas recién insertadas con `contabilidadCore.enriquecerLineasDocumento` (misma
regla que el resolvedor, nunca bloquea el cobro); la tienda del portal guarda la lista de
`PreciosBase` y, si la variante tiene precio de excepción, la diferencia como descuento
"Precio especial (tienda)"; la venta directa WMS guarda lista = precio. El resolvedor
identifica la línea del pedido por su ID cuando la consulta ya la encontró (VEN-/EMB-) y por
código en el resto.

**Queda afuera:** portal del cliente sin cambios (decisión del usuario); revisar en la
prueba general el ancho del modal de caja con 8 columnas.

## 1. Cómo viaja el precio hoy (cadena real)

| Paso | Dónde | Qué guarda | Qué se pierde |
|---|---|---|---|
| 1. Cálculo | `pricingService.calculatePrice` | Devuelve `precioUnitario` (neto), `breakdown[]` (BASE / OVERRIDE / DISCOUNT / SURCHARGE, con valor y perfil), `txt`, `perfilesAplicados` | El `breakdown` estructurado no lo persiste nadie. El % en el texto va redondeado a entero (`Math.round`): 8/22 = 36,36 % sale "36%". La traza completa (`traceDecision`) solo va al log. |
| 2. Congelado | `erpSyncService.updatePedidosCobranza` → `PedidosCobranzaDetalle` | `PrecioUnitario`, `Subtotal`, `Moneda`, `LogPrecioAplicado` (= `txt`, nvarchar 500), `PricingTrace` (= mismo `txt`), `PerfilAplicado` (nombres), `PrecioUnitarioOriginal`/`SubtotalOriginal`/`MonedaOriginal` (misma cifra en la moneda de origen: sirve para la cotización, **no es la lista**) | Lista, %, importe, origen, recargos. Todo es texto. Cabecera: `DetalleCostos`/`PerfilesPrecio` (texto). |
| 3. Cobrable | `Ordenes.CostoTotal`, `OrdenesDeposito.OrdCostoFinal` (float), `ServiciosExtraOrden.PrecioUnitario/TotalLinea` | Un número neto por orden/servicio; el check-in lo re-estampa con la cobertura de plan/rollo | Sin desglose (correcto: es "lo cobrable") |
| 4. Factura | `resolverLineasDetalle` (caja mostrador, Handy, MP, portal), `cajaController.procesarPagoDeuda`, `contabilidadService` (cierre), `cfeController` (manual/edición) | `DocumentosContablesDetalle` | Flujos automáticos: `DcdPrecioUnitario = Subtotal / Cantidad` (neto, con IVA), sin descuento. Además el cruce con el pedido falla (§2.4). |
| 5. CFE | `sisnetService.prepararCFE` | `precioUnitario = montoLinea / cantidad` (neto sin IVA), `montoItem` | No se mandan `descuentoPct/Monto` ni `recargoPct/Monto` aunque el WS los admite |
| 6. Impreso | `src/utils/pdfGenerator.js` (jsPDF; el email adjunta ese mismo PDF en base64) | Columnas % / Descuento / P.U. Neto ya existen | Solo se llenan si la línea trae `DcdTotalDescuentos`; sin columna de recargo |

Ejemplo real (pedido 20931, 4-sep-2026): artículo 48, 1,85 m, lista USD 22,00, excepción
del cliente 36,36 % → neto 14,00, subtotal 25,90. En el pedido queda `14,00` + el texto.
En la factura de un caso análogo (E-Ticket 10827, DTF-20394) la línea es `PU 22,00 ×
2,53 = 55,66` con descripción `"Orden: DTF-20394 (sunk setiembre) - Retiro RW-26082 / Byf"`:
ni lista, ni descuento, ni rastro del pedido ("Byf" es el nombre del cliente que mandó la
caja).

## 2. Diagnóstico por pieza

### 2.1 El motor (`backend/services/pricingService.js`)

Qué hace bien y hay que conservar:
- Lista por artículo + moneda (`PreciosBase`, DECIMAL 18,4), conversión a la moneda pedida.
- Override técnico (bordado por puntadas, estampado por bajadas) que **reemplaza** la lista.
- Competencia: mejor descuento (`percentage*` → % sobre la base post-override; `subtract` →
  importe) contra mejor precio fijo; gana el más bajo (RN-PRE.07).
- Recargos acumulativos (`*surcharge`, % sobre la misma base o importe), con exclusiones de
  urgencia (RN-PRE.09) y de tinta para servicios (RN-PRE.10). Cero es cero (RN-PRE.08).
- Prepago por plan (total/parcial).

Qué le falta para este cambio:
- Un **resultado estructurado**: `precioLista`, `override`, `descuento {tipo, pct, importe,
  origen, reglaId}`, `recargos[{pct, importe, origen}]`, `precioNeto`. Hoy solo `breakdown`
  (array heterogéneo) y `txt`.
- Precisión: el % en `txt` y en `breakdown.desc` se redondea a entero.
- Cuando gana un **precio fijo** el descuento queda implícito (lista − fijo) y no se expresa.
- La UI de precios especiales solo ofrece **% o precio fijo**; el motor ya entiende
  `subtract` (descuento por importe) y `*surcharge` por importe, pero **ninguna pantalla lo
  carga**. Esto es justamente el "importe de descuento o bonificación" pedido.

Datos de reglas (local): `PreciosEspecialesItems` 658 reglas de 99 clientes (`fixed` 15,
`percentage` 420, `percentage_discount` 223 — dos nombres para lo mismo; 14 por grupo, 3
"TOTAL"; **123 % con decimales** tipo 23,08 / 31,82 / 45,45 que nacieron de un precio fijo
tipeado y convertido a %; 5 negativos = recargos disfrazados). `PerfilesItems`: 35
`fixed_price`, 36 `percentage_discount`, 2 `percentage`, 3 `percentage_surcharge`; 14
perfiles; 25 clientes con perfil asignado. En los últimos 30 días **69 clientes con
excepción compraron: 1.303 líneas con descuento**. Este cambio les afecta la factura a todos.

### 2.2 `PedidosCobranzaDetalle` — NO preparada

| Columna | Hoy | Sirve para el desglose |
|---|---|---|
| `PrecioUnitario` DECIMAL(18,2), `Subtotal` | neto final | sí, queda igual (es el neto) |
| `PrecioUnitarioOriginal`, `SubtotalOriginal`, `MonedaOriginal` | el mismo neto en la moneda de origen | **no** es la lista; es la cotización de moneda (INV-PRE.01) |
| `LogPrecioAplicado` NVARCHAR(500), `PricingTrace` NVARCHAR(MAX) | mismo texto en las dos | solo como fallback de parseo (nunca truncó: 0 de 29.664 llegan a 500) |
| `PerfilAplicado` | nombres separados por coma | origen legible, no estructurado |
| `DatoTecnico`, `ProIdProducto`, `EsHermanaConsolidada`, `OrdenID` | ok | se conservan |
| **Faltan** | — | `PrecioLista`, `DescuentoTipo`, `DescuentoPct`, `DescuentoImporte`, `DescuentoOrigen`/`ReglaId`, `RecargoPct`, `RecargoImporte`, `RecargoOrigen`, `DesgloseJSON` |

Volumen: 29.664 líneas, 29.588 pedidos (todos del sync ERP: `Origen` NULL). En el texto:
2.986 con "Descuento:", 2.944 con "Recargo:", 916 con "Override:", 118 prepago, 11 manual.

Escritores a tocar: `erpSyncService.updatePedidosCobranza` (el principal; borra y reinserta
las líneas en cada re-sync), `quotationController` (edición manual: **borra y reinserta
todas las líneas** del pedido, así que si el front no devuelve las columnas nuevas se
pierden, igual que pasó con `EsHermanaConsolidada`), `tiendaController`/`wmsController`/
`prendasOrdersController` (no pasan por el motor: lista = precio, sin descuento).

### 2.3 `DocumentosContablesDetalle` — preparada a medias

Existe la convención (RN-FAC.10, memoria `project_descuento_linea_factura`):
`DcdPrecioUnitario` = **bruto con IVA antes del descuento**, `DcdTotalDescuentos` = importe
del descuento **con IVA**, `DcdDescuentoPct` DECIMAL(9,4) = el número tipeado, `DcdTotal` =
neto con IVA, `DcdSubtotal` = `DcdTotal / 1,22`. Ejemplo real (doc 10813): PU 10,00 × 4,07 =
40,70; desc 35 % = 14,25; total 26,46. El PDF, `crearDocumentoContable`, `editarFactura`,
`FacturacionManualModal` y el cierre de ciclo ya la respetan.

Lo que falta o está mal:
- `DcdDescuentoPct` **no está en producción** (`backend/scripts/add_DcdDescuentoPct.sql`).
- **No hay recargo por línea** (`DcdTotalRecargos` / `DcdRecargoPct` / `DcdRecargoStr`).
  Solo `DocTotalRecargos` en cabecera, que nadie usa. Una urgencia del 25 % hoy es
  invisible: `SUB-20860` cotizó lista 10,00 − 20 % + 25 % = 10,50 y la factura solo puede
  decir 10,50.
- **No hay origen** del descuento (excepción / perfil / beneficio / manual). Lo pide la
  spec 40 (beneficios: "la línea guarda el id") y sirve para el reporte "cuánto se descontó
  por cada vía".
- `DcdPrecioUnitario` es DECIMAL(18,2) aunque se escribe con precisión 18,4: un precio de
  lista con 4 decimales se redondea.
- **Tres semánticas conviven** en la misma columna (últimos 6 meses):

| Tipo de documento | Líneas | PU = neto con IVA (resolvedor) | PU = bruto + descuento (RN-FAC.10) | Otro |
|---|---|---|---|---|
| E-Ticket Contado | 8.919 | 8.810 | 36 | 73 |
| Pedidos Caja | 8.079 | 7.816 | 207 | 56 |
| E-Factura Contado | 1.584 | 1.565 | 3 | 16 |
| E-Factura Crédito | 763 | 640 | 119 | 4 |

  Y `cajaController.procesarPagoDeuda` (Pedido Caja por deuda de órdenes) escribe el PU
  **sin IVA** (`/ 1.22`). La nota de crédito clona `DcdTotalDescuentos` y `DcdDescuentoStr`
  pero **no `DcdDescuentoPct`** (`cajaController` ~2703).

### 2.4 La factura no lee el pedido (bug previo, bloqueante)

`resolverLineasDetalle` MODO 1 cruza `CAST(pc.NoDocERP) = LEFT(od.OrdCodigoOrden, …)` y
MODO 2 `LTRIM(RTRIM(pc.NoDocERP)) = od.OrdCodigoOrden`. Para el sync ERP `NoDocERP` es
numérico (`"20931"`) y el código lleva prefijo (`"SUB-20931"`): el cruce solo acierta en
VEN-/EMB- donde el código ES el NoDocERP.

| Últimos 90 días (`OrdenesDeposito`) | Órdenes |
|---|---|
| Total | 24.682 |
| Cruce actual por `LEFT(código)` (MODO 1) | 8.973 (36 %) |
| Cruce actual por código exacto (MODO 2) | 8.960 |
| Cruce por `Ordenes.NoDocERP` (como el CTE `PedBase` de `cajaController`) | 19.670 (80 %) |
| …de las cuales con descuento en el pedido | 2.859 |
| …con recargo en el pedido | 2.806 |

Consecuencias: (1) la línea sale de `OrdenesDeposito.OrdCostoFinal` y `OrdCantidad`, sin
pedido; (2) `DcdDscItem` nunca trae el `LogPrecioAplicado` (0 de 20.458 líneas contienen
"Base:"); (3) al arreglar el cruce hay que filtrar `pcd.OrdenID = o.OrdenID` (hoy el join
por pedido sin orden **fanearía** una fila por cada línea del pedido en multitela). El
20 % restante son órdenes sin `Ordenes` o sin pedido (ventas WMS, legacy): siguen con el
fallback actual.

### 2.5 DGI / SISNET

`wsItem` (XSD del servicio, `EfacturaWeb/wsService?xsd=1`): `cantidad`, `cod`, `descAdicional`,
**`descuentoMonto`, `descuentoPct`**, `indFact`, `montoItem`, `nomItem`, `nroLinDet`,
`precioUnitario`, **`recargoMonto`, `recargoPct`**, `uniMed`. Además `listaWsDescuentos`
(descuentos globales) y `wsVarios.mntBruto` (hoy 0 = importes sin IVA, correcto). El WSDL
también expone `GenerarCaeDePrueba` y `statusTest` para probar sin emitir. Regla DGI:
`MontoItem = Cantidad × PrecioUnitario − DescuentoMonto + RecargoMonto`; SISNET valida el
cuadre a 2 decimales, así que el unitario se deriva para que cierre.

### 2.6 Presentación y otros consumidores

- **PDF** (`src/utils/pdfGenerator.js` ~330-430): ya imprime P. Unitario (bruto con IVA),
  %, Descuento, P.U. Neto, Importe; deduce el % del importe solo para documentos viejos.
  Falta una columna/renglón de recargo.
- **Bandeja CFE / vista previa DGI**: leen `DocumentosContablesDetalle`; la vista previa
  DGI muestra el payload, hay que agregarle los campos nuevos.
- **Factura manual** (`FacturacionManualModal`): edita bruto + "Desc. %" y reenvía siempre el
  descuento. No tiene recargo ni origen.
- **Cierre de ciclo** (`CierreCicloPreviewModal` + `contabilidadService`): arma las líneas
  desde `DetallesJSON` (líneas del pedido) con `PrecioUnitario` **neto**; el descuento por
  línea que ofrece es un descuento **manual adicional** y el global va en cabecera
  (`DocTotalDescuentos`, 1 documento en toda la base). `OrdDescuentoAplicado` que imprime
  el PDF de ciclo nunca se escribe (siempre 0).
- **Cotización interna** (`QuotationEditModal`): muestra `PricingTrace` como HTML.
- **Portal**: solo `MontoTotal` / `CostoFinal` por pedido; no hay líneas.
- **Etiquetas**: copian `DetalleCostos`/`PerfilesPrecio` (texto). No cambian.
- **Descuento en caja** (`TransaccionDetalle.TdeAjuste`/`TdeTipoAjuste`): 4 filas
  'DESCUENTO', todas en 0. No se usa; queda fuera del alcance.

## 3. Modelo objetivo y reglas a fijar

Una línea de precio, en cualquier tabla, se lee así:

```
PrecioLista            (unitario, moneda de la línea; después del override técnico)
− DescuentoImporte     (tipo: PCT | IMPORTE | FIJO | MANUAL; pct; origen; regla)
+ Σ RecargoImporte     (urgencia, tinta…; pct; origen)
= PrecioUnitario       (neto: la columna que ya existe, no cambia)
× Cantidad = Subtotal  (no cambia)
```

Invariante propuesto (**INV-PRE.03**): en toda línea congelada
`PrecioLista − DescuentoImporte + RecargoImporte = PrecioUnitario` (±0,01); en factura
`DcdCantidad × DcdPrecioUnitario − DcdTotalDescuentos + DcdTotalRecargos = DcdTotal`
(todo con IVA). **El importe del descuento absorbe el redondeo** (lista − neto), y el % que
se imprime es el de la regla, no uno recalculado (misma lección de RN-FAC.10).

**Regla de redondeo (11-sep, simulada sobre 17.515 líneas reales de pedido):** nunca se
redondea cada pieza esperando que cierre; en cada nivel hay UNA sola cifra que absorbe el
redondeo y la cuenta cierra por construcción.
- Unitario (pedido, con IVA): `DescuentoImporte = PrecioLista + RecargoImporte − PrecioUnitario`
  (si no hay descuento absorbe el recargo; si no hay ninguno, neto = lista). El % guardado
  es el de la regla y es informativo: nunca se usa para recalcular importes.
- Línea (factura, con IVA): `DcdTotalDescuentos = round(cant × lista, 2) + DcdTotalRecargos −
  DcdTotal`, con `DcdTotal` = lo cobrado (no cambia). Guard: si el `Subtotal` guardado del
  pedido no es `PrecioUnitario × Cantidad` (±0,01), la línea va **sin desglose** (neto,
  como hoy) en vez de inventar un descuento que tape la diferencia.
- CFE: **no cambia** (decisión del 11-sep). Sigue viajando el unitario neto y el
  `montoItem` de hoy; ningún redondeo nuevo entra al CFE ni a sus totales.
- Evidencia (local): de 16.892 líneas con precio del motor, 16.875 cierran exactas en el
  unitario y 17 a 1 centavo; en la línea 16.217 cierran sin ajuste, 461 absorben 1 centavo,
  9 absorben 2; 205 tienen un subtotal que ya hoy no es PU × cantidad (van sin desglose);
  DGI con 4 decimales falla en 4 líneas de 150 a 1.800 unidades, con 6 decimales en 0 de
  16.686. Las 623 líneas restantes tienen precio editado a mano después del cálculo: en el
  modelo nuevo son `DescuentoTipo = 'MANUAL'` y el importe absorbe la diferencia.

**Varios recargos en la misma línea** (urgencia 25 % + tinta 25 %, decidido el 11-sep):
el motor calcula cada uno sobre la lista y los suma (no se componen), así que los % se
suman: 25 + 25 = 50 %. La línea guarda la **suma** (`RecargoPct` / `RecargoImporte`) y el
detalle de cada recargo en `DesgloseJSON` y en texto (`RecargoOrigen`: "Urgencia 25 % +
Tinta UV 25 %"). La factura y el CFE llevan la suma en la celda/ítem (`recargoPct` 50,
`recargoMonto`) y el detalle en la descripción. Ejemplo: lista 400,00, cliente 10 %,
urgente, tinta UV → 400 − 40 + 100 + 100 = 560,00.

**Cómo se ve qué perfil ganó**: hoy el motor solo escribe la traza completa en el log del
servidor (`traceDecision`, con "GANADORA para Perfil …" y "RESULTADO COMPETENCIA") y guarda
el resumen `txt`; en pantalla se ve el nombre del perfil y ese resumen. Con el cambio, el
`desglose` trae el origen del descuento ganador (perfil, regla, escalón: "PERFIL:13
SUBLIMACION ESCALONADOS (≥100 m: 10 %)") y las **reglas candidatas que perdieron y por
qué** ("Excepción del cliente 8 %: menor descuento"); se guarda en `DesgloseJSON` y la
cotización lo muestra como etiqueta de origen con el detalle al pasar el mouse. En el papel
el cliente ve `PerfilesPrecios.EtiquetaFactura` ("Descuento por volumen", "Urgencia",
"Tinta UV"), no el nombre interno.

Decisiones de negocio (recomendación entre paréntesis):

1. **Precio fijo pactado**: ¿se imprime como descuento sobre lista con % derivado a 2
   decimales (lista 22,00 − 9,02 = 12,98, "41,00 %") o como "precio especial" sin %?
   (Recomiendo descuento sobre lista con % derivado y origen "Precio pactado": el cliente
   ve la lista y cuánto ahorra; el contador ve el %.)
2. **Recargos** (urgencia, tinta): ¿explícitos en factura y CFE como recargo por línea, o
   siguen embebidos en el unitario? (Explícitos. DGI lo admite; es lo simétrico del
   descuento.)
3. **DGI — DECIDIDO el 11-sep-2026: NO se toca SISNET.** El CFE viaja exactamente como hoy
   (unitario neto sin IVA y montoItem por ítem, sin `descuentoPct/Monto` ni
   `recargoPct/Monto`). La transparencia vive en el pedido, en la línea de factura y en
   nuestro PDF. Para que la representación impresa siga diciendo lo mismo que el CFE, la
   columna "P. Unitario" del papel es el unitario neto (con IVA) que ya se imprime hoy como
   "P.U. Neto"; lista, descuento y recargo se agregan como columnas informativas y el
   "Importe" sigue siendo `DcdTotal`. Nada de lo que suma a DGI cambia.
4. **Histórico**: rellenar el desglose de los pedidos parseando el texto (2.986 + 2.944 +
   916 líneas; sí, es aditivo y verificable) y **no tocar** documentos emitidos
   (INV-PRE.02); ¿regenerar los borradores/pendientes con el resolvedor nuevo? (No hace
   falta: la transparencia arranca desde el despliegue.)
5. **Descuento manual del cierre de ciclo**: ¿se sigue aplicando sobre el neto como hoy y se
   imprime aparte, o se suma al del motor sobre la lista? (Sobre el neto, aparte: son dos
   conceptos distintos y el manual es raro.)
6. **Descuento por importe** ("bonificación"): la pantalla de precios especiales suma un
   tercer campo "Desc. $" (`TipoRegla = 'subtract'`, que el motor ya entiende) y los
   perfiles suman "Descuento por importe" y "Recargo por importe". ¿Se unifican también
   los nombres `percentage` / `percentage_discount`? (Sí, con un UPDATE de datos; el motor
   ya trata a los dos igual.)
7. **Cobertura parcial por plan** (excedente): el desglose se prorratea con el mismo factor
   que el neto; línea cubierta al 100 % sigue excluida de la factura (DGI rechaza líneas
   en 0). Sin decisión: es la regla actual extendida.
8. **Reimpresión de un documento aceptado por DGI** (planteado el 11-sep): DGI guarda el
   CFE como datos (XML), no un PDF; la "foto" impresa la genera SISNET (`ObtenerPDF` /
   `ReImpresionCFE`, y `CfeUrlImpresion` es la URL del QR) y nosotros regeneramos la
   nuestra cada vez desde las líneas guardadas. Los números de un documento aceptado no
   cambian nunca; lo que puede cambiar al reimprimir es la diagramación. Propuesta para
   cumplir "la foto es la que se muestra": (a) desde el despliegue, **guardar el PDF
   nuestro en el momento en que DGI acepta** y que reimprimir sea ese archivo (spec 18);
   (b) para lo ya emitido no hay foto guardada: se regenera con los mismos números, y la
   bandeja ofrece "ver copia SISNET" como referencia. Alternativa: congelar la diagramación
   vieja para documentos aceptados antes de una fecha de corte. (Recomiendo a + b.)
9. **Recalcular un pedido ya facturado**: la factura emitida es una copia congelada
   (`DocumentosContablesDetalle`) y no se toca. Guardar la re-cotización reescribe las
   líneas del pedido y, solo si la pantalla pide propagar, avisa con 409 cuando alguna
   orden ya fue entregada, facturada o cobrada; confirmado, actualiza `OrdCostoFinal`, el
   movimiento de cuenta sin documento, la deuda y el ciclo. El desglose nuevo sigue la
   misma regla: se guarda en el pedido, no reescribe documentos emitidos.

## 4. Plan por fases

Orden pensado para que cada fase se pueda desplegar sola y no rompa nada: primero capturar
el dato, después mostrarlo. Una llave en `ConfiguracionGlobal` para encender la
presentación cuando el dato ya esté cargado: `PRECIOS_DESGLOSE_EN_FACTURA` (F2), en 0 al
desplegar. Lo que viaja a SISNET/DGI no se toca (F4 descartada el 11-sep).

### F0 — Contrato del motor (1–2 días)

- `calculatePrice` devuelve, además de lo actual, `desglose`:
  `{ precioLista, monedaLista, precioListaConvertido, override: {valor, motivo} | null,
  baseCalculo, descuento: {tipo, pct, importeUnitario, origen, reglaId, perfilId, nombre} | null,
  recargos: [{pct, importeUnitario, origen, perfilId, nombre}], precioNeto, prepago: {...} }`.
  `txt` y `breakdown` se mantienen (los usan la cotización interna, las etiquetas y el
  cierre); el % del texto pasa a 2 decimales.
- Precio fijo ganador: `tipo = 'FIJO'`, `importeUnitario = lista − fijo`, `pct` derivado.
  Override técnico (bordado/estampado): `precioLista = override`, sin descuento.
- `subtract` (descuento por importe) y `amount_surcharge` quedan como tipos de primera
  clase, con la moneda de la regla convertida como hoy.
- UI: `SpecialPrices.jsx` campo "Desc. $"; `PriceProfiles.jsx` opciones "Descuento por
  importe" / "Recargo por importe". `specialPricesController`/`profilesController` sin
  cambio de esquema (`TipoRegla` NVARCHAR(20), `Valor` DECIMAL(18,4), `Moneda`).
- Datos: UPDATE opcional `percentage → percentage_discount` (o al revés) para un solo
  nombre.
- Pruebas: simulador `PriceCalculatorTest` muestra el desglose; casos §7.

### F1 — Congelar el desglose en el pedido (2–3 días + script de relleno 1 día)

- SQL aditivo `backend/scripts/add_desglose_PedidosCobranzaDetalle.sql` (**escrito el
  11-sep, validado en local con ROLLBACK, sin correr en ningún lado**):
  `PrecioLista DECIMAL(18,4)`, `DescuentoTipo VARCHAR(12)` (PCT | IMPORTE | FIJO | MANUAL,
  con CHECK), `DescuentoPct DECIMAL(9,4)`, `DescuentoImporte DECIMAL(18,4)` (unitario),
  `DescuentoOrigen NVARCHAR(150)`, `DescuentoPerfilId INT`, `DescuentoReglaId INT`,
  `RecargoPct DECIMAL(9,4)` (suma), `RecargoImporte DECIMAL(18,4)` (suma unitaria),
  `RecargoOrigen NVARCHAR(200)`, `DesgloseJSON NVARCHAR(MAX)`. Todo NULL: las filas viejas
  no cambian; NULL significa "sin desglose" y el resto del sistema cae al comportamiento
  actual. También `add_EtiquetaFactura_PerfilesPrecios.sql` (F0): `PerfilesPrecios.
  EtiquetaFactura NVARCHAR(60)`, el texto que ve el cliente.
- `erpSyncService`: material y servicios (`ServiciosExtraOrden`) escriben las columnas
  nuevas desde `desglose`; override manual (`priceOverride`) → `DescuentoTipo='MANUAL'`,
  lista = la del motor si se puede calcular. `quotationController.guardarCotizacion`: el
  front devuelve las columnas y el backend las reinserta (mismo cuidado que
  `EsHermanaConsolidada`); precio tipeado a mano → `MANUAL`.
- Tienda/WMS/prendas: `PrecioLista = PrecioUnitario`, sin descuento (no pasan por el
  motor). Cabecera `PedidosCobranza.DetalleCostos` se deja como está.
- Script `backend/scripts/backfill_desglose_pcd.js` (dry-run / `--apply`): parsea
  `LogPrecioAplicado` (`Base: USD 22.00`, `Descuento: -USD 8.00 (Desc. 36% [Excepción
  Cliente])`, `Recargo: +USD 5.50 (...)`, `Override: ...`), recalcula el % exacto desde
  los importes (8/22 = 36,36 %, no el "36%" impreso), verifica INV-PRE.03 contra
  `PrecioUnitario` y reporta las que no cierran sin escribirlas. Solo llena NULL.
- No se toca `PrecioUnitario` (18,2): el redondeo lo absorbe `DescuentoImporte`.

### F2 — Que la factura lea el pedido (2–3 días)

- `contabilidadCore.resolverLineasDetalle` MODO 1 y MODO 2: cruce por `Ordenes.NoDocERP`
  (patrón del CTE `PedBase` de `cajaController`), conservando el cruce por código para
  VEN-/EMB-, y **`pcd.OrdenID = o.OrdenID`** para no fanear en multitela. Esto solo ya
  corrige la descripción y la fuente de 10.700 órdenes por trimestre; se valida con un
  test dorado (§7) que compara totales viejos vs nuevos línea a línea.
- Mapeo nuevo (detrás de `PRECIOS_DESGLOSE_EN_FACTURA=1`): `precioUnitario = PrecioLista ×
  f` (bruto con IVA), `totalDescuentos = DescuentoImporte × Cantidad × f`, `descuentoPct`,
  `descuentoStr = origen legible`, `totalRecargos = RecargoImporte × Cantidad × f`,
  `recargoPct`, `recargoStr`; **`total` sigue siendo `pcd.Subtotal × f`** (el factor de
  cotización implícita RN-FAC.09 se aplica igual a lista, descuento y recargo). Sin
  desglose (NULL) → comportamiento actual.
- Mismo mapeo en `cajaController.procesarPagoDeuda` (y unificar su PU al bruto con IVA: hoy
  va sin IVA), en el bloque legacy de `cajaService` (servicios libres: sin descuento) y en
  `regenerar_lineas_docs.js` (usa el resolvedor, hereda el cambio).
- Cobertura parcial por plan: prorrateo de lista/descuento/recargo con el mismo factor.

### F3 — `DocumentosContablesDetalle` (1–2 días)

- Correr en producción **primero** `add_DcdDescuentoPct.sql` (pendiente desde julio).
- SQL aditivo `add_recargos_DocumentosContablesDetalle.sql` (**escrito el 11-sep, validado
  en local con ROLLBACK, sin correr**): repite el ALTER de `DcdDescuentoPct` (así un solo
  script deja la tabla completa), `DcdDescuentoOrigen NVARCHAR(150)`, `DcdRecargoPct
  DECIMAL(9,4)` (suma), `DcdTotalRecargos DECIMAL(18,2)` (suma, con IVA), `DcdRecargoStr
  VARCHAR(200)`; y `ALTER COLUMN DcdPrecioUnitario DECIMAL(18,4)` (ensancha sin pérdida;
  20 mil filas).
- `crearDocumentoContable` (acepta y escribe recargos + origen), `editarFactura`
  (reinserta también recargos y `DcdDescuentoPct`), clon de NC/ND (copia `DcdDescuentoPct`
  y recargos), `getDetalleFactura` y `contabilidadService` (cierre: líneas con lista y
  descuento del motor desde `DetallesJSON`; el manual sigue aparte, decisión 5).
- Regla documentada en el código: `DcdTotal = round(DcdCantidad × DcdPrecioUnitario −
  DcdTotalDescuentos + DcdTotalRecargos, 2)`; `DcdSubtotal = DcdTotal / 1,22`. Guard
  suave en `crearDocumentoContable`: si no cierra, log + `DcdDescuentoStr = 'REVISAR'`,
  nunca bloquea (el cuadre duro sigue siendo Σ `DcdTotal` = `DocTotal`).

### F4 — CFE a DGI: DESCARTADA el 11-sep-2026

> Decisión del usuario: **no se cambia nada de lo que viaja a SISNET/DGI**. El payload del
> CFE queda byte a byte como hoy; la llave `CFE_DESCUENTO_POR_ITEM` no se crea y no hay
> pruebas nuevas con SISNET. Lo que sigue queda solo como referencia de lo descartado.

- `sisnetService.prepararCFE` (detrás de `CFE_DESCUENTO_POR_ITEM=1`): por ítem
  `descuentoMonto = DcdTotalDescuentos / 1,22`, `descuentoPct = DcdDescuentoPct`,
  `recargoMonto = DcdTotalRecargos / 1,22`, `recargoPct`, `montoItem = DcdSubtotal` (igual
  que hoy) y `precioUnitario = (montoItem + descuentoMonto − recargoMonto) / cantidad`
  con **6 decimales** para que SISNET cuadre también con cantidades grandes (ver regla de
  redondeo en §3; validar en el ambiente de prueba que SISNET/DGI acepten 6 decimales en
  el unitario); `descAdicional` con "Orden: X" si se quiere.
  `mntBruto` sigue en 0; totales del documento no cambian. Con la llave en 0, el payload es
  byte a byte el actual.
- `previewDGI` / `CfePreviewDgiModal` muestran los campos nuevos.
- Pruebas: `GenerarCaeDePrueba` + `statusTest` en el WSDL de test (`test.sisnet.com.uy`)
  con un ítem con descuento, uno con recargo, uno con ambos y una NC referenciando; revisar
  el PDF/XML que devuelve SISNET (`ObtenerPDF`/`ObtenerXML`) y que DGI acepte
  `DescuentoPct` con 2 decimales. Visto bueno del contador antes de encender.

### F5 — Presentación (3–4 días)

- PDF (`pdfGenerator.js`), **formato de la línea decidido el 11-sep-2026**:
  - Columnas (ajustadas el 11-sep para no cambiar nada frente al CFE): No. | Descripción |
    IVA | **P. Lista** | Cantidad | **Descuento** | **Recargo** | **P. Unitario** | Importe.
    "P. Unitario" es el unitario neto con IVA que hoy se imprime como "P.U. Neto", el mismo
    que lleva el CFE; "Importe" sigue siendo `DcdTotal`. "Descuento" y "Recargo" llevan en la
    misma celda el % arriba y el importe abajo ("20,00 %" / "0,80"); un precio pactado sin %
    muestra solo el importe. Son las mismas nueve columnas de hoy: "%" y "Descuento" se
    funden y entra "Recargo". Regla: `P. Lista × Cantidad − Descuento + Recargo = Importe`,
    con el descuento absorbiendo el redondeo. El pie (Gravado, IVA, Total) sale del cabezal
    como hoy y no cambia.
  - Descripción corta: el nombre del artículo y debajo `CÓDIGO (trabajo) RW-nnnnn`. Se
    van las palabras "Orden:" y "Retiro" y el sufijo "(Neto: $ x)". **Hecho el 11-sep**
    como adelanto, solo front: `src/utils/descripcionLineaFactura.js` +
    `pdfGenerator.js`, sin SQL ni backend. La tercera línea con el nombre del cliente
    viene del carrito de caja (`TdeDescripcion`) porque el cruce con el pedido falla; en
    F2 el resolvedor deja de pegar ese texto y tampoco pega el del motor (el desglose va
    en columnas). Pendiente confirmar si esa línea también se saca al reimprimir.
  - Hacia atrás: el PDF **no se guarda**, se genera cada vez desde las líneas guardadas.
    (1) El sufijo "(Neto)" lo agregaba el generador: desaparece de todo documento, viejo y
    nuevo, al desplegar el front. (2) "Orden:" / "Retiro" están en el texto guardado de
    cada línea: el generador los quita al imprimir, sin tocar datos; en F2 el resolvedor
    deja de escribirlos. (3) En documentos viejos las columnas Descuento/Recargo quedan
    vacías, salvo las 369 líneas manuales que ya tienen descuento; P. Unitario = P.U.
    Neto como hoy; ningún importe se recalcula. La copia que guarda DGI/SISNET nunca
    cambia.
  - Verificar el ticket térmico de caja (`CajaTransaccionView`) y el PDF de cierre (que
    hoy imprime `OrdDescuentoAplicado`, siempre 0: reemplazar por el desglose real).
- Bandeja CFE: columnas lista / desc / recargo en el detalle expandido.
- `FacturacionManualModal` (factura manual y edición de documentos antes de DGI,
  **decidido el 11-sep**): mismas columnas que la factura: Concepto | Cant. | **P. Lista** |
  **Descuento** (% · $) | **Recargo** (% · $) | IVA % | **P. Unitario** (neto) | Subtotal neto
  | Total con IVA. Dos tipos de línea: (a) **línea que viene de una orden** (tiene
  `OrdCodigoOrden` y desglose): P. Lista, Cant. y P. Unitario son de solo lectura y solo se
  editan Descuento y Recargo; la lista sale del pedido, así desaparece el unitario
  "10,5091" que hoy fabrica el resolvedor dividiendo importe por cantidad (ET-7448:
  Hexagonal 5,78 / 0,55; la lista real es 10,50). (b) **Concepto manual** ("Agregar
  concepto", sin orden detrás): se tipean concepto, cantidad y P. Lista, y opcionalmente
  descuento y recargo; origen "Manual". El link "Precio original" vuelve a la lista del
  pedido. Cambiar descuento o recargo cambia el total del documento y sigue el circuito de
  edición actual (`editarFactura`: ajusta movimiento, deuda y pago si el monto cambió;
  bloqueado si ya fue a DGI; pide confirmación si estaba cobrado). Reinsertar las líneas
  lleva también recargo, origen y `DcdDescuentoPct`.
- `CierreCicloPreviewModal` (Vista Previa de Facturación, **decidido el 11-sep**): misma
  estructura que la factura impresa, para que se lea igual: Descripción | Cant. | **P. Lista**
  | **Descuento** (% · $) | **Recargo** (% · $) | **P. Unitario** (neto) | Importe, con la
  etiqueta de origen debajo del material (precio base, excepción, perfil, urgencia, tinta).
  **Solo se editan Descuento y Recargo**, en % o en importe (tipear uno completa el otro,
  como en Precios Especiales); P. Lista, Cant., P. Unitario e Importe son de solo lectura y
  se recalculan: neto = lista − descuento + recargo, importe = neto × cant. Editar un
  descuento o recargo que puso el motor lo marca "Manual" y deja visible el valor original.
  La lista y el desglose salen de la línea congelada del pedido (`DetallesJSON` con las
  columnas nuevas); una línea sin desglose muestra lista = neto y celdas vacías, como hoy.
  El descuento global de cabecera queda como está. Consecuencia: la corrección de precio
  o de cantidad línea a línea que hoy permite RN-FAC.19 deja de hacerse acá; un precio
  distinto se expresa como descuento o recargo manual, y una cantidad distinta se corrige
  en la orden antes de cerrar (queda anotado como cambio de regla en la spec 06).
- **Caja, "Editar órdenes del retiro"** (`CajaTransaccionView` + `ordenesRetiroController.
  editarCostoOrden`, analizado el 11-sep). Hoy el modal edita moneda, cantidad y TOTAL por
  orden (el unitario es derivado) y manda `nuevoCosto` + `nuevaCantidad`; el backend
  actualiza `OrdenesDeposito`, re-sincroniza la billetera, ajusta movimiento / saldo /
  deuda / ciclo, el total del retiro y el pedido. Problema encontrado en el pedido: (1)
  **nunca actualiza `PrecioUnitario`**, solo `Subtotal` y `Cantidad`, así que toda orden
  editada en caja queda con `PrecioUnitario × Cantidad ≠ Subtotal` (391 de 16.738 líneas de
  pedidos de una línea y 21 de 777 de multitela, 2,3 % del total); (2) en multitela **escala
  el `Subtotal` de TODAS las líneas por el ratio nuevoCosto / MontoTotal del pedido entero y
  pisa la `Cantidad` de TODAS** con la de la orden editada. Cambio: el modal pasa a Orden | Moneda |
  Cant. | **P. Lista** | **Descuento** (% · $) | **Recargo** (% · $) | P. Unit. | Total; se
  editan cantidad (acá se corrige lo medido al entregar), descuento y recargo; lista y
  unitario son de solo lectura y el total se recalcula. El backend recibe el desglose,
  escribe **solo la línea de esa orden** (`pcd.OrdenID`) con `DescuentoTipo = 'MANUAL'`,
  origen "CAJA: usuario · motivo", `Subtotal = neto × cant`, y propaga como hoy sin el
  escalado por ratio. Cambio de moneda: lista, descuento y recargo se convierten con el
  mismo factor que el total. **"Exonerar del pago"** (`exonerarOrdenCaja`): hoy inserta un pago de $0
  sin medio, tipo EXONERACION, y lo vincula a la orden en depósito; con eso la caja la ve
  saldada y el retiro se entrega. No cambia el importe, ni el estado, ni el pedido, ni el
  movimiento de cuenta, ni la deuda; no genera documento ni asiento; deja rastro en
  HistorialOrdenes ("Exonerada", con motivo). Revertir solo borra ese pago de $0. En la
  base local hay 6 órdenes exoneradas vigentes (USD 714,45, todas entregadas, ninguna con
  cargo en cuenta) y los motivos históricos son "ROLLO X ADELANTADO", "Ya fue abonada",
  "ORDEN YA RETIRADA": **se usa para no cobrar dos veces algo que ya se pagó por otra vía,
  no para regalar**. **Decisión del usuario (11-sep): la exoneración queda EXACTAMENTE como
  está.** Influye en el retiro de la orden, no en la contabilidad ni en el precio: no se
  convierte en descuento, no se divide en dos botones y no entra en este cambio. La línea
  de una orden exonerada conserva su desglose (lista, descuento, recargo) y en el modal se
  muestra bloqueada como hoy. Las reposiciones
  -R ya nacen en 0 y con desglose se ven como lista + 100 % "Reposición": no hace falta
  exonerarlas. "Las órdenes ya pagadas no se pueden editar" se mantiene.
- `QuotationEditModal` ("Confirmación de Cotización", pedido por pedido): la columna
  "Perfil" (badge + texto del motor en itálica) se reemplaza por **Lista | Descuento
  (% · importe) | Recargo (% · importe) | Precio U.** (neto, la columna que ya existe) y
  un badge de **origen** debajo del producto: perfil asignado al cliente, perfil global
  del área, excepción del cliente, urgencia, tinta, reposición sin cargo, manual. Un
  precio tipeado a mano conserva la lista y marca origen "Manual". "Recargar Precios"
  sigue llamando a `/prices/calculate` y lee `desglose`. Al guardar, el modal devuelve
  las columnas nuevas (el backend borra y reinserta todas las líneas). Reposición sin
  cargo se representa como descuento 100 % con origen "Reposición", así se ve cuánto
  valía el retrabajo regalado. **El perfil no se elige en esta pantalla**: se asigna al
  cliente en Precios Especiales ("Gestionar Perfiles"), es global por área en Perfiles
  de Precios, o lo inyecta la orden (urgente, tinta UV/Latex, código -R/-F).
- Portal (opcional, aparte): endpoint de solo lectura con las líneas del pedido y su
  desglose para "Mis pedidos" / cotización; hoy el cliente solo ve el total.

### F6 — Datos históricos (1 día)

- Correr `backfill_desglose_pcd.js --apply` en producción después de F1 (el usuario lo
  corre; entregar salida del dry-run local).
- Documentos ya emitidos: **no se tocan** (INV-PRE.02, y los que tienen CAE nunca). Los
  borradores/pendientes se pueden regenerar caso a caso con `regenerar_lineas_docs.js`.

### F7 — Pruebas y specs (2 días)

Casos mínimos, cada uno con su factura, PDF y payload DGI:
- % de excepción (20931: 22 − 36,36 % = 14,00); precio fijo (decisión 1); perfil
  escalonado (SB ≥ 100 m, 10 %); descuento + urgencia (SUB-20860: 10 − 2 + 2,50 = 10,50);
  tinta UV sobre material y no sobre servicios; bordado por puntadas (override, sin
  descuento); descuento por importe (`subtract`) y recargo por importe (nuevos).
- Prepago total (línea excluida) y parcial (prorrateo); reposición sin cargo (0).
- Cross-moneda: pedido USD cobrado en $ por MercadoPago (factor implícito RN-FAC.09
  aplicado a lista, descuento y recargo; `DcdTotal` idéntico al actual).
- Cierre de ciclo con descuento global + descuento manual por línea; edición de factura
  (no pierde nada); NC de una factura con descuento (clona todo); pago de deuda (PC).
- **Test dorado**: script de solo lectura que corre el resolvedor viejo y el nuevo sobre
  las últimas N transacciones y exige `total` idéntico por línea y Σ idéntica; con
  desglose exige INV-PRE.03.
- Specs: 09 §5 (el desglose se congela con la línea: cierra RN-PRE.12, agrega INV-PRE.03),
  06 RN-FAC.10 (extender a recargos y origen; el CFE lleva descuento/recargo por ítem),
  40 (el `BENEFICIO:id` va en `DescuentoOrigen`), glosario (lista / descuento / recargo /
  neto).

Estimación total: 14–20 días hábiles, más las pruebas con SISNET y el contador (F4), que
no dependen de código.

## 5. Lo que no cambia (invariantes)

- `PedidosCobranzaDetalle.PrecioUnitario`/`Subtotal`, `Ordenes.CostoTotal`,
  `OrdenesDeposito.OrdCostoFinal`, `DocumentosContables.DocTotal`, deuda, saldos y
  asientos: **idénticos**. El desglose es información adicional sobre el mismo neto.
- Cuadre pre-DGI (Σ `DcdTotal` = `DocTotal`, tolerancia 1,00): sin cambios.
- Documentos emitidos (con o sin CAE): sin cambios (INV-PRE.02).
- Con las dos llaves en 0, el sistema se comporta exactamente como hoy salvo el cruce del
  resolvedor (F2), que se despliega como corrección de bug con su test dorado.

## 6. Entregables SQL (los corre el usuario en producción, en este orden)

1. `add_DcdDescuentoPct.sql` (ya existe, pendiente; el script 3 lo incluye, cualquiera de
   los dos alcanza).
2. `add_desglose_PedidosCobranzaDetalle.sql` (F1, **escrito 11-sep**, aditivo).
3. `add_recargos_DocumentosContablesDetalle.sql` (F3, **escrito 11-sep**, aditivo +
   ensanche de `DcdPrecioUnitario`).
4. `add_EtiquetaFactura_PerfilesPrecios.sql` (F0, **escrito 11-sep**, aditivo; los textos
   por perfil quedan comentados para que los decida administración).
5. `unificar_TipoRegla_percentage.sql` (F0, opcional, UPDATE de nombres; no escrito).
5. Llave en `ConfiguracionGlobal`: `PRECIOS_DESGLOSE_EN_FACTURA`. No hace falta crearla:
   ausente = encendida; se apaga solo insertando la clave con Valor '0' (apaga la
   presentación en factura, nunca los totales). La llave del CFE ya no existe: F4 descartada.
6. `backfill_desglose_pcd.js --apply` (F6, node, después de 2).

## 7. Apéndice: evidencia (local, 7-sep-2026)

Scripts de solo lectura en el scratchpad de la sesión (`schema_precios.js`,
`muestras_precios.js`, `semantica_pu.js`, `join_resolver2.js`). Cifras clave: 29.664 líneas
de pedido (2.986 con descuento en texto, 2.944 con recargo, 916 override); 20.458 líneas
de documento (369 con `DcdTotalDescuentos`, 348 con `DcdDescuentoPct`, 0 con texto del
motor); cruce del resolvedor 8.973 / 24.682 órdenes en 90 días vs 19.670 por
`Ordenes.NoDocERP`; 658 reglas de excepción (123 % con decimales, 5 negativos); WSDL
SISNET `wsItem` con `descuentoPct/Monto` y `recargoPct/Monto`.
