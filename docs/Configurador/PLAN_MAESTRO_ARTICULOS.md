# Maestro de artículos — estructura nueva, impacto en los procesos y plan de upgrade

Fecha: 02-oct-2026 · **Actualizado 14-oct-2026** con los cambios del configurador del 05 al 14-oct (ver §0). Documento único: reúne y reemplaza como referencia a `PROPUESTA_maestro_articulos_erp.md` y `ESTRUCTURA_NUEVA_maestro_articulos.md` (quedan como antecedente).

Estado: **solo diseño y plan. Nada está implementado.**

Base del análisis: base LOCAL (258 tablas), lectura del código de stock, compras, precios y contabilidad, y un conteo sobre los 353 archivos de backend y 480 de frontend de qué archivos usan cada tabla o columna que cambia. Producción no se revisó: antes de cada etapa se corre su diagnóstico allá. Los conteos de archivos y usos son coincidencias de texto en el código: sirven para dimensionar cada etapa, no son una lista exacta de lo que hay que tocar.

Decisiones ya tomadas: WMS propio en producción · una sola lista de artículos e insumos · ingresos e IVA por familia ahora, inventario contable permanente después · costeo por lote + último costo + promedio · artículos restringidos cliente por cliente · nombre comercial en la factura · ingreso de combos repartido entre familias.

**Índice:** §0 — Qué cambió desde el 02-oct · Parte 1 — Estructura nueva · Parte 2 — Qué cambia en los procesos de hoy · Parte 3 — Plan de upgrade (back y front)

---

# §0 — Qué cambió en el configurador desde el 02-oct (y cómo entra al plan)

Desde el 07-oct la base local es una **copia de producción** (restaurada ese día) más los SQL corridos en local después. Por eso los números de este documento ahora valen como producción al 07-oct, y por eso algunas tablas que el plan daba por hechas (accesorios) **no están**: producción nunca recibió ese SQL.

| Cambio (fecha) | Qué es | Dónde vive | Cómo entra al plan |
|---|---|---|---|
| **Costuras paso a paso** (05-oct) | la ficha de diseño pasa de "unión + ISO" a la secuencia de confección: etapa, operación, costura ISO, máquina, piezas, **tiempo en minutos**, observaciones, imagen. Catálogo de tipos de máquina (15) | `ProductoFichaDisenoCosturas` (+ columnas), `CosturasISO` (+ descripción, imagen, máquina), `MaquinasCostura` [NUEVO] | [IGUAL] en la estructura. Los **tiempos por paso** son la base de la mano de obra del costo estándar (etapa 9): antes no existían |
| **Avíos por talle** (09-oct) | un avío puede ser "medida única" o variar por talle (cierre de 15 cm en S–M, 18 en L–XXL); cada paso de costura dice qué avío usa | `ProductoAvios.VariaPorTalle`, `ProductoAviosTalle` [NUEVO], `ProductoFichaDisenoCosturas.AvioID` | la receta (`ArticuloComponentes`, etapa 9) tiene que admitir **cantidad por talle**, no solo por unidad |
| **Producto padre + variantes por modelo** (12-oct) | Familia → Etiqueta → producto padre (con el molde) → una variante por cada modelo del molde que se vende (cuello V, cuello redondo…). La variante **es otro artículo**: nace como copia del padre y se edita en el mismo editor; molde, producción principal y medida son del padre. Códigos nuevos `FAM-ETQ-NN` (CAM-BAS-01, variante CAM-BAS-01-02) | `ProductoVentaConfig.PadreProIdProducto`, `ModeloClave` (único por padre + modelo); servicio `productoVariantes.js`; pantalla `ConfiguradorVariantes.jsx` | **Dos cosas distintas con el mismo nombre**: la "variante" del configurador es un **modelo de molde = artículo propio**; la variante del ERP (`ArticuloVariantes`) es **talle/color de stock** de un mismo artículo. El plan las separa (ver 1.1 y etapa 6). El código `FAM-ETQ-NN` es la convención del `Codigo` único de la etapa 0 |
| **Productos a medida** (13-oct) | productos sin talles con forma y medida libre (pañuelos, toallas, banderines): la medida la pone el cliente dentro de un mín–máx; TIZADA arma el molde y las tiras guía | `ProductoVentaConfig.AMedidaJson`; servicio `tizadaProAMedida.js`; pantalla `ConfiguradorAMedida.jsx`; en la solicitud, una medida por diseño | hoy se cobra el precio del producto **por unidad**; el precio por medida (m², metro) es exactamente lo que agrega la etapa 3 (precio por unidad). Queda como caso de prueba de esa etapa |
| **Archivos de impresión por producto** (14-oct) | cómo arma TIZADA las mesas (normal / una por fila) | `ProductoVentaConfig.TizadaMesasModo` | [IGUAL], es de fabricación |
| **Registro de envíos a TIZADA** (05-oct) | cada pedido enviado a TIZADA queda registrado con su resultado | `TizadaProEnvios` [NUEVO] | [IGUAL], integración |
| **El cliente arma su pedido en la tienda** (12-oct) | un producto "armable" de la tienda genera una Solicitud con origen PORTAL, el cliente sube artes y elige extras, y se convierte sola en pedido | `SolicitudesVendedor.Origen` (VENDEDOR / PORTAL), `PortalConfirmado`; `pedidoPortalService.js`; `PedidoTiendaView.jsx` | la etapa 4 (canales) tiene que cubrir "armable en la tienda" como visibilidad propia del canal TIENDA, y la audiencia por cliente aplica también a lo armable |
| **Borrado de los PR-0xx** (12-oct) | los 20 productos de básquet/fútbol se reemplazan por padre + variantes | en la base siguen 49 artículos `PR-…` | entra en el saneo de la etapa 0: decidir cuáles se borran (con respaldo, como PR-002) |

**Estado de los SQL del configurador en la base (local = prod al 07-oct + lo corrido en local después):**

| SQL | ¿Está? | Nota |
|---|---|---|
| F1 producción principal (2b) | sí | |
| Accesorios de stock (2c) — `ProductoAccesorios`, `WmsDepositoId` | **no** | el código del configurador y de los pedidos lo detecta y funciona sin él; sin la tabla, el paso "Cantidad y accesorios" guarda vacío |
| Áreas entregan tela (2e), requisito Accesorios (2f), requisito TPU (2g) | **no** | pendientes de producción (ver `scripts/PROD_2026-10-02_A/B`) |
| Costuras paso a paso, avíos por talle, variantes, a medida, mesas TIZADA, solicitudes portal, envíos TIZADA | sí en local | corridos en local después de la restauración; **en producción no se verificó**: hay que correr un diagnóstico allá |

