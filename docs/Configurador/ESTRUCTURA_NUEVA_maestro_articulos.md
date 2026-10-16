# Estructura nueva del maestro de artículos — tablas y columnas

Fecha: 02-oct-2026. Es el detalle de base de datos de `PROPUESTA_maestro_articulos_erp.md`. Solo diseño: nada está creado.

Decisiones ya tomadas (02-oct):
- El WMS propio está en producción → las variantes y el stock pueden vivir en el maestro.
- **Una sola lista** de artículos e insumos.
- Contabilidad: cuentas de ingreso e IVA **por familia** ahora; inventario contable permanente más adelante.
- Costeo: valorización por lote, más último costo y costo promedio por variante.
- Artículos restringidos: se habilitan cliente por cliente.
- En la factura sale el nombre comercial (si está vacío, el interno).
- Combos: el ingreso se reparte entre las familias de los componentes.

Cómo leer las tablas: **PK** = clave, **FK** = apunta a otra tabla, **!** = obligatorio. "Hoy" dice de dónde sale el dato. Cuando una tabla ya existe, se indica su nombre actual y no se renombra: se le agregan columnas y relaciones.

---

## 1. Mapa general

```
ArticuloCategorias (árbol)
   └─< Articulos ──────────────< ArticuloUnidades >── Unidades
          │  ├──< ArticuloVariantes ──< VarianteAtributos >── Atributos
          │  │        ├──< PreciosBase (artículo + variante + unidad + moneda)
          │  │        ├──< ArticuloCostos
          │  │        ├──< ArticuloProveedores >── Proveedores
          │  │        └──< Lotes (existencias) >── Depositos ──< MovimientosStock
          │  ├──< ArticuloCanales ──< ArticuloAudiencia >── Clientes
          │  ├──< ArticuloComponentes (receta: materiales y componentes)
          │  ├──< ArticuloProcederes (ruta: áreas y servicios)
          │  ├──1 ArticuloFabricacion (ficha: técnica principal, molde, medidas)
          │  ├──1 ArticuloFichaTecnica (ancho, gramaje, composición)
          │  └──1 ArticuloMarketing + imágenes + etiquetas
          ├── Impuestos            (heredado de la familia)
          └── PerfilesContables    (heredado de la familia)
```

---

## 2. Catálogo

### 2.1 `ArticuloCategorias` — NUEVA (árbol de familias)

| Columna | Tipo | Nota | Hoy |
|---|---|---|---|
| `CategoriaId` PK | int identity | | — |
| `PadreId` FK → sí misma | int null | null = raíz | SupFlia › Grupo › CodStock |
| `Codigo` ! único | varchar(30) | "2.1.16" | `StockArt.CodStock` (sin espacios) |
| `Nombre` ! | nvarchar(120) | | `StockArt.Articulo` |
| `Ruta` | nvarchar(500) | "Productos / Indumentaria / Shorts", calculada | — |
| `Nivel`, `Orden` | int | | — |
| `Naturaleza` | varchar(10) null | BIEN / SERVICIO (heredable) | `StockArt.TipoStock` |
| `UnidadBaseId` FK → Unidades | int null | heredable | `StockArt.UM` |
| `ImpuestoId` FK → Impuestos | int null | heredable | — |
| `PerfilContableId` FK → PerfilesContables | int null | heredable | — |
| `AreaId` FK → Areas | varchar(20) null | área que lo produce | `ConfigMapeoERP`, `ArticuloClasificacion.AclArea` |
| `SectorId` FK → Sectores | varchar(30) null | sector comercial para reportes | `SectorMapeo` |
| `CotizaPor` | varchar(10) null | UNIDAD / SUPERFICIE / LARGO | lo que hoy dispara `TipoStock` |
| `Activa` ! | bit | | `StockArt.Mostrar` |

Regla de herencia: el valor de un artículo es el propio; si está vacío, el de su familia; si está vacío, el del padre, y así hasta la raíz. Se resuelve con una función (`fn_ArticuloEfectivo`) para que nadie repita la lógica.

`StockArt` y `ArticuloClasificacion` quedan como **vistas** sobre esta tabla.

