# ESPECIFICACIÓN — Auditoría de Depósito con Registro de Casos

Versión 1.0 · 04/09/2026
Documento de implementación. Acompaña a `CEREBRO_AUDITORIA_DEPOSITO.md`.

---

## 1. El problema que resuelve

Hoy la auditoría produce **listados que se pierden**. Cada vez que se corre, se ve lo mismo
otra vez, sin memoria de qué se hizo con lo anterior. No se puede distinguir un problema
nuevo de uno que arrastra tres meses.

La solución separa dos cosas que hoy están fundidas:

| Capa | Qué es | Vida |
|---|---|---|
| **Auditoría** | Un evento. La fotografía del depósito en un momento + los escaneos de esa sesión. | Inmutable una vez cerrada |
| **Caso** | Un problema concreto sobre una orden concreta, con su historia y sus acciones. | Permanente, hasta que se resuelve |

Una auditoría **no genera una lista nueva**: alimenta el registro de casos que ya existe.

---

## 2. La fotografía (corte documental)

Al **abrir** una auditoría el sistema congela el estado del depósito:

```
snapshot = SELECT * FROM ordenes WHERE estado='ACTIVA' [AND zona = :alcance]
```

Se guarda copiado, no por referencia. Todos los hallazgos se calculan **contra el snapshot**,
nunca contra la tabla viva.

**Por qué:** la auditoría dura horas. Si se compara contra la tabla viva, un paquete que se
entrega a las 15:00 aparece como faltante y uno que ingresa a las 16:00 aparece como sobrante.
Serían diferencias falsas que ensucian el registro para siempre.

Los movimientos ocurridos entre apertura y cierre van a una bandeja aparte
(`movimientos_durante_auditoria`) y **no generan casos**.

### Alcance
Cada auditoría declara qué cubrió: todo el depósito, una zona, un rango de códigos.
**Esto es obligatorio** y define qué casos se pueden auto-cerrar (ver §5.3).

---

## 3. Tipos de caso

| Código | Nombre | Se detecta cuando | Acción típica |
|---|---|---|---|
| `FALTANTE` | Faltante físico | Está en el snapshot como activa pero no se escaneó | Recontar → investigar → ajustar |
| `SOBRANTE` | Sobrante en depósito | Se escaneó pero el sistema la da por entregada | Revertir estado a activa |
| `NO_REGISTRADA` | Sin registro en base | Se escaneó un código que no existe en la base | Alta manual |
| `SIN_AVISO` | Cliente nunca avisado | Activa, sin `fecha_aviso` | Avisar al cliente |
| `DUPLICADO` | Código repetido | El mismo código aparece más de una vez en la base | Depurar registro |
| `PERMANENCIA` | Excede plazo | Supera los días configurados (hoy 15) | Avisar / caducar / devolver |

Configurable por tipo: si genera caso o solo se informa.
`SIN_AVISO` y `PERMANENCIA` se detectan **sin necesidad de escaneo físico**.

---

## 4. Modelo de datos

```sql
-- ═══ EVENTO ═══
auditoria
  id                 PK
  codigo             TEXT      -- AUD-2026-0904-01
  fecha_apertura     TIMESTAMP
  fecha_cierre       TIMESTAMP NULL
  operador_id        FK
  alcance_tipo       TEXT      -- TOTAL | ZONA | RANGO
  alcance_valor      TEXT NULL
  estado             TEXT      -- ABIERTA | CERRADA | ANULADA

auditoria_snapshot            -- LA FOTOGRAFÍA (copia, no referencia)
  auditoria_id       FK
  orden_id           FK
  codigo, cliente, estado_orden, fecha_ingreso, fecha_aviso,
  valor_declarado, monto_cobrar, pagado
  PRIMARY KEY (auditoria_id, orden_id)

auditoria_escaneo
  auditoria_id       FK
  codigo             TEXT
  fecha_scan         TIMESTAMP
  operador_id        FK
  duplicado          BOOLEAN   -- segundo escaneo del mismo código

-- ═══ REGISTRO PERMANENTE ═══
caso
  id                 PK
  codigo             TEXT      -- CASO-000412
  orden_id           FK NULL   -- NULL solo para NO_REGISTRADA
  orden_codigo       TEXT
  cliente            TEXT
  tipo               TEXT      -- ver §3
  estado             TEXT      -- ABIERTO | EN_CURSO | ESPERANDO | RESUELTO | ASUMIDO
  severidad          TEXT      -- ALTA | MEDIA | BAJA  (derivada, ver §6)
  primera_auditoria  FK
  primera_deteccion  TIMESTAMP
  ultima_auditoria   FK
  ultima_deteccion   TIMESTAMP
  veces_detectado    INT DEFAULT 1
  reincidente        BOOLEAN DEFAULT FALSE
  responsable_id     FK NULL
  fecha_limite       DATE NULL
  motivo_cierre      TEXT NULL
  cerrado_en         TIMESTAMP NULL

caso_evento                   -- historial completo del caso
  id                 PK
  caso_id            FK
  fecha              TIMESTAMP
  usuario_id         FK NULL
  tipo               TEXT      -- DETECCION | ACCION | CAMBIO_ESTADO | COMENTARIO
  auditoria_id       FK NULL   -- si vino de una auditoría
  detalle            TEXT
```

