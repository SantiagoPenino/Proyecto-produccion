# Propuesta: un solo modelo de producto (nomenclador + configurador + pedidos)

Fecha: 29-sep-2026. Base: relevamiento completo del código y la base local (3 barridos: tablas/columnas, caminos que crean pedidos, canales/pantallas). Objetivo pedido: **lo más funcional posible, general y genérico**, sobre lo que ya existe. No se propone borrar nada que funcione: se propone que las piezas que hoy están duplicadas converjan en una, y que los pedidos las lean desde un solo lugar.

---

## 1. Qué hay hoy (diagnóstico en una página)

### 1.1 Dos modelos de "producto terminado" que no se hablan

| | ECOUV (cuadros canvas, roll ups, pasacalles) | Configurador (prendas, banderas, combos) |
|---|---|---|
| Clave | `CodArticulo` (texto, **no único**) | `ProIdProducto` |
| Ficha | `ProductosTerminados` (AnchoM, AltoM, BordeCm, MaterialCodArticulo, Tinta) | `ProductoVentaConfig` + `ProductoFichaDiseno` + molde TizadaPro |
| Qué incluye | `ProductoTerminadoTerminaciones` (terminación × cantidad × ubicación) | `ProductoTerminadoServicios` (área, Obligatorio, Modo, Cobro) + `ProductoApliques` (área, opción, pieza, cantidad, Incluido) |
| Material | un material de impresión (`MaterialCodArticulo`) | lista de telas ofrecidas (`ProductoTelas`) |
| Editor | 2 pantallas para la misma ficha (ProductsIntegration + NuevoProductoTerminadoModal) | ConfigurarProductosPage |
| Lo lee al pedir | portal ECOUV y pedido interno (código copiado) | solicitudes de vendedor; el pedido interno solo `Obligatorio` |

Los dos cuelgan del mismo disparador (`StockArt.TipoStock = PRODUCTO_TERMINADO` → precio cerrado por unidad, candado de retiro WMS) y del mismo endpoint de listado.

### 1.2 Lo que se le "agrega" a un producto existe en 5 formas
Terminación (ECOUV) · Servicio/técnica por área · Opción de técnica · Aplique · Avío. Son dos ideas: **un trabajo que se hace sobre el producto** (terminación = aplique = servicio con opción, cantidad, ubicación, cobrado o incluido) y **un insumo** (avío). Hoy cada una tiene su tabla, su editor y su lector.

### 1.3 Cuatro creadores de pedidos, cada uno con su copia
Portal (`webOrdersController`), pedido interno (`prendasOrdersController`, fork declarado), solicitudes (`pedidosExternos` → llama al interno), tienda (`tiendaController`). Entre ellos: 3 copias del mapa servicio→área, artículos de servicio clavados (Corte 1375, Costura 115/112, Bordado 1567, Estampado 110, matriz TPU 156, recargos bordado 1568/1631), el orden de ruta como `switch` por área, y reglas de UM/medida que existen en uno y no en otro (DIRECTA/CORTE solo en el portal; ModoRetiro solo en el portal; requisito TELA auto solo en el portal). Lo que el configurador escribe y **ningún pedido lee**: `Modo`, `Cobro`, `ProductoTecnicaOpciones`, `ProductoApliques`, `ValidarStock`, `CantidadMinima/Fija` (solo la solicitud).

### 1.4 Nomenclador con tres identidades y ocho clasificaciones
- Identidad: `ProIdProducto`, `IDProdReact` (ERP viejo), `CodArticulo` (duplicado entre grupos: el "28" es Back pet y Rib 1,70). Precios: el motor lee por `ProIdProducto`, pero `upsertPrecioBase` escribe por `CodArticulo` sin moneda.
- Clasificación: SupFlia/Grupo/StockArt.Articulo, `ProductoVentaConfig.Familia` (muerta), `ProductoEtiqueta`, `TiendaProductos.CategoriaVitrina`, `ArticuloClasificacion`, `ConfigMapeoERP.NombreReferencia`, `Wms_Categorias`, `Productos.ProCategoria`.
- Visibilidad: `StockArt.Mostrar`, `Articulos.Mostrar/borrar`, `ProductoVentaConfig.Estado`, `TiendaProductos.Publicado/TipoVitrina`, `EnListaPrecios/EnListaPublica`, más un `Activo` por catálogo.
- Unidad: `StockArt.UM`, `Articulos.UniIdUnidad`, `Areas.UM`, y el override a 'u' por TipoStock.
- Sublimación como supuesto: técnica principal fija en configurador (siembra SB/TWC/TWT), solicitud (telas SB, tizada), validador de pedidos ("Hoy solo Sublimación"), traductor (`idServicioBase: 'sublimacion'`).

