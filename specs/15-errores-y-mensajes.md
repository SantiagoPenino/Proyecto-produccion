# Spec 15 — Tratamiento de Errores y Mensajes al Usuario (módulo dedicado, to-be)

> Spec de escalamiento: el sistema nuevo trata los errores y los mensajes como una
> **política central**, no como decisión de cada pantalla o controlador.
> Entidades definidas aquí: **Error de Negocio (catálogo)**, **Mensaje**, **Política de
> Reintento**, **Operación Best-Effort**, **Alerta Operativa**.

## 1. Diagnóstico del sistema actual

Hoy cada flujo improvisa, y conviven cuatro comportamientos incompatibles:

1. **Errores tragados en silencio**: las Notas de Crédito se guardaron **durante meses sin
   asiento contable** porque el fallo solo se logueaba; las etiquetas que no podían
   generarse dejaban el motivo en el log y el operario se enteraba recién al ir a
   despachar; el WhatsApp en modo simulado marca la orden como avisada **sin avisar a
   nadie**.
2. **Best-effort sin declarar**: muchos flujos deciden "esto nunca rompe la operación"
   (área en la línea, historial de emails, eventos contables, aviso a la estación de
   impresión) — la decisión es correcta caso a caso, pero es implícita, invisible y sin
   ningún mecanismo que después repare lo que falló.
