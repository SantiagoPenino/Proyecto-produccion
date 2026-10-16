# Propuesta: maestro único de artículos (compras · stock · precios · contabilidad · canales)

Fecha: 02-oct-2026. Continúa `PROPUESTA_modelo_generico_productos.md` (29-sep): aquella define **cómo se fabrica y se pide** un producto; esta define **qué es un artículo** para todo el sistema.

Base del análisis: la base LOCAL (esquema, volúmenes y anomalías, solo lectura) y la lectura del código de stock, compras, precios y contabilidad. **Producción no se revisó**: lo que dependa de ella está marcado.

---

## 1. Resumen

Hoy no hay un maestro de artículos: hay **cuatro catálogos** que describen las mismas cosas sin estar unidos (`Articulos`, el catálogo del WMS, `Insumos` y la tela/prendas del cliente en texto libre). Sobre eso, cada módulo guardó "su" copia de la unidad, la moneda, el nombre, la familia y la visibilidad.

La propuesta es la de cualquier ERP: **una ficha por cosa**, con todo lo demás colgando de ella.

| Bloque | Idea | Qué resuelve de lo que pediste |
|---|---|---|
| Ficha del artículo | `Articulos` sigue siendo el maestro (clave `ProIdProducto`), con **roles**: se vende, se compra, se fabrica, se consume en producción, lleva stock | El papel es insumo **y** producto de venta con una sola ficha |
| Árbol de familias | Tabla de categorías con padre, de cualquier profundidad, que **hereda** unidad, impuesto y cuentas contables | "Que se arme por familia de manera arbórea" |
| Unidades | Una unidad base por artículo + tabla de conversiones por artículo | "Una por defecto, las otras se convierten"; papel por rollo o por metro |
| Variantes | Talle/color dentro del maestro, con costo y precio propios | El short verde a un precio y el rojo a otro |
| Precios | Un precio por artículo **+ variante + unidad + moneda** | Precio según unidad de medida y según variante |
| Compras y costo | Proveedor único, proveedor por artículo, unidad de compra, último costo y costo promedio | Módulo de compras ligado al artículo |
| Stock | Un solo modelo de existencias (lote × depósito) para mercadería, insumos y bobinas | Stock sin duplicar |
| Contabilidad | Perfil contable e impuesto por familia (con excepción por artículo) | Cuentas de venta, costo, inventario e IVA por artículo |
| Canales | Visibilidad por canal y, si hace falta, por cliente | Web / e-commerce / solo interno / solo ciertos clientes |
| Nombres y marketing | Nombre interno + nombre comercial + fotos, etiquetas, vidriera | Nombres distintos o iguales; lo que usa marketing |
| Productos a pedido y combos | Artículo que **se fabrica y no lleva stock**, con su ficha de fabricación (molde, técnicas, procederes) colgada de la misma ficha; combo = artículo con componentes | Productos personalizados para la venta y combos con toda su configuración de producción |

---

## 2. Qué tenés hoy

### 2.1 Cuatro catálogos para las mismas cosas

| Catálogo | Filas (local) | Clave | Para qué se usa | Unido a `Articulos` |
|---|---|---|---|---|
| `Articulos` | 309 | `ProIdProducto` | vender, cotizar, facturar, órdenes | — |
| Catálogo del WMS (maestros + variantes) | externo | `variante_id` | stock de mercadería, compras, costo | por **nombre** (`Articulos_Wms`, `Articulos_WMS_Variantes`: 255 artículos, 212 variantes) |
| `Insumos` | 139 | `InsumoID` | bobinas e insumos de producción | **sin vínculo**; 63 coinciden solo porque su `CodigoReferencia` es igual a un `CodArticulo` |
| Tela y prendas del cliente | 169 bobinas | texto libre | material que trae el cliente | no |

**Ejemplo real — el papel de sublimación vive en cuatro lugares:**

| Dónde | Qué dice | Unidad | Precio / costo |
|---|---|---|---|
| `Articulos` 246 "Papel de Sublimación 1,60" (familia Impresión de Papel) | el **servicio** de imprimir sobre papel | metros | precio de venta en USD |
| `Articulos` 454–456 "INS-… Papel de Sublimación 1,60 / 1,18 / 0,914" | el papel **para vender** | sin unidad | sin familia válida (apuntan a 2.2.1.1, que no existe) |
| `Insumos` 1225 "Impresion de papel Papel 100g (1,60)" | el papel **como insumo** (bobinas en metros) | "Metros" (texto) | sin costo |
| Catálogo del WMS | el papel **en stock** | "rollos" o "mts" (texto) | costo por variante y por lote |