### 2.2 `Articulos` — SE AMPLÍA

| Columna | Tipo | Nota | Hoy |
|---|---|---|---|
| `ProIdProducto` PK | int | no cambia | igual |
| `Codigo` ! único | varchar(30) | código humano | `CodArticulo` (3 repetidos a corregir) |
| `NombreInterno` ! | nvarchar(150) | | `Descripcion` (hoy char(100) con relleno) |
| `NombreComercial` | nvarchar(200) null | null = usar el interno | `TituloVenta`, `DescripcionLista`, nombre WMS |
| `CategoriaId` ! FK | int | | `SupFlia`, `Grupo`, `CodStock` |
| `Naturaleza` | varchar(10) null | BIEN / SERVICIO; null = hereda | `TipoStock` |
| `SeVende` ! | bit | | implícito |
| `SeCompra` ! | bit | | existir en el WMS |
| `SeFabrica` ! | bit | | tener `ProductoVentaConfig` |
| `SeConsume` ! | bit | insumo de producción | existir en `Insumos` |
| `LlevaStock` ! | bit | | existir en el WMS / bobinas |
| `Abastecimiento` ! | varchar(10) | DE_STOCK / A_PEDIDO / COMBO | `OrigenTipo`, `EsCombo` |
| `UnidadBaseId` FK | int null | null = hereda | `UniIdUnidad`, `StockArt.UM`, `UnidadBase` WMS |
| `ImpuestoId` FK | int null | null = hereda | — (22 fijo) |
| `PerfilContableId` FK | int null | null = hereda | — |
| `LlevaVariantes` ! | bit | | — |
| `ControlStock` | varchar(10) null | GRANEL / POR_LOTE | `TipoGestion` WMS |
| `CantidadMinima`, `CantidadMultiplo` | decimal null | venta mínima y de a cuánto | `ProductoVentaConfig.CantidadMinima/Fija` |
| `ValidarStock` ! | bit | frena la venta sin stock | `ProductoVentaConfig.ValidarStock` (hoy nadie lo aplica) |
| `Estado` ! | varchar(15) | BORRADOR / ACTIVO / DISCONTINUADO | `Mostrar`, `borrar`, `ProductoVentaConfig.Estado` |
| `IDProdReact`, `ProCodigoOdooProducto` | | solo históricos; no se usan para decidir nada | igual |
| `AltaUsuarioId`, `AltaFecha`, `ModifUsuarioId`, `ModifFecha` | | auditoría | — |

**Columnas que se van de `Articulos`:** `SupFlia`, `Grupo`, `CodStock` (→ categoría) · `MonIdMoneda` (→ precio) · `UniIdUnidad` (→ `UnidadBaseId`) · `Mostrar`, `borrar`, `EnListaPrecios`, `EnListaPublica` (→ estado y canales) · `DescripcionLista` (→ nombre comercial) · `anchoimprimible`, `largoimprimible`, `LLEVAPAPEL` (→ ficha técnica).
Durante la transición se mantienen como columnas calculadas para no romper lectores.

### 2.3 `Unidades` — SE AMPLÍA · `ArticuloUnidades` — NUEVA

`Unidades`: `UniIdUnidad` PK · `Codigo` ! único (u, m, m2, kg, l, rollo, caja, par, baj) · `Nombre` · `Magnitud` ! (CANTIDAD / LONGITUD / SUPERFICIE / PESO / VOLUMEN) · `CodigoDGI` (para la factura electrónica; hoy se manda siempre "UN") · `Decimales`.

`ArticuloUnidades`:

| Columna | Tipo | Nota |
|---|---|---|
| `ProIdProducto` ! FK, `UnidadId` ! FK | PK compuesta | |
| `FactorABase` ! | decimal(18,6) | 1 rollo = 100 m → 100 |
| `ParaCompra`, `ParaVenta` ! | bit | |
| `SugeridaCompra`, `SugeridaVenta` ! | bit | una sola de cada una por artículo |
| `CodigoBarras` | varchar(50) null | el de esa presentación |

