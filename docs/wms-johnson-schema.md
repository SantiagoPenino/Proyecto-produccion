# WMS Johnson (`Ventas_Dev`) — schema reconstruido

**Fecha:** 2026-08-26 · **Fuente:** reconstruido del código de `stock-amazon` y **confirmado el mismo día contra la base viva** (queries A-D por el proxy — el RDS `database-1...` de los scripts YA NO EXISTE; el único acceso real es el proxy `3.85.26.173:5005/sql`). Resultados crudos + **snapshot completo del WMS (27 tablas, 71.429 filas, paridad verificada contra la query C)** en `docs/wms-data/`. DDL propuesto para nuestras tablas: `docs/wms-data/DDL-wms-propio.sql`.

Convención de la base: snake_case, multi-depósito; OJO: movimientos y compras usan **GUID** como id (+ `numero_secuencial`), el resto INT.

**Hallazgos de la confirmación (26/08):**
- **Volumetría chica**: 54.387 etiquetas (~4.800 activas en 7 depósitos; el 5 nuestro: 186 etiquetas / 10.817 unidades), 11.676 movimientos, 413 variantes, 142 maestros — la migración entera son ~71k filas.
- **`Ventas_Dev` no es solo el WMS**: conviven un sistema de órdenes/clientes ajeno (`ordenes_maestras` 134k + `ordenes_servicios` 144k + `clientes` 3.089) y una suite de WhatsApp (`whatcon_*`). El ETL no los toca; y "apagar AWS" involucra a esos sistemas, no solo al stock.
- **Los triggers, aclarados**: son solo DOS. `trg_StockMovimientos_AfterInsert` descuenta etiquetas **únicamente para `egreso_venta_web`** (nuestras ventas); el resto de su app actualiza `cantidad_actual` A MANO. Y `trg_StockEtiquetas_PreventDirectDiscount` es un candado anti-manoseo: rechaza todo UPDATE que baje cantidades si la conexión no creó antes la tabla-firma `#WmsSecureTx_v17` — ese es el único "auth" real del sistema. En el nuestro: cero triggers, todo por el servicio en transacción.
- Columnas descubiertas en la confirmación: `Stock_Etiquetas.medida_secundaria` (ej. metros cuando la unidad es kg) y `ultima_actualizacion`; `Stock_Productos_Maestros.lleva_peso`, `tipo_gestion` ('granel'/…), `variantes_requeridas_json`, `costo_unitario_base`; `Stock_Depositos.tipo`. `Stock_Consumo_Historico` y `Stock_Alertas_Depositos` están **vacías** (las alertas predictivas nunca se usaron — F4 nuestro arranca de cero sin perder nada).

## Núcleo de stock

- **`Stock_Depositos`** — id, nombre, ubicacion. (El local nuestro = **id 5**.)
- **`Stock_Categorias`** — id, nombre, descripcion.
- **`Stock_Productos_Maestros`** — id, nombre, sku, categoria_id, unidad_base, tipo_gestion, atributos_config (JSON de ejes talle/color).
- **`Stock_Variantes`** — id, producto_maestro_id, nombre_variante, codigo_variante, costo, moneda, metadata_json, stock_minimo_esperado, cantidad_alerta, cantidad_critica, cantidad_ideal, alerta_activada. *(Nuestro `Articulos_WMS_Variantes.wms_variante_id` apunta acá — estos ids se conservan en la migración.)*
- **`Stock_Etiquetas`** — id, variante_id, deposito_id, compra_id, cantidad_inicial, cantidad_actual, costo_unitario_real, codigo_barras, peso, estado ('activo'/…). **Stock de una variante = SUM(cantidad_actual) de etiquetas activas.** `cantidad_actual` la mantienen TRIGGERS a partir de los movimientos (por eso nuestro egreso inserta movimientos y no updatea).
- **`Stock_Movimientos`** — id, etiqueta_id, tipo_movimiento (ingreso / egreso_final / egreso_auto / baja_consumo / **egreso_venta_web** ← el nuestro / …), cantidad_afectada, deposito_origen_id, deposito_destino_id, remito_id, referencia_compra_id, usuario_id, fecha.
- **`Stock_Alertas_Depositos`** — variante_id, deposito_id, cantidad_alerta, cantidad_critica, cantidad_ideal (umbral por depósito, pisa el de la variante).
- **`Stock_Consumo_Historico`** — id, variante_id, anio, mes, cantidad_consumida (base de las alertas predictivas).

## Logística interna

