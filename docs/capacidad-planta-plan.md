# Capacidad de planta y fechas de entrega — documento de traspaso

> Para la sesión que tome este trabajo. Escrito el 12-ago-2026 desde la base **local**
> (réplica de `SecureAppDB`). Todos los números de acá salen de consultas reales, no de
> estimaciones — están las consultas al final para que las puedas repetir.
>
> **Bordado (EMB) se está trabajando en paralelo en otra sesión. No lo toques** — ver
> "Qué NO tocar" al final.

---

## 1. Qué se quiere

Hoy el sistema **no sabe cuánto trabajo tiene adentro**. Cuando entra un pedido:

- La fecha de entrega se calcula con `DATEADD(day, 3, GETDATE())` **hardcodeado** en
  `webOrdersController.js` — tres días para todo, siempre, sin mirar la carga.
- Nadie puede responder "¿cuándo lo tengo?" con un número defendible.
- No hay forma de ver si una máquina está saturada o libre.

Se quiere:

1. **Saber la carga real** de cada área y cada máquina en cualquier momento.
2. **Proponer una fecha de entrega** basada en el trabajo ya comprometido y el volumen
   del pedido nuevo.
3. **Una agenda interna** que se reordene sola cuando se termina algo antes de lo previsto,
   **sin mover la fecha prometida al cliente**.

---

## 2. Hallazgos — leer esto antes de diseñar nada

### 2.1 No existe ni un solo dato de capacidad cargado

`ConfigEquipos` tiene 23 equipos en 9 áreas. **Todos** tienen `Capacidad = 100` y
`Velocidad = 10`, salvo `CALANDRA 1` que tiene ambos en 0. Son valores de relleno
idénticos: nadie los cargó nunca.

```
DF       DTF-1, DTF-2, DTF-3, DTF-4, DTF-UV-1      (5)
SB       FEDAR 1, FEDAR 2, MIMAKI, CALANDRA 1      (4)
EMB      Tajima 6, Tajima 6 Cabezales, Gensy 1/2   (4)
ECOUV    ECOSOLVENTE, ECOSOLVENTE 2, UV            (3)
TPU      SAMURAI, TPU 1, TPU 2                     (3)
DIRECTA  DIRECTA 1                                 (1)
EST      ESTAMPADO                                 (1)
TWC      CORTE 1                                   (1)
TWT      COSTURA 1                                 (1)
```

**Consecuencia:** cualquier cálculo de capacidad arranca con datos que hay que pedirle a
la planta. No hay atajo. Ver §5.

### 2.2 `SesionesTurno` NO es de turnos de producción

El nombre engaña. Sus columnas son `StuMontoInicial`, `StuMontoFinal`, `StuDiferencia`,
`StuUsuarioAbre`… Es el **arqueo de caja**. No sirve para capacidad y no hay ninguna otra
tabla de turnos, calendario laboral ni feriados.

### 2.3 Los tiempos prometidos no coinciden con los reales

`ConfiguracionTiemposEntrega` solo tiene filas para 4 áreas, y lo que promete no es lo que
pasa. Comparando con el tiempo real medido (`FechaIngreso` → `FechaPronto`, últimos 6 meses):

| Área | Promete | Real (promedio) | Real (máximo) | Órdenes medidas |
|---|---|---|---|---|
| DF | 24 h | **9 h** | 187 h | 5.107 |
| SB | 48 h | **35 h** | 314 h | 3.022 |
| ECOUV | "48 a 72 horas" | **52 h** | 164 h | 27 |
| DIRECTA | 96 h | 74 h | 74 h | 1 |
| EMB, EST, TWC, TWT, TPU | *(sin fila)* | — | — | — |

Dos lecturas:

- **El promedio se cumple con holgura**, pero **la cola larga es enorme**: DF promete 24 h,
  promedia 9 y tiene casos de 187 h. Una fecha calculada sobre el promedio va a fallar
  justo en los pedidos que importan.
- **Ya existe la materia prima para calibrar.** No hace falta inventar tiempos: hay 8.000+
  órdenes con ingreso y fin reales. Cualquier modelo que se construya se puede contrastar
  contra esa historia antes de mostrarle una fecha a un cliente.