Nada une esas cuatro filas: no se puede saber cuánto papel hay, cuánto costó ni cuánto se ganó.

### 2.2 El mismo dato guardado en varios lugares

| Dato | Dónde vive hoy |
|---|---|
| **Identidad** | `ProIdProducto`, `CodArticulo` (3 repetidos), `IDProdReact`, `CodStock`, `variante_id` del WMS, `InsumoID`. Además `PedidosCobranzaDetalle.CodArticulo` guarda a veces el id de variante del WMS como texto |
| **Familia / clasificación** | `Articulos.SupFlia/Grupo/CodStock` → `StockArt` (43 filas, 3 niveles fijos, sin relaciones), `ArticuloClasificacion` (300), `ConfigMapeoERP` (grupo → área), `SectorMapeo`, categorías del WMS, `Insumos.Categoria`, `PreciosListaPublica.Familia`, `TiendaProductos.CategoriaVitrina`, `ProductoEtiqueta` |
| **Unidad** | `Articulos.UniIdUnidad`, `StockArt.UM`, `ProductoVentaConfig.UM`, `Areas.UM`, `Insumos.UnidadDefault` (texto), `UnidadBase` del WMS (texto), `Ordenes.UM` |
| **Moneda** | `Articulos.MonIdMoneda`, `PreciosBase.MonIdMoneda` y `PreciosBase.Moneda` (texto). 11 precios tienen el texto y el id contradictorios; 25 artículos tienen una moneda distinta a la de su precio |
| **Nombre** | `Articulos.Descripcion`, `Articulos.DescripcionLista`, `TiendaProductos.TituloVenta`, `PreciosListaPublica.Producto`, nombre del maestro WMS, `Articulos_Wms.nombre_wms`, `Insumos.Nombre` |
| **Visibilidad** | `Articulos.Mostrar`, `Articulos.borrar`, `Articulos.EnListaPrecios/EnListaPublica`, `StockArt.Mostrar`, `TiendaProductos.Publicado/TipoVitrina/EnLista*`, `ProductoVentaConfig.Estado` y `VisiblePortal/Tienda/Interno` (estas últimas solo para los 59 productos configurados) |
| **Talle y color** | variantes del WMS y, copiados, `Articulos_WMS_Variantes` (derivados del nombre) |

### 2.3 Tema por tema

| Tema | Qué hay | Problema |
|---|---|---|
| **Árbol** | `StockArt`: SupFlia › Grupo › CodStock | Tres niveles fijos; códigos con espacios de relleno; ninguna relación en la base. 41 artículos apuntan a familias que no existen (2.2.1.1 y 2.2.1.2) y 7 no tienen familia |
| **Unidades** | `Unidades` con 2 filas: "Cantidades" y "Metros" | No hay conversiones. Lonas y vinilos se cuentan por rollo en stock y se venden por metro, sin factor. La única conversión (kg → metros de tela) se calcula en pantalla y no se guarda |
| **Precio de venta** | `PreciosBase`: un precio por artículo y una moneda (254 precios; 78 artículos sin precio). Encima, reglas por perfil y por cliente (escalonados, descuentos) | No hay precio por unidad alternativa. Hay un precio por variante (`precio_excepcion`) que solo leen la tienda y la venta de mostrador; hoy tiene 0 datos y **se borra** al re-vincular el artículo con el WMS |
| **Costo** | Solo en el WMS: costo de referencia por variante y costo real por lote | Nada en `Articulos`. No hay último costo ni costo promedio. Los movimientos de stock no guardan costo. Bobinas e insumos no tienen costo |
| **Compras** | Circuito completo dentro del WMS propio: compra, importación, costos extra prorrateados, pagos, recepción que crea lotes con costo | La línea apunta a la variante del WMS, no al artículo. Sin unidad de compra, sin IVA, sin proveedor por artículo. **No genera ningún asiento**: ni deuda con el proveedor, ni IVA compras, ni pago |
| **Proveedores** | Tres versiones: `Wms_Proveedores`, texto libre en los egresos de caja, y un número suelto en los cheques emitidos | No hay ficha única ni cuentas por pagar |
| **Stock** | (A) WMS externo, el vigente en local; (B) WMS propio, copia con operación propia; (C) bobinas e insumos por área; (D) tela del cliente; (E) prendas del cliente | A y B conviven: las ventas descuentan de uno y las pantallas de /stock escriben en el otro. La misma tela puede estar en el WMS (en kg) y en bobinas (en metros). Sin reservas: el stock baja al preparar el pedido |
| **Contabilidad** | Motor por evento (`Cont_EventosContables` + `Cont_ReglasAsiento`); plan de 49 cuentas | La cuenta de ingresos depende del **tipo de documento**, nunca del artículo: todo va a 4.1.1. Un asiento por documento, sin detalle por línea. No existe asiento de costo de ventas ni de inventario; el plan ni siquiera tiene cuenta de costo de ventas |
| **IVA** | 22 % fijo en casi todos los caminos | `Articulos` no tiene tasa. La factura manual deja elegir 22/10/0, pero el backend convierte el 0 en 22. A DGI solo se envía tasa básica o exento, nunca la mínima |
| **Canales** | Tres casillas (portal, tienda, interno) en los productos configurados | No existe para el resto de los artículos ni hay forma de restringir un artículo a ciertos clientes |
| **Productos a pedido y combos** | El configurador: 59 productos con ficha de fabricación (`ProductoVentaConfig`: técnica principal, molde de TizadaPro, medidas), 176 técnicas por producto, modelos, telas, apliques, avíos, accesorios y ficha de diseño con costuras. Combos con componentes y técnicas por componente | La ficha está bien armada pero **aislada del resto**: 56 de 59 están en borrador; no tiene costo (ni de materiales ni de procederes); el pedido interno casi no la lee (propuesta del 29-sep); y lo que el producto consume está en cuatro tablas distintas (telas, avíos, accesorios, componentes de combo) |

