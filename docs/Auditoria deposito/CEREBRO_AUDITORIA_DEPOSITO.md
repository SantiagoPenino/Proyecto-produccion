# 🧠 CEREBRO — Auditoría de Depósito / Control Físico

> **Leer SIEMPRE antes de tocar código.** Actualizar SIEMPRE después de cambiar algo.
> Última actualización: 2026-08-17 · Fuente: screenshot de UI (⚠️ código fuente aún NO revisado)

---

## 1. Qué es este sistema

Módulo de **auditoría física de paquetería** (courier / depósito de encomiendas).
No es inventario por SKU: cada unidad es una **orden única** identificada por código
(`EUV-15265`, `DF-250`) asociada a un cliente.

**Objetivo del módulo:** cruzar lo que hay *físicamente* en el depósito contra lo que
dice la base de datos, usando pistola láser o cámara del móvil.

---

## 2. Estado actual observado (según UI)

### Tabs / contadores
| Tab | Valor visto | Qué significa | ⚠️ Observación |
|---|---|---|---|
| Escaneo Físico | 0 | Órdenes escaneadas en la sesión | Arranca en 0, OK |
| Órdenes Activas | 850 | Deberían estar en depósito | Universo a auditar |
| Caducadas | 171 | Superaron plazo de permanencia | ¿Están dentro de las 850? **CONFIRMAR** |
| Extraviadas | 850 | — | 🔴 **BUG: igual a Activas.** Ver §4.1 |
| Sobrantes | 0 | Físico sin respaldo en DB | OK |
| Entregadas Sin Pago | 10599 | Deuda de clientes | 🟠 No pertenece a auditoría física. Ver §4.6 |

### Paneles de la vista "Escaneo Físico"
1. **Pistola Escáner** — input de captura + botón cámara móvil + `Finalizar / Reporte`.
   Texto UI: *"Tus escaneos se guardan en la DB automáticamente."*
2. **Faltan por Escanear** — activas NO escaneadas. *"¿Ya se entregaron Físicamente?"*
3. **Entregada Errónea** — escaneadas pero figuran como Entregadas → deben volver a depósito.
4. **Falta Por Ingresar** — escaneadas que no existen en la DB.

### Matriz de reconciliación (está bien cubierta ✅)
|  | En sistema | No en sistema |
|---|---|---|
| **Escaneado** | Verificada / Entregada Errónea | Falta Por Ingresar |
| **No escaneado** | Faltan por Escanear | — (invisible) |

---

## 3. Reglas de negocio que NO se deben romper

- Un escaneo **nunca** debe borrar o pisar el estado original de la orden sin dejar traza.
- "Entregada Errónea" implica **revertir** el estado a "en depósito", no crear una orden nueva.
- Una orden escaneada dos veces **no** debe contar doble.
- El operador **no debe ver** el estado esperado antes de escanear (conteo ciego).
- Nada se marca como Extraviada sin pasar por reconteo.

---

## 4. Problemas detectados y solución propuesta

### 4.1 🔴 CRÍTICO — "Extraviadas" arranca en 850
**Síntoma:** Extraviadas == Órdenes Activas antes de escanear nada.
**Causa probable:** el contador se calcula como `activas - escaneadas` en vivo.
**Fix:** Extraviada solo se materializa al cerrar la sesión (`Finalizar / Reporte`) y
después del reconteo. Durante la sesión el estado correcto es *"pendiente de escaneo"*.
**Riesgo si se toca:** verificar que ningún reporte externo ya consuma ese contador.

### 4.2 🔴 Falta corte documental (snapshot)
La auditoría dura horas; entran y salen paquetes en el medio → falsos faltantes/sobrantes.
**Fix:** al iniciar sesión guardar `snapshot_ordenes_activas` con timestamp. Comparar
contra el snapshot, no contra la tabla viva. Movimientos posteriores → bandeja
"Movidos durante auditoría".

### 4.3 🟠 No hay reconteo
**Fix:** estado intermedio `PENDIENTE_RECONTEO`. Segunda pasada (idealmente otro operador)
antes de habilitar el cierre.

### 4.4 🟠 Sin causa ni responsable en la diferencia
**Fix:** al cerrar, cada faltante exige `motivo` (entregado sin escanear / error de carga /
rotura / no hallado / robo) + `usuario` + `fecha`. Sin motivo no se cierra.

### 4.5 🟠 Sin sesiones, operador ni zonas
**Fix:** entidad `sesion_auditoria` (id, operador, inicio, fin, zona, estado).
Permitir auditar por zona/estante. Sesión reanudable si se cae el navegador.

### 4.6 🟠 "Entregadas Sin Pago" (10599) mezclado con auditoría
Es cobranza, no control físico. Arrastra histórico sin filtro.
**Fix:** módulo aparte o, mínimo, aging (0-30 / 31-60 / 61-90 / +90 días) + monto.

### 4.7 🟡 Escaneo duplicado
**Fix:** detectar y avisar con feedback sonoro/visual distinto. No sumar.

### 4.8 🟡 Sin métricas de cierre
**Fix en el reporte:** ERI (verificadas/activas), faltantes y sobrantes **por separado**
(nunca neteados) en unidades y valorizados, duración de sesión, antigüedad promedio.