Lo que no cambió: las tablas `ProductoComponentes` y `ProductoVariantes` existen en producción **vacías** (restos de un diseño anterior que el configurador ya no usa salvo al copiar filas); van a la limpieza final.

---

# PARTE 1 — Estructura nueva

Etiquetas: **[NUEVO]** no existe hoy · **[CAMBIA]** existe y se modifica · **[SE MUEVE]** el dato pasa a otro lugar · **[SE ELIMINA]** desaparece al final · **[IGUAL]** no se toca.

## 1.1 Vista general

| Bloque | Tabla | Estado | En una línea |
|---|---|---|---|
| Catálogo | `Articulos` | [CAMBIA] | sigue siendo el maestro; gana roles, nombres, estado, familia, unidad base |
| | `ArticuloCategorias` | [NUEVO] | árbol de familias de cualquier profundidad, con herencia |
| | `StockArt` | [SE ELIMINA] → vista | lo absorbe el árbol |
| | `ArticuloClasificacion` | [SE ELIMINA] → vista | el área pasa a ser dato de la familia |
| | `SectorMapeo` | [SE MUEVE] | el sector pasa a la familia; `Sectores` queda [IGUAL] |
| | `ConfigMapeoERP` | [CAMBIA] | queda solo como configuración de áreas; deja de clasificar artículos |
| | `ArticuloFichaTecnica` | [NUEVO] | ancho/largo imprimible, lleva papel, gramaje, composición |
| Unidades | `Unidades` | [CAMBIA] | de 2 filas a la lista completa, con magnitud y código DGI |
| | `ArticuloUnidades` | [NUEVO] | conversiones por artículo (1 rollo = 100 m) |
| Variantes de stock (talle / color) | `ArticuloVariantes` (hoy `Wms_Variantes`) | [CAMBIA] | la variante pasa a ser del artículo: `ProIdProducto` obligatorio. **No confundir** con las "variantes" del configurador (modelos de molde): esas son artículos propios con `PadreProIdProducto` |
| | `Atributos`, `VarianteAtributos` | [NUEVO] | talle, color y otros, sin copiarlos en dos tablas |
| | `Wms_ProductosMaestros` | [SE ELIMINA] | cada maestro pasa a ser su artículo |
| | `Articulos_Wms`, `Articulos_WMS_Variantes` | [SE ELIMINA] | tablas puente unidas por nombre |
| Precios | `PreciosBase` | [CAMBIA] | clave nueva: artículo + variante + unidad + moneda |
| | `PerfilesItems`, `PreciosEspecialesItems` | [CAMBIA] | + variante, unidad y familia opcionales |
| | `PerfilesPrecios`, `PreciosEspeciales`, `ConfiguracionPrecios` | [IGUAL] | |
| | `PreciosListaPublica` | [SE ELIMINA] → vista | |
| | `PreciosHistorial` (hoy `HistoricoPreciosProductos`, vacía) | [CAMBIA] | se empieza a llenar |
| Canales | `Canales`, `ArticuloCanales`, `ArticuloAudiencia` | [NUEVO] | visibilidad por canal y por cliente |
| Marketing | `ArticuloMarketing` (hoy `TiendaProductos`) | [CAMBIA] | se queda con vidriera, orden, destacado; pierde la visibilidad |
| | `Articulos_Imagenes`, `ProductoEtiqueta` | [IGUAL] | + `ArticuloEtiquetas` [NUEVO] para varias etiquetas por artículo |
| Compras | `Proveedores` (hoy `Wms_Proveedores`) | [CAMBIA] | ficha única; la usan compras, egresos y cheques |
| | `ArticuloProveedores` | [NUEVO] | proveedor habitual, código y precio del proveedor |
| | `ArticuloCostos`, `CostosHistorial` | [NUEVO] | último, promedio y estándar por variante |
| | `Wms_Compras`, `Wms_ComprasDetalle` | [CAMBIA] | + comprobante, IVA, unidad de compra y factor |
| Stock | `Wms_Depositos`, `Wms_Etiquetas`, `Wms_Movimientos` | [CAMBIA] | + área del depósito, propietario del lote, costo y orden en el movimiento |
| | `Reservas` | [NUEVO] | lo vendido y todavía no preparado |
| | `ReglasReposicion` (hoy `Wms_AlertasDepositos`) | [CAMBIA] | + punto de pedido |
| | `Insumos`, `InsumosPorArea` | [SE ELIMINA] → vista | pasan a ser artículos con rol "se consume" |
| | `InventarioBobinas`, `MovimientosInsumos` | [SE MUEVE] | a lotes y movimientos (última etapa, opcional) |
| | `InventarioPrendasCliente`, `TelaClienteEventos` | [SE MUEVE] | a lotes con propietario |
| Fabricación | `ArticuloFabricacion` (hoy `ProductoVentaConfig`) | [CAMBIA] | queda con técnica principal, molde, medidas, modelo de la variante (`ModeloClave`), a medida (`AMedidaJson`) y modo de mesas TIZADA |
| | `Articulos.PadreProIdProducto` | [SE MUEVE] | el "producto padre" de las variantes por modelo pasa de `ProductoVentaConfig` al maestro: es un dato de catálogo (se ve en el árbol), no de fabricación |
| | `MaquinasCostura`, `ProductoFichaDisenoCosturas` (pasos), `ProductoAviosTalle` | [IGUAL] | ya están (05 y 09-oct); la receta y el costo estándar los leen |
| | `TizadaProEnvios` | [IGUAL] | registro de envíos a TIZADA |
| | `ArticuloProcederes` (hoy `ProductoTerminadoServicios`) | [CAMBIA] | + artículo de servicio y tiempo estándar |
| | `ArticuloComponentes` | [NUEVO] | receta: materiales, avíos, accesorios, componentes |
| | `ProductoComboItems`, `ProductoAccesorios` (hoy no existe en prod), `ProductoAvios` + `ProductoAviosTalle`, `ProductoTelas` | [SE ELIMINA] | convergen en la receta, que admite cantidad por talle |
| | `ProductoComponentes`, `ProductoVariantes` (vacías, diseño anterior) | [SE ELIMINA] | limpieza final |
| | `ProductoTecnicaOpciones`, `TecnicaOpciones`, `ProductoApliques`, `ProductoModelos`, `ProductoComboItemServicios`, `ProductoFichaDiseno*`, `CosturasISO`, `CatalogoAvios` | [IGUAL] | |
| | Modelo ECOUV (`ProductosTerminados`, `Terminaciones`…) | [IGUAL] | intacto hasta su propia migración |
| Contabilidad | `Impuestos`, `PerfilesContables` | [NUEVO] | IVA y cuentas por familia |
| | `Cont_ReglasAsiento` | [CAMBIA] | cuentas comodín por línea (ingreso e IVA) |
| | `Cont_PlanCuentas` | [CAMBIA] | + equivalencia con el plan del contador; cuentas de ingreso por familia |
| | `DocumentosContablesDetalle` | [CAMBIA] | + impuesto, tasa, cuenta, variante, unidad, cantidad base |
| | `DocumentosContablesDetalleReparto` | [NUEVO] | reparto del ingreso de un combo entre familias |
| Pedidos | `PedidosCobranzaDetalle` | [CAMBIA] | + variante, unidad, factor, cantidad base |
| Restos | `SINCRO-ARTICULOS*`, `Articulos_UbicacionLocal`, `Wms_Monedas`, `Wms_Categorias` | [SE ELIMINA] | se archivan o se absorben |