### 2.4 Lo que ya está bien y se conserva

- `ProIdProducto` como clave: precios, líneas de factura y órdenes ya la usan.
- El motor de precios (precio base + perfiles + especiales por cliente).
- El motor contable por eventos y reglas: se extiende, no se reemplaza.
- El modelo de existencias del WMS propio: **lote (etiqueta) × depósito**, con costo por lote, movimientos con clave de idempotencia, remitos entre depósitos y umbrales de alerta. Es el modelo correcto para todo el stock.
- Las compras del WMS propio (importaciones, costos extra, recepción).
- `Articulos_Imagenes` (fotos por color) y `ProductoEtiqueta`.
- La ficha de fabricación del configurador (`ProductoVentaConfig` y sus tablas).

---

## 3. Qué falta

1. Un artículo que pueda ser a la vez insumo y producto de venta.
2. Árbol de familias de profundidad libre, con herencia.
3. Conversión de unidades y unidad distinta para comprar, guardar y vender.
4. Precio por unidad y por variante dentro del motor de precios.
5. Costo del artículo (último, promedio y estándar) y margen.
6. Proveedor único, proveedor habitual por artículo y su código/precio.
7. Compras que impacten en contabilidad (deuda, IVA compras, pago).
8. Cuenta contable e impuesto por artículo o familia; costo de ventas e inventario.
9. Visibilidad por canal para **todos** los artículos, y por cliente.
10. Nombre comercial separado del interno.
11. Receta de materiales: qué insumo y cuánto consume cada servicio o producto.
12. Reservas de stock y validación de stock al vender (`ValidarStock` se guarda y nadie lo aplica).

---

## 4. El modelo propuesto

### 4.1 Reglas de diseño

1. **Una ficha por cosa.** Lo que hoy son cuatro filas del papel pasa a ser una.
2. **`Articulos` es el maestro**; no se crea una tabla paralela. Se le agregan columnas y relaciones.
3. **Cada dato en un solo lugar.** Si un dato se puede heredar del árbol, no se copia: se resuelve al leer.
4. **Todo por clave, nada por nombre.** Las relaciones se declaran en la base.
5. **Lo viejo no se rompe.** Las tablas que se absorben quedan como **vistas** con el mismo nombre hasta que sus lectores se cambien.

### 4.2 Ficha del artículo — `Articulos` (se amplía)