---

## 5. Flujo de estados objetivo

```
ACTIVA
  ├─ [escaneo OK] ─────────────→ VERIFICADA ✅
  └─ [no escaneada al cierre] ─→ PENDIENTE_RECONTEO
                                   ├─ [hallada] ─→ VERIFICADA ✅
                                   └─ [no hallada] ─→ EN_INVESTIGACION
                                                        └─→ EXTRAVIADA
                                                            (motivo + responsable + fecha)

ESCANEADA + estado "Entregada"  →  ENTREGADA_ERRONEA → revertir a ACTIVA
ESCANEADA + no existe en DB     →  FALTA_POR_INGRESAR → alta manual
```

---

## 6. Prioridad de trabajo sugerida

| # | Tarea | Impacto | Riesgo |
|---|---|---|---|
| 1 | Fix contador Extraviadas (§4.1) | Alto | Bajo |
| 2 | Snapshot / corte documental (§4.2) | Alto | Medio |
| 3 | Sesiones + operador (§4.5) | Alto | Medio |
| 4 | Reconteo (§4.3) | Medio | Bajo |
| 5 | Motivo obligatorio (§4.4) | Medio | Bajo |
| 6 | Separar Entregadas Sin Pago (§4.6) | Medio | Medio |
| 7 | Duplicados + métricas (§4.7, §4.8) | Bajo | Bajo |

---

## 7. ✅ Confirmado con el código y la base (2026-09-05)

- [x] ~~Stack~~ → Node + Express con `mssql` (T-SQL a mano, sin ORM), SQL Server 2025; React + Vite + Tailwind; Socket.IO.
- [x] ~~Estructura de tablas~~ → `dbo.OrdenesDeposito`, PK `OrdIdOrden`; `OrdCodigoOrden varchar(20)` NO único; estados `EstadosOrdenes` 1..13 (9 Entregado, 10 Cancelado, 11 Perdida, 12 Avisar nuevamente, 13 Esperando Bultos). Etiqueta física = `{NoDocERP}/B{idEtiqueta}` (Logistica_Bultos.CodigoEtiqueta).
- [x] ~~Contadores~~ → en JS dentro de `initAudit`/`checkAudit` sobre UNA query (ver §12).
- [x] ~~Caducadas dentro de Activas~~ → SÍ (`activa && dias > DIAS_MAX_DEPOSITO`). La clave no existía en la base local (default 15); el script la crea.
- [x] ~~Dónde escribe el escaneo~~ → `dbo.AuditoriaScansTemp (Codigo, Fecha)`: global, sin sesión ni operador, duplicado descartado en silencio.
- [x] ~~Sesión hoy~~ → NO existía. Ahora: `dbo.AuditoriaDeposito`.
- [x] ~~Valorización~~ → solo `OrdCostoFinal` + `MonIdMoneda` (1 = $, 2 = US$). NO hay valor declarado: no se crea columna, se valoriza a pesos con la cotización del día al tomar la fotografía.
- [x] ~~Finalizar / Reporte~~ → bajaba un .txt y hacía TRUNCATE de la tabla temporal. Con auditoría abierta ya no aplica: lo reemplaza "Cerrar auditoría".
- [x] Fecha de aviso → SÍ existe: `OrdAvisoWsp` + `OrdFechaAvisoWsp` (cron de WhatsApp, estado 6). Es "último aviso" (se resetea al reenviar). Historial en `HistoricoEstadosOrdenes` (6 y 12).
- [x] Zonas → `OcupacionEstantes` cubre < 1/3 de las activas → alcance por ESTANTE descartado; alcance = TOTAL o PREFIJO de área.
- [x] Operarios → JWT en `req.user` {id, username, name, role, idRol, areaKey, userType}; `Usuarios.IdUsuario`.

---

## 8. Reportes requeridos por el usuario

Archivo: `reporte_auditoria_deposito.sql`

| # | Reporte | Query | Campo clave que necesita |
|---|---|---|---|
| 1 | Resumen ejecutivo | §1 | todos |
| 2 | Órdenes con código duplicado | §2 | `codigo` |
| 2B | Mismo cliente + mismo día | §2B | `cliente`, `fecha_ingreso` |
| 2C | Escaneos duplicados en sesión | §2C | tabla `escaneos_auditoria` |
| 3 | Sin avisar (+ prioridad por antigüedad) | §3 / §3B | **`fecha_aviso`** |
| 4 | Aging por tramos | §4 / §4B | `fecha_ingreso` |
| 5 | Valorización del depósito | §5 / §5B | `valor_declarado`, `monto_cobrar`, `pagado` |

### ⚠️ Definiciones que hay que fijar con el usuario
- **"Doble"** = ¿código repetido en DB, o mismo bulto ingresado 2 veces, o doble escaneo?
  Los tres casos están cubiertos, pero el reporte "oficial" debe elegir uno.
- **"Costo"** = valor de mercadería en custodia ≠ dinero pendiente de cobro. Reportar separado.
- **"Sin avisar"** = ¿nunca se avisó, o no se avisó en los últimos N días? (reaviso)