Regla: stock y costo **siempre** en `UnidadBaseId`. Toda línea de compra o venta guarda `UnidadId`, `Factor` y `CantidadBase`.

### 2.4 Variantes

`ArticuloVariantes` — hoy `Wms_Variantes` (se conservan los ids):

| Columna | Tipo | Nota | Hoy |
|---|---|---|---|
| `VarianteId` PK | int | | `VarId` |
| `ProIdProducto` ! FK | int | **obligatorio** | `Wms_Variantes.ProIdProducto` (se escribe y nadie lo lee) |
| `Sku` único | varchar(50) | | `CodigoVariante` |
| `Nombre` | nvarchar(200) | calculado de los atributos | `NombreVariante` |
| `CodigoBarras` | varchar(50) null | | — |
| `EsUnica` ! | bit | la variante de un artículo sin variantes | hoy se usa el `ProIdProducto` como id |
| `Activa` ! | bit | | `Activa` |

`Atributos` (Talle, Color, Ancho, Gramaje, Manga…) y `VarianteAtributos` (`VarianteId`, `AtributoId`, `Valor`): reemplazan las columnas `Talle` y `Color` copiadas en dos tablas y derivadas del nombre.

Desaparecen: `Wms_ProductosMaestros` (cada maestro pasa a ser su artículo), `Articulos_Wms`, `Articulos_WMS_Variantes`.

### 2.5 `ArticuloFichaTecnica` — NUEVA (1 a 1, solo materiales)

`ProIdProducto` PK/FK · `AnchoImprimibleM` · `LargoImprimibleM` · `LlevaPapel` · `GramajeGsm` · `Composicion`.
Hoy: `Articulos.anchoimprimible/largoimprimible/LLEVAPAPEL` y `Wms_Variantes.GramajeGsm/AnchoMetros/Composicion`.

---

## 3. Comercial

### 3.1 `PreciosBase` — SE AMPLÍA

| Columna | Tipo | Nota | Hoy |
|---|---|---|---|
| `ID` PK | int | | igual |
| `ProIdProducto` ! FK | int | | igual |
| `VarianteId` FK | int null | null = todas las variantes | `Articulos_WMS_Variantes.precio_excepcion` |
| `UnidadId` FK | int null | null = unidad base | — |
| `MonIdMoneda` ! FK | int | | igual |
| `Precio` ! | decimal(18,4) | | igual |
| `VigenteDesde` ! | date | | `UltimaActualizacion` |

Único: (`ProIdProducto`, `VarianteId`, `UnidadId`, `MonIdMoneda`). Se quitan `CodArticulo` y `Moneda` (texto).
`PerfilesItems` y `PreciosEspecialesItems` ganan `VarianteId` y `UnidadId` opcionales, y `CategoriaId` en lugar de `CodGrupo`.
`PreciosHistorial` (hoy `HistoricoPreciosProductos`, vacía): una fila por cada cambio, con usuario.
`PreciosListaPublica` pasa a vista.

### 3.2 Canales y audiencia — NUEVAS

`Canales`: INTERNO, PORTAL, TIENDA, LISTA_PUBLICA, API.

`ArticuloCanales`: `ProIdProducto` ! FK · `CanalCodigo` ! FK · `Visible` ! bit · `Alcance` ! (TODOS / HABILITADOS). PK (artículo, canal).

`ArticuloAudiencia`: `ProIdProducto` ! · `CanalCodigo` ! · `CliIdCliente` ! FK. PK (artículo, canal, cliente). Se habilita cliente por cliente (decidido 02-oct); no hay grupos.

Reemplazan: `Articulos.Mostrar/EnLista*`, `TiendaProductos.Publicado/TipoVitrina/EnLista*`, `ProductoVentaConfig.VisiblePortal/Tienda/Interno`.

### 3.3 Marketing

`ArticuloMarketing` — hoy `TiendaProductos`, sin las casillas de visibilidad: `ProIdProducto` PK/FK · `DescripcionLarga` · `CategoriaVitrina` · `Orden` · `Destacado` · `FiltroLanding` · `PagoOnline` · `Slug`.
`Articulos_Imagenes`: se queda; se le declara la relación con el artículo y el color pasa a apuntar a un valor de atributo.
`ArticuloEtiquetas` (artículo, etiqueta): un artículo puede tener varias etiquetas (hoy `ProductoVentaConfig.EtiquetaID` permite una sola).