### 1.5 Lo que ya es genérico y hay que **conservar** (no reinventar)
`EstadoDependencia` + `LiberaCuandoOrdenID` (7 valores en uso), `pedidoCompletoService`, `LabelGenerationService` (bultos), requisitos por orden, `ServiciosExtraOrden` (línea de cobro/control), `OrdenTerminaciones` + hermana TERMINAC, `erpSyncService.syncFinalOrderIntegration` (único motor de precios, ya cubre PRO madre, hermanas, planes, sin cargo, retiros de combo), `wmsStockService.explotarCombos` + `descontarStockWmsExterno`, `ConfigMapeoERP` (Numero = orden de ruta, CodOrden = prefijo), `Areas.UM`, `uploadOrderFile` (compartido por los 4 caminos), `PricingService`.

---

## 2. La propuesta: 6 decisiones de modelo

### D1. Un producto vendible = una fila de `ProductoVentaConfig`, para TODO lo que se vende como unidad
`ProductosTerminados` (ECOUV) se absorbe en `ProductoVentaConfig`. Columnas que se suman (todas opcionales, con default):

| Columna nueva | Viene de | Para qué |
|---|---|---|
| `TecnicaPrincipal` (AreaID: SB, DIRECTA, ECOUV, DF, EMB…; NULL = no se produce, es stock) | hoy implícito "SB" | qué área hace la producción principal; desbloquea Impresión Directa, ECOUV y cualquier área futura sin tocar código |
| `AnchoM`, `AltoM`, `BordeCm` | `ProductosTerminados` | medida fija del producto (cuadro, bandera, funda). Reemplaza el doble mecanismo `largoimprimible` vs ficha PT |
| `UM` ('u' \| 'm' \| 'm2') | `StockArt.UM` + `UniIdUnidad` + override | cómo se cuenta el producto en la orden. Un solo lugar |
| `MoldeOpcional` (bit) | regla de publicar | con molde TizadaPro (prendas) o sin molde (cuadro, bandera con archivo a medida) |

- `ProductoTelas` pasa a llamarse conceptualmente **"materiales del producto"**: sirve igual para telas de sublimación, tela de bandera, lona, canvas. `EsDefault` = "se imprime en" por defecto. `MaterialCodArticulo` de ECOUV migra ahí (1 fila).
- `Tinta` deja de ser columna: es una **opción de técnica** del área ECOUV/DIRECTA (`TecnicaOpciones`: Ecosolvente, UV con su recargo por perfil 3, que ya existe).
- Los cuadros/roll ups/pasacalles (24 fichas) se migran con un script a `ProductoVentaConfig` + `ProductoTelas` + apliques (ver D2). `ProductosTerminados` queda como vista de compatibilidad hasta apagar los lectores viejos.