### Campos que probablemente falten en la DB
- `fecha_aviso` / tabla `avisos` (canal, fecha, resultado) → **sin esto no hay reporte 3**
- `valor_declarado` → sin esto no hay valorización
- `sesion_id` en escaneos → sin esto no se pueden separar auditorías

---

## 9. Bitácora de cambios

| Fecha | Cambio | Archivos tocados |
|---|---|---|
| 2026-08-17 | Creación del cerebro a partir de screenshot de UI | — |
| 2026-08-17 | Set de queries del reporte (dobles, sin avisar, aging, valorización) | `reporte_auditoria_deposito.sql` |
| 2026-08-17 | Prototipo HTML del reporte con datos sintéticos (850 órdenes, semilla 20260817) | `reporte_auditoria_prototipo.html` |
| 2026-08-17 | Versión final: estructura calcada del video + descarga de reporte | `auditoria_reportes.html` |
| 2026-09-04 | **Cambio de arquitectura**: registro de casos permanente + motor de fusión | `ESPEC_registro_de_casos.md`, `mockup_registro_casos.html` |
| 2026-09-07 | **Acciones sobre la orden desde el Registro de Casos** (`ENTREGAR`, `REGRESAR`, `AVISAR`: mismo código que la pantalla, movido a `services/auditDepositoAccionesService.js`, en la misma transacción que el caso; `Ingresar al depósito` = `POST /logistics/receive` desde el front; **Asumir pérdida en un Faltante cancela la orden en depósito** por el mismo endpoint que Caja `POST /api/apiordenesRetiro/caja/orden/cancelar`, estado 10 y reversión del cargo). Órdenes Activas absorbió Caducadas y Sin escanear (switches de reloj / QR / campana + ciclo de pago); Entregadas Sin Pago se fue de la pantalla (cobranza) y ya no se consulta en cada lectura. **Incidente**: la suite de pruebas corrió con casos reales en local y los cerró; se repararon (731 reabiertos) y la suite ahora ABORTA si el registro no está vacío (`--forzar` para bases de prueba) | `auditDepositoAccionesService.js`, `auditoriaDepositoService.js`, `auditDepositoController.js`, `AuditDepositoCasosTab.jsx`, `AuditDepositoView.jsx`, `test_auditoria_deposito_casos.js` |
| 2026-09-07 | **Pestaña Escaneo Físico rediseñada**: se quitaron las tres listas de la derecha; cada lectura muestra su categoría (OK · Entregada errónea · Falta por ingresar · Repetida · Corregida) con filtro arriba, también SIN auditoría abierta (`clasificarEscaneosSinSesion`). Las tarjetas que no están OK ofrecen la corrección en el lugar: "Regresar a Depósito" (misma acción A_DEPOSITO de la pestaña Sobrantes) e "Ingresar al depósito" (mismo `POST /logistics/receive` de Recepción, área DEPOSITO). Una lectura corregida pasa a **CORREGIDA** (derivado del estado vivo), deja de contar como sobrante/sin ingreso y al cerrar va a `movidas`, no a caso. 47 PASS | `auditDepositoSql.js`, `auditDepositoController.js`, `auditoriaDepositoService.js`, `AuditDepositoView.jsx`, `AuditDepositoSesionBar.jsx` |
| 2026-09-06 | **Fases 3 (completa), 4 (reportes) y 5 (conteo cíclico)** en local. 47 comprobaciones PASS. Ver §12.8 | `backend/services/auditoriaDepositoReportesService.js`, `src/components/pages/AuditDepositoReportesTab.jsx`, `src/components/pages/AuditDepositoCiclicoTab.jsx` + editados |
| 2026-09-05 | **Fases 0, 1 y 2 implementadas en local** + pantalla mínima (barra de sesión + pestaña Registro de Casos). 36 comprobaciones PASS contra la réplica. Falta: correr el SQL en prod + deploy. Ver §12 | `scripts/add_auditoria_deposito.sql`, `backend/services/auditoriaDepositoService.js`, `backend/services/auditDepositoSql.js`, `backend/controllers/auditDepositoCasosController.js`, `backend/controllers/auditDepositoController.js`, `backend/routes/auditDepositoRoutes.js`, `backend/scripts/test_auditoria_deposito_casos.js`, `src/components/pages/AuditDepositoView.jsx`, `src/components/pages/AuditDepositoSesionBar.jsx`, `src/components/pages/AuditDepositoCasosTab.jsx` |

---

## 11. ⭐ ARQUITECTURA VIGENTE — Registro de casos (2026-09-04)

**Esto reemplaza el enfoque de "reportes por auditoría".** Ver `ESPEC_registro_de_casos.md`
para el detalle completo. Resumen de lo que no hay que romper:

### Dos capas separadas
| Capa | Qué es | Vida |
|---|---|---|
| **Auditoría** | Evento: fotografía (snapshot) + escaneos de esa sesión | Inmutable al cerrar |
| **Caso** | Problema sobre una orden, con su historia y acciones | Permanente hasta resolverse |

Una auditoría **NO genera lista nueva**: alimenta el registro que ya existe.

### Regla de fusión (el corazón del sistema)
| Situación | Resultado |
|---|---|
| Hallazgo nuevo | Crea caso |
| Ya existe y está abierto | **NO crea.** `veces_detectado++`, actualiza última detección |
| Caso abierto que ya no aparece | Auto-cierre: "no reapareció" |
| Caso cerrado que reaparece | Reabre marcado `reincidente` |

