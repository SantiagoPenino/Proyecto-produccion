# Spec 12 — Seguridad (módulo dedicado, to-be)

> Esta spec es distinta de las 01–11: no documenta lo que el sistema actual hace, sino lo
> que el **sistema nuevo debe tener** como módulo dedicado, partiendo del diagnóstico del
> actual. Cada regla nace de un hueco real detectado.
> Entidades definidas aquí: **Identidad**, **Credencial**, **Sesión**, **Permiso**,
> **Política de Acceso**, **Dispositivo Autorizado**, **Secreto**.

## 1. Diagnóstico del sistema actual (por qué existe este módulo)

1. Contraseñas comparadas **en texto plano** (internos y clientes).
2. La autorización por rol filtra **solo la navegación**; la API interna acepta casi
   cualquier operación con sesión válida.
3. La dimensión "área" del permiso se aplica mayormente en el frontend.
4. Componentes que **fallan abiertos**: el tótem sin llave configurada deja pasar todo.
5. Operaciones estampadas con un **usuario genérico de respaldo** cuando no se puede
   identificar al actor; sesiones sin cliente que caen a identificadores de respaldo.
6. Registro de sesiones activas **en memoria** (se pierde al reiniciar).
7. Sin política de contraseñas, sin segundo factor, sin límite de intentos declarado.

## 2. Identidad y autenticación

- **RN-SEG.01** Una **Identidad** única por persona/actor, con tipo (interno / cliente /
  diseñador / servicio / dispositivo). Los actores de sistema (jobs, integraciones) son
  identidades de tipo servicio, con credencial propia — **nunca un usuario genérico
  compartido**.
- **INV-SEG.01** Las credenciales se almacenan **solo como hash criptográfico moderno**
  (con sal y factor de costo). El texto plano no existe en ninguna tabla, log ni backup.
- **RN-SEG.02** Política de contraseñas configurable (largo mínimo, historial, expiración
  opcional) y **límite de intentos** con bloqueo temporal progresivo, registrado.
- **RN-SEG.03** **Segundo factor opcional por rol**: obligatorio para roles con poderes
  sensibles (administración, consola, contabilidad); opcional para el resto.
- **RN-SEG.04** Los flujos que hoy funcionan bien se conservan: recuperación que no revela
  usuarios, enlaces de un solo uso con vencimiento corto, activación por correo.
- **RN-SEG.05** **Sesiones con estado en servidor**: revocables individualmente
  (expulsión), con expiración por inactividad, visibles en un registro **persistente**
  (no en memoria). El pase que viaja es corto y renovable; la revocación es inmediata.

## 3. Autorización (el cambio de fondo)

- **INV-SEG.02** **La autorización se decide en el backend, operación por operación.**
  El menú/navegación es una consecuencia del permiso, nunca el permiso mismo. Ninguna
  ruta de negocio queda protegida solo por "tener sesión".
- **RN-SEG.06** Modelo de tres dimensiones, todas evaluadas en el servidor:
  1. **Rol → operaciones** (no pantallas): cada operación de negocio (cobrar, anular,
     cambiar estado, editar precio, exportar) declara qué permiso exige.
  2. **Área**: acota sobre qué recursos opera un usuario de área (su bandeja, su
     inventario, sus remitos), con las excepciones explícitas (Depósito y Administración
     ven todo).
  3. **Pertenencia**: un cliente/diseñador solo alcanza sus propios recursos — la regla
     que hoy vive repetida endpoint por endpoint pasa a ser un **filtro estructural
     único** (el recurso conoce a su dueño y la capa de acceso lo exige siempre).
- **RN-SEG.07** Los permisos son **datos administrables** (rol × operación), con las
  operaciones sensibles marcadas como no-delegables. Guardar un rol versiona el cambio
  (quién, cuándo, antes→después).
- **RN-SEG.08** **Autorización elevada puntual**: operaciones excepcionales (entregar con
  deuda, forzar un pedido incompleto, reabrir algo cerrado) exigen la credencial de un
  autorizador con el permiso específico, y quedan registradas con ambos actores — el que
  ejecuta y el que autoriza. Generaliza lo que hoy hace la "contraseña de autorización"
  de retiros con deuda.

## 4. Fail-closed y dispositivos

- **INV-SEG.03** **Todo componente falla cerrado.** Sin configuración de llave, sin
  credencial o sin permiso resoluble, la respuesta es "no" — nunca el modo permisivo del
  tótem actual.
- **RN-SEG.09** **Dispositivos Autorizados** como entidad: tótems, estaciones de
  impresión, pistolas/puestos fijos se registran con su llave, su ubicación y sus
  operaciones permitidas; se revocan individualmente; su actividad se audita como la de
  cualquier identidad.

## 5. Secretos y datos sensibles

- **RN-SEG.10** Los **Secretos** (credenciales de DGI/proveedor CFE, SMTP, pasarelas,
  API keys de integración) viven cifrados, nunca se devuelven por la API (ya es así para
  CFE — se generaliza), y su rotación queda registrada.
- **RN-SEG.11** Las claves de API de integraciones externas son por-integración,
  revocables y con alcance acotado (qué operaciones permiten).
- **RN-SEG.12** Datos personales de clientes: acceso registrado en auditoría cuando se
  exportan en masa (estados de cuenta, listados); los documentos de identidad se muestran
  enmascarados salvo permiso explícito.

## 6. Interacciones

| Módulo | Interacción |
|---|---|
| Trazabilidad (Spec 13) | Toda decisión de acceso denegada relevante y toda autorización elevada emiten evento de auditoría. |
| Máquina de estados (Spec 14) | Las transiciones declaran qué permiso exigen; el motor lo verifica antes de ejecutar. |
| Portal (Spec 10) | Candados de pertenencia pasan de ad-hoc a estructurales; el bloqueo de cliente es una política central. |