### D2. "Lo que se hace sobre el producto" = servicio + opción + aplique. Terminación es un aplique.
- `TecnicaOpciones` gana las columnas de `Terminaciones`: `UnidadCobro` (U/M/M2), `Ubicaciones`, `ReglaCantidad`, `ParamCantidad`, `ClienteElige`. Una terminación ECOUV ("ojales cada 30 cm") = opción de la técnica TERMINAC. Bastidor, palos, soldadura, roll up: ídem. Los recargos de bordado (1568/1631) = opciones de EMB en vez de artículos clavados en el código.
- `ProductoApliques` ya tiene (área, opción, posición, cantidad, incluido): **es** `ProductoTerminadoTerminaciones`. Se migra 1:1 (Posicion ← Ubicacion).
- `MaterialTerminaciones` (qué terminaciones admite cada material) pasa a `MaterialTecnicaOpciones` (material → opción permitida). Mismo dato, clave por opción.
- `ProductoTerminadoServicios` queda como está (área, Obligatorio, Modo, Cobro) y es la **única** lista de técnicas del producto; `ProductoTecnicaOpciones` sigue siendo el recorte de opciones.
- Avíos (`CatalogoAvios`/`ProductoAvios`) siguen aparte: son insumos de la ficha técnica, no se venden ni se cobran.

Resultado: un solo editor de "técnicas / opciones / apliques" en el configurador vale para prendas, cuadros y windflags; `OrdenTerminaciones` se sigue generando igual (lee apliques + opciones).

### D3. Componentes: un producto puede estar hecho de otros (stock o fabricados)
`ProductoComboItems` ya es eso. Se generaliza con dos columnas: `Tipo` ('STOCK' = sale del WMS con `WmsVarianteId`; 'FABRICADO' = es otro producto vendible que se produce) y `Cantidad`. Un windflag = [Bandera (FABRICADO, técnica DIRECTA) + Mástil (STOCK) + Base (STOCK)]. Una estructura de tensión = [Funda (FABRICADO) + Marco (STOCK)]. Un cuadro canvas = producto simple sin componentes (el bastidor es aplique). `EsCombo` deja de ser "otra familia": es "tiene componentes". Se conserva `ProductoComboItemServicios` para técnicas por componente.

### D4. Un solo armador de pedidos, cuatro puertas
Nuevo servicio `armadorPedido` (backend) que recibe **producto + cantidad + elecciones del cliente (material, opciones, archivos, componentes elegidos)** y devuelve la lista de órdenes a crear, con todo resuelto desde la config:
1. Orden **PRO madre de precio** si el producto tiene precio cerrado (hoy existe: variante `FABRICA PRODUCTO TERMINADO` / `COMBO PRODUCTOS`).
2. Orden de la **técnica principal** (`TecnicaPrincipal`) con UM/medida/material del producto — SUB, DIR, EUV, DF… sin `if serviceId === …`.
3. Órdenes de **técnicas activas** (obligatorias + elegidas), cada una con su opción resuelta a `CodArticulo` (de `TecnicaOpciones`), y EST encadenada a DF/TPU como hoy.
4. **Apliques/terminaciones** → `OrdenTerminaciones` + `ServiciosExtraOrden` (incluido = precio 0; aparte = se precia).
5. **Componentes STOCK** → retiros WMS con `ESPERANDO_RETIRO_WMS` (mecanismo actual); FABRICADO → recursión (el componente arma sus propias órdenes con `ComboItemID`).
6. Ruta por `ConfigMapeoERP.Numero` + cadenas TWC←principal, TWT←TWC (hoy `switch` clavado) y gates existentes.

Los cuatro creadores (portal, interno, solicitudes, tienda) llaman al armador y solo se quedan con lo propio de su puerta (auth, archivos, checkout). El mapa servicio→área y los artículos de servicio por área pasan a **`ConfigMapeoERP`** (columnas `ArticuloServicio`, `ServicioPortal`) — es la tabla que ya define áreas, prefijos y orden.