### Invariantes que NO se pueden romper
1. **Dedup a nivel base:** `UNIQUE (orden_id, tipo) WHERE estado NOT IN ('RESUELTO','ASUMIDO')`.
   Índice único parcial. Si la app falla, la base lo impide igual.
2. **La clave es `orden_id`, NUNCA `orden_codigo`.** Un tipo de caso es "código duplicado":
   usar el código como identidad fusionaría dos órdenes distintas en un solo caso.
3. **Auto-cierre solo dentro del alcance.** Si se auditó solo la zona A, los casos de zona B
   no se pueden dar por resueltos. Sin esta condición una auditoría parcial cierra en falso
   media lista. Verificado en el mockup: auditoría de zona A cerró 0 casos de zona B.
4. **Los hallazgos se calculan contra el snapshot, nunca contra la tabla viva.**
5. **Ningún caso pasa a `ASUMIDO` sin motivo y sin responsable.**
6. **Los movimientos ocurridos durante la auditoría no generan casos.**

### Verificación del motor (6 auditorías simuladas)
```
AUD-0615 TOTAL | nuevos 46 | ya estaban  0 | reincid 0 | resueltos  0
AUD-0817 TOTAL | nuevos 11 | ya estaban 26 | reincid 0 | resueltos  9
AUD-0904 ZONA A| nuevos 11 | ya estaban 17 | reincid 0 | resueltos  3  ← no tocó zona B
AUD-1010 TOTAL | nuevos 10 | ya estaban 28 | reincid 1 | resueltos 17
AUD-1110 TOTAL | nuevos  9 | ya estaban 27 | reincid 2 | resueltos 12
AUD-1210 TOTAL | nuevos  9 | ya estaban 24 | reincid 4 | resueltos 14
→ 96 casos totales, 37 abiertos, 0 duplicados, 19 crónicos, 7 reincidentes
```

### Orden de implementación (no se puede reordenar)
`Fase 0` campos faltantes → `Fase 1` sesión + snapshot → `Fase 2` motor de fusión →
`Fase 3` pantalla → `Fase 4` reportes → `Fase 5` conteo cíclico.

### ⚠️ La trampa de la primera corrida
La primera auditoría con el motor activo crea **cientos de casos de golpe**. Una lista de
400 casos el día uno es una lista que nadie mira. Mitigación: marcarla como *línea base*,
ordenar por severidad y no por fecha, activar `SIN_AVISO` y `PERMANENCIA` recién en la
segunda corrida, y no mostrar "crónicos" hasta que haya una segunda auditoría.

> Los archivos `reporte_auditoria_prototipo.html` y `reporte_auditoria_v2.html` quedaron
> obsoletos y fueron eliminados. El vigente es `auditoria_reportes.html`.

### ⚠️ Estructura del layout (esto se había hecho mal en la v2)
El sistema usa **UN panel blanco único** que contiene la barra de tabs Y el contenido.
NO son tarjetas sueltas flotando sobre el fondo.

```
fondo #F4F7FB
└── contenedor (max-width 1180)
    ├── h1 + subtítulo         ← FUERA del panel, sobre el fondo
    └── .panel (blanco, radio 14px, borde #EAEEF4)
        ├── .tabbar            ← DENTRO del panel, con borde inferior
        └── .cuerpo (pad 22px)
            ├── .sec-h         ← título indigo + subtítulo + botones a la derecha
            └── .marco         ← cada tabla en su propio marco redondeado
```

- Las tablas van en **marco propio** (borde + radio 11px), cabecera `#F8FAFC` sticky.
- Título de sección: indigo `#4F46E5` bold 16px. Cambia de color según semántica
  (violeta en Caducadas, rojo en faltantes, ámbar en errores).
- Nombre de cliente en indigo en listados generales; oscuro + `COMUN` gris en los operativos.

### Descarga de reporte (v2)
- Botón **Descargar reporte** en la barra de corte → abre vista previa en overlay.
- Dos versiones: **ejecutivo** (~2 páginas, listados recortados) y **completo** (listados extendidos).
- Salidas: **PDF** vía `window.print()` con `@media print` dedicado, y **Excel** en formato
  SpreadsheetML 2003 (`.xls`, sin librerías externas) con 7 hojas:
  Resumen · Antiguedad · Duplicadas · Mismo cliente mismo dia · Sin avisar · Por cliente · Censo completo.
- La sección **Hallazgos** se genera sola con `hallazgos()`: cruza los datos y redacta las
  conclusiones en texto. Ese cruce (sin aviso × antigüedad) es el que explica el estancamiento.
- El documento cierra con líneas de firma (Responsable de depósito / Auditor) — la auditoría
  necesita conformidad de dos personas distintas, ver §4.4 sobre separación de funciones.

---

## 10. Sistema de diseño del proyecto (extraído del video)

**Usar SIEMPRE estos tokens al crear pantallas nuevas.**

