# Spec 21 — Administración, Mantenimiento de Datos Maestros y Consola (to-be)

> Spec de escalamiento. Tres cosas que hoy existen a medias y desparramadas se vuelven un
> módulo: el **mantenimiento de datos maestros/nomencladores** (con reglas comunes para
> todo ABM), el **mantenimiento del sistema** (backups, purgas, salud) y la **consola de
> administración**.
> Entidades definidas aquí: **Dato Maestro**, **Cambio de Configuración**, **Tarea de
> Mantenimiento**, **Chequeo de Salud**, **Ventana de Mantenimiento**.

## 1. Diagnóstico del sistema actual

Lo que ya existe: consola de sysadmin (estado del servidor, logs, métricas, consultas
lentas, sesiones activas con expulsión, consola SQL solo-lectura logueada, reinicio,
aviso de mantenimiento, backup manual, pista de auditoría), pantalla de nomencladores,
configuración global clave-valor, ABMs por módulo (roles, menús, estados, áreas, equipos,
feriados, horarios, precios, sectores, empresas, catálogo).

Lo que falla:
1. **Cada ABM inventa sus reglas**: algunos impiden borrar lo referenciado (variantes con
   artículos, módulos con hijos, cuentas con asientos), otros no; algunos versionan el
   cambio, la mayoría no; casi ninguno distingue "desactivar" de "borrar".
2. **La configuración global es texto sin contrato**: claves sin tipo declarado, sin
   descripción obligatoria, sin default visible, sin historial de quién cambió qué.
3. **Los seeds viven en scripts sueltos**: los valores iniciales de estados, eventos
   contables y catálogos no tienen un lugar canónico versionado (la réplica local y prod
   divergen hasta que alguien corre el script).
4. **Mantenimiento del sistema artesanal**: backup manual sin restauración probada,
   purgas inexistentes (los logs rotan, la base crece para siempre), jobs sin monitoreo
   (uno caído se descubre por sus consecuencias), sin chequeos de salud.

## 2. Mantenimiento de datos maestros (las reglas comunes de todo ABM)

- **INV-ADM.01** **Nada referenciado se borra: se desactiva.** Todo Dato Maestro
  (nomenclador, estado, área, equipo, medio de pago, tipo de documento, feriado, regla de
  precio…) tiene estado activo/inactivo; el borrado físico solo existe para filas jamás
  referenciadas, y la base lo garantiza (FKs restrictivas). Generaliza lo que hoy hacen
  bien tres o cuatro pantallas.