## 1.2 `Articulos`, columna por columna

| Columna | Estado | Detalle |
|---|---|---|
| `ProIdProducto` | [IGUAL] | sigue siendo la clave de todo |
| `Codigo` | [CAMBIA] | es `CodArticulo`, pero **único** (hoy hay 3 repetidos). Convención ya en uso desde el 12-oct: `FAMILIA-ETIQUETA-NN` (CAM-BAS-01), variante `-NN` (CAM-BAS-01-02), combo `CMB-NN` |
| `NombreInterno` | [CAMBIA] | es `Descripcion`, sin el relleno de espacios |
| `NombreComercial` | [NUEVO] | vacío = usar el interno. Es el que sale en la factura |
| `CategoriaId` | [NUEVO] | lugar en el árbol |
| `SupFlia`, `Grupo`, `CodStock` | [SE MUEVE] → categoría | quedan como columnas sincronizadas hasta que nadie las lea |
| `Naturaleza` | [NUEVO] | BIEN / SERVICIO (vacío = hereda) |
| `SeVende`, `SeCompra`, `SeFabrica`, `SeConsume`, `LlevaStock` | [NUEVO] | los roles |
| `Abastecimiento` | [NUEVO] | DE_STOCK / A_PEDIDO / COMBO |
| `PadreProIdProducto` | [SE MUEVE] | viene de `ProductoVentaConfig` (12-oct): el padre de una variante por modelo. Vacío = no es variante |
| `UnidadBaseId` | [CAMBIA] | reemplaza `UniIdUnidad` |
| `ImpuestoId`, `PerfilContableId` | [NUEVO] | vacío = hereda de la familia |
| `LlevaVariantes`, `ControlStock` | [NUEVO] | |
| `CantidadMinima`, `CantidadMultiplo`, `ValidarStock` | [SE MUEVE] | vienen de `ProductoVentaConfig` |
| `Estado` | [NUEVO] | BORRADOR / ACTIVO / DISCONTINUADO; reemplaza `Mostrar` y `borrar` |
| `MonIdMoneda` | [SE ELIMINA] | la moneda es del precio |
| `EnListaPrecios`, `EnListaPublica` | [SE MUEVE] → canales | |
| `DescripcionLista` | [SE MUEVE] → `NombreComercial` | |
| `anchoimprimible`, `largoimprimible`, `LLEVAPAPEL` | [SE MUEVE] → ficha técnica | |
| `IDProdReact`, `ProCodigoOdooProducto` | [IGUAL] | solo históricos |
| Usuario y fecha de alta / modificación | [NUEVO] | |

## 1.3 Tablas nuevas, con sus columnas

**`ArticuloCategorias`** — `CategoriaId` PK · `PadreId` (a sí misma) · `Codigo` único · `Nombre` · `Ruta` · `Nivel` · `Orden` · `Activa` · valores heredables: `Naturaleza`, `UnidadBaseId`, `ImpuestoId`, `PerfilContableId`, `AreaId`, `SectorId`, `CotizaPor` (UNIDAD / SUPERFICIE / LARGO).

**`ArticuloUnidades`** — `ProIdProducto` + `UnidadId` (PK) · `FactorABase` · `ParaCompra` · `ParaVenta` · `SugeridaCompra` · `SugeridaVenta` · `CodigoBarras`.

**`Atributos`** — `AtributoId` · `Nombre` (Talle, Color, Ancho…). **`VarianteAtributos`** — `VarianteId` + `AtributoId` (PK) · `Valor`.

**`ArticuloFichaTecnica`** — `ProIdProducto` PK · `AnchoImprimibleM` · `LargoImprimibleM` · `LlevaPapel` · `GramajeGsm` · `Composicion`.

**`Canales`** — `CanalCodigo` PK (INTERNO, PORTAL, TIENDA, LISTA_PUBLICA, API). **`ArticuloCanales`** — `ProIdProducto` + `CanalCodigo` (PK) · `Visible` · `Alcance` (TODOS / HABILITADOS). **`ArticuloAudiencia`** — `ProIdProducto` + `CanalCodigo` + `CliIdCliente` (PK).

**`ArticuloProveedores`** — `ProIdProducto` · `VarianteId` (opcional) · `ProveedorId` · `CodigoProveedor` · `UnidadId` · `UltimoPrecio` · `MonIdMoneda` · `PlazoEntregaDias` · `CantidadMinima` · `EsHabitual`.

**`ArticuloCostos`** — `VarianteId` PK · `CostoUltimo` · `CostoPromedio` · `CostoEstandar` · `MonIdMoneda` · `FechaUltimo` · `Origen`.

**`ArticuloComponentes`** — `ComponenteId` PK · `ProIdProducto` (padre) · `HijoProIdProducto` · `HijoVarianteId` (vacío = se elige en el pedido) · `Tipo` (MATERIAL / AVIO / ACCESORIO / COMPONENTE) · `Cantidad` · `UnidadId` · `MermaPct` · `Obligatorio` · `Cobro` · `DepId` · `EsDefault` · `VariaPorTalle`. **`ArticuloComponentesTalle`** — `ComponenteId` + `Talle` (PK) · `Cantidad` · `HijoProIdProducto` (si el artículo cambia por talle). Es lo que hoy hacen `ProductoAvios.VariaPorTalle` + `ProductoAviosTalle`, generalizado a cualquier componente.

