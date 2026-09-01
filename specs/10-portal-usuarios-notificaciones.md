# Spec 10 — Portal de Clientes, Usuarios Internos y Notificaciones

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Usuario Interno**, **Rol**, **Módulo**, **Cliente del Portal**,
> **Diseñador**, **Aviso WhatsApp**, **Notificación Push**, **Envío de Email**, **Sesión**.
> Referencia entidades de otras specs: Orden, Pedido, Retiro, Documento, Cuenta de Billetera.

## 1. Poblaciones de usuarios

- **RN-USR.01** Conviven tres poblaciones con el mismo formulario de ingreso: **Usuario
  Interno** (gestión), **Cliente del Portal** y **Diseñador**. El sistema resuelve en
  cascada: interno → cliente → diseñador.
- **RN-USR.02** La sesión es un pase firmado con vigencia de 30 días que **se renueva en
  cada llamada**. El pase distingue si el titular es interno; esa marca habilita las
  acciones exclusivas de gestión.
- **RN-USR.03** El acceso con cuenta de Google resuelve **solo clientes** (por correo de la
  ficha); si no hay cliente, deriva al registro.
- **INV-USR.01** *(Lección para el sistema nuevo)* Las contraseñas deben almacenarse con
  hash criptográfico. El sistema actual las compara en texto plano — defecto conocido que
  el diseño nuevo no debe heredar.

## 2. Roles y permisos internos

- **RN-USR.04** Los Roles se administran desde el sistema (no están fijos en código). El
  permiso se otorga por **rol × módulo/pantalla**; guardar un rol reemplaza su set completo
  de módulos.
- **RN-USR.05** El menú de cada usuario se arma dinámicamente: usuario → rol → módulos
  habilitados. Los módulos son jerárquicos, con orden de aparición; no puede borrarse un
  módulo con submódulos, y borrarlo elimina sus permisos.
- **RN-USR.06** *(Limitación conocida / lección)* El permiso por rol gobierna la
  **navegación**; la API interna en general solo exige sesión válida. En el sistema nuevo
  la autorización debe validarse **también en cada operación del backend**.
- **RN-USR.07** Permisos "duros" existentes: cambiar el estado de una Orden requiere ser
  interno con rol de una lista acotada (Admin/User/Coordinador — Administración excluida);
  la consola de sistema requiere rol administrador (estado del servidor, logs, sesiones
  activas y expulsión, consola SQL solo lectura, reinicio, backups, auditoría).
- **RN-USR.08** Cada Usuario Interno tiene además un **área asignada** (segunda dimensión de
  permiso): condiciona qué ve y qué confirma en inventario, logística (Depósito ve todo el
  circuito; las demás áreas su tramo), recepción de remitos (recibir para otra área pide
  confirmación explícita), etiquetas e historial de rollos.
- **RN-USR.09** Un interno puede **operar en nombre de un cliente** (vendedor cargando un
  pedido): el cliente lo determina el sistema a partir de un dato validado contra la base
  (nunca el contenido del formulario) y queda registrado quién cargó realmente. El interno
  puede operar sobre cualquier cliente; el Diseñador solo sobre los que lo autorizaron.

## 3. Cliente del Portal

### 3.1 Alta y acceso

- **RN-POR.01** El registro pide identificador elegido por el cliente, contraseña, datos de
  contacto, documento y zona. Unicidad verificada de: identificador, correo, teléfono y
  documento.
- **RN-POR.02** Si el cliente no elige vendedor, se le asigna automáticamente el vendedor de
  la zona de su departamento **con menos clientes a cargo** (reparto equilibrado).
- **RN-POR.03** El alta queda inactiva y dispara un correo de activación con enlace válido
  **7 días**; hay reenvío de activación (que exige que el correo coincida con la ficha y no
  revela si el usuario existe).
- **RN-POR.04** Se ingresa con identificador + contraseña (no con correo) o con Google.
  Si la cuenta aún no tiene contraseña, **la primera que escriba queda fijada**. Si la ficha
  exige cambio de contraseña, el portal bloquea el acceso hasta cambiarla.
- **RN-POR.05** Recuperación de contraseña por correo: la respuesta es siempre "listo"
  (no revela usuarios); el enlace vence a los **15 minutos**.
- **RN-POR.06** Cliente **Bloqueado**: puede entrar y mirar, pero no puede crear pedidos,
  comprar en la tienda ni generar retiros (portal ni tótem); se le indica contactar a la
  empresa.

### 3.2 Qué ve y qué hace

- **RN-POR.07** Módulos del portal: perfil (con **QR personal** para el tótem), seguimiento
  de pedidos (con aprobación/rechazo de bocetos), alta de pedidos por servicio (la
  visibilidad de cada servicio es **configurable desde la gestión**), recursos propios
  (planes de metros y telas, solo lectura), retiro de pedidos, pagos pendientes, historial,
  soporte por tickets, tienda (existe, oculta hasta lanzamiento), lista de precios,
  novedades/promos administrables y app instalable (PWA).
