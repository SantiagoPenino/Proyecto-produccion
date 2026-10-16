# Deploy: integración TizadaPro (configurador + solicitudes) y limpieza

Fecha: 25-sep-2026. Todo probado en LOCAL (SQL corrido, 21 pruebas de backend OK, frontend compila y el vite lo sirve). Sin commit.

## Qué cambia

- **TizadaPro es el dueño del molde.** Piezas, talles, modelos (variantes de piezas), telas permitidas por pieza y consumo de tela viven en su base. Nuestro sistema **solo la lee** (nunca escribe).
- **Configurador de productos:** el paso "Componentes y apliques" + "Variantes" se reemplaza por **"Molde, telas y apliques"**: se vincula el producto a su molde de TizadaPro, se marca qué **modelos** se venden, qué **telas** se ofrecen (solo las que el molde admite, con su precio de lista a la vista, sin editarlo), y los apliques se ubican sobre una pieza del molde. Las pestañas "Componentes (confección)" y "Piezas de la prenda" desaparecen.
- **Solicitudes:** en la producción principal aparece el bloque **"Tizada (TizadaPro)"**. El diseñador vincula la tizada terminada (lista leída de TizadaPro, filtrada por el molde del producto) y sube **a mano** el PDF de cada hoja. La tela, el ancho y los metros de cada PDF salen de la tizada, no de medir el archivo. La conversión a pedido no cambia.
- **Solicitudes — "Piezas y telas"** (28-sep): para un producto del catálogo con molde, el vendedor elige el modelo y, por pieza, la tela (de las que ofrece el producto) y el arte del cliente. Va en `DatosJson.sublimacion` del producto de la solicitud (**sin SQL nuevo**), se ve en la ficha PDF, y la producción principal **no sale a Diseño** hasta que esté completo (409). Rutas: `GET /solicitudes-vendedor/:id/productos/:productoSolId/molde`, `PUT …/sublimacion`. El trabajo del diseñador salió de la solicitud: vive en **/ventas/solicitudes/:id/diseno** (la bandeja lleva ahí); la solicitud solo muestra el estado de cada servicio. La "Lista de talles" ya no es paso del formulario: se carga en la solicitud (`PUT …/talles`). Enviar a Diseño exige piezas y telas completas + planilla de talles (o nota) salvo productos por medidas. Quitar el único diseño pronto de un servicio que no pasó por Diseño lo devuelve a Ingresado.
- **Se descarta** (código borrado + tablas quitadas por el SQL): moldes escalados (`/moldes`, `Moldes`, `MoldePiezas`, `MoldeNidoTalles`, `CurvasTalle`, `CurvaTalleItems`), componentes de confección (`ComponenteOpciones`, `ComponenteOpcionPiezas`, `ProductoComponentes`), variantes cartesianas (`ProductoVariantes`, `CodigoCorto`) y el nomenclador de piezas (`PiezasPrenda`). Eran configuración y semillas: ningún pedido apuntaba a esas tablas.

## F1 — Producción principal genérica (29-sep)

- **Qué es:** el producto dice qué área lo produce (`ProductoVentaConfig.TecnicaPrincipal`: SB, DIRECTA, ECOUV…), si lleva molde de TizadaPro (`Molde`: OBLIGATORIO / OPCIONAL / NO), su medida fija (`AnchoM/AltoM/BordeCm`), cómo se cuenta (`UM`) y en qué canales se ve (`VisiblePortal/VisibleTienda/VisibleInterno`, por ahora solo guardados; la casilla Tienda mantiene `TiendaProductos.Publicado`). Configurador: paso nuevo **"Producción principal"** + filtro de la lista por área. Solicitud/Diseño: la producción principal, las telas por archivo y el candado de Enviar a Diseño siguen al producto (sin molde → archivo a medida fija; Molde = NO → sin planilla de talles). Conversión a pedido: el validador acepta `sublimacion`, `directa_320` y `ecouv`; el traductor arma la orden del área principal con la variante física del material; el creador interno encadena Corte/Costura a DIRECTA/ECOUV igual que a SB. **ECOUV no se toca.**
- **SQL:** `docs/migrations/configurador_f1_produccion_principal.sql` (idempotente, solo agrega columnas; backfill SB/OBLIGATORIO a los confeccionados la primera vez). Correr ANTES del deploy. Sin el SQL, el backend sigue funcionando como antes (todo guardado por `COL_LENGTH`).
- **Pendiente (F3):** que el pedido controle la medida fija del producto (hoy controla la del material, `largoimprimible`) y que el pedido interno / portal / tienda respeten Modo, Cobro, cantidades y canales.

