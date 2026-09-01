# Spec 08 — Artículos, Stock (WMS), Combos, Tienda y Configurador

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Artículo**, **Variante de Stock (categoría)**, **Grupo**,
> **Terminación**, **Combo**, **Producto Publicado (vitrina)**, **Variante de Depósito**,
> **Producto Configurado**.

## 1. Catálogo de Artículos

- **RN-ART.01** El catálogo es **propio del sistema** (ya no es espejo de un ERP externo).
  Las altas nacen localmente con identificador propio; el vínculo con el producto de un ERP
  sobrevive solo como referencia opcional, vinculable y desvinculable a mano.
- **RN-ART.02** Jerarquía de cuatro niveles: **Super-familia** (Servicios / Productos) →
  **Grupo** (línea de negocio; es lo que se **mapea a un área de producción** y define qué
  perfiles de precios globales aplican) → **Variante de stock** (categoría fina, con nombre,
  unidad de medida y visibilidad) → **Artículo**.
- **INV-ART.01** El código de un Artículo **puede repetirse entre grupos**; toda operación
  sensible identifica artículo **+ categoría**, nunca el código solo. *(Lección: en el
  sistema nuevo el identificador debe ser único de verdad.)*
- **RN-ART.03** Tipos de stock a nivel de categoría, con significado de negocio:
  - **Material**: insumo de impresión (lo único vendible como rollo adelantado).
  - **Producto terminado**: precio cerrado, se fabrica a pedido.
  - **Producto local**: sale del stock físico del local (mismo trato de precio que el
    terminado, más el freno de "retirar de depósito antes de decorar").
  - **Terminación**: servicio/acabado, no material.
- **RN-ART.04** Una categoría no se elimina si tiene artículos (primero moverlos). Un
  artículo con órdenes históricas **no se borra: se oculta**. Borrar un artículo limpia sus
  vínculos con terminaciones.
- **RN-ART.05** **Terminaciones**: catálogo propio con unidad de cobro (unidad / metro /
  m²), regla de cantidad (fija, cada X cm, por tramo de metros), ubicaciones posibles y flag
  "el cliente elige". Vinculación bidireccional material ↔ terminación. Una terminación
  solo puede tener precio si tiene artículo vinculado.

## 2. Stock físico (WMS)

- **RN-WMS.01** El WMS es un sistema externo de depósito con su propia base. La vinculación
  de su catálogo con los artículos locales se hace **por nombre** (con prioridad: productos
  sobre servicios, coincidencia exacta, antigüedad), en dos niveles: maestro y variantes
  (talle/color con SKU). Es un upsert repetible; lo que no matchea queda fuera. *(Lección:
  matchear por nombre es frágil — el sistema nuevo necesita una clave de vinculación
  estable.)*
- **RN-WMS.02** Un artículo sin variantes mapeadas usa una variante "Única" de respaldo.
  Cada variante puede tener **precio de excepción** con moneda propia que pisa el precio
  base. Se guarda además ubicación de picking e imágenes (portada, galería y fotos por
  color).
- **RN-WMS.03** El stock se lee de **un único depósito de ventas** (configurable), sumando
  etiquetas activas con cantidad > 0, siempre por el mismo camino en todos los consumidores.
- **RN-WMS.04** **Falla blanda**: si el WMS no contesta, el catálogo sale igual con stock
  "sin dato" (no cero) — *la venta no se cae si se cae el sistema de stock*.
- **RN-WMS.05** El stock se **descuenta al preparar/retirar en depósito, no al vender**,
  generando remito de egreso en el WMS. WMS caído por completo ⇒ la preparación sí se
  bloquea; faltante puntual de una variante ⇒ advertencia sin abortar.

## 3. Combos

- **RN-CMB.01** Un Combo es un artículo vendible compuesto por otros artículos; su
  composición define por componente la variante de depósito y las unidades por combo.
- **RN-CMB.02** El combo **no existe en el WMS**: al descontar stock se **explota en sus
  componentes** (cantidad por combo × vendida). Componente sin variante mapeada ⇒
  advertencia y se saltea.
- **RN-CMB.03** El stock del combo no se almacena: es el **stock armable** = mínimo entre
  componentes de (stock ÷ cantidad por combo), redondeado hacia abajo.
- **RN-CMB.04** **Ocultamiento**: si algún componente está en 0, el combo no se muestra en
  el portal (excepción a "se vende sin stock"). Si el WMS no contesta, el combo **sí** se
  muestra: ausencia de dato ≠ ausencia de stock.
- **RN-CMB.05** En pedidos de producción: cada componente genera su propia venta de retiro
  de depósito y cada orden de decoración queda atribuida a su componente. Confirmar la
  preparación del retiro del componente **libera** su servicio de decoración.
- **RN-CMB.06** Validación al alta: componente sin variante de depósito vinculada ⇒ el
  pedido **se rechaza antes de crear nada** (fallar temprano antes que dejar una orden
  esperando un retiro que nunca llega).
- **RN-CMB.07** **Precio consolidado**: los retiros de componentes se cotizan en 0; el
  precio del combo lo cobra una única orden. Nunca se factura el artículo suelto.

## 4. Tienda del portal