### 2.4 El volumen es muy desparejo

Últimos 3 meses: DF 8.778 órdenes en 57 días (~154/día), SB 3.743 en 37 días (~101/día), y
el resto de las áreas por debajo de 70 órdenes **en total**.

**Consecuencia de diseño:** un motor genérico que trate igual a DF y a TWC va a estar
sobredimensionado para siete áreas y corto para dos. Conviene que el modelo sea genérico
pero que la **puesta en marcha** empiece por DF y SB, que son las que tienen datos para
validar.

---

## 3. Lo que ya existe y sirve

| Objeto | Para qué sirve |
|---|---|
| `ConfigEquipos` (AreaID, Nombre, Activo, Capacidad, Velocidad) | El inventario de máquinas ya está; faltan los valores reales |
| `Ordenes.MaquinaID` | La orden ya se puede asignar a una máquina |
| `Ordenes.Prioridad` | Normal / Urgente, ya se usa en todo el sistema |
| `Ordenes.FechaIngreso`, `FechaEntradaSector`, `FechaPronto` | **El historial real para calibrar** |
| `Ordenes.FechaEstimadaEntrega` | El campo de la promesa ya existe (hoy mal llenado) |
| `Ordenes.EstadoDependencia`, `LiberaCuandoOrdenID` | Qué órdenes NO pueden arrancar todavía |
| `ConfiguracionTiemposEntrega` (AreaID, Prioridad, Horas, Dias, Texto) | Los plazos que se le muestran al cliente en el portal |
| `HistorialOrdenes` | Cada cambio de estado con su fecha |

---

## 4. Lo que falta

### 4.1 Datos de máquina (bloqueante)

`ConfigEquipos` necesita, por equipo:

- **`Cabezales`** — cuántas piezas hace a la vez. Crítico en bordado: una `Tajima 6
  Cabezales` borda 6 prendas simultáneas; tratarla como una máquina de 1 cabezal
  **multiplica el tiempo estimado por 6**.
- **Velocidad real y su unidad** — no es comparable entre áreas: bordado va en puntadas por
  minuto, las impresoras en m²/hora o metros lineales/hora, corte en metros/minuto.
  Conviene `VelocidadValor` + `VelocidadUnidad` en vez de un número suelto sin significado
  (que es lo que hay hoy).
- **`MinutosPreparacion`** — el setup por trabajo (bastidor, cambio de rollo, calibrar).
  En trabajos chicos suele pesar más que la producción misma.

### 4.2 Calendario laboral

No existe. Hace falta: días y horas de trabajo por área, turnos, y feriados. Sin esto,
cualquier cola calcula sobre 24×7 y promete fechas de domingo.

### 4.3 Motor de estimación

Una función `minutosDeOrden(orden)` por área. **No la inventes**: calíbrala contra el
historial de §2.3.

### 4.4 Cola y agenda

- Cola por máquina respetando prioridad y dependencias.
- Recompresión automática al terminar algo antes.
- **Promesa congelada**: la fecha que ve el cliente no se mueve aunque la interna sí.

---

## 5. Datos a pedirle a la planta

Esto no sale de la base. Hay que preguntarlo, y **sin esto el proyecto no arranca**:

1. Por cada una de las 23 máquinas: **cabezales**, **velocidad real** (en su unidad) y
   **minutos de preparación** típicos.
2. **Horario de trabajo** por área: días, horas por día, turnos.
3. **Feriados** del año.
4. ¿Un pedido urgente **saltea la cola** o solo se ordena antes dentro de su día?
5. ¿Cuánto margen de seguridad se le suma a la fecha antes de prometerla?

---

## 6. Fases propuestas

**F1 — Datos de máquina.** Columnas nuevas en `ConfigEquipos` + pantalla para cargarlas +
los valores reales. Sin F1 no hay nada.

**F2 — Calendario laboral.** Tabla nueva de horarios y feriados por área.

