# Spec 25 — Cumplimiento Legal y Datos Personales (to-be)

> Marco legal uruguayo aplicable al sistema: fiscal (DGI/CFE), protección de datos
> personales (Ley 18.331 y su reglamentación) y conservación documental. Los plazos
> concretos marcados como DECISIÓN PENDIENTE deben confirmarse con el contador y/o
> asesor legal antes de implementarse — esta spec fija el mecanismo; ellos fijan el
> número.

## 1. Conservación fiscal y documental

- **RN-LEG.01** Los documentos fiscales (CFE emitidos, con su PDF congelado — Spec 18
  INV-DOC.02), sus asientos, deudas y pagos se conservan **al menos el plazo de
  prescripción tributaria**.
  > DECISIÓN PENDIENTE (contador): plazo exacto a configurar (la prescripción DGI es de
  > 5 años, extensible a 10 en ciertos casos — confirmar criterio del estudio).
- **RN-LEG.02** Los libros del contador exportados (Spec 18 RN-DOC.10) y los respaldos de
  la base fiscal siguen el mismo plazo. La retención se implementa con el mecanismo de la
  Spec 13 RN-TRZ.06 y Spec 21 RN-ADM.07: **nada referenciado por un documento fiscal
  vigente puede purgarse** (garantizado por estructura).
- **RN-LEG.03** Los requisitos operativos del CFE ya especificados se consolidan acá como
  obligaciones legales: numeración oficial DGI en toda comunicación al cliente,
  referencia obligatoria en NC/ND, umbral de identificación del comprador en UI,
  inmutabilidad del documento aceptado.

## 2. Datos personales (Ley 18.331)

- **RN-LEG.04** **Inventario de datos personales**: el sistema declara qué datos
  personales guarda y para qué — identificación y contacto de clientes (nombre,
  documento, teléfono, correos, dirección), datos de diseñadores, datos de usuarios
  internos, IPs en auditoría. Cada categoría con su finalidad y su plazo.
- **RN-LEG.05** **Finalidad y minimización**: los datos se usan para operar el negocio
  (pedidos, entregas, facturación, avisos). El **consentimiento de comunicaciones no
  operativas** (newsletter, promos) es un flag propio del cliente, separado de los avisos
  operativos (el aviso de "tu pedido está pronto" es ejecución del contrato; la promo
  no).
- **RN-LEG.06** **Derechos del titular**: el sistema puede responder a un pedido de
  acceso ("qué datos tenés de mí" — exportable desde la ficha), rectificación (edición
  auditada) y supresión — con la salvedad legal: **los datos dentro de documentos
  fiscales vigentes no se suprimen** (obligación fiscal prima); se suprime/anonimiza lo
  demás (contacto, portal, marketing).
  > DECISIÓN PENDIENTE (asesor): procedimiento formal de respuesta y plazos.
- **RN-LEG.07** **Los datos reales no viajan a ambientes de prueba** (Spec 24 RN-PRU.03).
  La réplica local para diagnóstico es un ambiente controlado del responsable — no un
  ambiente de desarrollo compartido.
- **RN-LEG.08** Acceso a datos personales bajo permiso y auditado (Spec 12 RN-SEG.12):
  exports masivos de clientes quedan en el libro con quién y cuándo; documentos de
  identidad enmascarados por defecto.
- **RN-LEG.09** **Incidentes de seguridad**: si se detecta acceso indebido a datos
  personales, existe un registro del incidente y un responsable de evaluarlo/notificar
  según corresponda.
  > DECISIÓN PENDIENTE (asesor): protocolo de notificación (URCDP / titulares).

## 3. Retenciones por tipo (la tabla que gobierna las purgas)

Consolidación de las retenciones dispersas (Specs 13, 19, 21), a confirmar los números:

| Tipo de dato | Retención propuesta | Estado |
|---|---|---|
| Documentos fiscales + PDFs + asientos | Plazo de prescripción tributaria | PENDIENTE contador |
| Eventos de negocio (libro) sobre dinero | Igual al fiscal | PENDIENTE contador |
| Eventos de negocio operativos (estados, logística) | 5 años propuestos | PENDIENTE |
| Artes y archivos de pedidos entregados | 2 años calientes + frío, propuesto | PENDIENTE negocio |
| Bocetos rechazados / archivos zombie | 6 meses propuestos | PENDIENTE negocio |
| Logs técnicos (HTTP, integraciones) | 90 días | Propuesto |
| Registros de acceso/auditoría de seguridad | 2 años propuestos | PENDIENTE |
| Datos de clientes inactivos (sin operaciones) | Anonimización a los N años | PENDIENTE asesor |

- **INV-LEG.01** Ninguna purga corre sin que su fila de esta tabla esté en estado
  CONFIRMADO. Mientras tanto, se conserva todo.

## 4. Interacciones

| Con | Relación |
|---|---|
| Spec 13 / 19 / 21 | Esta spec fija los plazos que aquellas ejecutan (retención, purgas, archivado). |
| Spec 12 | Acceso a datos personales con permiso y registro; enmascaramiento. |
| Spec 24 | Datos sintéticos en pruebas. |
| Spec 06 / 18 | Obligaciones CFE y conservación de documentos emitidos. |