```css
--bg:#F3F6FA          /* fondo de página, azul-gris muy claro */
--card:#FFFFFF        /* tarjetas, radio 12px, sombra 0 1px 2px rgba(27,36,52,.04) */
--borde:#E9EDF4
--titulo:#1B2434      /* títulos, peso 700-800 */
--texto:#3D4759
--suave:#8A94A6       /* subtítulos y labels */

--violeta:#8A17D9     /* primario: tab activa, botón de acción */
--indigo:#4F46E5      /* códigos de orden en tablas */
--verde:#19B24A       /* botón Excel */
--rojo:#DC2626        /* Faltan por Escanear, sin avisar */
--ambar:#D97706       /* Entregada Errónea */
--naranja:#EA7C1B     /* Regresar a Depósito */
--magenta:#D6336C     /* columna de días */
--navy:#1E2A38        /* botones oscuros: Cámara del móvil, Finalizar/Reporte */
```

- **Tipografía:** Plus Jakarta Sans (títulos 700/800) + JetBrains Mono (códigos, días, montos).
- **Tabs:** icono outline + label + badge con contador. Activa = color violeta + subrayado 2.5px.
  El color de la tab activa cambia según la semántica de la sección (Sobrantes = naranja).
- **Tablas:** cabecera `#F8FAFC` sticky, código en mono bold indigo, días en mono bold magenta,
  filas con borde inferior `#F1F4F8`.
- **Cabecera de tarjeta:** título coloreado + subtítulo explicativo del mismo tono más claro
  + botones alineados a la derecha (Excel verde siempre último).
- **Patrón de acción en lote:** checkbox por fila → `<select>` de acción → botón violeta
  "Ejecutar Acción (n)" deshabilitado si n=0. Replicado en la vista "Sin avisar".
- **Estado vacío:** ícono lupa gris centrado + texto en gris.

### Notas del prototipo
- La "franja de sedimentación" es el elemento central: barra proporcional por tramo de
  permanencia, clickeable, filtra todas las tablas.
- Vistas implementadas: Antigüedad, Duplicadas (2 criterios), Sin avisar, Por cliente.
- Para conectarlo a la DB real: reemplazar `generarDatos()` por el fetch al endpoint.
  El resto del código consume el array `ORDENES` con esta forma:
  `{codigo, cliente, dias, avisoDias, valor, cobrar, pagado}` + campos derivados
  (`tramo`, `ingreso`, `ingresoTxt`) que calcula el propio script.

---

## 12. ✅ IMPLEMENTACIÓN REAL — Fases 0, 1 y 2 + pantalla mínima (2026-09-05)

> Estado: **completo y probado en LOCAL. NO desplegado. NO commiteado.**
> Para producción: `scripts/add_auditoria_deposito.sql` (una vez, antes del deploy) + deploy backend/frontend.
> Guía paso a paso: `DEPLOY_AUDITORIA_DEPOSITO.md` (esta carpeta).

### 12.1 Corrección de premisa
Este NO es un courier. `OrdenesDeposito` son las **órdenes de producción propias** (SUB, DTF, EUV…) ya terminadas,
esperando que el cliente las retire. Consecuencias: no hay "valor declarado" (el valor en juego es el costo de la
orden), el aviso al cliente **ya existe** (cron de WhatsApp → `OrdAvisoWsp`/`OrdFechaAvisoWsp`), y un "código sin
registro" casi siempre es una orden que **existe en producción pero nunca se pistoleó al depósito** (nuevo tipo `SIN_INGRESO`).

### 12.2 Modelo real (nombres reales; `dbo.Auditoria` ya existía como log de usuarios → prefijo `AuditoriaDeposito`)
| Tabla | Rol | Clave |
|---|---|---|
| `AuditoriaDeposito` | la sesión: código `AUD-YYYY-MMDD-NN`, alcance (TOTAL / PREFIJO 'SUB,DTF'), tipos activos, línea base, operador apertura/cierre, cotización y días máx. usados, contadores del cierre, `AudResumenJson` | `UX_AuditoriaDeposito_Abierta`: solo UNA abierta a la vez |
| `AuditoriaDepositoSnapshot` | LA FOTOGRAFÍA: copia de cada orden activa al abrir (cliente, estado, fechas, aviso, costo, `ValorPesos`, `PagoEstado` con la lógica de pago vía documento, estante, bultos, días) | PK (AudId, OrdIdOrden) |
| `AuditoriaDepositoEscaneo` | cada lectura: código crudo, clave, orden resuelta, `Resultado` (OK / ENTREGADA / FUERA_ALCANCE / INGRESO_POSTERIOR / SIN_INGRESO / DESCONOCIDO), `Duplicado`, usuario, fecha | |
| `AuditoriaDepositoCaso` | registro permanente: identidad `OrdIdOrden` (NULL solo en SIN_INGRESO/NO_REGISTRADA → identidad = código), tipo, estado, severidad derivada, veces, reincidente, responsable, motivo de cierre | `UX_AudDepCaso_VivoOrden` (OrdIdOrden, Tipo) y `UX_AudDepCaso_VivoCodigo` (OrdCodigoOrden, Tipo), ambos `WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')` + CHECK "ASUMIDO exige motivo y responsable" |
| `AuditoriaDepositoCasoEvento` | historia del caso (DETECCION / ACCION / CAMBIO_ESTADO / COMENTARIO) | |

