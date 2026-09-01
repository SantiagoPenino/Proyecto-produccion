# Spec 18 — Documentos Imprimibles y Reportería (to-be)

> Spec de escalamiento. Todo lo que el sistema imprime, genera en PDF, almacena y deja
> descargar se trata como un **módulo único de documentos imprimibles**, con plantillas y
> variantes por dispositivo — no como código de impresión repartido por cada pantalla.
> Entidades definidas aquí: **Plantilla de Documento**, **Variante de Formato**,
> **Documento Generado**, **Estación de Impresión**, **Reporte**.

## 1. Diagnóstico del sistema actual

Inventario real de lo que hoy se imprime/genera, cada uno resuelto a su manera:

| Documento | Cómo se genera hoy |
|---|---|
| Factura / e-Ticket / NC (PDF) | **El navegador del operador** lo dibuja y lo manda en base64 (decisión deliberada: una sola maquetación) |
| Recibo de cobro / anticipo | PDF por pantalla |
| Arqueo de cierre de caja | PDF **guardado en servidor** y regenerable — el único con almacenamiento sistemático |
| Etiquetas de bulto / lote / falla | Térmica 10×15, generadas por el backend |
| Remito (tienda, encomiendas) | A4 con QR, impreso por la **estación de impresión** automática; encomiendas agrupadas por agencia con doble firma |
| Comprobante de retiro / anuncio | Ticket del tótem, con voz |
| Comprobante de recepción de tela | PDF automático |
| Estado de cuenta | PDF adjunto al email, con cola de aprobación |
| Libro mayor / resumen 360 | PDF y Excel por pantalla |
| Libros del contador | CSV por empresa |

Problemas: el mismo concepto tiene generadores distintos según la pantalla; casi ningún
PDF emitido **se conserva** (se regenera con datos de hoy, que pueden haber cambiado); la
elección térmica vs A4 está cableada por flujo; no hay un lugar donde ver/descargar "todo
lo que se le emitió a este cliente".

## 2. El modelo: plantilla × variante × generación

- **RN-DOC.01** Existe un **catálogo de Plantillas de Documento**: factura, recibo,
  ticket, etiqueta de bulto, etiqueta de lote, remito, comprobante de retiro, arqueo,
  estado de cuenta, ficha de diseño… Cada plantilla declara qué datos recibe (su
  contrato) y a qué entidad de negocio pertenece.
- **RN-DOC.02** Cada plantilla tiene **Variantes de Formato**: térmica 10×15, ticket
  80 mm, A4, media A4 — la MISMA información adaptada al medio. Qué variante se usa lo
  decide la **estación/impresora de destino**, no el código del flujo: un remito puede
  salir A4 en depósito y ticket en mostrador sin duplicar lógica.
- **INV-DOC.01** **Un documento de negocio tiene UNA fuente de maquetación** (se conserva
  la lección del CFE: el cliente recibe exactamente lo que el operador ve), pero la
  generación pasa al **servidor, determinística**: mismos datos → mismo PDF, sin depender
  del navegador de turno.
- **RN-DOC.03** Toda plantilla es **versionada**: se sabe con qué versión se generó cada
  documento; cambiar la plantilla no altera lo ya emitido.

## 3. Generación, almacenamiento y descarga

- **INV-DOC.02** **Todo documento emitido con valor de negocio se genera una vez y se
  almacena** (el modelo del arqueo, generalizado): facturas, recibos, remitos firmables,
  estados de cuenta enviados, comprobantes. Reimprimir o re-descargar entrega **el mismo
  archivo**, no una regeneración con datos actuales — un documento histórico no puede
  cambiar por reimprimirse (coherente con Spec 09 INV-PRE.02).
- **RN-DOC.04** El Documento Generado guarda: plantilla y versión, variante, fecha,
  quién lo generó, la entidad de negocio a la que pertenece y el archivo (en el
  repositorio de archivos, Spec 19). Regenerar es una acción explícita y auditada que
  crea una **nueva versión** sin borrar la anterior.
- **RN-DOC.05** **Descargables desde donde se los espera**: la entidad muestra sus
  documentos (la factura desde la bandeja y el 360; el remito desde el envío; el arqueo
  desde el cierre), y el cliente del portal ve y descarga los suyos (con pertenencia,
  Spec 12).
- **RN-DOC.06** Los documentos con numeración (facturas, recibos, remitos) imprimen
  **el número correcto según su estado**: el oficial DGI si están aceptados, el interno
  si no (regla actual del email, generalizada a todo medio).

## 4. Estaciones de impresión

- **RN-DOC.07** Las **Estaciones de Impresión** son Dispositivos Autorizados (Spec 12
  RN-SEG.09) con sus impresoras declaradas (tipo, formato, ubicación). Un evento de
  negocio (venta de tienda, anuncio de tótem) **enruta** el documento a la estación que
  corresponde — formaliza la estación automática actual.
- **RN-DOC.08** La impresión automática es best-effort declarado (Spec 15 RN-ERR.06):
  si la estación está caída, el trabajo queda **en cola visible** y reimprimible — nunca
  se pierde en silencio.

## 5. Reportería (lo que se consulta, no lo que se emite)

- **RN-DOC.09** Los **Reportes** (ventas por área, top clientes, antigüedad, desperdicio,
  capacidad) son distintos de los documentos: se generan **al momento con datos vivos**,
  sobre la capa de lectura (Spec 16 RN-ARQ.12), exportables a PDF/Excel/CSV con el mismo
  motor de plantillas.
- **RN-DOC.10** Un reporte exportado que **se entrega a un tercero** (libros del
  contador, estado de cuenta enviado) cruza la frontera y se convierte en Documento
  Generado: se almacena con fecha y filtros usados, porque "qué le mandamos al contador
  en julio" es una pregunta de negocio.
- **RN-DOC.11** Todo reporte declara sus filtros y su definición de los términos que usa
  ("venta incluye Pedidos Caja", Spec 06 RN-REP.02) — visible en el propio reporte, para
  que dos personas mirando números distintos puedan descubrir que filtraron distinto.

## 6. Interacciones

| Con | Relación |
|---|---|
| Spec 19 | Los PDFs generados se almacenan en el repositorio de archivos, con su metadata. |
| Spec 06 | El PDF de la factura se congela al emitir; número oficial DGI cuando existe. |
| Spec 12 | Estaciones como dispositivos; descarga con pertenencia y permisos. |
| Spec 13 | Cada generación, reimpresión y descarga sensible queda en el libro. |
| Spec 15 | Impresión automática best-effort con cola visible. |
