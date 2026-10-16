# PROMPT DE IMPLEMENTACIÓN — Auditoría de Depósito · Fases 0 a 2

> Pegá esto en Claude Code (dentro de la carpeta del proyecto) o en un chat nuevo
> junto con `CEREBRO_AUDITORIA_DEPOSITO.md` y `ESPEC_registro_de_casos.md`.
> Es autocontenido: lleva las decisiones ya tomadas y las reglas que no se pueden romper.

---

## Contexto

Trabajo sobre un módulo existente llamado **"Auditoría de Depósito / Control Físico"**.
Es un sistema de paquetería: cada unidad es una **orden** con código (`EUV-15280`, `DTF-11789`)
asociada a un cliente. Hoy tiene 6 pestañas: Escaneo Físico, Órdenes Activas, Caducadas,
Extraviadas, Sobrantes, Entregadas Sin Pago.

**Vamos a agregar un registro de casos permanente.** Hoy cada auditoría produce listados
que se pierden: no hay forma de saber si un problema es nuevo o arrastra tres meses.

---

## ⛔ NO ESCRIBAS CÓDIGO TODAVÍA

**Primer paso obligatorio: leé el código del módulo y respondeme esto.**
Sin estas respuestas cualquier implementación es adivinanza:

1. Stack: lenguaje, framework, motor de base de datos, ORM si hay.
2. Estructura de la tabla de órdenes: nombre real, columnas, tipos, clave primaria.
3. ¿Existe un campo o tabla que registre **cuándo se le avisó al cliente**?
   (esto bloquea la Fase 0 — si no existe, hay que crearlo y no se puede reconstruir hacia atrás)
4. ¿Existe **valor declarado** por orden, o solo monto a cobrar?
5. ¿Cómo se calcula hoy el contador de cada pestaña? Mostrame las consultas.
6. ¿"Caducadas" está dentro de "Órdenes Activas" o es un universo aparte?
7. ¿El depósito tiene zonas o ubicaciones, o los paquetes están sueltos?
8. ¿Dónde se guardan hoy los escaneos de la pistola?
9. ¿Hay sistema de usuarios/sesión? ¿Cómo identifico al operador?

Cuando me contestes, seguimos con el plan.

---

## Bug conocido a corregir de paso

El contador de **"Extraviadas"** hoy muestra el mismo número que "Órdenes Activas" antes de
escanear nada (verificado: 850/850 y luego 876/876). Está calculado como
`activas − escaneadas` en vivo, así que antes de empezar el 100% del depósito figura perdido.

**Corrección:** "Extraviada" solo se materializa al cerrar la auditoría y después del
reconteo. Durante la sesión el estado correcto es "pendiente de escaneo".

---

## Qué hay que construir

### Fase 0 — Campos que faltan
Agregar `fecha_aviso` (o tabla `avisos` con canal y resultado) y `valor_declarado`.
Sin esto no existen los tipos de caso `SIN_AVISO` ni la valorización.

### Fase 1 — Sesión de auditoría + fotografía

```sql
auditoria
  id, codigo, fecha_apertura, fecha_cierre, operador_id,
  alcance_tipo (TOTAL|ZONA|RANGO), alcance_valor, estado (ABIERTA|CERRADA|ANULADA)

auditoria_snapshot          -- LA FOTOGRAFÍA: copia, no referencia
  auditoria_id, orden_id, codigo, cliente, estado_orden, fecha_ingreso,
  fecha_aviso, valor_declarado, monto_cobrar, pagado
  PRIMARY KEY (auditoria_id, orden_id)

auditoria_escaneo
  auditoria_id, codigo, fecha_scan, operador_id, duplicado BOOLEAN
```

Al **abrir** la auditoría se copia el estado actual a `auditoria_snapshot`.
Todos los hallazgos se calculan **contra el snapshot, nunca contra la tabla viva**.
Motivo: la auditoría dura horas; comparar contra la tabla viva convierte cada entrega
y cada ingreso del día en una diferencia falsa.