### La clave de la deduplicación

```sql
CREATE UNIQUE INDEX ux_caso_abierto
  ON caso (orden_id, tipo)
  WHERE estado NOT IN ('RESUELTO','ASUMIDO');
```

Un índice único **parcial**. Garantiza a nivel de base que no puede haber dos casos abiertos
del mismo tipo sobre la misma orden. Si el código de la aplicación falla, la base lo impide.

> ⚠️ **La clave es `orden_id`, NO `orden_codigo`.** Uno de los tipos de caso es justamente
> "código duplicado": si se usa el código como identidad, dos órdenes distintas con el mismo
> código colapsan en un solo caso y se pierde una. Siempre el id interno de la fila.

---

## 5. El motor de fusión

Se ejecuta **al cerrar la auditoría**, en una sola transacción.

### 5.1 Detectar hallazgos

```
hallazgos = []
snapshot  = items de auditoria_snapshot
escaneos  = códigos escaneados (sin duplicados)

para cada s en snapshot:
    si s.codigo no está en escaneos        → FALTANTE
    si s.fecha_aviso es NULL               → SIN_AVISO
    si dias(s.fecha_ingreso) > plazo       → PERMANENCIA

para cada e en escaneos:
    si e.codigo no está en snapshot:
        si existe en ordenes con estado ENTREGADA → SOBRANTE
        si no existe en ordenes                   → NO_REGISTRADA
        -- si existe pero es de otra zona: NO es hallazgo, es fuera de alcance

códigos con más de una fila en ordenes    → DUPLICADO
```

### 5.2 Fusionar contra el registro

```
para cada h en hallazgos:
    c = buscar caso (h.orden_id, h.tipo)

    si c no existe:
        crear caso: estado=ABIERTO, veces=1,
                    primera_deteccion = ultima_deteccion = ahora
        evento DETECCION: "Detectado en {auditoria}"
        → cuenta como NUEVO

    si c existe y está ABIERTO/EN_CURSO/ESPERANDO:
        c.veces_detectado += 1
        c.ultima_deteccion = ahora
        c.ultima_auditoria = auditoria
        evento DETECCION: "Vuelve a detectarse ({veces}ª vez)"
        → cuenta como YA EXISTENTE — NO se crea nada

    si c existe y está RESUELTO/ASUMIDO:
        c.estado = ABIERTO
        c.reincidente = TRUE
        c.veces_detectado += 1
        evento CAMBIO_ESTADO: "Reabierto — reapareció tras cierre del {fecha}"
        → cuenta como REINCIDENTE
```

### 5.3 Auto-cierre — la parte delicada

```
para cada caso abierto c:
    si c.orden NO estaba en el alcance de esta auditoría → NO TOCAR
    si c.tipo no era detectable en esta auditoría        → NO TOCAR
    si c.orden estaba en alcance y NO generó hallazgo:
        c.estado = RESUELTO
        c.motivo_cierre = "No reapareció en {auditoria}"
        evento CAMBIO_ESTADO
        → cuenta como RESUELTO
```

> ⚠️ **Un caso solo se puede cerrar si su orden estaba en el alcance.** Si se auditó
> únicamente la zona A, los casos de la zona B no se pueden dar por resueltos: no se los
> miró. Sin esta condición, una auditoría parcial cerraría en falso la mitad del registro.

### 5.4 Salida
Al cerrar, el sistema informa:

```
Auditoría AUD-2026-0904-01 cerrada
  Nuevos:        12 casos
  Ya existentes: 38 casos (no se duplicaron)
  Reincidentes:   3 casos
  Resueltos:      9 casos
  Registro:      54 casos abiertos
```

---

## 6. Severidad (derivada, no se carga a mano)

| Nivel | Regla |
|---|---|
| **ALTA** | `FALTANTE` con valor > umbral · o `veces_detectado >= 3` · o antigüedad > 90 días |
| **MEDIA** | `SOBRANTE`, `NO_REGISTRADA`, `DUPLICADO` · o antigüedad > 30 días |
| **BAJA** | Todo lo demás |

Se recalcula en cada fusión: un caso que reaparece **sube solo** de severidad.

---

## 7. Estados y acciones

```
ABIERTO ──[tomar]──→ EN_CURSO ──[acción]──→ RESUELTO
   │                     │                      │
   │                     └──[depende de 3ro]──→ ESPERANDO
   │                                              │
   └──────────[no se pudo resolver]──→ ASUMIDO ←──┘
                                    (exige motivo + ajuste)

RESUELTO/ASUMIDO ──[reaparece en auditoría]──→ ABIERTO (reincidente)
```