| Columna | Qué es | Reemplaza a |
|---|---|---|
| `ProIdProducto` | clave | — |
| `Codigo` (único) | código humano | `CodArticulo` (hoy repetido), `IDProdReact` queda solo como dato histórico |
| `NombreInterno` | cómo lo llama la planta | `Descripcion` |
| `NombreComercial` (vacío = igual al interno) | cómo lo ve el cliente | `TituloVenta`, `DescripcionLista`, `PreciosListaPublica.Producto`, `nombre_wms` |
| `CategoriaId` | lugar en el árbol | `SupFlia`, `Grupo`, `CodStock` |
| `Naturaleza` | BIEN o SERVICIO | parte de `StockArt.TipoStock` |
| `SeVende`, `SeCompra`, `SeFabrica`, `SeConsume`, `LlevaStock` | los roles | `StockArt.TipoStock`, `Insumos.EsProductivo`, existir o no en el WMS |
| `Abastecimiento` | DE_STOCK, A_PEDIDO (se fabrica al venderse) o COMBO — ver 4.13 | `ProductoVentaConfig.OrigenTipo` y `EsCombo` |
| `UnidadBaseId` | unidad en que se guarda y se costea | `UniIdUnidad`, `StockArt.UM`, `UnidadBase` del WMS, `Insumos.UnidadDefault` |
| `ImpuestoId` (vacío = el de la familia) | tasa de IVA | el 22 fijo |
| `PerfilContableId` (vacío = el de la familia) | cuentas contables | la cuenta fija por tipo de documento |
| `LlevaVariantes`, `ControlStock` (GRANEL o POR_LOTE) | cómo se gestiona | `TipoGestion` del WMS |
| `Estado` (BORRADOR, ACTIVO, DISCONTINUADO) | ciclo de vida | `Mostrar`, `borrar` |
| Alta/modificación: usuario y fecha | auditoría | — |

Se van de `Articulos`: `MonIdMoneda` (la moneda es del precio), `EnListaPrecios/EnListaPublica` (pasan a canales), `anchoimprimible/largoimprimible/LLEVAPAPEL` (son atributos técnicos del material; van a la ficha técnica, ver 4.11).

### 4.3 Árbol de familias — `ArticuloCategorias` (nueva)

`CategoriaId`, `PadreId`, `Codigo`, `Nombre`, `Orden`, `Activa`, y los **valores por defecto que heredan los hijos**: `UnidadBaseId`, `ImpuestoId`, `PerfilContableId`, `AreaId` (qué área lo produce), `SectorId` (sector comercial para reportes), `Naturaleza` y roles sugeridos.

- Cualquier profundidad: Productos › Indumentaria › Shorts › Short de fútbol.
- Un artículo toma de su familia lo que no tenga cargado. Cambiar el IVA o la cuenta de toda una familia es un solo cambio.
- Absorbe: `StockArt`, `ArticuloClasificacion`, la parte "grupo → área" de `ConfigMapeoERP`, `SectorMapeo`, categorías del WMS, `Insumos.Categoria`.
- `StockArt` queda como vista para no romper lo que la lee.
- La vidriera de la tienda (`CategoriaVitrina`) y las etiquetas siguen aparte: son de marketing, no de familia.

### 4.4 Unidades — `Unidades` (se amplía) + `ArticuloUnidades` (nueva)

- `Unidades`: unidad, metro, m², kg, litro, rollo, caja, par, bajada… con su `Magnitud` (cantidad, longitud, superficie, peso).
- `ArticuloUnidades`: `ProIdProducto`, `UnidadId`, **`FactorABase`**, y para qué se usa: `ParaCompra`, `ParaVenta`, cuál es la sugerida en cada caso.
- Regla: el **stock y el costo siempre en la unidad base**. Cada línea de compra o de venta guarda la unidad usada, el factor de ese momento y la cantidad convertida.
- Rollos de largo variable: cada rollo físico es un **lote** con sus metros reales (el WMS ya lo modela así). El factor del rollo es el nominal; al vender "un rollo" se entrega un lote entero.

### 4.5 Variantes — `ArticuloVariantes` (el catálogo de variantes del WMS pasa al maestro)

`VarianteId` (se conservan los ids actuales del WMS), `ProIdProducto`, `Sku`, `CodigoBarras`, `Talle`, `Color` (y otros atributos), `Activa`, umbrales de stock.

- Un artículo sin variantes tiene **una** variante "única" con id propio. Hoy ese caso usa el `ProIdProducto` como si fuera un id de variante, que puede coincidir con una variante real de otro artículo.
- Desaparecen las tablas puente `Articulos_Wms` y `Articulos_WMS_Variantes` y el vínculo por nombre.
- Stock, compras, costo y precio pueden ir a nivel variante.

### 4.6 Precios de venta — `PreciosBase` (se amplía)

Clave nueva: **artículo + variante (opcional) + unidad (opcional) + moneda**. Se quitan `CodArticulo` y `Moneda` (texto).

Cómo se resuelve el precio de una línea:
1. precio de esa variante en esa unidad;
2. precio de esa variante en unidad base × factor;
3. precio del artículo en esa unidad;
4. precio del artículo en unidad base × factor.