Configuración (`ConfiguracionGlobal`, AreaID 'ADMIN'): `DIAS_MAX_DEPOSITO`=15, `AUDIT_DEP_UMBRAL_VALOR_ALTA`=5000 ($),
`AUDIT_DEP_DIAS_SIN_AVISO`=3, `AUDIT_DEP_TIPOS_ACTIVOS`=los 6 tipos. Solo se insertan si no existen.

> SQL Server no admite `NOT IN` en el filtro de un índice: se enumeran los 3 estados vivos (el CHECK de Estado deja la lista cerrada).

### 12.3 Tipos de caso vigentes
`FALTANTE` · `SOBRANTE` · `SIN_INGRESO` (existe en `Ordenes`, no en depósito) · `NO_REGISTRADA` (no existe en ningún lado) ·
`SIN_AVISO` (estados 5/6/7/12, sin aviso WSP, más de N días) · `PERMANENCIA` (más de DIAS_MAX_DEPOSITO).
`DUPLICADO` quedó como **informe** en el resumen del cierre (0 activos en la base), no genera caso.

### 12.4 Flujo
1. **Abrir** (`POST /api/audit-deposito/sesion/abrir`): toma la fotografía (761 filas en local, ~1 s). Si no hay ninguna
   auditoría CERRADA en el sistema → **línea base**: solo tipos físicos. Opcional: importar los escaneos sueltos de `AuditoriaScansTemp`.
2. **Escanear**: los endpoints viejos (`/live`, `/check`, `/init`) detectan la sesión abierta y trabajan contra ella.
   Cada lectura se resuelve en el momento: etiqueta `9471/B11575` → `Logistica_Bultos` (PROD_TERMINADO) → `Ordenes.CodigoOrden`
   exacto (distingue órdenes hermanas); `SUB-9471` → exacto; `9471` → clave sin prefijo (si hay hermanas, prefiere la no escaneada).
   La misma etiqueta dos veces se guarda con `Duplicado=1` (no suma). Lo no escaneado es "Sin escanear", nunca "Extraviada".
3. **Cerrar** (`POST .../sesion/cerrar`, UNA transacción): detección contra el snapshot → fusión (nuevo / ya existente / reincidente)
   → auto-cierre solo dentro del alcance → contadores en la sesión + `audit:cerrada` por socket. Devuelve
   `Nuevos · Ya existentes · Reincidentes · Resueltos · Abiertos totales` + movidas + duplicados.
4. **Anular** (`.../sesion/anular`): descarta la sesión sin tocar el registro; escaneos quedan como rastro.
5. **Casos** (`GET/POST .../casos…`): lista con KPIs y filtros (VIVOS, CRONICOS, REINCIDENTES, ALTA, CERRADOS, TODOS, tipo, búsqueda),
   detalle con línea de tiempo, acciones TOMAR / REGISTRAR / ESPERAR / COMENTAR / ASIGNAR / RESOLVER / ASUMIR / REABRIR e igual en lote.
6. **Historial** (`GET .../auditorias`, `.../auditorias/:id` con la fotografía tal como se tomó).

Sin auditoría abierta **todo sigue funcionando como antes** (tabla temporal, Finalizar/Reporte), así el deploy no corta a nadie.
Si el frontend nuevo corre contra un backend viejo, la barra avisa "falta desplegar" y el resto funciona igual.

### 12.5 Decisiones tomadas y desvíos respecto de la spec (con el porqué)
- **Alcance TOTAL o PREFIJO**, no por estante: `OcupacionEstantes` cubre menos de un tercio de las activas.
- **Invariante 6 ampliada**: al cerrar, una orden de la fotografía que ya salió del depósito (estado ≥ 9) no genera FALTANTE, y una
  escaneada que se entregó después de abrir no genera SOBRANTE. Van a `movidas` en el resumen. Sin esto, cada entrega del día sería un caso falso.
- **Auto-cierre (invariante 3)**: un caso se cierra solo si su orden estaba en la fotografía y no generó hallazgo; si la orden ya no está
  activa y su prefijo está en el alcance, se cierra con motivo "la orden ya no está en depósito"; si es de otra área o entró después de abrir, no se toca.
- **Severidad**: FALTANTE nunca es BAJA (queda MEDIA aunque valga poco; ALTA si supera el umbral). El resto igual a la spec:
  ALTA por 3+ detecciones o más de 90 días; MEDIA por diferencia física o más de 30 días; BAJA el resto. Lista ordenada por severidad y luego valor.
- **Línea base automática**: primera auditoría sin cerradas previas → `AudEsLineaBase=1` y sin SIN_AVISO/PERMANENCIA. "Crónicos" se muestra recién con 2 auditorías cerradas.
- **Seguridad**: el módulo aceptaba cualquier JWT válido (incluido un cliente del portal) para marcar entregadas. Ahora las rutas bloquean
  tokens que no sean internos (los internos viejos sin `userType` siguen entrando para no cortar al depósito). Se sacó el fallback a usuario 1
  y el IN de `performAction` escapa las comillas.