**`Reservas`** — `ReservaId` · `VarianteId` · `DepId` · `Cantidad` · `RefTipo` · `RefId` · `Estado` · `Fecha`.

**`Impuestos`** — `ImpuestoId` · `Nombre` · `Tasa` · `CuentaVentasCod` · `CuentaComprasCod` · `IndFactDGI`.

**`PerfilesContables`** — `PerfilContableId` · `Nombre` · `CuentaIngresosCod` · `CuentaDevolucionesCod` · (para después: `CuentaCostoVentasCod`, `CuentaInventarioCod`, `CuentaComprasCod`).

**`DocumentosContablesDetalleReparto`** — `DcdIdDetalle` · `ProIdProducto` del componente · `CuentaIngresosCod` · `Importe`.

## 1.4 Tablas que cambian: qué se les agrega

| Tabla | Se agrega | Se quita al final |
|---|---|---|
| `PreciosBase` | `VarianteId`, `UnidadId` (vacíos = todas / base), `VigenteDesde`; único por artículo + variante + unidad + moneda | `CodArticulo`, `Moneda` (texto) |
| `PerfilesItems`, `PreciosEspecialesItems` | `VarianteId`, `UnidadId`, `CategoriaId` | `CodGrupo`, `CodArticulo` |
| `Wms_Variantes` | `ProIdProducto` obligatorio con relación, `EsUnica`, `CodigoBarras` | `Talle`, `Color`, `Costo`, `Moneda` (pasan a atributos y costos) |
| `Wms_Etiquetas` | `PropietarioCliId`, `LoteProveedor`, `AnchoReal`, moneda del costo | — |
| `Wms_Movimientos` | `CostoUnitario`, `UnidadId`, `OrdenId` | — |
| `Wms_Depositos` | `AreaId` | — |
| `Wms_Proveedores` | `Rut`, `CondicionPagoId`, `MonIdMoneda`, `CuentaContableCod`, contacto | — |
| `Wms_Compras` | `NumeroComprobante`, `FechaComprobante`, `Neto`, `Impuestos`, `Total` | — |
| `Wms_ComprasDetalle` | `UnidadId`, `Factor`, `CantidadBase`, `ImpuestoId` | — |
| `ProductoVentaConfig` | — (ya tiene `PadreProIdProducto`, `ModeloClave`, `AMedidaJson`, `TizadaMesasModo` desde octubre) | `UM`, `Estado`, `EsCombo`, `OrigenTipo`, cantidades, `ValidarStock`, casillas de canal, `PadreProIdProducto` (pasan al artículo) |
| `ProductoTerminadoServicios` | `ServicioProIdProducto`, `TiempoEstandarMin` (para Costura se calcula sumando los `TiempoMin` de los pasos de la ficha) | — |
| `TiendaProductos` | `Destacado`, `Slug`, `FiltroLanding` | `Publicado`, `TipoVitrina`, `EnLista*`, `TituloVenta` |
| `DocumentosContablesDetalle` | `ImpuestoId`, `TasaIva`, `CuentaIngresosCod`, `VarianteId`, `UnidadId`, `CantidadBase` | — |
| `PedidosCobranzaDetalle` | `VarianteId`, `UnidadId`, `Factor`, `CantidadBase` | deja de guardar el id de variante en `CodArticulo` |
| `EgresosCaja`, `TesoreriaCheques` | `ProveedorId` | `EgrProveedor` (texto), `IdProveedorDestino` (número suelto) |
| `Cont_PlanCuentas` | `CueCodigoContador` | — |
| `Unidades` | `Codigo`, `Magnitud`, `CodigoDGI`, `Decimales` | — |

---

# PARTE 2 — Qué cambia en los procesos de hoy

Para cada proceso: qué nota la persona, qué sigue igual y cuánto código lo toca (archivos de backend / frontend que usan lo que cambia).

## 2.1 Procesos de administración (no tocan la planta)

| Proceso | Qué cambia para quien lo usa | Qué sigue igual | Código afectado |
|---|---|---|---|
| **Alta y edición de artículos** | Una sola pantalla con pestañas (general, unidades, variantes, precios, proveedores, canales, contabilidad, fabricación). Se elige la familia en un árbol. Se cargan nombre interno y comercial y se marcan los roles | El número de artículo no cambia | `Articulos`: 46 archivos de backend lo leen. Pantallas: `ProductsIntegration.jsx`, `StockArtEditModal.jsx`, `NuevoProductoTerminadoModal.jsx` |
| **Nomenclador (familias)** | Pasa de una lista de 3 niveles a un árbol. Unidad, IVA y cuenta se cargan en la familia y bajan solos | Los códigos actuales (1.1.3.2…) se conservan como código de la familia | `StockArt`: 19 back / 11 front. `CodStock`: 21 / 10 |
| **Precios base** | Precio general + lista corta de excepciones por variante o por unidad. La moneda se elige en el precio, no en el artículo | Perfiles, escalonados y precios especiales por cliente | `PreciosBase`: 17 / 7. `CodArticulo` en pantallas de precios: `PriceProfiles.jsx`, `SpecialPrices.jsx`, `BasePrices.jsx` |
| **Lista pública y marketing** | Se decide por canal qué se muestra. La lista pública sale del precio base, sin hoja de cálculo intermedia | Fotos, vidriera, orden | `EnLista*`: 4 / 2. `PreciosListaPublica`: 5 / 0. `TiendaProductos`: 4 / 1 |
| **Compras** | Al comprar se elige unidad (rollo) y el sistema convierte a la unidad base (metros). Se carga comprobante e IVA. El proveedor sale de una lista única | El circuito de compra, importación, costos extra y recepción | `Wms_Compras*`: 2 / pantalla `StockGestionPage.jsx` |
| **Egresos de caja y cheques** | El proveedor se elige de la lista en vez de escribirlo | El resto del egreso | `EgrProveedor`/`IdProveedorDestino`: 3 / 2 |
| **Facturación** | Cada línea toma el IVA y la cuenta de su artículo. Sale el nombre comercial. Una línea exenta queda exenta (hoy se convierte en 22 %) | Tipos de documento, numeración, envío a DGI, cuenta corriente | IVA fijo: 10 archivos de backend, 44 usos. `DcdNomItem`: 8 / 8 |
| **Asientos** | El asiento de una factura abre los ingresos por familia y el IVA por tasa | El motor de eventos; los asientos ya hechos no se tocan | `Cont_ReglasAsiento`: 5 / 1 |
| **Reportes por sector y área** | Salen de la familia del artículo. Deberían dar lo mismo que hoy; se verifica antes de cambiar | Los reportes | `ArticuloClasificacion`: 2 / 1. `SectorMapeo`: 2 / 1 |