### Fase 2 — Registro de casos + motor de fusión

```sql
caso
  id, codigo, orden_id, orden_codigo, cliente, tipo, estado, severidad,
  primera_auditoria, primera_deteccion, ultima_auditoria, ultima_deteccion,
  veces_detectado INT DEFAULT 1, reincidente BOOLEAN DEFAULT FALSE,
  responsable_id, fecha_limite, motivo_cierre, cerrado_en

caso_evento
  id, caso_id, fecha, usuario_id, tipo (DETECCION|ACCION|CAMBIO_ESTADO|COMENTARIO),
  auditoria_id, detalle
```

**Tipos de caso:** `FALTANTE` · `SOBRANTE` · `NO_REGISTRADA` · `SIN_AVISO` · `DUPLICADO` · `PERMANENCIA`
**Estados:** `ABIERTO` · `EN_CURSO` · `ESPERANDO` · `RESUELTO` · `ASUMIDO`

---

## 🔒 INVARIANTES — no se pueden romper

**1. La deduplicación va en la base, no en el código.**
```sql
CREATE UNIQUE INDEX ux_caso_abierto ON caso (orden_id, tipo)
  WHERE estado NOT IN ('RESUELTO','ASUMIDO');
```
Índice único parcial. Si la aplicación tiene un bug, la base lo impide igual.
(Si el motor no soporta índices parciales, decímelo y lo resolvemos de otra forma.)

**2. La identidad del caso es `orden_id`, NUNCA `orden_codigo`.**
Uno de los tipos de caso es "código duplicado": si se usa el código como identidad,
dos órdenes distintas con el mismo código se fusionan en un solo caso y se pierde una.

**3. El auto-cierre solo aplica dentro del alcance de la auditoría.**
Si se auditó solo la zona A, los casos de la zona B **no** se pueden dar por resueltos:
no se los miró. Sin esta condición, una auditoría parcial cierra en falso media lista.

**4. Los hallazgos se calculan contra el snapshot, no contra la tabla viva.**

**5. Ningún caso pasa a `ASUMIDO` sin motivo de cierre y sin responsable.**
Un ajuste sin causa registrada reaparece en el próximo control.

**6. Los movimientos ocurridos durante la auditoría no generan casos.**

---

## Algoritmo de fusión (se ejecuta al CERRAR, en una transacción)

```
hallazgos = detectar(snapshot, escaneos)
vistos = {}

para cada h en hallazgos:
    vistos[h.orden_id + "|" + h.tipo] = true
    c = buscar_caso(h.orden_id, h.tipo)

    si c no existe:
        crear caso ABIERTO, veces_detectado = 1
        evento DETECCION: "Detectado en {auditoria}"
        → NUEVO

    si c existe y estado en (ABIERTO, EN_CURSO, ESPERANDO):
        c.veces_detectado += 1
        c.ultima_deteccion = ahora
        c.ultima_auditoria = auditoria
        evento DETECCION: "Vuelve a detectarse ({veces}ª vez)"
        → YA EXISTENTE — NO SE CREA NADA

    si c existe y estado en (RESUELTO, ASUMIDO):
        c.estado = ABIERTO
        c.reincidente = true
        c.veces_detectado += 1
        evento CAMBIO_ESTADO: "Reabierto — reapareció tras cierre"
        → REINCIDENTE

# auto-cierre
para cada caso c abierto:
    si vistos[c.orden_id + "|" + c.tipo] → continuar
    si la orden de c NO estaba en el alcance → continuar   # ← invariante 3
    c.estado = RESUELTO
    c.motivo_cierre = "No reapareció en {auditoria}"
    evento CAMBIO_ESTADO
    → RESUELTO
```

**Detección de hallazgos:**
```
para cada s en snapshot:
    s.codigo no está en escaneos       → FALTANTE
    s.fecha_aviso es NULL              → SIN_AVISO
    dias(s.fecha_ingreso) > plazo      → PERMANENCIA

para cada e en escaneos que no está en snapshot:
    existe en ordenes con estado ENTREGADA → SOBRANTE
    no existe en ordenes                   → NO_REGISTRADA
    existe pero es de otra zona            → NO es hallazgo (fuera de alcance)

códigos con más de una fila en ordenes     → DUPLICADO
```