### D5. Nomenclador: una clave, un árbol, una visibilidad
- **Clave**: todo lo nuevo escribe y lee por `ProIdProducto`. `upsertPrecioBase` (configurador, terminaciones, técnicas) pasa a `PricingService.setBasePrice` (ProIdProducto + moneda). `CodArticulo` queda como código humano; `IDProdReact` como puente al ERP viejo.
- **Árbol**: `StockArt` es la familia (SupFlia › Grupo › CodStock) y **la única**; `ProductoEtiqueta` es el "para qué" (Fútbol, Windflag, Estructura de tensión) y puede ser N:1; `TiendaProductos.CategoriaVitrina` es la vidriera comercial. Se apagan `ProductoVentaConfig.Familia` (ya sin uso) y `ArticuloClasificacion` como fuente de área (el área sale de `ConfigMapeoERP` por Grupo). `Articulos.Grupo/SupFlia` se rellenan desde StockArt en `moverArticulo` (hoy quedan viejos).
- **TipoStock** queda como el disparador de comportamiento que ya es, con los 4 valores completos en el editor (falta PRODUCTO_LOCAL en la lista de la pantalla) y CHECK en la base.
- **Visibilidad**: `ProductoVentaConfig.Estado` (BORRADOR/PUBLICADO) + **canales** (`VisiblePortal`, `VisibleTienda`, `VisibleInterno`) reemplazan `TiendaProductos.Publicado/TipoVitrina` y `Articulos.EnLista*`. `StockArt.Mostrar`/`Articulos.Mostrar` siguen siendo del nomenclador (existe/no existe), no del canal.
- **ConfigMapeoERP.CodOrden** y las constantes del front (`'EUV'/'ECOUV'`, `'COR'/'TWC'`, `'DIR'/'IMD'`) se alinean: el front deja de tener su mapa.

### D6. La solicitud de vendedor y el diseñador no cambian de forma, cambian de fuente
La "producción principal" de la solicitud lee `TecnicaPrincipal` del producto: telas/materiales del producto, tizada TizadaPro si hay molde, archivo a medida fija si no lo hay, planilla de talles solo si el producto se define por talle. La conversión llama al armador (D4) → desaparece "Hoy solo Sublimación".

---

## 3. Qué cambia en las pantallas (para que el usuario lo vea)

| Pantalla | Cambio |
|---|---|
| Configurador | Una sola pestaña de productos (Prendas, Banderas, Windflags, Cuadros, Roll ups… por familia de StockArt), sin pestaña "EcoUV" aparte. Pasos: Origen · **Producción principal** (área + materiales + medida fija o molde + UM) · Técnicas y apliques (incluye terminaciones) · Componentes (stock/fabricados) · Precio y cantidades · Ficha técnica · Publicar (estado + canales). Las 2 pantallas ECOUV de ficha PT y "Terminaciones EcoUV" se retiran (sus datos ya migraron). |
| Nomenclador (Editor StockArt) | Igual, con los 4 TipoStock y sin la pestaña Terminaciones (viven en Catálogo de técnicas del configurador). |
| Editar Artículo (ProductsIntegration) | Se queda con lo del artículo (fotos, WMS, unidad, ancho imprimible, precio). El bloque violeta "Producto terminado" se va al configurador. |
| Portal — form por servicio | Pestaña "Productos terminados" en **todos** los servicios (no solo ECOUV), leyendo la misma ficha: medida, material, incluidos, componentes con stock. |
| Portal — tienda | Igual; los combos y personalizables leen la misma config (F3 pendiente se vuelve trivial). |
| Pedido interno (Fabricar a medida / Combos) | Igual de forma; empieza a respetar Modo/Cobro/opciones/cantidades porque el armador las lee. |
| Solicitudes / Diseño | Igual de forma; "Producción principal" según el producto. |

---

## 4. Fases (cada una deja el sistema funcionando)