## 2.2 Procesos comerciales

| Proceso | Qué cambia | Qué sigue igual | Código afectado |
|---|---|---|---|
| **Venta de mostrador y tienda** | Selector de unidad cuando el artículo tiene más de una (metro / rollo). El precio de la variante sale del precio base. Se **reserva** stock al vender. Si el artículo lo exige, no deja vender sin stock | Carrito, cobro, retiro | `wms_variante_id`: 20 / 10. `precio_excepcion`: 3 / 3. Pantallas: `WmsOrderPage.jsx`, `TiendaView.jsx`, `CajaVentaDirectaTab.jsx` |
| **Portal del cliente** | Ve solo los artículos de su canal y los habilitados para él | Los formularios por servicio, la subida de archivos | `OrderForm.jsx`, catálogo en `nomenclatorsRoutes.js` y `webOrdersController.js` |
| **Pedido interno y solicitudes** | El producto trae su ficha de fabricación desde el artículo; los procederes apuntan a su artículo de servicio (hoy escritos en el código). Las variantes por modelo y los productos a medida entran como artículos normales | La forma del formulario; la solicitud de vendedor y la solicitud desde el portal (origen PORTAL) | `ProductoVentaConfig`: 9 / 3. `prendasOrdersController.js`, `PrendaOrderForm.jsx`, `pedidoPortalService.js`, servicios de solicitudes |
| **Configurador de productos** | Pasa a ser las pestañas "Fabricación", "Variantes por modelo", "A medida", "Costuras", "Avíos" de la ficha única. Lo hecho en octubre (variantes, a medida, pasos de costura, avíos por talle) **se conserva tal cual**; solo cambia dónde se entra | Los pasos actuales, los códigos `FAM-ETQ-NN`, la copia padre → variante | `configuradorController.js` (2.100 líneas), `productoVariantes.js`, `tizadaProAMedida.js`; `ConfigurarProductosPage.jsx`, `ConfiguradorVariantes.jsx`, `ConfiguradorAMedida.jsx`, `ConfiguradorPasosCostura.jsx`, `ConfiguradorAviosTalle.jsx` |
| **Cotización de pedidos** | El motor agrega dos pasos (variante y unidad). Para lo que hoy tiene un solo precio, el resultado es idéntico | Todo lo demás del motor | `pricingService.js`, `erpSyncService.js` |

## 2.3 Procesos de planta

| Proceso | Qué cambia | Qué sigue igual | Código afectado |
|---|---|---|---|
| **Órdenes, bandejas, control, remitos** | **Nada** en las primeras etapas. Leen el artículo por su número, que no cambia | Todo | — |
| **Control de medida al subir archivos** | El ancho y largo imprimible se leen de la ficha técnica en vez de `Articulos` | La regla de control | `anchoimprimible…`: 7 / 3 |
| **Cálculo de magnitud (metros, m², unidades)** | Sale de "cotiza por" de la familia en vez de `TipoStock` | El resultado | `TipoStock`: 10 / 7 |
| **Bobinas, recepción de tela, tela del cliente** | Primero solo se **enlaza** cada insumo con su artículo: nadie nota nada. Pasar las bobinas al modelo de lotes es la última etapa, opcional | Las pantallas de inventario, recepción y rollos | `InsumoID`: 15 / 8. `InventarioBobinas`: 21 / 4 |
| **Stock de mercadería** | Las variantes pasan a ser del artículo: desaparece "vincular con el WMS". El movimiento guarda costo | Depósitos, lotes, remitos internos, conteos | `Wms_Variantes`: 5 archivos |
| **Consumo de insumos** | Con la receta, el consumo previsto de una orden se conoce de antemano | El descuento manual sigue disponible | etapa final |

## 2.4 Integraciones y datos históricos

- **API externa de pedidos y sincronización con el sistema viejo:** `IDProdReact` se conserva (15 archivos de backend lo usan). No cambia.
- **Datos históricos:** las líneas viejas de pedidos y facturas no se reescriben. Las columnas nuevas quedan vacías en lo anterior.
- **WMS externo:** el código todavía lo puede leer (5 archivos). Con el WMS propio en producción, ese camino se retira en la limpieza final.

## 2.5 Lo que la gente va a hacer distinto, en corto

1. Dar de alta un artículo en un solo lugar.
2. Elegir la familia en un árbol.
3. Cargar precios como "general + excepciones".
4. Elegir unidad al comprar y al vender, cuando haya más de una.
5. Elegir proveedor de una lista.
6. Decidir por canal y por cliente qué se muestra.
7. Ver el IVA y la cuenta que tomó cada línea de factura.

---

# PARTE 3 — Plan de upgrade

## 3.1 Cómo se hace sin frenar la operación

Regla general, en tres tiempos por cada cambio:

1. **Agregar** — se crean tablas y columnas nuevas. Nadie las lee todavía. El sistema sigue igual.
2. **Mudar** — se copian los datos y se mantiene lo viejo y lo nuevo **sincronizados** (lo viejo se sigue llenando solo). Las pantallas y procesos pasan a leer lo nuevo de a uno.
3. **Quitar** — recién cuando nadie lee lo viejo, se elimina.

Herramientas que acompañan todo el plan:

| Herramienta | Para qué |
|---|---|
| Vista `vw_ArticuloEfectivo` | devuelve cada artículo con todo ya resuelto (familia, unidad, impuesto, cuenta, área, sector heredados). Los lectores nuevos usan la vista y no repiten la lógica |
| Servicio único de artículos en el backend | un solo lugar que da de alta, modifica y consulta. Hoy `Articulos` se escribe desde varios controladores |
| Columnas viejas sincronizadas | `CodStock`, `Grupo`, `SupFlia`, `UniIdUnidad`, `Mostrar` se siguen llenando solas desde lo nuevo, así los 46 archivos que hoy las leen no se rompen |
| Interruptores de configuración | cada comportamiento nuevo (precio por variante, IVA por artículo, reservas) se enciende con un valor de configuración y se puede apagar |
| Modo sombra | para precios y asientos: el sistema calcula con la regla nueva **sin grabarla** y la compara con la vieja. Se enciende de verdad cuando coinciden |
| Diagnóstico por etapa | un script de solo lectura que se corre en producción antes de cada etapa |