- **Ficha del pedido desde el pedido** (30-sep): `services/fichaPedidoPdf.js` arma el PDF (pedido, producto y su configuración, órdenes, archivos, cobro) para cualquier vía de ingreso y lo pega a la PRO como FICHA_PEDIDO al crear el pedido (pedido-prenda) — la solicitud sigue adjuntando la suya y no se duplica. Botón "Generar / actualizar la ficha" en Archivos de Referencia de la PRO. Rutas `POST/GET /orders/:ordenId/ficha-pedido`. Sin SQL.

## Orden en producción

1. **Permiso de lectura sobre TizadaPro** (una vez, en SSMS): el login que usa el backend (`DB_USER` del `.env`) necesita `db_datareader` en la base `TizadaPro`. El bloque exacto está comentado en la sección C de `scripts/add_solicitudes_tizadapro.sql`. Sin esto, el configurador muestra "No se pudo leer TizadaPro" y la solicitud no lista tizadas, pero nada más se rompe.
2. `docs/migrations/configurador_tizadapro.sql`
2b. `docs/migrations/configurador_f1_produccion_principal.sql` — producción principal, molde, medida fija, canales (F1).
2c. `docs/migrations/configurador_accesorios.sql` — tabla ProductoAccesorios (accesorios de stock de un producto fabricado: mástil, base…). Idempotente; sin ella el paso del configurador guarda vacío y los pedidos no generan accesorios.
2d. `docs/migrations/limpiar_linea_fantasma_directa_ecouv.sql` — borra la línea "Impresión Directa… " duplicada del archivo en pedidos DIRECTA/ECOUV de producto terminado (Control mostraba 2 ítems y la cotización por área cobraba dos veces). Correr DESPUÉS del deploy del backend. Idempotente.
2e. `docs/migrations/areas_entrega_directa_ecouv.sql` — Areas.Entrega = TELA para DIRECTA/ECOUV (sin esto la tela impresa llega a Corte y el requisito "Tela para Corte" queda Pendiente) + repara los ya recibidos. Idempotente.
2f. `docs/migrations/requisito_accesorios_pro.sql` — requisito PRO/ACCESORIOS ("Accesorios de stock recibidos en Producción"), no bloqueante en el motor (el bloqueo real lo hacen aprobar-control de PRO y el ingreso a Depósito) + reparación de los ya recibidos. Idempotente.
2g. `docs/migrations/requisito_tpu_estampado.sql` — requisito EST/TPU ("TPU a Estampar", bloqueante) + deja resuelto el requisito en los Estampados ya existentes (solo queda pendiente el Estampado abierto cuyo transfer TPU todavía no llegó) + corrige el texto "Prendas a Etampar". Idempotente. **Correrlo DESPUÉS del deploy del backend (paso 4)**: con el backend viejo, la llegada del TPU cumple "DTF a Estampar" y los Estampados de TPU quedarían trabados esperando este requisito.
2h. `docs/migrations/reparar_estampado_hermana_sin_bulto.sql` — Estampados que quedaron "Pronto" sin bulto propio aunque el bulto de su hermana (misma prenda, DTF + TPU) ya viajó o llegó: les pone el estado de la hermana. Idempotente. **Correrlo DESPUÉS del deploy del backend (paso 4)**, que es el que evita que vuelva a pasar.
3. `scripts/add_solicitudes_tizadapro.sql` — tizadas vinculadas a la solicitud.
4. Deploy del backend y del frontend.

Los dos SQL se pueden correr dos veces sin efecto. Si el backend sale antes que los SQL, el listado del configurador sigue funcionando (sin modelos ni telas) y los botones de tizada avisan "Falta correr…".

**No correr** `docs/migrations/configurador_etiquetas.sql` en producción hasta decidir si la etiqueta (Básquet, Fútbol) queda o pasa a ser categoría. En local está aplicado y no molesta.

## Variables de entorno (opcional)

- `TIZADAPRO_DB`: nombre de la base de TizadaPro si no se llama `TizadaPro` (solo letras, números y `_`).

## Qué NO hace todavía

- No copia los PDF de TizadaPro: se suben a mano (TizadaPro no expone los archivos).
- Las **siluetas de las piezas** salen de subir una vez el PDF del molde (botón en la tarjeta del molde, paso "Molde, telas y apliques"). Sin ese PDF se ve el espacio que ocupa cada pieza, no su forma. Tiene que ser el mismo archivo que se cargó en TizadaPro (mismas coordenadas). Carpeta: `backend/uploads/moldes-tizadapro/`. Verificado en local con "Short basket 4 piezas.pdf" (120 de 120 cajas) y "camiseta polo.pdf" (molde CAMISETA POLO CARTERA, 160 de 160).
- El precio de la tela no se edita en el configurador (decisión del 28-sep: es competencia de Precios). Cómo entra la tela al precio de la prenda queda para el motor de precios.
- No frena el pedido web por modelos/telas ofrecidos (F4 del configurador, pendiente de antes).