- **RN-TIE.01** Una capa de **publicación** decide qué artículos se ven en la vitrina
  (flag publicado, solapa, título y descripción de venta, categoría, orden). Los datos
  duros (precio, variantes, stock, fotos) salen del catálogo interno; la vitrina recorta lo
  que un cliente no debe ver (picking, sincronización, edición de precios).
- **RN-TIE.02** Tres solapas: **Terminado** (precio cerrado — único que entra al carrito),
  **Personalizado** y **Confeccionado** (ambos "a cotizar": inician un pedido normal).
- **RN-TIE.03** Las variantes de depósito (texto plano) se parten en ejes talle × color para
  la ficha; si alguna no parsea, se cae a lista plana — **nunca se esconde una variante**.
- **RN-TIE.04** Carrito persistente en el navegador; al checkout **solo viaja qué y
  cuánto, nunca el precio**.
- **RN-TIE.05** Checkout: cliente desde la sesión (jamás del formulario); cliente bloqueado
  rechazado; **precio recalculado en servidor** solo para publicados Terminado; validaciones
  explícitas (despublicado, variante inexistente, cantidad 1–9999, sin precio ⇒ error).
- **RN-TIE.06** Moneda del pedido: si algún ítem es en dólares, **el pedido entero va en
  dólares** convirtiendo los ítems en pesos con la cotización vigente; **sin cotización
  cargada el checkout se rechaza** (no se inventa un tipo de cambio). Se guardan precio
  convertido y precio/moneda originales por línea.
- **RN-TIE.07** La venta lleva **numeración propia correlativa** compartida con la venta
  interna de depósito, generada dentro de la transacción del pedido.
- **RN-TIE.08** Se crea **una única orden ancla** en depósito marcada como venta directa
  (excluida de todas las grillas de producción): existe para generar el bulto/etiqueta.
  Un pedido = un bulto rotulado (más bultos extra numerados N/M si hace falta).
- **RN-TIE.09** **Sin control de stock a propósito** (se vende también sin stock) y **pago
  al retirar**: el pedido nace con cobro pendiente y cae en la bandeja de caja. El pago
  online está previsto como interruptor futuro, sin uso.
- **RN-TIE.10** Tras confirmar (best-effort, nunca aborta la venta): evento de trazabilidad
  y aviso a la estación de impresión, que imprime sola el remito con QR y ubicación de
  picking.
- **RN-TIE.11** DECISIÓN PENDIENTE (negocio, prioridad baja): fidelización en la tienda
  (cupones, puntos, gift cards) — el modelo de promociones con vigencia (Spec 09 §7.2) es
  la base; se activa solo si el negocio lo quiere operar.

## 5. Configurador de Productos

- **RN-CFG.01** Camino aislado que no toca los flujos existentes. Premisa: **el precio
  nunca vive en el configurador** — siempre se escribe al catálogo de precios base.
- **RN-CFG.02** Por producto se configura: **origen de venta** (local / prenda del cliente /
  confeccionado —default— / ambos), **política de cantidad** (mínima o fija, excluyentes,
  enteros > 0), **bypass de validación de stock**, y **estado Borrador/Publicado** (nace
  borrador; publicado = visible en el formulario de pedido web — cosa distinta de la
  vitrina de la tienda).
- **RN-CFG.03** **Técnicas de personalización** por producto: obligatoria o no; modo de
  elección (libre / restringido / fija); cobro (aparte = línea propia, o incluida en el
  precio cerrado). Cada opción concreta de técnica tiene su **artículo que la cotiza** y sus
  medidas como datos.
- **RN-CFG.04** **Componentes** de confección (cuello, manga, puño, costado) con opciones
  permitidas, una predeterminada y precio extra opcional. **Apliques** con posición,
  técnica, opción, cantidad e "incluido".
- **RN-CFG.05** **Variantes por combinación cartesiana** de opciones marcadas: código
  autoasignado + código legible; precio calculado = base + extras, pisable con precio
  manual por variante; **upsert que conserva** estado y overrides de las existentes; tope de
  seguridad de combinaciones; las combinaciones inalcanzables no se borran solas (pueden
  estar referenciadas) pero se reportan obsoletas.
- **RN-CFG.06** **Ficha de diseño** imprimible, guardada como una unidad (todo o nada):
  referencia, marca, material (sugiere la tela del cliente), tallas, dibujo técnico propio
  (distinto de la foto de catálogo) con **anotaciones posicionadas en porcentaje**, campos
  libres etiqueta/valor, y **costuras** clasificadas con un catálogo chico de tipos ISO,
  con sugerencia automática por despiece.

## 6. Interacciones

| Módulo | Interacción |
|---|---|
| Precios (Spec 09) | Precio base por artículo+moneda; excepciones por variante de depósito; el configurador escribe precios al catálogo. |
| Recursos (Spec 07) | El tipo Material define qué se vende como rollo adelantado. |
| Pedidos (Spec 02) | El configurador alimenta el formulario web; combos generan retiros por componente. |
| Logística (Spec 04) | Descuento de stock al preparar; remitos de egreso; venta de tienda como bulto a depósito. |
| Caja (Spec 05) | La venta de tienda nace impaga y se cobra al retirar. |