Forma de trabajo (la de siempre): scripts SQL que se pueden correr dos veces sin efecto, probados en local; vos los corrés en producción; sin commits de mi parte.

## 3.2 Las etapas, de menor a mayor impacto

| # | Etapa | Toca la planta | Riesgo | Tamaño |
|---|---|---|---|---|
| 0 | Saneo de datos | no | bajo | chico |
| 1 | Cimientos invisibles | no | bajo | mediano |
| 2 | Ficha única y árbol de familias | no | bajo | mediano |
| 3 | Unidades y precios por variante y unidad | no | medio | mediano |
| 4 | Canales y clientes habilitados | no | bajo | chico |
| 5 | IVA e ingresos por familia | no | medio-alto (fiscal) | mediano |
| 6 | Variantes dentro del maestro | depósito | medio | mediano |
| 7 | Proveedores y costos | no | bajo | mediano |
| 8 | Insumos al maestro | sí, al final | bajo → alto según sub-etapa | chico → grande |
| 9 | Receta, procederes y costo estándar | pedidos | medio | grande |
| 10 | Limpieza | — | bajo | chico |

Las etapas 0 a 5 no cambian nada de lo que usa la planta. Cada etapa se puede dejar en producción y parar ahí.

### Etapa 0 — Saneo de datos

- **Objetivo:** que los datos se puedan migrar sin arrastrar errores.
- **Qué se hace** (números al 14-oct, sobre la copia de producción del 07-oct): corregir 3 códigos repetidos; darles familia a los artículos sin familia o con familia inexistente (7 + 43); tipo a las 14 familias sin tipo; unidad a los **129** artículos sin unidad; resolver las monedas contradictorias (11 precios y 24 artículos); revisar los 58 artículos visibles sin precio; decidir qué se hace con los 49 artículos `PR-…` que el padre + variantes reemplaza; armar la lista de pares insumo ↔ artículo para que la revises (el cruce por código no es confiable: 76 insumos no cruzan con nada).
- **Poner producción al día con el configurador:** antes de cualquier etapa hay que correr en producción los SQL de octubre que solo están en local (costuras paso a paso, avíos por talle, variantes, a medida, mesas TIZADA, solicitudes portal, envíos TIZADA) y los pendientes del 02-oct (accesorios 2c, áreas 2e, requisitos 2f y 2g). Primero un diagnóstico de solo lectura que diga cuáles faltan.
- **SQL:** `scripts/diagnostico_fase0_maestro_articulos.sql` (ya está) + un script de corrección por cada grupo, con la lista caso por caso para que la apruebes.
- **Back / front:** nada. Aparte, dos arreglos sueltos que conviene meter ya: las rutas `/api/stock` y `/api/insumos` no piden sesión.
- **Qué nota la gente:** nada.
- **Vuelta atrás:** cada script guarda los valores anteriores en una tabla de respaldo.

### Etapa 1 — Cimientos invisibles

- **Objetivo:** tener la estructura nueva creada y llena, sin que nadie la use.
- **SQL:** crear `ArticuloCategorias`, `ArticuloUnidades`, `ArticuloFichaTecnica`, `Atributos`, `Impuestos`, `PerfilesContables`, `Canales`, `ArticuloCanales`, `ArticuloAudiencia`; agregar las columnas nuevas a `Articulos` y `Unidades`; copiar: familias desde `StockArt`, unidad base desde las cuatro fuentes actuales, roles desde `TipoStock` y desde la existencia en el WMS y en `Insumos`, canales desde `Mostrar` / `EnLista*` / `TiendaProductos`; crear la vista `vw_ArticuloEfectivo`; dejar la sincronía entre columnas viejas y nuevas.
- **Back:** servicio único de artículos (nuevo). Los cuatro lugares que hoy crean artículos (`productsIntegrationController.js`, `configuradorController.js`, `stockArtController.js`, alta de producto de stock) pasan a crear por el servicio, que llena lo viejo y lo nuevo.
- **Front:** nada.
- **Qué nota la gente:** nada.
- **Verificación:** un script que compara, artículo por artículo, que lo nuevo dice lo mismo que lo viejo.
- **Vuelta atrás:** las tablas nuevas se pueden borrar; lo viejo no se tocó.

### Etapa 2 — Ficha única y árbol de familias

- **Objetivo:** que los artículos se administren en la estructura nueva.
- **Back:** `productsIntegrationController.js` (11 usos de `Articulos`, 26 de medidas), `stockArtController.js` (49 usos de `StockArt`) y `nomenclatorsRoutes.js` pasan a leer y escribir por el servicio y la vista.
- **Front:** `ProductsIntegration.jsx` se convierte en la ficha con pestañas (general, unidades, ficha técnica; las demás pestañas se van sumando en las etapas siguientes). `StockArtEditModal.jsx` pasa a ser el editor del árbol. `NuevoProductoTerminadoModal.jsx` y `ConfigurarProductosPage.jsx` eligen familia en el árbol. El configurador (producción principal, técnicas, molde, variantes por modelo, a medida, ficha de diseño con pasos de costura y avíos por talle) **no se reescribe**: se abre como la pestaña "Fabricación" de la ficha única para los artículos marcados "se fabrica". El árbol ya existe en parte: Familia → Etiqueta → padre → variantes del 12-oct es la primera rama; el árbol nuevo lo generaliza a todas las familias.
- **Qué nota la gente:** administración ve la pantalla nueva; aparecen nombre comercial, roles y estado.
- **Riesgo:** bajo. Las columnas viejas siguen llenas, así que portal, pedidos, cotización y planta no se enteran.
- **Vuelta atrás:** volver a la pantalla anterior; los datos viejos siguen al día.

### Etapa 3 — Unidades y precios por variante y unidad