Sobre ese resultado siguen actuando, igual que hoy, los perfiles y los precios especiales por cliente.

- `precio_excepcion` por variante migra acá y deja de perderse al re-vincular.
- `PreciosListaPublica` pasa a vista; hoy la caja todavía la consulta antes que el precio base.
- `HistoricoPreciosProductos` (existe, vacía) se empieza a llenar en cada cambio.

### 4.7 Costos — `ArticuloCostos` (nueva)

Por variante: `CostoUltimo`, `CostoPromedio`, `CostoEstandar` (a mano, para servicios y fabricados), moneda y fecha.

- Último y promedio se actualizan solos al recibir una compra.
- La valorización del stock sigue siendo por lote (ya existe), convertida a una moneda única.
- Los movimientos de stock empiezan a guardar el costo con el que salieron: de ahí sale el costo de ventas.

### 4.8 Compras y proveedores

- **`Proveedores`** única (parte de `Wms_Proveedores`, ampliada con RUT, condición de pago, moneda, cuenta contable). La usan compras, egresos de caja y cheques.
- **`ArticuloProveedores`**: artículo/variante, proveedor, código del proveedor, unidad de compra, último precio, moneda, plazo de entrega, mínimo de compra, proveedor habitual.
- La línea de compra pasa a guardar: variante del maestro, unidad de compra + factor, precio, impuesto.
- Recibir la compra: crea los lotes (como hoy), actualiza costos y **genera el asiento**.

### 4.9 Stock — un solo modelo de existencias

Existencia = **variante × depósito × lote**, en unidad base, con costo. Es el modelo del WMS propio, aplicado a todo:

| Hoy | Pasa a ser |
|---|---|
| Mercadería del WMS | igual |
| `Insumos` | artículos con rol "se consume" (la tabla queda como vista) |
| `InventarioBobinas` | lotes en el depósito del área, con ancho y lote de proveedor como atributos del lote |
| Tela y prendas del cliente | lotes con **propietario = cliente**: no se valorizan ni se venden, pero se ven y se consumen igual |

Se agregan: **reservas** (lo vendido y no preparado), validación de stock al vender según `ValidarStock`, y punto de pedido usando los umbrales que ya existen.

### 4.10 Contabilidad

- **`Impuestos`**: IVA básico 22 %, mínimo 10 %, exento; cada uno con su cuenta de IVA ventas, su cuenta de IVA compras y su código para DGI.
- **`PerfilesContables`**: cinco cuentas — ventas, costo de ventas, inventario, compras/gasto, devoluciones. Se asigna a la **familia** y se puede cambiar en un artículo puntual.
- **Motor contable**: se agregan cuentas "comodín" que se resuelven por línea según el artículo (hoy solo existen las de cliente y caja). El asiento de una factura suma las líneas por cuenta.
- **Eventos nuevos**: compra recibida, pago a proveedor, costo de ventas al entregar mercadería, consumo de insumos en producción, ajuste de stock.
- **Plan de cuentas**: hay que agregar costo de ventas e inventarios por tipo (materias primas, productos terminados). Hoy solo existen "Mercaderías de Reventa" y "Pedidos en Depósito".
- El libro del contador usa otro plan, escrito en el código: pasa a una columna de equivalencia en el plan de cuentas.

### 4.11 Canales y clientes — `ArticuloCanales` + `ArticuloAudiencia` (nuevas)

- `ArticuloCanales`: artículo, canal (INTERNO, PORTAL, TIENDA, LISTA PÚBLICA, API), visible sí/no, y si es **para todos o solo para habilitados**.
- `ArticuloAudiencia`: artículo, canal, cliente. Se habilita **cliente por cliente** (decidido 02-oct).

| Quiero que… | Interno | Portal | Tienda | Audiencia |
|---|---|---|---|---|
| se venda en todos lados | sí | sí | sí | todos |
| lo vendan solo los vendedores | sí | no | no | — |
| esté solo en el e-commerce | no | no | sí | todos |
| lo pida por autogestión solo el cliente X | sí | sí | no | portal: cliente X |

Reemplaza `Mostrar`, `EnLista*`, `Publicado/TipoVitrina` y las tres casillas de `ProductoVentaConfig`, que hoy solo cubren los productos configurados.

### 4.12 Marketing y ficha técnica