---

## 4. Compras y costo

### 4.1 `Proveedores` — hoy `Wms_Proveedores`, se amplía y pasa a ser única

`ProveedorId` PK · `Nombre` · `RazonSocial` · `Rut` · `Contacto`, `Telefono`, `Email` · `Ciudad`, `Pais` · `CondicionPagoId` FK → `CondicionesPago` · `MonIdMoneda` · `CuentaContableCod` (acreedores) · `Activo`.
La usan compras, `EgresosCaja` (hoy texto libre) y `TesoreriaCheques` (hoy un número suelto).

### 4.2 `ArticuloProveedores` — NUEVA

`ProIdProducto` ! · `VarianteId` null · `ProveedorId` ! · `CodigoProveedor` · `UnidadId` (de compra) · `UltimoPrecio` · `MonIdMoneda` · `PlazoEntregaDias` · `CantidadMinima` · `EsHabitual` bit.

### 4.3 `ArticuloCostos` — NUEVA

`VarianteId` PK/FK · `CostoUltimo` · `CostoPromedio` · `CostoEstandar` · `MonIdMoneda` ! · `FechaUltimo` · `Origen` (COMPRA / MANUAL / CALCULADO).
Reemplaza `Wms_Variantes.Costo/Moneda` y `Wms_ProductosMaestros.CostoUnitarioBase`. `CostosHistorial` guarda cada cambio.

### 4.4 Compras — `Wms_Compras*`, se amplían

`Wms_Compras`: + `ProveedorId` FK (hoy `PrvId`) · `NumeroComprobante`, `FechaComprobante` · `Neto`, `Impuestos`, `Total`.
`Wms_ComprasDetalle`: + `UnidadId`, `Factor`, `CantidadBase` · `ImpuestoId`.
El asiento de compra queda para la etapa de inventario contable permanente.

---

## 5. Stock — un solo modelo

| Tabla lógica | Tabla de hoy | Cambios |
|---|---|---|
| `Depositos` | `Wms_Depositos` | + `AreaId` (el depósito de cada área de producción) |
| `Lotes` (existencias) | `Wms_Etiquetas` | + `PropietarioCliId` (material del cliente), `LoteProveedor`, `AnchoReal`, `MonIdMoneda` del costo |
| `MovimientosStock` | `Wms_Movimientos` | + `CostoUnitario`, `UnidadId`, `OrdenId` (consumo de producción) |
| `Reservas` | NUEVA | `VarianteId`, `DepId`, `Cantidad`, `RefTipo`, `RefId`, `Estado` |
| `ReglasReposicion` | `Wms_AlertasDepositos` + umbrales de `Wms_Variantes` | + `PuntoPedido`, `CantidadAReponer` |

Qué se absorbe:
- `Insumos` → artículos con `SeConsume = 1`. `InsumosPorArea` → qué áreas lo usan (tabla `ArticuloAreas`).
- `InventarioBobinas` → `Lotes` en el depósito del área. `MovimientosInsumos` → `MovimientosStock`.
- Tela del cliente → lotes con `PropietarioCliId`. `InventarioPrendasCliente` → igual.
Estas quedan como vistas mientras se cambian las pantallas de bobinas, que siguen funcionando igual.

---

## 6. Fabricación (productos a pedido y combos)

### 6.1 `ArticuloFabricacion` — hoy `ProductoVentaConfig`

Se queda con lo que es de fabricar: `TecnicaPrincipal`, `Molde`, `TizadaProMoldeRef`, `AnchoM`, `AltoM`, `BordeCm`.
Pasan al artículo: `UM`, `Estado`, `CantidadMinima/Fija`, `ValidarStock`, `EsCombo`, `OrigenTipo` y las tres casillas de canal.

### 6.2 `ArticuloComponentes` — NUEVA (receta)