| Fase | Contenido | Desbloquea |
|---|---|---|
| **F1 — Producción principal genérica** (SQL aditivo + configurador + solicitud + validador/traductor) | `TecnicaPrincipal`, `AnchoM/AltoM/BordeCm`, `UM`, `MoldeOpcional` en `ProductoVentaConfig`; DIRECTA/ECOUV en la lista de técnicas; siembra por área; solicitud y conversión leen la técnica principal; `ConfigMapeoERP.ArticuloServicio`. | **Windflags/fundas por solicitud de vendedor** (archivo pronto o molde). |
| **F2 — Terminación = aplique** (SQL migración + configurador) | `TecnicaOpciones` absorbe `Terminaciones`; `ProductoApliques` absorbe `ProductoTerminadoTerminaciones`; `MaterialTecnicaOpciones`; migración de las 24 fichas ECOUV a `ProductoVentaConfig`; vista de compatibilidad `ProductosTerminados`. | Un solo editor de producto terminado; cuadros canvas dejan de ser caso especial. |
| **F3 — Armador de pedidos** (backend) | `armadorPedido` + los 4 creadores lo usan (primero el interno y solicitudes; después portal y tienda). Mapa servicio→área y artículos por área a `ConfigMapeoERP`. | Modo/Cobro/opciones/cantidades/apliques respetados en TODOS los canales; DIR/EUV/SB sin `if`. |
| **F4 — Componentes en el portal** | `ProductoComboItems.Tipo`; pestaña "Productos terminados" en el form de cada servicio con stock de componentes; tienda F3. | **Windflag completo (bandera + mástil + base) desde el portal**, con retiro WMS y pedido completo. |
| **F5 — Nomenclador** | Claves por `ProIdProducto` en precios, `Articulos.Grupo/SupFlia` sincronizados, CHECK de TipoStock, visibilidad por canales, alineación CodOrden/front, retiro de `ArticuloClasificacion` como fuente de área y de `Familia`. | Menos bugs de datos (precios duplicados por moneda, "28" ambiguo, artículos sin CodStock). |

Orden recomendado: **F1 → F3 (interno + solicitudes) → F2 → F4 → F5**. F1+F3 son las que hacen que lo configurado se cumpla en el pedido; F2 y F4 son las que unifican ECOUV y abren el portal; F5 es limpieza que se puede intercalar.

---

## 5. Lo que NO se toca
Motor de precios (`erpSyncService` + `PricingService`), gates `EstadoDependencia`, WMS (descuento, retiros, bultos, remitos), `pedidoCompletoService`, `uploadOrderFile` y medición, planilla/API de pedidos externos, caja/planes de metros. Todo eso queda igual y el armador se apoya en ello.

## 5b. ¿Cómo sabe el sistema en qué área "nace" un producto terminado?

**Hoy** se deduce del lugar del nomenclador: los cuadros canvas están en StockArt Grupo **1.3** (que `ConfigMapeoERP` mapea a ECOUV), por eso las pantallas de ECOUV clavan `'1.3'` y el portal lista "Productos Terminados" leyendo las variantes de ese grupo. Las prendas están en Grupo 2.x, que **no está en `ConfigMapeoERP`** (por eso no tienen área y el código asume sublimación).

**Propuesta:** el área que produce el producto es un dato del producto, `ProductoVentaConfig.TecnicaPrincipal` (AreaID), no el grupo donde está clasificado. El grupo de StockArt sigue siendo solo la familia (Cuadros canvas, Windflags, Camisetas…). Consecuencias:
- Cada área puede "subir sus productos terminados" como hoy ECOUV: la pantalla de configuración del área (`/area/<x>/config`) pasa a ser el configurador **filtrado por `TecnicaPrincipal` = esa área**, con la técnica preseteada y los materiales de esa área (los de su Grupo en StockArt vía `ConfigMapeoERP`). Directa sube windflags y fundas; ECOUV sube cuadros; Sublimación sube prendas.
- El portal, en el form de cada servicio, lista "Productos terminados" por `TecnicaPrincipal` = área del servicio, no por grupo 1.3.
- Los cuadros canvas pueden quedarse en 1.3 (no hace falta moverlos de familia) hasta que el portal lea por `TecnicaPrincipal` (F4).

## 5c. Molde de TizadaPro: obligatorio, opcional o no lleva

En vez de un bit, `ProductoVentaConfig.Molde` con tres valores, elegido en el paso **Producción principal** del configurador:

| Valor | Quién | Publicar exige molde | Solicitud / portal |
|---|---|---|---|
| `OBLIGATORIO` | prendas confeccionadas (default para SB) | sí (como hoy) | "Piezas y telas" por modelo; tizada en TizadaPro |
| `OPCIONAL` | windflags, fundas, banderas con forma | no | si el producto tiene molde vinculado → piezas y telas + tizada; si no → archivo pronto a medida fija (AnchoM×AltoM) + boceto |
| `NO` | cuadros, roll ups, pasacalles, productos de stock | no; medida fija obligatoria | archivo a medida fija; sin piezas y telas |