3. **Mensajes excelentes conviviendo con mensajes crudos**: el sistema tiene mensajes
   modelo ("la bobina solo tiene X m disponibles, el pedido requiere Y"; el cuadre
   pre-DGI con la diferencia exacta y la solución; "Envío SIMULADO: no hay credenciales,
   el mail no salió"; "no está esperando aprobación de nadie, falta abrir el enlace") —
   y a la vez errores técnicos que llegan tal cual al usuario, sin catálogo ni tono común.
4. **Reintentos ad-hoc**: el reintento ante bloqueo de base existe solo donde alguien lo
   agregó (caja, tótem); el resto de las operaciones falla a la primera.

Regla de la casa ya establecida (feedback del usuario): **claridad máxima** — cada label,
confirmación y toast dice exactamente qué hace la acción. Esta spec la eleva a política.

## 2. Taxonomía: todo error tiene un tipo

- **RN-ERR.01** Todo error pertenece a una de cuatro clases, y la clase decide el
  tratamiento:

| Clase | Ejemplo | Tratamiento |
|---|---|---|
| **Validación de negocio** | Bobina sin metros, pedido incompleto, cliente bloqueado | Mensaje claro al usuario con el dato y la salida. Nunca es "error del sistema". |
| **Conflicto** | Doble click, remito ya recibido, documento ya aceptado, edición concurrente | Se informa el estado real y qué hacer; la operación repetida responde éxito idempotente o conflicto explícito, jamás duplica. |
| **Técnica transitoria** | Bloqueo de base, WMS caído, proveedor CFE sin responder | **Reintento automático según política central** (§5); si se agota, mensaje honesto + registro. |
| **Técnica permanente** | Bug, dato corrupto, configuración faltante | El usuario recibe un mensaje genérico con **código de referencia**; el detalle técnico va al libro y a la alerta operativa — nunca a la pantalla. |

- **INV-ERR.01** **Ningún error desaparece**: o llega al usuario como mensaje, o queda
  como Alerta Operativa visible para administración, o ambas. El log técnico existe
  además, nunca en lugar de.

## 3. Catálogo central de errores y mensajes

- **RN-ERR.02** Los errores de negocio y conflicto viven en un **catálogo administrable**:
  código estable, clase, plantilla de mensaje con variables, y salida sugerida. El código
  viaja en toda respuesta de error — soporte y el libro de trazabilidad lo referencian.
- **RN-ERR.03** **Anatomía obligatoria del mensaje al usuario** (el estándar que ya tienen
  los mejores mensajes actuales): *qué pasó* + *el dato concreto* + *qué hacer ahora*.
  "No se pudo X" a secas está prohibido. Ejemplos canónicos a imitar: el de la bobina, el
  del cuadre pre-DGI, el del envío simulado.
- **RN-ERR.04** **El mensaje distingue al destinatario**: el cliente del portal recibe
  lenguaje de cliente (sin códigos internos ni jerga); el operador interno recibe el dato
  operativo (orden, importe, estado); administración recibe el detalle técnico vía alerta.
  La misma falla produce los tres niveles desde el mismo catálogo.
- **RN-ERR.05** Confirmaciones y acciones destructivas siguen la regla de claridad
  máxima: el texto dice exactamente qué va a pasar, con los datos del caso ("Forzar
  ingresa el pedido ENTERO, se contabiliza y se avisa al cliente aunque falten bultos") —
  nunca un "¿Está seguro?" genérico.

## 4. Best-effort declarado (nunca silencioso)

- **RN-ERR.06** Una operación secundaria puede declararse **Best-Effort** (no rompe la
  principal), pero la declaración es explícita y conlleva tres obligaciones:
  1. El fallo queda registrado como **pendiente de reparación** (no solo logueado).
  2. Existe un mecanismo de **reproceso** (manual o job) que lo completa después — la
     generalización de los backfills que hoy se escriben a mano tras cada incidente.
  3. Si el pendiente afecta al negocio (un asiento sin generar, un aviso sin salir), es
     **visible en una bandeja** hasta resolverse.
- **INV-ERR.02** Un "modo simulado" (sin credenciales de un proveedor) **jamás marca la
  operación de negocio como hecha**: el envío queda en estado Simulado, visible, y la
  marca de negocio (avisado, enviado) solo la pone un resultado real. (Corrige la regla
  actual del WhatsApp.)

## 5. Política central de reintentos

- **RN-ERR.07** Los reintentos ante fallas transitorias son **una política del módulo**
  (cuántos, con qué espera, para qué clases de error), aplicada por la infraestructura a
  toda operación — no un privilegio de los flujos donde alguien lo escribió.
- **INV-ERR.03** Solo son reintentables las operaciones **idempotentes o transaccionales
  completas** (Spec 11, invariante 9). El motor lo exige: una operación no marcada como
  segura no se reintenta sola.
- **RN-ERR.08** Dependencias externas (WMS, proveedor CFE, WhatsApp, email, pasarelas)
  declaran su **modo de degradación**: qué se bloquea (preparar sin WMS), qué sigue con
  dato faltante (catálogo con stock "sin dato"), qué se encola para después (avisos).
  Las decisiones que hoy existen caso a caso se vuelven contrato explícito por proveedor.

## 6. Alertas operativas

- **RN-ERR.09** Las fallas técnicas y los pendientes de reparación generan **Alertas
  Operativas** en una bandeja de administración (y opcionalmente notificación), con
  correlación al libro (Spec 13): qué operación, qué entidad, cuántas veces, desde
  cuándo. Un error repetido N veces escala de severidad.
- **RN-ERR.10** Los jobs (avisos, cotización, estados de cuenta, cierres) reportan su
  resultado en cada corrida; un job que falla en silencio o deja de correr genera alerta
  — hoy un job caído se descubre por sus consecuencias.

## 7. Interacciones

| Módulo | Interacción |
|---|---|
| Trazabilidad (Spec 13) | Todo error con efecto de negocio es un evento del libro; el código de referencia del usuario permite saltar directo al detalle. |
| Máquina de estados (Spec 14) | Las guardas que rechazan una transición producen mensajes del catálogo (qué faltó y qué hacer), no errores crudos. |
| Seguridad (Spec 12) | Los mensajes de acceso denegado no revelan información (existencia de usuarios/recursos); el detalle va al libro. |
| Portal (Spec 10) | El cliente siempre recibe el nivel "cliente" del mensaje; los mensajes modelo actuales del portal son la vara. |