| Columna | Tipo | Nota |
|---|---|---|
| `ComponenteId` PK | int identity | |
| `ProIdProducto` ! FK | int | el artículo padre |
| `HijoProIdProducto` ! FK | int | lo que lleva |
| `HijoVarianteId` FK | int null | null = se elige en el pedido |
| `Tipo` ! | varchar(12) | MATERIAL / AVIO / ACCESORIO / COMPONENTE |
| `Cantidad` ! , `UnidadId` | decimal, int | por unidad del padre |
| `MermaPct` | decimal null | |
| `Obligatorio` ! , `Cobro` ! | bit, varchar | INCLUIDO / APARTE |
| `DepId` FK | int null | de qué depósito sale |
| `EsDefault` | bit | la tela "por defecto" |

Reemplaza: `ProductoComboItems`, `ProductoAccesorios`, `ProductoAvios`, `ProductoTelas`, y el vínculo implícito insumo ↔ servicio (`Insumos.CodigoReferencia`).

### 6.3 `ArticuloProcederes` — hoy `ProductoTerminadoServicios`

`ProIdProducto` ! · `AreaId` ! · **`ServicioProIdProducto`** FK (el artículo de servicio que se cobra y se costea; hoy está escrito en el código) · `Obligatorio` · `Modo` · `Cobro` · `Orden` · `TiempoEstandarMin` null.
`ProductoTecnicaOpciones`, `ProductoApliques`, `ProductoComboItemServicios`, `ProductoModelos` y la ficha de diseño (`ProductoFichaDiseno*`) se quedan como están.

---

## 7. Contabilidad (etapa A: ingresos e IVA por familia)

### 7.1 `Impuestos` — NUEVA

`ImpuestoId` PK · `Nombre` (IVA básico, IVA mínimo, Exento) · `Tasa` · `CuentaVentasCod` (2.2.1 / 2.2.2) · `CuentaComprasCod` (1.2.4) · `IndFactDGI` (código de la factura electrónica).

### 7.2 `PerfilesContables` — NUEVA

`PerfilContableId` PK · `Nombre` · `CuentaIngresosCod` ! · `CuentaDevolucionesCod` · y, para la etapa B: `CuentaCostoVentasCod`, `CuentaInventarioCod`, `CuentaComprasCod`.

### 7.3 Cambios en lo que ya existe

- `DocumentosContablesDetalle`: + `ImpuestoId`, `TasaIva`, `CuentaIngresosCod` (foto al facturar), `VarianteId`, `UnidadId`, `CantidadBase`. El nombre del ítem (`DcdNomItem`) se llena con el **nombre comercial** del artículo.
- Línea de un combo: al facturar se guarda, además de la línea del combo, el reparto por familia de sus componentes (`DocumentosContablesDetalleReparto`: línea, `ProIdProducto` del componente, `CuentaIngresosCod`, importe), en proporción al precio de lista de cada componente. El asiento usa ese reparto; la factura muestra una sola línea.
- `Cont_ReglasAsiento`: se agregan las cuentas comodín `META_INGRESO` y `META_IVA`, que se resuelven por línea. El asiento de una factura pasa a tener una fila por cada cuenta de ingreso y por cada tasa.
- `Cont_PlanCuentas`: + `CueCodigoContador` (equivalencia con el plan del estudio, hoy escrita en el código).
- Cuentas nuevas de ingreso por familia: las define el contador.
- Se corrige el error que convierte una línea exenta (IVA 0) en 22 %, y se empieza a enviar la tasa mínima a DGI.

---

## 8. Líneas de pedido y de orden

- `PedidosCobranzaDetalle`: + `VarianteId`, `UnidadId`, `Factor`, `CantidadBase`. `CodArticulo` deja de usarse para guardar el id de variante.
- `Ordenes`: `WmsVarianteId` y `ComboItemID` pasan a apuntar a `ArticuloVariantes` y `ArticuloComponentes`.

---

## 9. Destino de cada tabla de hoy