Default al crear: `OBLIGATORIO` si `TecnicaPrincipal` = SB, `NO` en el resto; se cambia a mano.

## 5d. Dónde se puede romper algo (y cómo se cubre)

| # | Punto de rotura | Por qué | Cobertura |
|---|---|---|---|
| 1 | `StockArt.TipoStock = PRODUCTO_TERMINADO/PRODUCTO_LOCAL` dispara precio por unidad y candado de retiro WMS en portal e interno | un producto creado en una familia con TipoStock MATERIAL se cotiza por m² | el configurador crea familias con el TipoStock correcto (ya lo hace); CHECK en la base; test de regresión sobre Camisetas y Lonas |
| 2 | Portal ECOUV lee `ProductosTerminados` por CodArticulo con `Activo = 1` (columna que **nadie escribe**) | si la tabla desaparece o cambia la clave, el form ECOUV deja de mostrar productos | F2 deja una **vista** `ProductosTerminados` sobre `ProductoVentaConfig` hasta que el portal lea la fuente nueva (F4) |
| 3 | `OrdenTerminaciones`, bandeja de terminaciones y `hermanaTerminaciones` usan `TerminacionID` numérico y buscan la hermana TERMINAC por `Nota LIKE` | fusionar `Terminaciones` en `TecnicaOpciones` con IDs nuevos rompe órdenes vivas | se conservan los IDs (se insertan en `TecnicaOpciones` con el mismo número) o `Terminaciones` queda como vista; las notas no se tocan |
| 4 | Precios: `upsertPrecioBase` escribe por `CodArticulo` sin moneda; `CodArticulo` no es único ("28" = Back pet y Rib 1,70); tienda/prendas hacen LEFT JOIN a `PreciosBase` sin TOP 1 | un precio cargado desde el configurador puede caer en otro artículo o duplicar filas cuando hay UYU y USD | F5: todo por `ProIdProducto` + moneda vía `PricingService.setBasePrice`; script de detección de duplicados antes |
| 5 | Los creadores igualan `CodArticulo = IDProdReact = ProIdProducto`; el ERP recibe `IDProdReact` con fallback '150'/'82' | colisión de espacios de nombres; un producto nuevo puede facturarse como otro | no cambiar hasta F5; regla: nuevos productos con `IDProdReact` propio |
| 6 | Artículos de servicio clavados en 3 lugares y **distintos** (Costura 115 en portal/interno, **112** en solicitudes; Bordado 1.1.4.1 vs 1.1.9.1) | hoy ya cobran distinto según la puerta | D4 los lleva a `ConfigMapeoERP`; hay que decidir el correcto (decisión 3) |
| 7 | Mapa servicio→área copiado 3 veces (portal, interno, planilla/API con alias) | un área nueva (DIR como principal) hay que agregarla en los 3 o la planilla la manda a 'GENE' | el armador lee `ConfigMapeoERP`; la planilla/API se adapta en F3 |
| 8 | Dorso Twinface: el cálculo de Magnitud compara UM `'ml'` en un lado y `'m'` en otro → el dorso suma 0 metros | bug existente; las fundas doble faz lo van a pisar | corregir en F1 junto con `UM` del producto |
| 9 | Medida fija: tolerancia ±2 mm en portal, cm exactos en solicitudes; la subida busca el artículo por `Descripcion = Material` (nombre) | renombrar un material rompe el control de medida; dos criterios distintos | una sola regla en el armador; buscar por `ProIdProducto` |
| 10 | Publicar CONFECCIONADO exige molde; "Piezas y telas" y el candado de Enviar a Diseño asumen molde | un windflag sin molde no se puede publicar ni enviar a Diseño | `Molde` OBLIGATORIO/OPCIONAL/NO (5c) gobierna las tres reglas |
| 11 | `Articulos.Grupo/SupFlia` quedan viejos al mover un artículo de familia (`moverArticulo` solo cambia CodStock) y los perfiles de precio por grupo (`PerfilesItems 'GRUPO:x'`) leen `Articulos.Grupo` | mover un producto de familia no cambia (o cambia mal) sus reglas de precio | F5: `moverArticulo` sincroniza Grupo/SupFlia; script de reparación de los desfasados |
| 12 | `Ordenes.ComboItemID` guarda dos cosas (id de componente del combo o `wms_variante_id` del carrito) | confundir un retiro de combo con un ítem del carrito al liberar hermanas | D3 no cambia esto; se documenta y el armador usa una sola convención para lo nuevo |
| 13 | `explotarCombos` salta componentes con `WmsVarianteId NULL` ("el cliente elige") y la tienda los cuenta como stock 0 | un windflag con "mástil a elegir" nunca descuenta stock y se oculta en la tienda | en F4 el cliente elige la variante en el pedido y el componente se resuelve antes de crear el retiro |
| 14 | EST se libera solo cuando la orden DF/TPU pasa a "Pronto"; canal EST clavado a DF/TPU/EMB | una técnica nueva encadenada a EST no se libera | el armador conserva la cadena EST tal cual; no se agregan técnicas a EST sin tocar ese punto |
| 15 | `prendaServices.js` (interno) y `services.js` (portal) divergen (variantes virtuales ECOUV distintas) | el mismo producto se ve distinto según la puerta | F3: los dos leen el catálogo de productos, no listas estáticas |
| 16 | Reportes de ventas por sector usan `ArticuloClasificacion.AclArea` | si el área pasa a salir de `TecnicaPrincipal`/`ConfigMapeoERP`, los reportes pueden reclasificar | F5 mantiene `ArticuloClasificacion` para reportes hasta reconciliar; no se borra |
| 17 | `CantidadMinima/CantidadFija` solo las respeta la solicitud | portal y tienda venden 1 unidad de un paquete de 12 | F3: el armador las valida en todas las puertas |