- **RN-POR.08** **Candado de pertenencia universal**: el cliente nunca elige a quién mirar —
  su identidad sale siempre de la sesión. Aplica a pedidos, órdenes para retirar, recursos
  (con verificación adicional de que la cuenta consultada le pertenece), alta de pedido
  (el cliente jamás viene en el formulario), tienda (precio recalculado en servidor) y pago
  con saldo (cuenta propia, activa, no principal, no restringida, misma moneda, saldo
  suficiente).
- **RN-POR.09** El cliente **no ve** las órdenes internas (fallas, hermanas de
  terminaciones): ve su pedido, no el trabajo interno.
- **RN-POR.10** Aprobar o rechazar un boceto es **exclusivo del cliente dueño** (un
  Diseñador no puede aprobar en su nombre) y solo mientras el pedido espera aprobación.
  El rechazo exige **motivo obligatorio**.
- **RN-POR.11** La ficha comercial y el alta web guardan **correos distintos que nunca se
  unifican automáticamente** (el del portal puede ser del operador que dio el alta). Al
  enviar un comprobante, el operador ve ambos etiquetados y elige.

### 3.3 Diseñadores

- **RN-POR.12** El Diseñador se registra públicamente y queda **pendiente de aprobación**
  por la empresa. El **vínculo lo crea el cliente** (autoriza y desautoriza cuando quiere).
- **RN-POR.13** Al operar, el Diseñador indica en nombre de qué cliente trabaja y el sistema
  valida el vínculo. El cliente puede exigir **aprobar los pedidos que suban sus
  diseñadores** (por defecto entran directo).
- **RN-POR.14** El Diseñador ve el seguimiento de los pedidos que creó, **sin precios ni
  importes**.

## 4. Tótem de mostrador

- **RN-TOT.01** Autogestión sin login: buscar pedidos por número de orden (resuelve al
  cliente dueño y muestra **todas** sus órdenes prontas), o identificarse con el **QR
  personal** (codifica dos datos del cliente que deben corresponder entre sí).
- **RN-TOT.02** Desde el tótem el cliente crea su Retiro (solo órdenes en estados de
  depósito válidos y sin retiro previo) o **se anuncia** con un retiro ya creado: el sistema
  lo baja del estante si estaba guardado y avisa en tiempo real al equipo de mostrador.
  Imprime comprobante en el momento.
- **RN-TOT.03** Modo kiosco: se cierra solo a los 2 minutos de inactividad (protege los
  datos del cliente anterior).
- **RN-TOT.04** El equipo tótem se autoriza por **llave de dispositivo** (secreto activado
  una vez, guardado en el equipo, borrado de la URL). Los endpoints del tótem exigen la
  llave. *(Lección: sin llave configurada el sistema actual deja pasar todo — el nuevo debe
  fallar cerrado.)*

## 5. Avisos WhatsApp

- **RN-WSP.01** **Un único evento dispara WhatsApp**: la Orden llega físicamente al depósito
  y queda pronta para retirar. El aviso es **por Orden** (la plantilla lleva un material),
  pero las hermanas de un Pedido salen en la misma tanda porque pasan a "pronta para avisar"
  juntas.
- **RN-WSP.02** **Aviso único**: cada Orden lleva marca de "ya avisada" con fecha; avisada
  no se reenvía. El envío estampa el estado "Avisado" — salvo que la Orden ya esté
  Entregada o Cancelada.
- **RN-WSP.03** Palancas manuales: corregir teléfono y reenviar (borra la marca), omitir el
  WhatsApp (marca sin enviar), y "avisar nuevamente" en lote — que **jamás toca órdenes
  entregadas, canceladas o perdidas** (guard nacido de un incidente real de ~60 re-avisos).
- **RN-WSP.04** Completar una reposición borra la marca de avisado de la orden madre para
  que se vuelva a avisar.
- **RN-WSP.05** **Gates que controlan el CUÁNDO** (todos deben cumplirse):
  1. Estado "para avisar" y sin marca.
  2. Teléfono válido (normalización: 8–9 dígitos se asumen uruguayos; inválido bloquea el
     envío y se informa al operador, sin marcar la orden).
  3. **Pedido completo**: ninguna hermana del pedido sin llegar al depósito (ignorando
     canceladas y ya ingresadas/avisadas/entregadas).
  4. **Bultos físicos**: si el pedido tiene bultos vivos sin llegar, no se avisa.
  5. Excepción: el estado "Avisar de nuevo" saltea todos los gates (palanca del operador).