- **Marketing** (`TiendaProductos` se queda con lo suyo): descripción comercial larga, fotos por color (ya existe), etiquetas, categoría de vidriera, orden, destacado, filtro de la landing.
- **Ficha técnica del material**: ancho y largo imprimible, lleva papel, gramaje, composición. Hoy están repartidos entre `Articulos` y las variantes del WMS.
- **Receta de materiales — `ArticuloComponentes`**: artículo padre, artículo hijo, cantidad por unidad, unidad, merma. Une el servicio "impresión sobre papel 1,60" con el papel que consume, y generaliza lo que hoy son combos, accesorios, avíos y telas del producto. Es lo que permite calcular costo y descontar insumos solos.
- La **ficha de fabricación** se detalla en 4.13.

### 4.13 Productos personalizados (a pedido) y combos, con su configuración de producción

Un producto personalizado **es un artículo más** del maestro, con dos particularidades: se fabrica cuando se vende (no tiene existencias) y lleva colgada su configuración de producción.

**En la ficha del artículo:**

| Dato | Producto de stock | Producto personalizado (a pedido) | Combo |
|---|---|---|---|
| `SeVende` | sí | sí | sí |
| `SeFabrica` | no (o sí, para stock) | **sí** | según sus componentes |
| `LlevaStock` | sí | **no** | no: su disponibilidad sale de los componentes de stock |
| `Abastecimiento` (columna nueva) | DE_STOCK | **A_PEDIDO** | COMBO |
| Precio | por artículo / variante / unidad | igual; puede tener precio cerrado por unidad | precio propio del combo, o suma de componentes |
| Costo | último y promedio de compra | **costo estándar calculado**: materiales de la receta + procederes | suma del costo de los componentes |

**Colgando de la ficha (solo si `SeFabrica`) — la ficha de fabricación**, que es lo que el configurador ya tiene y se conserva:

| Parte | Qué define | Tabla de hoy |
|---|---|---|
| Producción principal | qué área lo produce, medida fija o molde, cómo se cuenta | `ProductoVentaConfig` (técnica principal, molde, ancho/alto) |
| **Molde** | piezas, talles y modelos; consumo de tela por talle | TizadaPro (solo lectura) + `ProductoModelos` |
| **Procederes (ruta)** | por qué áreas pasa y qué se hace en cada una: obligatorio u opcional, incluido o se cobra aparte, con qué opción | `ProductoTerminadoServicios`, `ProductoTecnicaOpciones`, `ProductoApliques` |
| Materiales | telas ofrecidas, avíos, accesorios de stock | hoy `ProductoTelas`, `ProductoAvios`, `ProductoAccesorios` → convergen en `ArticuloComponentes` (4.12) |
| Ficha de diseño | dibujo, anotaciones, costuras, extras | `ProductoFichaDiseno` y sus tablas |
| Cantidades | mínima, fija (paquetes) | `ProductoVentaConfig` |

Lo que se agrega a esa ficha para que sirva a contabilidad y administración:

1. **Cada proceder apunta a un artículo de servicio** (Corte, Costura, Bordado…), que tiene su precio y su costo estándar. Hoy esos artículos están escritos en el código y son distintos según por dónde entre el pedido.
2. **Costo estándar del producto** = materiales de la receta (a su costo) + procederes (a su costo estándar). Se recalcula cuando cambia un costo y queda guardado en `ArticuloCostos`. Con eso hay margen por producto antes de vender.
3. **Contabilidad sin stock de terminados**: al fabricar a pedido no hay inventario de producto terminado. El costo de la venta es lo consumido (insumos que bajan de stock) más los procederes. El ingreso va a la cuenta de la familia del producto.

**Combos.** Un combo es un artículo cuyo `ArticuloComponentes` lista otros artículos:

- componente **de stock** (una prenda del local, un mástil): se retira del depósito, con variante fija o a elegir en el pedido;
- componente **fabricado** (una bandera, una camiseta personalizada): es otro artículo a pedido, con **su propia** ficha de fabricación; el combo la reutiliza, no la copia;
- técnicas por componente (bordar solo la campera del conjunto): se conservan como hoy (`ProductoComboItemServicios`).

El ingreso del combo se reparte entre las familias de sus componentes en proporción a su precio de lista, para que los informes por familia no se distorsionen.

**Producto hecho para un solo cliente.** Dos caminos, según se repita o no:

- se va a volver a pedir (el uniforme de un club): artículo a pedido normal, con **audiencia = ese cliente** (4.11). Lo ve y lo pide solo él, por autogestión o por su vendedor;
- es por única vez: no se crea artículo. Se vende con el artículo genérico de la familia ("Prenda personalizada") y la configuración queda en el pedido, como hoy.

---

## 5. Los dos ejemplos que planteaste