## 5e. Los artículos de servicio clavados, mirados en la base (local, 29-sep)

| Código en el código | Qué es en Articulos | Dónde vive (StockArt) | Uso real (90 días) |
|---|---|---|---|
| Costura **115** (portal, interno) | ProId 36 "Costura" — **y también** ProId 398 "PROMO UNIFORME CAPITONEADA" (sin CodStock): código duplicado | 1.1.7.1 Costura (grupo 1.7 = TWT) | 0 líneas |
| Costura **112** (solicitudes) | **no existe** en Articulos | — | 3 líneas (las solicitudes convertidas): no se precian |
| Corte 1375 | ProId 90 "Corte Laser por prenda" | 1.1.6.1 Corte Laser (TWC) | 3 |
| Estampado 110 | ProId 29 "Estampado" | 1.1.5.1 (EST, UM BAJ) | 0 |
| Bordado 1567 | ProId 434 "Bordado" (oculto) | **1.1.4.9 "Cargos de bordado"** (TERMINACION). El código le pone CodStock `1.1.9.1`, que es "Confección de Indumentaria Deportiva" (grupo 1.9 = PRO, 0 artículos): etiqueta equivocada | 0 |
| Matriz bordado 1568 / relieve 1631 / parche 1632 | ProId 435 / 502 / 503 | 1.1.4.9 Cargos de bordado | 1 / 0 / — |
| Matriz TPU 156 | ProId 417 (15 USD) | 1.1.10.1 TPU | 137 |
| Variantes reales de bordado que elige el cliente | 107 "con tafeta" (ProId 25), 108 "100% hilo" (ProId 26) | 1.1.4.1 "Bordado sobre la prenda" (MATERIAL) | van como artículo de la orden EMB |

Conclusión: la referencia correcta es **por ProIdProducto** (36 Costura, 90 Corte, 29 Estampado, 434 Bordado, 435/502/503 cargos, 417 matriz TPU); 112 es un error del traductor de solicitudes y `1.1.9.1` una etiqueta equivocada. Todo eso pasa a `ConfigMapeoERP.ArticuloServicio` (ProIdProducto).

## 5f. Visibilidad por canales: cómo se configura