- **Objetivo:** vender el papel por rollo o por metro; el short verde S a otro precio.
- **SQL:** `PreciosBase` + `VarianteId`, `UnidadId`, `VigenteDesde` y la clave única nueva; `PerfilesItems` y `PreciosEspecialesItems` + las columnas opcionales; pasar `precio_excepcion` a `PreciosBase`; `PedidosCobranzaDetalle` + variante, unidad, factor y cantidad base; activar el historial de precios.
- **Back:** `pricingService.js` (resolución en cuatro pasos y `setBasePrice` con variante y unidad); `pricesController.js`, `profilesController.js`, `specialPricesController.js`; quienes hoy escriben precio por su cuenta pasan al servicio: `configuradorController.js` (9 usos), `stockArtController.js` (7), `productsIntegrationController.js`; lectores con su propio JOIN a `PreciosBase`: `tiendaController.js`, `wmsController.js`, `prendasOrdersController.js`, `cajaService.js` (hoy consulta primero la lista pública); `logisticaWmsController.js` y `wmsInternoService.js` descuentan stock en cantidad base.
- **Front:** `BasePrices.jsx` (precio general + excepciones), `PriceProfiles.jsx`, `SpecialPrices.jsx`, `MarketingPreciosPage.jsx`; selector de unidad en `WmsOrderPage.jsx`, `TiendaView.jsx` y `CajaVentaDirectaTab.jsx`; pestaña "Unidades" y "Precios" en la ficha.
- **Protección:** interruptor + modo sombra. Antes de encender se recalculan los pedidos de los últimos días con el motor nuevo y tienen que dar **exactamente** lo mismo.
- **Cambio de unidad base de un artículo con stock** (lonas y vinilos, hoy en "rollos"): se hace artículo por artículo, convirtiendo sus lotes, cuando se necesite. No es masivo.
- **Productos a medida** (13-oct): hoy se cobran por unidad; con el precio por unidad de medida se cobran por m² o por metro de la medida que puso el cliente. Es el caso de prueba de esta etapa para los fabricados.
- **Qué nota la gente:** precios con excepciones; selector de unidad en la venta.
- **Vuelta atrás:** apagar el interruptor; las filas nuevas con variante o unidad se ignoran.

### Etapa 4 — Canales y clientes habilitados

- **Objetivo:** decidir por canal y por cliente qué se muestra.
- **Back:** los listados de catálogo de cada canal filtran por `ArticuloCanales` y `ArticuloAudiencia`: tienda (`tiendaController.js`, 24 usos de `EnLista*`), lista pública (`pricesController.js`, `server.js`), portal (`nomenclatorsRoutes.js`, `webOrdersController.js`), interno (`prendasOrdersRoutes.js`, `wmsController.js`). Además, validar al **crear** el pedido que el cliente pueda pedir ese artículo, no solo ocultarlo.
- **Front:** pestaña "Canales" en la ficha; `MarketingProductosPage.jsx` y `MarketingPreciosPage.jsx`; se retiran las tres casillas de `ConfigurarProductosPage.jsx`.
- **Armable en la tienda** (12-oct): es una visibilidad más del canal TIENDA ("se vende" / "el cliente lo arma"); la audiencia por cliente vale también para lo armable.
- **Se hace canal por canal:** tienda → lista pública → interno → portal.
- **Vuelta atrás:** por canal, con su interruptor.

### Etapa 5 — IVA e ingresos por familia

- **Objetivo:** cada línea con su impuesto y su cuenta de ingresos; nombre comercial en la factura.
- **Antes de empezar:** el contador define las cuentas de ingreso por familia y qué familias llevan tasa mínima o son exentas.
- **SQL:** cargar `Impuestos` y `PerfilesContables`; asignarlos a las familias; cuentas nuevas en el plan; columnas nuevas en `DocumentosContablesDetalle`; tabla de reparto de combos; reglas con las cuentas comodín.
- **Back:** un solo cálculo de impuestos que reemplaza los 44 usos de IVA fijo en 10 archivos (`cajaService.js` 13, `cajaController.js` 9, `webOrdersController.js` 6, `contabilidadCore.js` 6, `contabilidadService.js` 4, `prendasOrdersController.js` 2, `cfeController.js`); `motorContable.js` y `contabilidadCore.js` resuelven ingreso e IVA por línea; `sisnetService.js` envía la tasa mínima y la unidad real; `libroContadorService.js` usa la equivalencia del plan; `areaLineaService.js` y `contabilidadReportesController.js` leen área y sector de la familia.
- **Front:** `FacturacionManualModal.jsx` (el IVA sale del artículo; se puede cambiar con permiso), `CfePreviewModal.jsx`, `CfePreviewDgiModal.jsx`, `CfeNotaCreditoModal.jsx`, `CierreCicloPreviewModal.jsx`, `ContabilidadCuentasView.jsx`, `ContabilidadMotorReglasAdmin.jsx`, `pdfGenerator.js`; pantallas nuevas de Impuestos y Perfiles contables.
- **Primer paso, aparte y urgente:** corregir el error que convierte una línea exenta en 22 %.
- **Protección:** modo sombra un mes: se calcula el asiento nuevo al lado del viejo y se compara. Se enciende al inicio de un mes, por empresa.
- **Riesgo:** medio-alto, porque es lo que se informa a DGI. Por eso va después de las etapas que no tocan dinero.
- **Vuelta atrás:** apagar el interruptor; los documentos ya emitidos quedan como salieron.

### Etapa 6 — Variantes dentro del maestro

- **Objetivo:** que la variante de **stock** (talle / color) sea parte del artículo y desaparezca el vínculo por nombre. Las variantes por **modelo** del configurador no se tocan: siguen siendo artículos con padre. Un short de stock "Cuello V" (modelo) puede tener a su vez talles y colores (variantes de stock): las dos cosas conviven.
- **SQL:** completar `Wms_Variantes.ProIdProducto` y hacerlo obligatorio; crear la variante "única" real para los artículos sin variantes; pasar talle y color a atributos; dejar las tablas puente como vistas.
- **Back:** `wmsController.js` (11 usos de las tablas puente, 21 de variante), `tiendaController.js` (11), `productsIntegrationController.js` (13; se retira "vincular con el WMS"), `configuradorController.js` (5 + 23), `logisticaWmsController.js`, `prendasOrdersRoutes.js`, `utils/variantesEjes.js`, `wmsInternoController.js` y `wmsInternoService.js`; `prendasOrdersController.js` (38 usos de variante) solo cambia de dónde lee.
- **Front:** pestaña "Variantes" en la ficha; `StockGestionPage.jsx` (alta de producto de stock); `WmsOrderPage.jsx`, `TiendaView.jsx`, `ConfigurarProductosPage.jsx`, `PrendaOrderForm.jsx`, `WmsLogisticsPage.jsx`, `WmsReceiveSalesView.jsx`, `SolicitudVendedorForm.jsx` leen la variante del maestro.
- **Reservas:** se suman acá, con su interruptor.
- **Riesgo:** medio; toca el descuento de stock de las ventas. Se prueba con el depósito de ventas antes de extender.
- **Vuelta atrás:** las vistas de compatibilidad mantienen funcionando el código anterior.