**Regla que no se rompe:** ningún caso pasa a `ASUMIDO` sin `motivo_cierre` y sin usuario
responsable. Un ajuste sin causa registrada reaparece en el próximo control.

Acciones disponibles (cada una genera un `caso_evento`):
`Recontar` · `Avisar al cliente` · `Revertir a depósito` · `Alta manual` ·
`Depurar duplicado` · `Derivar` · `Comentar` · `Cerrar`

Todas admiten ejecución **en lote** sobre casos seleccionados.

---

## 8. Pantallas

### 8.1 Registro de Casos (nueva pestaña, la principal)
Lista única, persistente. Filtros por estado, tipo, severidad, responsable, antigüedad.
Cada fila se despliega y muestra la línea de tiempo del caso: detecciones y acciones
intercaladas en orden cronológico. Acciones individuales y en lote.

### 8.2 Auditoría en curso
La pantalla de escaneo actual, más: sesión con operador y alcance, snapshot tomado al abrir,
contador de escaneados vs snapshot, y botón **Cerrar auditoría** que dispara la fusión y
muestra el resumen de §5.4.

### 8.3 Historial de auditorías
Una fila por auditoría: fecha, operador, alcance, escaneados, y el resultado de la fusión.
Permite abrir la fotografía de cualquier auditoría pasada tal como se tomó.

### 8.4 Reportes
Los ya especificados en `reporte_auditoria_deposito.sql`, más:
**edad del caso**, **tasa de reincidencia** y **casos crónicos** (3+ detecciones).

---

## 9. Plan de ejecución

| Fase | Qué se hace | Depende de | Riesgo | Entrega |
|---|---|---|---|---|
| **0** | **Campos que faltan.** Agregar `fecha_aviso` (o tabla `avisos`) y `valor_declarado`. Sin esto no existen los tipos `SIN_AVISO` ni la valorización. | — | Bajo | Migración |
| **1** | **Sesión + fotografía.** Tablas `auditoria`, `auditoria_snapshot`, `auditoria_escaneo`. Abrir/cerrar sesión con operador y alcance. **Arregla de paso el bug de "Extraviadas"**: el contador deja de ser `activas − escaneadas` en vivo. | 0 | Medio | Backend |
| **2** | **Motor de fusión.** Tablas `caso` y `caso_evento`, índice único parcial, detección de hallazgos y algoritmo de §5. Es el corazón: sin esto no hay lista única. | 1 | **Alto** | Backend |
| **3** | **Pantalla de casos.** Lista, filtros, línea de tiempo, acciones individuales y en lote. | 2 | Medio | Frontend |
| **4** | **Reportes y export.** PDF ejecutivo, Excel multi-hoja, hallazgos automáticos. | 2 | Bajo | Ambos |
| **5** | **Conteo cíclico.** Auditorías por zona con clasificación ABC, para dejar de parar el depósito una vez al año. | 1 | Bajo | Ambos |

**Orden recomendado:** 0 → 1 → 2 → 3 → 4 → 5. Las fases 0 a 2 no se pueden saltear ni
reordenar. La 4 y la 5 pueden ir en paralelo si hay dos personas.

### La trampa de la primera corrida

La primera auditoría con el motor activo va a crear **cientos de casos de golpe** —
todo lo que hoy está mal y nunca se registró. Una lista de 400 casos el día uno es
una lista que nadie mira, y el sistema muere ahí.

**Mitigación, en este orden:**
1. La primera auditoría se marca como **línea base**. Sus casos nacen agrupados por tipo
   y con acción en lote disponible desde el minuto cero.
2. Ordenar por severidad, no por fecha: se atacan los 20 de valor alto, no los 400.
3. El contador `veces_detectado` recién tiene sentido desde la **segunda** auditoría.
   No mostrar "crónicos" hasta entonces.
4. `SIN_AVISO` y `PERMANENCIA` conviene activarlos **después**, en la segunda corrida,
   para que la línea base sea solo diferencias físicas.

---

## 10. Preguntas abiertas (bloquean la fase 0)

- [ ] ¿Existe hoy algún registro de cuándo se avisó al cliente? ¿En qué tabla?
- [ ] ¿Hay valor declarado por orden, o solo monto a cobrar?
- [ ] ¿El depósito tiene zonas/ubicaciones, o los paquetes están sueltos?
- [ ] ¿Qué motor de base de datos y qué framework?
- [ ] ¿Cómo se calculan hoy los contadores de las pestañas?
- [ ] ¿"Caducadas" está dentro de "Órdenes Activas" o es un universo aparte?
- [ ] ¿Cuántos operarios hacen la auditoría a la vez?