### 5.1 Papel de sublimación 1,18

**Una** ficha, familia Insumos › Papeles › Sublimación:

| Dato | Valor |
|---|---|
| Roles | se compra, se vende, se consume en producción, lleva stock |
| Unidad base | metro |
| Otras unidades | rollo = 100 m (compra y venta) |
| Proveedor habitual | el que corresponda, con su código y precio por rollo |
| Costo | último y promedio por metro, actualizados al recibir la compra |
| Precio de venta | por metro: X · por rollo: Y (precio propio, no 100 × X) |
| Stock | lotes (rollos) con sus metros reales, en depósito central y en Sublimación |
| Contabilidad | familia Insumos: cuenta de inventario "Materias primas"; si se vende, ingreso "Venta de insumos" y costo de ventas; IVA básico |
| Canales | interno: sí · portal: solo clientes habilitados · tienda: no |
| Receta | el servicio "Impresión de papel 1,60" consume 1 m de este papel por metro impreso |

### 5.2 Short de fútbol, verde y rojo

Una ficha "Short de fútbol", unidad base: unidad. Variantes por talle y color.

- Precio del artículo: 500. Precio de la variante "Rojo": 550 → el rojo cuesta 550, todos los demás 500.
- Costo por variante: cada color puede tener su costo; el margen se ve por variante.
- Fotos por color (ya existe) y stock por talle y color (ya existe en el WMS).

### 5.3 Camiseta personalizada (a pedido) y combo "Equipo completo"

**Camiseta de fútbol sublimada** — una ficha, familia Productos › Indumentaria › Camisetas:

| Dato | Valor |
|---|---|
| Roles | se vende, se fabrica; **no** lleva stock (a pedido) |
| Unidad base | unidad; cantidad mínima 10 |
| Precio | cerrado por unidad; variante "manga larga" con otro precio |
| Ficha de fabricación | producción principal Sublimación; molde de TizadaPro obligatorio; procederes: Corte y Costura obligatorios e incluidos, Bordado opcional y se cobra aparte |
| Materiales | tela Deportivo Pro (consumo por talle según el molde), hilo, etiqueta |
| Costo estándar | tela + avíos + corte + costura, calculado |
| Contabilidad | ingreso en "Ventas de indumentaria"; costo = insumos consumidos + procederes |
| Canales | interno y portal; tienda no |

**Combo "Equipo completo"** — una ficha con componentes:

| Componente | Tipo | De dónde sale |
|---|---|---|
| Camiseta de fútbol sublimada | fabricado | su propia ficha de fabricación (la de arriba) |
| Short de fútbol sublimado | fabricado | su propia ficha de fabricación |
| Medias | de stock | depósito de ventas, talle a elegir en el pedido |

Precio propio del combo. Al pedirlo se generan las órdenes de producción de la camiseta y el short, y el retiro de las medias.

---

## 6. Qué pasa con cada tabla de hoy

| Tabla | Destino |
|---|---|
| `Articulos` | **se queda** y se amplía |
| `StockArt`, `ArticuloClasificacion`, `SectorMapeo`, categorías del WMS | se absorben en `ArticuloCategorias`; `StockArt` queda como vista |
| `ConfigMapeoERP` | se queda como configuración de **áreas** (prefijo, orden de ruta); deja de clasificar artículos |
| `Unidades` | se amplía |
| `PreciosBase` | se amplía (variante, unidad) y se limpia |
| `PerfilesPrecios`, `PerfilesItems`, `PreciosEspeciales*` | se quedan |
| `PreciosListaPublica` | pasa a vista |
| Maestros y variantes del WMS | se funden en `Articulos` y `ArticuloVariantes` |
| `Articulos_Wms`, `Articulos_WMS_Variantes` | desaparecen |
| `Insumos`, `InsumosPorArea` | se absorben en `Articulos`; quedan como vista |
| `InventarioBobinas`, `MovimientosInsumos` | pasan al modelo de lotes y movimientos (última fase) |
| `Wms_Compras*`, `Wms_Proveedores` | se quedan; proveedor pasa a ser único |
| `TiendaProductos` | se queda con lo de marketing; pierde las casillas de visibilidad |
| `ProductoVentaConfig` y sus tablas | se quedan (ficha de fabricación); `UM` y las casillas de canal pasan al artículo |
| `ProductoComboItems`, `ProductoAccesorios`, `ProductoAvios`, `ProductoTelas` | convergen en `ArticuloComponentes` |
| `Cont_*` | se quedan; se agregan impuestos, perfiles contables y eventos |