**Severidad (derivada, no se carga a mano):**
- `ALTA`: FALTANTE con valor sobre umbral · o `veces_detectado >= 3` · o antigüedad > 90 días
- `MEDIA`: SOBRANTE, NO_REGISTRADA, DUPLICADO · o antigüedad > 30 días
- `BAJA`: el resto

Se recalcula en cada fusión: un caso que reaparece sube solo de severidad.

**Salida al cerrar:**
```
Nuevos: N · Ya existentes: N · Reincidentes: N · Resueltos: N · Abiertos totales: N
```

---

## Implementación de referencia ya verificada

El archivo `mockup_registro_casos.html` tiene el algoritmo implementado y probado en JS:
la función **`cerrarAuditoria()`** es la referencia exacta a portar.

⚠️ **`generarHallazgos()` NO se porta** — es simulación con datos falsos. En el sistema real
esa función se reemplaza por las consultas de detección contra el snapshot.

El motor fue verificado con 6 auditorías encadenadas:
```
AUD-0615 TOTAL | nuevos 46 | ya estaban  0 | reincid 0 | resueltos  0
AUD-0817 TOTAL | nuevos 11 | ya estaban 26 | reincid 0 | resueltos  9
AUD-0904 ZONA A| nuevos 11 | ya estaban 17 | reincid 0 | resueltos  3  ← no tocó zona B
AUD-1010 TOTAL | nuevos 10 | ya estaban 28 | reincid 1 | resueltos 17
AUD-1110 TOTAL | nuevos  9 | ya estaban 27 | reincid 2 | resueltos 12
AUD-1210 TOTAL | nuevos  9 | ya estaban 24 | reincid 4 | resueltos 14
→ 96 casos, 37 abiertos, 0 duplicados, 19 crónicos, 7 reincidentes
```

---

## Pruebas obligatorias antes de dar por buena la Fase 2

1. **Sin duplicados:** correr 3 auditorías seguidas. Verificar que no existan dos casos
   abiertos con el mismo `(orden_id, tipo)`. Debe dar **0**.
2. **Alcance parcial:** correr una auditoría de una sola zona. Verificar que **ningún** caso
   de la otra zona haya cambiado de estado.
3. **Reincidencia:** cerrar un caso a mano, correr una auditoría donde el problema reaparece.
   El caso debe reabrirse con `reincidente = true`, no crearse uno nuevo.
4. **Snapshot:** abrir una auditoría, modificar una orden en la tabla viva, cerrar.
   El hallazgo debe calcularse con el valor del snapshot, no con el modificado.
5. **Índice único:** intentar insertar a mano un caso duplicado. La base debe rechazarlo.

---

## ⚠️ La trampa de la primera corrida

La primera auditoría con el motor activo va a crear **cientos de casos de golpe** — todo lo
que hoy está mal y nunca se registró. Una lista de 400 casos el día uno es una lista que
nadie mira, y el sistema muere ahí.

Implementar desde el principio:
1. La primera auditoría se marca como **línea base**, con acción en lote disponible.
2. Ordenar por severidad, no por fecha.
3. Activar `SIN_AVISO` y `PERMANENCIA` recién en la **segunda** corrida, para que la línea
   base sean solo diferencias físicas.
4. No mostrar el indicador "crónicos" hasta que exista una segunda auditoría.

---

## Al terminar cada fase

1. Pasame los archivos completos que cambiaron.
2. Actualizá `CEREBRO_AUDITORIA_DEPOSITO.md`: qué se cambió, qué decisiones se tomaron y
   por qué, qué riesgos quedan, y tachá de la sección 7 las preguntas que ya se respondieron.
3. Decime explícitamente qué prueba de la lista de arriba corriste y qué dio.