- **Valor** = `OrdCostoFinal` a pesos por `Cotizaciones.CotDolar` del día de apertura (guardada en la sesión).
- Helpers `clavesDeCodigo` y la "situación de pago" se movieron tal cual a `services/auditDepositoSql.js` para que la fotografía se clasifique igual que la pantalla.

### 12.6 Pruebas corridas (backend/scripts/test_auditoria_deposito_casos.js, contra la réplica local, 36 comprobaciones, TODAS PASS)
| # | Prueba de la spec | Resultado |
|---|---|---|
| 1 | Sin duplicados: 3 auditorías seguidas (AUD-01 línea base 13 nuevos / AUD-02 13 ya existentes + 194 nuevos de PERMANENCIA y SIN_AVISO / AUD-03 13 resueltos) | 0 casos vivos repetidos |
| 2 | Alcance parcial: auditoría solo SUB después de crear 3 FALTANTE SUB + 3 DTF | cerró los 3 SUB; los 72 casos DTF quedaron idénticos (estado, veces, última auditoría, severidad) |
| 3 | Reincidencia: caso resuelto a mano que reaparece | mismo CasoId reabierto, Reincidente=1, veces 1→2, evento "Reabierto…" |
| 4 | Snapshot: orden modificada en la tabla viva después de abrir | no generó SIN_AVISO: se usó la fotografía |
| 5 | Índice único: INSERT manual de un caso vivo duplicado (por orden y por código) | error 2601 en la base; CHECK de ASUMIDO error 547; el servicio exige motivo |
| 6 | Movimiento durante la auditoría: orden entregada después de abrir y no escaneada | sin FALTANTE, listada en `movidas` |
| + | Resolución de códigos (exacto, número pelado, etiqueta /B, entregada, sin ingreso, desconocido, duplicado), acción en lote, detalle con línea de tiempo, listado + KPIs, historial | PASS |

El script limpia todo lo que crea y restaura las 2 órdenes que modifica. No correrlo en producción.
La pantalla se verificó por compilación (esbuild + transform del Vite dev server) — **no hubo E2E en navegador** porque el backend
local corre con `node server.js` viejo y la app pide login.

### 12.7 Riesgos y pendientes
- La **primera corrida real** en producción con 761 activas: la línea base va a crear los FALTANTE/SOBRANTE/SIN_INGRESO reales de golpe
  (lo esperado). Recomendación: primera auditoría TOTAL bien hecha, y atacar por severidad (la lista ya viene ordenada así).
- Multi-bulto: un escaneo de cualquier bulto cuenta como orden presente. La fotografía guarda `BultosEsperados` para un conteo por bulto futuro.
- Órdenes hermanas con el mismo número en dos áreas: solo la etiqueta `/B` o el código con prefijo las distingue; el número pelado prefiere la no escaneada.
- Tokens internos viejos sin `userType` siguen entrando (decisión deliberada); cuando todos hayan reiniciado sesión se puede endurecer a `soloInternoConRol`.
- `AuditoriaScansTemp` queda solo como modo "sin auditoría abierta". Cuando el depósito trabaje siempre con sesión, se puede retirar.

### 12.8 Fases 3, 4 y 5 (2026-09-06) — también hechas y probadas en local

**Fase 3 completa (registro de casos).** Responsable asignable a cualquier usuario interno activo (`GET /api/audit-deposito/usuarios`),
fecha límite por caso (`FechaLimite`, DATE; se devuelve como 'AAAA-MM-DD' para evitar el "un día antes"), filtro por responsable
(`?responsableId=` o `SIN_ASIGNAR`), filtro y KPI de **vencidos**, acción `ASIGNAR` individual y en lote con fecha límite.

**Fase 4 — Reportes** (`GET /api/audit-deposito/reportes?audId=`; `backend/services/auditoriaDepositoReportesService.js`;
pestaña `AuditDepositoReportesTab.jsx`). Fuente: la fotografía de una auditoría (con ERI, faltantes, sobrantes, sin ingreso,
desconocidos, movidas, lecturas repetidas) o la foto EN VIVO del depósito (sin auditoría: sin ERI ni faltantes).
| Sección | Qué trae |
|---|---|
| Resumen ejecutivo | activas, valor $ (a pesos con la cotización de la auditoría), ERI, faltantes/sobrantes por separado en unidades y $, caducadas %, sin aviso %, pendiente de cobro $ y %, antigüedad promedio y mediana, duración de la sesión |
| Hallazgos | redactados solos por reglas: ERI y diferencias; caducadas × sin aviso (si más del 20% nunca se avisó, la permanencia se explica por falta de aviso; si no, es el cliente que no retira); tramo dominante; sin avisar (más de 30 días / sin teléfono); cliente que concentra valor; sin cobrar; ingresos dobles; registro de casos |
| Antigüedad | franja de sedimentación + tabla por tramos 0-15 / 16-30 / 31-60 / 61-90 / 91-180 / +180 (n, %, $, % valor, sin aviso); detalle por tramo en la versión completa |
| Sin avisar | prioridad ALTA (más de 30 días) / MEDIA (más del plazo) / BAJA, contacto y marca "sin teléfono" |
| Duplicadas | mismo código en más de una fila · mismo cliente ingresado el mismo día (posible ingreso doble, marca "mismo trabajo") · lecturas repetidas de la sesión |
| Valorización | por moneda (nativo y $), por situación de pago, por área, clientes con más valor. Es mercadería en custodia, no deuda |
| Por cliente | top por cantidad: n, %, $, más antigua, sin aviso, sin cobrar |
| Registro de casos | abiertos, crónicos, reincidentes, cerrados, asumidos, vencidos, edad promedio y máxima, **tasa de reincidencia** = reincidentes / (cerrados + reincidentes), por tipo y severidad, últimas 6 auditorías |
| Censo completo | solo en la versión completa |
Versión **ejecutiva** (listas recortadas) o **completa**. Salidas: **PDF** por impresión del navegador (solo se imprime el reporte,
con líneas de firma Responsable de depósito / Auditor) y **Excel** de 13 hojas (Resumen, Hallazgos, Antigüedad, Antigüedad detalle,
Sin avisar, Duplicadas, Mismo cliente mismo día, Valorización, Por cliente, Casos, Faltantes, Sobrantes, Sin ingreso, Desconocidos, Movidas, Censo).