---

## 7. Fases (cada una deja el sistema funcionando)

| Fase | Contenido | Qué se ve |
|---|---|---|
| **0 — Saneo** (sin cambiar el modelo) | código único (3 repetidos); 41 artículos sin familia válida y 7 sin familia; moneda de precios (11 + 25 contradicciones); el bug que convierte IVA 0 en 22; cerrar las rutas `/api/stock` y `/api/insumos`, que hoy no piden sesión | datos confiables para migrar |
| **1 — Ficha y árbol** | columnas nuevas de `Articulos`; `ArticuloCategorias` con herencia; `Unidades` + `ArticuloUnidades`; una sola pantalla "Artículo" con pestañas | árbol de familias, nombre comercial, roles y unidades con conversión |
| **2 — Variantes y precios** | `ArticuloVariantes`; precio por variante y por unidad en el motor; historial de precios | el short rojo a otro precio; el papel por rollo o por metro |
| **3 — Compras y costo** | proveedor único; `ArticuloProveedores`; compra con unidad e impuesto; último costo y promedio; costo en los movimientos; procederes ligados a su artículo de servicio y costo estándar de los productos a pedido | costo y margen por artículo, también de los personalizados y combos |
| **4 — Contabilidad** | impuestos y perfiles contables por familia; asiento por línea; asientos de compra, pago, costo de ventas y consumo | ventas por cuenta según el artículo; IVA correcto; inventario contable |
| **5 — Canales y marketing** | `ArticuloCanales` y `ArticuloAudiencia` leídos por portal, tienda e interno | artículos solo internos, solo e-commerce o solo para ciertos clientes |
| **6 — Stock único** | insumos al maestro; bobinas y tela del cliente al modelo de lotes; recetas; reservas | un solo stock, consumo automático de insumos |

Requisito previo de las fases 2, 3 y 6: **terminar el pase al WMS propio**. Mientras el stock de ventas siga en el WMS externo, las variantes no pueden vivir en el maestro.

Relación con la propuesta del 29-sep: su fase F5 ("Nomenclador") queda incluida en las fases 0 y 1 de esta. Sus fases F2 a F4 (armador de pedidos, terminaciones, componentes en el portal) siguen igual y se pueden intercalar.

---

## 8. Riesgos

| Riesgo | Cobertura |
|---|---|
| `StockArt.TipoStock` hoy decide si algo se cotiza por unidad o por m² y si exige retiro de stock | los roles nuevos se cargan desde `TipoStock`; la vista `StockArt` lo sigue devolviendo hasta cambiar los lectores |
| Los reportes de ventas por sector leen `ArticuloClasificacion` | no se borra hasta que los reportes lean el árbol y den lo mismo |
| El pase al WMS propio borra del lado local lo que el externo ya no tiene | no mezclar la migración de variantes con importaciones del externo; primero el pase, después el maestro |
| Costo en una moneda y valorización en otra | una moneda de costo por variante y conversión al recibir |
| Cambiar la cuenta de ingresos cambia los informes al contador | las cuentas las define el contador antes de la fase 4; los asientos ya hechos no se tocan |
| Las líneas viejas guardan el id de variante del WMS dentro de `CodArticulo` | columna nueva para la variante; las viejas no se reescriben |

---

## 9. Decisiones

**Ya decididas (02-oct):**
- El WMS propio está en producción.
- Una sola lista de artículos e insumos: `Insumos` deja de ser un catálogo aparte.
- Contabilidad: cuentas de ingreso e IVA por familia ahora; inventario contable permanente más adelante.

El detalle de tablas y columnas está en `ESTRUCTURA_NUEVA_maestro_articulos.md`. La comparación con ERP profesionales, módulo por módulo, en `docs/COMPARACION_ERP_que_falta_por_modulo.md`.

- **Costeo:** el stock se valoriza por lote; además se guardan último costo y costo promedio por variante.
- **Clientes habilitados:** cliente por cliente (sin grupos).
- **Factura:** sale el **nombre comercial**; si está vacío, el interno.
- **Combos:** el ingreso se reparte entre las familias de los componentes, en proporción a su precio de lista.

**Pendientes:**

1. **Producto para un solo cliente:** ¿de acuerdo con los dos caminos (artículo con audiencia si se repite; artículo genérico si es por única vez)?
2. **Arranque:** propongo empezar por la fase 0 y la fase 1, que no dependen de nada. El diagnóstico de la fase 0 está en `scripts/diagnostico_fase0_maestro_articulos.sql` (solo lectura).