- **`wms_remitos_internos`** — id, numeracion, deposito_origen_id, deposito_destino_id, creado_por, estado (EN_TRANSITO / RECIBIDO / CANCELADO / **EGRESO_WEB** ← los nuestros), fecha_creacion.
- **`wms_remitos_internos_items`** — id, remito_id, variante_id, cantidad_enviada, **cantidad_recibida**, estado, etiqueta_generada_id (la etiqueta que nace al recibir).
- **`wms_solicitudes`** — id, numeracion, deposito_solicitante_id, creado_por, estado. + **`wms_solicitudes_items`** — solicitud_id, variante_id, cantidad_solicitada. (Pedidos de reposición entre depósitos.)
- **`wms_equivalencias_metricas`** — id, producto_maestro_id, gramos_por_metro_lineal (conversión kg↔metros para telas/rollos).

## Abastecimiento

- **`Stock_Proveedores`** — id, nombre, razon_social, documento, contacto, ciudad.
- **`Stock_Compras`** — id, proveedor_id, importacion_id, referencia_factura, tipo_factura_id, moneda_id, total_compra, gastos_extras, estado, progreso, plantilla_progreso_id, autorizado_recepcion (gate: sin autorizar no se recepciona), creado_por, fecha_creacion.
- **`Stock_Compras_Detalle`** — compra_id, variante_id, cantidad, precio_unitario, costo_puesto_local (costo con gastos prorrateados).
- **`Stock_Compras_Costos_Extra`** — compra_id, descripcion, monto.
- **`Stock_Importaciones`** — id, origen, empresa_importadora, contacto_importadora, empresa_transporte_local, contacto_transporte_local, estado, progreso, plantilla_progreso_id, creado_por, fecha_creacion.
- **`Stock_Pagos`** — compra_id, importacion_id, monto, motivo, tipo_pago. + **`Stock_Pagos_Motivos`** (catálogo).
- **`Stock_Plantillas_Progreso`** — nombre, descripcion. + **`Stock_Plantillas_Progreso_Pasos`** — plantilla_id, clave, etiqueta, icono, orden. (Workflows configurables de compra/importación.)
- **`Stock_Monedas`** — id, codigo, nombre, simbolo. **`Stock_TiposFactura`** (catálogo).

## Sistema (no se migran — lo cubre lo nuestro)

- **`usuarios`** — id, nombre_completo, cedula, pass, rol, permisos (login por SQL crudo → lo reemplazan nuestros usuarios/roles).
- **`roles`**, **`WMS_Sys_Icons`**, **`wms_sys_ui_config`** (personalización de UI), **`wms_atributos_base`** / **`wms_atributos_valores_base`** (ejes de atributos → se unifican con las variantes Talle/Color nuestras), **`Vista_Capital_Activo`** (vista de valorización).

## Queries de confirmación (correr en `Ventas_Dev` — solo lectura)

**A. Tipos exactos de todo (pega el resultado y congelo el DDL propio):**
```sql
USE Ventas_Dev;
SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE,
       CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME LIKE 'Stock[_]%' OR TABLE_NAME LIKE 'wms[_]%' OR TABLE_NAME IN ('usuarios','roles')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

**B. Volumetría (dimensiona el ETL y los índices):**
```sql
USE Ventas_Dev;
SELECT t.name AS tabla, SUM(p.rows) AS filas
FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY t.name ORDER BY filas DESC;
```

**C. Foto del stock vivo (la base de la apertura):**
```sql
USE Ventas_Dev;
SELECT deposito_id, COUNT(*) AS etiquetas_activas, SUM(cantidad_actual) AS unidades
FROM Stock_Etiquetas WHERE estado = 'activo'
GROUP BY deposito_id ORDER BY deposito_id;
```

**D. Triggers (qué mantiene `cantidad_actual`, para replicar la regla — no el trigger):**
```sql
USE Ventas_Dev;
SELECT OBJECT_NAME(parent_id) AS tabla, name AS trigger_name, OBJECT_DEFINITION(object_id) AS definicion
FROM sys.triggers WHERE parent_id IN (OBJECT_ID('Stock_Etiquetas'), OBJECT_ID('Stock_Movimientos'), OBJECT_ID('wms_remitos_internos_items'));
```

Dónde correrlas: SSMS conectado al RDS (`database-1.cdwyyw0q8yl4.us-east-1.rds.amazonaws.com`, usuario `admin` — la credencial está en `test_db.cjs` de la carpeta stock-amazon), o vía el proxy `3.85.26.173:5005/sql` con curl. Son todas SELECT.