- **RN-ADM.01** Todo ABM de datos maestros cumple el mismo contrato: alta/edición con
  validación en servidor, desactivación con verificación de impacto ("este medio de pago
  tiene N cobros este mes — se ocultará para nuevos, los históricos no cambian"),
  historial **antes→después** con autor (evento del libro, Spec 13), y permiso propio por
  operación (Spec 12).
- **RN-ADM.02** Los datos maestros con **columnas de comportamiento** (Spec 11: un estado
  declara si bloquea facturación, si es final…) editan ese comportamiento desde el ABM —
  con advertencia de impacto cuando el cambio afecta procesos en curso (Spec 14
  RN-FLU.07: el cambio versiona el proceso).
- **RN-ADM.03** **Seeds canónicos versionados**: los valores iniciales de cada nomenclador
  viven en el repo como datos declarativos; los entornos se siembran desde ahí (local,
  réplica y producción no pueden divergir en catálogos). Un seed nuevo es un cambio
  revisable, no un INSERT suelto.
- **RN-ADM.04** **Configuración global tipada** (formaliza la Spec 11 §9): cada clave
  declara tipo, default, descripción y módulo dueño; el valor se valida al guardar; todo
  cambio queda con autor y antes→después, y las claves que afectan comportamiento crítico
  (gates, umbrales DGI, intervalos de jobs) se marcan como sensibles — su cambio genera
  alerta informativa a administración.
- **RN-ADM.05** **Operaciones masivas** (edición de precios en masa, reclasificación de
  artículos, backfills) son tareas de primera clase: previsualizan el alcance ("esto toca
  1.240 filas"), corren como job auditado con resultado, y son reversibles o declaran
  explícitamente que no lo son.

## 3. Mantenimiento del sistema

- **RN-ADM.06** **Backups automáticos con restauración probada**: respaldo programado de
  base y archivos, con **prueba de restauración periódica automatizada** (un backup que
  nunca se restauró no es un backup) y alerta si el respaldo o la prueba fallan.
- **RN-ADM.07** **Housekeeping declarado**: cada tipo de dato crece o se purga según su
  retención (Spec 13 RN-TRZ.06 para eventos; Spec 19 RN-ARC.06 para archivos; sesiones
  vencidas, colas procesadas, snapshots viejos). El purgado es un job auditado; nada se
  borra por script manual.
- **RN-ADM.08** **Chequeos de salud**: el sistema se auto-verifica (base accesible,
  espacio en disco, proveedores externos respondiendo, colas sin atasco, jobs corriendo a
  horario, certificados/credenciales por vencer, stock de numeradores CAE) y expone el
  resultado en la consola + alertas (Spec 15 RN-ERR.09/10).
- **RN-ADM.09** **Chequeos de consistencia de negocio** programados: las auditorías que
  hoy se escriben a mano tras cada incidente se institucionalizan como verificaciones
  periódicas — deudas duplicadas, documentos descuadrados (cabecera vs líneas), saldos
  vs movimientos, bobinas agotadas sin movimiento, huérfanos. El resultado va a una
  bandeja de administración; en el sistema nuevo deberían dar siempre cero, y un
  no-cero es una alerta de bug, no una tarea de limpieza.
- **RN-ADM.10** **Ventanas de mantenimiento**: el aviso a usuarios conectados (existe
  hoy) se formaliza — programar ventana, avisar con antelación configurable, modo
  solo-lectura opcional durante la ventana, registro de quién la ejecutó.
- **RN-ADM.11** **Actualizaciones del sistema**: el deploy corre migraciones versionadas
  (Spec 16 RN-ARQ.13) con verificación post-deploy (chequeos de salud + smoke de
  operaciones clave) y vuelta atrás documentada.

## 4. Consola de administración

- **RN-ADM.12** Una consola única, reservada a roles administradores con segundo factor
  (Spec 12 RN-SEG.03), que reúne lo que hoy existe más lo nuevo:

| Sección | Contenido |
|---|---|
| **Salud** | Chequeos de salud en vivo, estado de proveedores externos, colas, espacio |
| **Jobs** | Cada job con última corrida, resultado, próxima ejecución; ejecutar ahora; pausar |
| **Sesiones** | Conectados (persistente, no en memoria), expulsión, historial de accesos |
| **Alertas y pendientes** | Bandeja de alertas operativas (Spec 15) y pendientes de reparación best-effort |
| **Consistencia** | Resultado de los chequeos de negocio (RN-ADM.09) con drill-down |
| **Configuración** | La configuración tipada con su historial |
| **Datos maestros** | Acceso a los ABMs con las reglas comunes |
| **Auditoría** | El libro (Spec 13) con sus filtros |
| **Mantenimiento** | Backups y pruebas de restauración, ventanas, purgas, versión desplegada |
| **Consulta técnica** | Consola de solo lectura sobre la capa de lectura, logueada por consulta (conserva la actual) |

- **INV-ADM.02** **La consola no tiene poderes mágicos**: todo lo que hace pasa por las
  mismas operaciones, permisos, guardas y eventos que el resto del sistema. No existe el
  "UPDATE desde la consola" que saltea el motor de estados — el equivalente al script a
  mano en producción queda estructuralmente fuera del sistema nuevo.
- **RN-ADM.13** Las acciones de riesgo de la consola (expulsar, reiniciar, purgar,
  ejecutar ventana) piden confirmación con claridad máxima (Spec 17 INV-FRO.01) y quedan
  en el libro con el detalle completo.

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 11 | Los nomencladores con comportamiento y la configuración tipada son los datos que este módulo mantiene. |
| Spec 12 | Consola con rol + segundo factor; permiso por operación en cada ABM. |
| Spec 13 | Todo cambio de maestro/configuración es evento del libro; la consola lee el libro. |
| Spec 14 | Cambiar el comportamiento de un estado versiona el proceso. |
| Spec 15 | Alertas operativas y pendientes de reparación viven en la consola. |
| Spec 16 | Migraciones, deploy y capa de lectura para la consulta técnica. |