`ProductoVentaConfig`: `Estado` (BORRADOR \| PUBLICADO) + `VisiblePortal`, `VisibleTienda`, `VisibleInterno`. Regla: BORRADOR no se ve en ningún lado; PUBLICADO se ve en los canales marcados. `StockArt.Mostrar` / `Articulos.Mostrar` siguen siendo del nomenclador ("existe"), no del canal.

| Quiero que… | Estado | Portal (forms por servicio) | Tienda (e-commerce) | Interno (Fabricar a medida, combos, solicitudes de vendedor) |
|---|---|---|---|---|
| se vea SOLO en el e-commerce | PUBLICADO | ✗ | ✓ | ✗ |
| esté activo en todos lados MENOS en el e-commerce | PUBLICADO | ✓ | ✗ | ✓ |
| lo vendan solo los vendedores | PUBLICADO | ✗ | ✗ | ✓ |
| no se vea todavía | BORRADOR | (ignorado) | (ignorado) | (ignorado) |

Reemplaza `TiendaProductos.Publicado/TipoVitrina` y `Articulos.EnListaPrecios/EnListaPublica`; `TituloVenta`, `DescripcionVenta`, `CategoriaVitrina` y `Orden` de la tienda se quedan (son datos de vidriera, no de visibilidad).

### 5f-bis. Visibilidad en dos tiempos (preparar el terreno, cambiar después)
1. **Ahora (F1):** se agregan las 3 columnas a `ProductoVentaConfig` y el configurador las muestra y las guarda. Nadie las lee todavía. Un **puente** al guardar mantiene lo viejo coherente: `VisibleTienda` → `TiendaProductos.Publicado`. `VisibleInterno`/`VisiblePortal` no tienen flag viejo, así que no hay nada que romper. Backfill inicial: `VisibleTienda` = `TiendaProductos.Publicado`, `VisibleInterno` = 1, `VisiblePortal` = 0.
2. **Después (F3/F4, canal por canal):** interno → tienda → portal pasan a leer su columna. Cuando los tres leen lo nuevo se apaga el puente; `Publicado/TipoVitrina/EnLista*` quedan sin uso (no se borran hasta que se decida).

### 5f-ter. Tinta: DECIDIDO 29-sep — queda para después
La tinta (Ecosolvente/UV) existe solo en ECOUV (columna de la ficha, el cliente la cambia en el portal, UV recarga 25 % por perfil 3). ECOUV queda intacto → la tinta no entra en F1. Directa 3.20 tiene una sola tinta. Se decide al migrar ECOUV (F2): opción de técnica FIJA/LIBRE o columna `Tinta` en `ProductoVentaConfig`.

## 5g. ECOUV intacto hasta el final

Sí: F1, F3 y F4 no tocan ECOUV. `ProductosTerminados`, `Terminaciones`, `MaterialTerminaciones`, `OrdenTerminaciones`, la bandeja de terminaciones, `EcouvConfigPage`, la pestaña EcoUV del configurador y el form ECOUV del portal siguen exactamente como hoy. El modelo nuevo corre para Directa, Sublimación y las áreas que se sumen. F2 (convergencia) va al final, arranca con la vista de compatibilidad y migra los 24 productos cuando se decida.

## 6. Decisiones que necesito antes de F1
1. **Tinta** como opción de técnica (Ecosolvente/UV, recargo por perfil como hoy) — ¿de acuerdo?
2. **Unidad del producto** en `ProductoVentaConfig.UM` como única fuente para productos vendibles (los materiales siguen con `StockArt.UM`/`UniIdUnidad`) — ¿de acuerdo?
3. Los **artículos de servicio por área** (Corte 1375, Costura 115 — el traductor usa 112 —, Bordado 1567, Estampado 110, matriz TPU 156) pasan a `ConfigMapeoERP`: ¿confirmás cuál es el correcto de Costura (112 vs 115) y de Bordado (1.1.4.1 vs 1.1.9.1)?
4. Visibilidad por **canales** en el producto (Portal / Tienda / Interno) en lugar de `TipoVitrina` + `Mostrar` + `EnLista*` — ¿de acuerdo?