### Etapa 7 — Proveedores y costos

- **Objetivo:** proveedor único; último costo y promedio; margen.
- **SQL:** ampliar `Wms_Proveedores`; `ArticuloProveedores`; `ArticuloCostos` con carga inicial desde el costo de variante y de los lotes; columnas nuevas en compras y movimientos.
- **Back:** `wmsInternoController.js` (37 usos de compras, 8 de proveedores), `wmsInternoService.js` (la recepción actualiza costos y convierte moneda; el egreso guarda el costo del lote); `cajaController.js` (18 usos de proveedor en texto), `tesoreriaController.js`, `pdfService.js`.
- **Front:** `StockGestionPage.jsx` (compra con unidad, comprobante e IVA); `VoucherEgresoModal.jsx` y `ChequeEmitirModal.jsx` (proveedor de la lista); pestañas "Proveedores" y "Costos" en la ficha; reporte de margen.
- **Riesgo:** bajo; agrega datos, no cambia reglas.

### Etapa 8 — Insumos al maestro

En tres sub-etapas, de menor a mayor. Se puede parar en cualquiera.

| Sub-etapa | Qué | Toca la planta | Riesgo |
|---|---|---|---|
| 8a | Enlazar cada insumo con su artículo (`Insumos.ProIdProducto`), con la lista de pares que aprobaste en la etapa 0. Nada más | no | bajo |
| 8b | El alta y la edición de insumos pasan a la ficha del artículo; `Insumos` queda como vista. Las pantallas de bobinas siguen igual | casi no | medio |
| 8c | Las bobinas pasan al modelo de lotes y depósitos | **sí** | alto |

- **Back (8b):** `insumosController.js`, la parte de catálogo de `inventoryController.js`, `areasController.js`.
- **Back (8c):** `inventoryController.js` (84 usos), `rollsController.js`, `receptionController.js`, `telaClienteController.js`, `telaClienteDevolucionFisicaService.js`, `machineControlController.js`, `logisticsController.js` y los creadores de pedidos: 21 archivos usan `InventarioBobinas`.
- **Front (8b):** `InsumosCatalogPage.jsx`, `ConfigInsumosModal.jsx`. **(8c):** `InventoryPage`, `ReceptionPage.jsx`, `AddStockModal.jsx`, las vistas de tela del cliente.
- **Recomendación:** hacer 8a y 8b. Con eso ya hay una sola lista y el insumo tiene costo. **8c dejarla para cuando todo lo demás esté firme**: es la única etapa que cambia cómo trabaja la planta todos los días.

### Etapa 9 — Receta, procederes y costo estándar

- **Objetivo:** que cada producto a pedido y cada combo tenga su receta y su costo; un solo lugar para "lo que lleva".
- **SQL:** `ArticuloComponentes` (+ `ArticuloComponentesTalle`) con los datos de combos, accesorios, avíos (con sus valores por talle del 09-oct) y telas; `ServicioProIdProducto` en los procederes; las columnas que pasan de `ProductoVentaConfig` al artículo.
- **Costo estándar de mano de obra:** ya hay base: los pasos de costura tienen tiempo en minutos (05-oct). Costo de Costura = suma de minutos × costo hora del puesto. Para las demás áreas, `TiempoEstandarMin` del proceder.
- **Variantes por modelo:** la receta de una variante nace copiada del padre (como el resto de su ficha) y se edita aparte; si el padre pierde un componente, se poda en las variantes (misma regla que hoy).
- **Back:** `configuradorController.js` (26 usos de las cuatro tablas, 25 de la ficha), `prendasOrdersRoutes.js`, `wmsStockService.js` (descuento de combos), `tiendaController.js`, los servicios de solicitudes de vendedor, `logisticaWmsController.js`, `prendasOrdersController.js`, `fichaPedidoPdf.js`; cálculo del costo estándar.
- **Front:** `ConfigurarProductosPage.jsx` (un solo paso "Qué lleva"), `PrendaOrderForm.jsx`, `SolicitudVendedorForm.jsx`.
- **Se cruza con** el armador de pedidos de la propuesta del 29-sep (su fase F3): conviene hacerlas juntas, porque tocan los mismos archivos.
- **Riesgo:** medio; toca la creación de pedidos. Con interruptor por tipo de producto.

### Etapa 10 — Limpieza

Cuando ya nadie lee lo viejo: quitar de `Articulos` las columnas que se mudaron; convertir `StockArt`, `ArticuloClasificacion`, `PreciosListaPublica` e `Insumos` en vistas definitivas o eliminarlas; borrar las tablas puente, los restos del sistema anterior y el camino al WMS externo; declarar las relaciones que falten.

## 3.3 Qué se puede hacer en paralelo y qué no

- 0 → 1 → 2 van en orden; son la base.
- Después de la 2, las etapas **3, 4, 5 y 7** son independientes entre sí: se pueden ordenar según lo que más te urja.
- La **6** conviene antes de la 9.
- La **8a** puede ir en cualquier momento después de la 0.
- La **10** siempre al final.

## 3.4 Qué queda fuera de este plan

Inventario contable permanente (cuando compras y costos sean confiables), cuentas por pagar, conciliación bancaria, cierre de período, terceros unificados y la migración de ECOUV. Están en `docs/COMPARACION_ERP_que_falta_por_modulo.md` con su prioridad.

## 3.5 Lo que necesito para arrancar

1. Tu OK para empezar por las etapas 0 y 1.
2. Correr en producción `scripts/diagnostico_fase0_maestro_articulos.sql` y pasarme el resultado: los números de este documento son de local.
3. Con el contador, para la etapa 5: cuentas de ingreso por familia y qué familias no llevan IVA básico.
4. Confirmar los dos caminos para el producto hecho para un solo cliente.