- **RN-WSP.06** Operación configurable sin tocar servidor: interruptor global de avisos,
  intervalo del ciclo, modo prueba (todo a un número de test) y control de ritmo (envíos en
  paralelo acotados, espera mínima entre mensajes al mismo destinatario).
- **RN-WSP.07** El mensaje lleva: fecha, código de orden, nombre del trabajo, producto,
  cantidad e importe con moneda. El importe es **el mismo que ve la cajera y el del QR de
  la etiqueta** (una única fuente).
- **INV-WSP.01** *(Lección)* En el sistema actual, el modo simulado (sin credenciales)
  **marca la orden como avisada sin enviar nada** — el aviso se pierde en silencio. El
  sistema nuevo debe distinguir "enviado" de "simulado" también en WhatsApp (como ya hace
  el email).

## 6. Notificaciones push (portal)

- **RN-PUSH.01** Eventos: pedido pronto para retirar, despachado/en camino, cancelado,
  reactivado, respuesta de soporte y ticket resuelto.
- **RN-PUSH.02** Los avisos del mismo Pedido **se reemplazan entre sí** (no se apilan); los
  de pedidos distintos conviven. Suscripciones vencidas se limpian solas. Sin claves
  configuradas, el canal queda apagado en silencio.

## 7. Emails

- **RN-MAIL.01** Dos proveedores conviven: uno para transaccionales del portal (activación,
  reseteo, aviso de orden lista — este último **no cambia el estado de la orden**, a
  diferencia del WhatsApp) y otro para contabilidad (estados de cuenta con PDF adjunto).
- **RN-MAIL.02** **Estados de cuenta**: un proceso semanal (día/hora configurables) arma un
  estado por cliente y lo deja en **cola para revisión**; un operador aprueba y envía
  (autoenvío opcional, apagado por defecto). Clientes sin actividad se omiten.
- **RN-MAIL.03** **Envío de comprobantes fiscales**: PDF adjunto obligatorio (máx. 8 MB,
  verificado como PDF real), generado por el navegador del operador (el cliente recibe
  exactamente lo que el operador ve). Si el comprobante está **aceptado por DGI**, el
  correo, asunto y nombre de archivo usan el **número oficial DGI**; pendiente ⇒ número
  interno, con advertencia explícita de que no es firme.
- **RN-MAIL.04** Selección de proveedor por credenciales configuradas, con opción de
  forzarlo. **Sin credenciales ⇒ modo simulado**: no falla ni bloquea, no envía, y la
  respuesta al operador lo dice explícitamente; el intento queda en el historial con estado
  **Simulado** (distinto de Enviado y Error).
- **RN-MAIL.05** **Historial único de correos**: todo módulo que envía anota módulo,
  referencia legible, cliente, destinatario real, asunto, adjunto, estado, proveedor, error,
  fecha y usuario. Responde "¿ya le mandé esta factura?" y "¿qué le mandamos a este
  cliente?". Si falla el registro, la operación no se rompe.

## 8. Auditoría y sesiones

- **RN-AUD.01** Pista de seguridad con retención definida: todos los logins (exitosos y
  fallidos, con IP y motivo), expulsiones, consultas de consola SQL, avisos de
  mantenimiento, reinicios y backups.
- **RN-AUD.02** Auditoría visible en pantalla: quién hizo qué, cuándo y desde qué IP
  (logins, cambios de estado, cancelaciones). *(Lección: la cobertura actual es parcial —
  el sistema nuevo debe registrar todas las operaciones de negocio.)*
- **RN-AUD.03** **Historial de estados de Orden**: todo cambio de estado pasa por un punto
  único que registra orden, estado nuevo, fecha, usuario y descripción. Sin usuario
  identificable, **el cambio se rechaza**. Las acciones automáticas firman con un actor de
  sistema identificable ("Sistema (WSP)"). El mismo servicio deriva el estado general del
  Pedido desde los estados de área (configuración padre/hijo).
- **RN-AUD.04** Sesiones activas visibles en vivo (usuario, IP, actividad), con expulsión
  por administrador y expiración por inactividad. *(Lección: hoy vive en memoria y se
  pierde al reiniciar.)*
- **RN-AUD.05** Cuando un tercero opera en nombre del cliente (vendedor o diseñador), queda
  registrado **quién cargó realmente** además del titular.

## 9. Interacciones

| Módulo | Interacción |
|---|---|
| Pedidos (Spec 02) | El portal y el tótem son canales de ingreso; candados de pertenencia y bloqueo de cliente. |
| Logística (Spec 04) | El gate de pedido completo y bultos gobierna el aviso WhatsApp; el tótem anuncia retiros al panel de depósito. |
| Caja (Spec 05) | El importe avisado por WhatsApp es el mismo que cobra la caja; pagos online del portal son caja administrativa. |
| Facturación (Spec 06) | Envío de comprobantes por email con número DGI; correos ficha vs portal. |