| Tabla | Filas | Destino |
|---|---|---|
| `Articulos` | 309 | se queda, se amplía |
| `StockArt` | 43 | → `ArticuloCategorias`; queda como vista |
| `ArticuloClasificacion` | 300 | → categoría (área); vista hasta cambiar los reportes |
| `SectorMapeo`, `Sectores` | 12 / 9 | `Sectores` se queda; el mapeo pasa a `ArticuloCategorias.SectorId` |
| `ConfigMapeoERP` | 11 | se queda como configuración de áreas; deja de clasificar artículos |
| `Unidades` | 2 | se amplía |
| `Monedas` | 2 | se queda; absorbe `Wms_Monedas` |
| `PreciosBase` | 254 | se amplía |
| `PerfilesPrecios`, `PerfilesItems` | 13 / 76 | se quedan (+ variante, unidad, categoría) |
| `PreciosEspeciales`, `PreciosEspecialesItems` | 127 / 988 | se quedan (ídem) |
| `PreciosListaPublica` | 265 | vista |
| `HistoricoPreciosProductos` | 0 | se empieza a usar como historial |
| `ConfiguracionPrecios` | 7 | se queda |
| `Articulos_Wms`, `Articulos_WMS_Variantes` | 255 / 212 | desaparecen |
| `Articulos_Imagenes` | 59 | se queda |
| `Articulos_UbicacionLocal` | 0 | se elimina (la ubicación es del lote) |
| `SINCRO-ARTICULOS`, `SINCRO-ARTICULOSVIEJA` | 138 / 0 | restos del ERP viejo: se archivan |
| `TiendaProductos` | 49 | → `ArticuloMarketing` |
| `ProductoEtiqueta` | 5 | se queda (+ tabla de relación) |
| `ProductoVentaConfig` | 59 | → `ArticuloFabricacion` |
| `ProductoTerminadoServicios` | 176 | → `ArticuloProcederes` |
| `ProductoTecnicaOpciones`, `TecnicaOpciones`, `ProductoApliques` | 1 / 11 / 3 | se quedan |
| `ProductoComboItems`, `ProductoAccesorios`, `ProductoAvios`, `ProductoTelas` | 0 / 1 / 6 / 1 | → `ArticuloComponentes` |
| `ProductoComboItemServicios`, `ProductoModelos`, `ProductoOrigenVariantes` | 0 / 2 / 0 | se quedan |
| `ProductoFichaDiseno*`, `CosturasISO`, `CatalogoAvios`, `TizadaProMoldePiezas` | | se quedan |
| `ProductosTerminados`, `ProductoTerminadoTerminaciones`, `Terminaciones`, `MaterialTerminaciones` | 26 / 26 / 13 / 34 | modelo ECOUV: se queda intacto hasta su migración (propuesta del 29-sep, fase F2) |
| `Insumos`, `InsumosPorArea` | 139 / 147 | → `Articulos`; vistas |
| `InventarioBobinas`, `MovimientosInsumos` | 178 / 855 | → lotes y movimientos; vistas |
| `InventarioPrendasCliente`, `TelaClienteEventos` | 0 / 14 | → lotes con propietario |
| `Wms_ProductosMaestros`, `Wms_Categorias` | | → `Articulos` y categorías |
| `Wms_Variantes`, `Wms_Etiquetas`, `Wms_Movimientos`, `Wms_Depositos` | | son las tablas físicas de variantes, lotes, movimientos y depósitos |
| `Wms_Compras*`, `Wms_Importaciones`, `Wms_Pagos`, `Wms_Remitos*`, `Wms_Solicitudes*` | | se quedan |
| `Wms_Proveedores` | | → `Proveedores` única |
| `Wms_EquivalenciasMetricas` | | → `ArticuloUnidades` (kg ↔ metros) |
| `CuentasClienteArticulosPermitidos`, `PlanesMetrosArticulosPermitidos` | 22 / 380 | se quedan (son de planes del cliente, no de visibilidad) |
| `BitacoraInsumosMaquina`, `SolicitudesInsumo`, `SolicitudesInsumos`, `OrdenMateriales` | 0 | vacías: se revisan y se eliminan o se reemplazan por consumo de la receta |

Nota: en local las tablas `Wms_*` están vacías (el entorno local sigue leyendo el WMS externo). Antes de escribir los scripts hay que mirar los datos reales de producción.