**F3 — Motor de estimación**, calibrado contra el historial. Entregable: un reporte que
compare, para las últimas 500 órdenes de DF y SB, el tiempo estimado por el motor contra el
real. **Si no se parece, el motor está mal — no se sigue.**

**F4 — Carga y cola.** Vista de ocupación por máquina y área. Todavía sin prometer nada:
solo mostrar lo que hay.

**F5 — Fecha propuesta.** Reemplazar el `+3 días` hardcodeado. Arrancar **solo con DF y
SB**, que tienen volumen para validar.

**F6 — Agenda interna con recompresión** y promesa congelada.

---

## 7. Riesgos

**La cola larga.** DF promedia 9 h con picos de 187. Un motor afinado al promedio va a
prometer bien el 80% de las veces y fallar feo en el 20% restante — que son justo los
pedidos grandes, los que el cliente recuerda. Conviene prometer sobre un **percentil alto**
(p85 o p90), no sobre el promedio.

**Las dependencias mandan sobre la cola.** Una orden con `EstadoDependencia` no arranca
cuando dice la agenda sino cuando llega el material. Si el motor las ignora, promete
fechas imposibles.

**Un pedido grande tapa la cola** y empuja a todos los que entran después. Hay que decidir
qué pasa con los que ya tenían fecha prometida.

**Prometer sobre estimaciones es un compromiso comercial.** Mientras el motor no esté
validado contra el historial, la fecha debería mostrarse como *estimada, sujeta a
confirmación* y no como una promesa en firme.

---

## 8. Cómo verificar

Estas son las consultas que produjeron los números de este documento. Correlas en local
(réplica) para confirmar que nada cambió:

```sql
-- Equipos y sus valores de capacidad
SELECT AreaID, Nombre, Activo, Capacidad, Velocidad FROM ConfigEquipos ORDER BY AreaID, Nombre;

-- Tiempo REAL de ciclo por área (últimos 6 meses)
SELECT AreaID, COUNT(*) AS Ordenes,
       AVG(DATEDIFF(hour, FechaIngreso, FechaPronto)) AS HorasPromedio,
       MAX(DATEDIFF(hour, FechaIngreso, FechaPronto)) AS HorasMax
FROM Ordenes
WHERE FechaPronto IS NOT NULL AND FechaIngreso IS NOT NULL
  AND FechaPronto > FechaIngreso AND FechaIngreso >= DATEADD(month, -6, GETDATE())
GROUP BY AreaID ORDER BY Ordenes DESC;

-- Volumen por área (últimos 3 meses)
SELECT AreaID, COUNT(*) AS Ordenes, COUNT(DISTINCT CAST(FechaIngreso AS DATE)) AS DiasConIngreso
FROM Ordenes WHERE FechaIngreso >= DATEADD(month, -3, GETDATE())
GROUP BY AreaID ORDER BY Ordenes DESC;

-- Plazos que se le prometen al cliente hoy
SELECT * FROM ConfiguracionTiemposEntrega;
```

---

## 9. Qué NO tocar

**Bordado (EMB) está en desarrollo activo en otra sesión.** No modificar:

- `backend/controllers/embBoardController.js`
- `src/components/production/EmbBandeja.jsx`
- `src/client-portal/modulos/order-form/components/BordadoTechnicalUI.jsx`
- `src/client-portal/modulos/order-form/components/PredisenoBordadoModal.jsx`
- `src/client-portal/modulos/order-form/utils/bordadoHilos.js`
- `docs/migrations/bordado_*.sql`

En bordado ya hay un estimador de puntadas y de minutos de máquina
(`estimarPuntadas` / `estimarMinutos` en `bordadoHilos.js`), calculado por área y densidad
según los estándares del rubro. **Sirve como referencia de cómo modelar el resto**, pero
está en el front y es específico de bordado.

Cuando el motor genérico exista, bordado debería migrar a él — coordinar antes.

### Reglas de trabajo del proyecto

- **No commitear ni migrar a producción.** Se entregan scripts SQL y los corre el usuario.
- Los scripts de node contra la base son **solo lectura** y **siempre contra local**.
- **No arrancar ni reiniciar los servidores de desarrollo** del usuario.