**Fase 5 — Conteo cíclico** (`GET /api/audit-deposito/ciclico`; pestaña `AuditDepositoCiclicoTab.jsx`). Zona = prefijo de área.
Clase **ABC por valor acumulado** en depósito (hasta 80% = A, hasta 95% = B, resto C; clave `AUDIT_DEP_ABC_CORTES`), frecuencia
por clase (`AUDIT_DEP_CICLICO_DIAS_A/B/C` = 7 / 14 / 30 días), última auditoría CERRADA que cubrió el área (TOTAL cubre todas),
días transcurridos, estado NUNCA / VENCIDO / PROXIMO (2 días o menos) / AL_DIA, próxima fecha, atraso, caducadas y casos abiertos
por área, cobertura (% de órdenes en áreas al día) y 3 áreas sugeridas. Botón **"Auditar solo X"** abre una auditoría con alcance
PREFIJO desde la misma pantalla (deshabilitado si ya hay una abierta). En local hoy: 15 áreas, 1 A, 5 B, 9 C.

**Pruebas:** el mismo script, ahora **47 comprobaciones, todas PASS** (se sumaron: reporte de auditoría cuadra con la fotografía y
la valorización, reporte en vivo sin ERI, sin avisar ordenado con prioridad, indicadores del registro, conteo cíclico con ABC y
cobertura, ninguna área NUNCA/VENCIDA tras una TOTAL, usuarios internos, asignar con fecha límite vencida → VENCIDOS y filtro por
responsable, fecha inválida rechazada). Sin E2E en navegador (mismo motivo que antes).

**Archivos nuevos de esta tanda:** `backend/services/auditoriaDepositoReportesService.js`, `src/components/pages/AuditDepositoReportesTab.jsx`,
`src/components/pages/AuditDepositoCiclicoTab.jsx`. Editados: `auditoriaDepositoService.js` (fecha límite, filtros, `vencido`),
`auditDepositoCasosController.js`, `auditDepositoRoutes.js` (3 rutas GET), `AuditDepositoCasosTab.jsx`, `AuditDepositoView.jsx`
(2 pestañas), `scripts/add_auditoria_deposito.sql` (4 claves más, idempotente).

### 12.9 Reporte ejecutivo con análisis gráfico + criterios de severidad visibles (2026-09-08)

**Análisis gráfico** (solo en la versión **ejecutiva**, sección "Análisis Gráfico Ejecutivo", recharts): órdenes por tramo de
antigüedad · valor $ de los casos abiertos por tipo · **verificación física** (dona verificadas / faltantes / sobrantes / movidas,
solo con auditoría) · **casos abiertos por tipo apilados por severidad** (Alta / Media / Baja) · **situación de pago** (dona en $) ·
**valor en depósito por área** (barras horizontales, 8 áreas con más valor). Debajo, un recuadro con los criterios que explican
los gráficos (severidad, crónico, reincidente, envejecida, sin aviso, ERI).

**Criterios de severidad, ahora a la vista** (antes solo vivían en `calcSeveridad`):
- Registro de casos → tarjeta **Severidad alta**: "3+ detecciones · faltante > $ 5.000 · más de 90 días" (el umbral sale de
  `AUDIT_DEP_UMBRAL_VALOR_ALTA` vía `estado.config.umbralValorAlta`); el resto de las tarjetas también dice qué cuenta (tooltip + subtítulo).
- Reporte → tarjetas del Registro de casos con su definición y, bajo la tabla Tipo/Alta/Media/Baja (en ejecutivo y completo):
  **Alta** = 3 o más detecciones, o Faltante con valor mayor al umbral, o más de 90 días (del caso o de la orden en depósito);
  **Media** = cualquier diferencia física (Faltante, Sobrante, Sin ingreso, Sin registro) o más de 30 días; **Baja** = el resto.
- El resumen del reporte ahora trae `umbralValorAlta` y `diasSinAviso` (`auditoriaDepositoReportesService.js`); el frontend usa
  5.000 / 3 como respaldo hasta que el backend se reinicie.

Probado con un render en servidor del reporte real de la réplica (foto en vivo y AUD-2026-0907-04, versiones ejecutiva y completa): sin errores.
