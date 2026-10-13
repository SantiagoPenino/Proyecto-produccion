# Consulta al cliente con la orden en lote o en máquina — análisis

**23/09/2026.** Pedido: evaluar si una consulta al cliente se puede hacer con la orden ya en un lote o en una máquina, de modo que al crearla la orden salga del lote y de la máquina y quede en Pendiente. Ver cómo afecta a Sublimación, DTF y ECOUV según en qué punto esté el lote: en mesa, en la cola de una máquina, imprimiendo, en pausa o en calandra.

Hoy la consulta solo se permite con la orden **Pendiente y sin lote**: lo valida `crearConsulta` ([consultasClienteService.js:271](../backend/services/consultasClienteService.js)) y el botón no aparece en el detalle ([OrderDetailModal.jsx:1348](../src/components/production/components/OrderDetailModal.jsx)).

Marcas de este documento: **verificado** = leído en el código (con archivo:línea) o en la base local; **inferido** = deducido del código o de comentarios, sin verlo funcionar; **no sé** = depende de cómo se trabaja en planta.

---

## 1. Resumen

1. **Sacar una orden de un lote, aunque esté imprimiendo, ya se puede hacer hoy.** El detalle del lote tiene el botón "Sacar del Rollo", que avisa "El rollo está en máquina" y deja seguir (verificado, [RollDetailsModal.jsx:1024](../src/components/modals/RollDetailsModal.jsx)). La consulta reusaría ese mismo mecanismo: el código nuevo es poco.
2. **El problema real es el trabajo físico, no el sistema.** Si el operario ya bajó los archivos del lote y armó el trabajo en la máquina, sacar la orden en el sistema no la saca del trabajo, y se imprime igual. El sistema **no registra** cuándo el operario baja los archivos (verificado: la descarga ZIP del lote no escribe nada en la base).
3. **La diferencia con hoy es quién la saca.** "Sacar del Rollo" lo hace alguien que está mirando el lote. La consulta la puede hacer cualquier usuario interno desde el detalle de la orden, sin saber en qué máquina está ni avisarle a nadie.
4. **Por área, lo que cambia es si el sistema sabe qué ya se imprimió:**
   - **SB:** sí. Imprime en cola y el operario tiene que marcar "impreso" en orden.
   - **DTF:** a medias. La marca es obligatoria para finalizar el lote, pero se puede poner en cualquier momento, así que durante la impresión no es confiable.
   - **ECOUV:** no. La marca es opcional y el lote se finaliza sin ella.
5. **Encontré cuatro problemas que existen hoy, con o sin este cambio** (sección 6). El más directo: el **Armado Mágico de ECOUV mete en lotes órdenes frenadas por una consulta**.

**Recomendación:**
- Permitir la consulta con el lote **en mesa o en la cola de una máquina sin arrancar**, siempre que la orden **no tenga nada marcado como impreso**.
- Con el lote **imprimiendo o en pausa**: no permitirla en DTF ni en ECOUV. En SB, como mucho, solo si no está marcada y con un aviso visible en el lote.

---

## 2. Cómo es hoy el ciclo de un lote (verificado)

| Momento | `Rollos.Estado` | Máquina | Estado de las órdenes | Dónde |
|---|---|---|---|---|
| Armado en mesa | `Abierto` | no | `En Lote` | creación de lote, Armado Mágico |
| Asignado a máquina (en cola) | `En cola` | sí | `En Maquina` | [productionKanbanController.js:232](../backend/controllers/productionKanbanController.js) |
| Imprimiendo | `En maquina` + fecha de inicio + registro en `BitacoraProduccion` + bobina montada | sí | `En Maquina` | [productionController.js:161](../backend/controllers/productionController.js) |
| Pausado | `Pausado` (cierra la bitácora) | sí | `En Maquina` | [productionController.js:204](../backend/controllers/productionController.js) |
| Finalizado en impresora (SB) | `En Cola` en la calandra | calandra | `En Maquina` | [productionController.js:359](../backend/controllers/productionController.js) |
| Vuelto a la cola a medio imprimir | `En Cola` | no | `En Lote` | [productionController.js:314](../backend/controllers/productionController.js) |
| Desmontado de la máquina | `Abierto` | no | `En Lote` | [productionKanbanController.js:283](../backend/controllers/productionKanbanController.js) |
| Finalizado | `Finalizado` | se conserva | `Control y Calidad` | [productionController.js:402](../backend/controllers/productionController.js) |

Importante: **"En Lote" no garantiza que no se haya impreso nada.** Un lote que se devuelve a la cola a medio imprimir deja todas sus órdenes en `En Lote`, y algunas ya marcadas como impresas. Por eso cualquier bloqueo tiene que mirar las **marcas de la orden**, no el estado del lote.

Marcas por orden (verificado, [rollsController.js:1460](../backend/controllers/rollsController.js)): `Impreso`, `FechaImpreso`, `CantidadImpresa` (avance parcial), `Calandrado`, `CantidadCortada` y `GrupoManual` (grupo visual de SB).

---

## 3. Lo que ya existe para sacar una orden de un lote (verificado)

| Camino | Qué limpia | Si el lote queda vacío | Restricción |
|---|---|---|---|
| **"Sacar del Rollo"** en el detalle del lote → `unassignOrder` ([ordersController.js:2911](../backend/controllers/ordersController.js)) | lote y secuencia. **La máquina queda** (el comentario de la línea 3012 dice que la limpia, pero no lo hace) | **Borra el lote aunque esté imprimiendo**, pone la máquina en `Detenido` y **no cierra la bitácora** (líneas 2989–3017) | Ninguna. El front solo avisa |
| Arrastrar a pendientes en Planeación → `moveOrder` ([rollsController.js:280](../backend/controllers/rollsController.js)) | lote, secuencia, máquina | Barrido global: borra **cualquier** lote vacío de más de 10 minutos, sin mirar el estado (líneas 505–512) | Bloquea solo lotes `Cerrado`/`Producción`. Imprimiendo es `En maquina`: no lo bloquea |
| Impresión parcial al finalizar (solo DIRECTA) ([productionController.js:268](../backend/controllers/productionController.js)) | lote, secuencia, máquina | **Cierra el lote como `Finalizado` y cierra la bitácora**: es la forma correcta | Solo el área DIRECTA |
| Desarmar lote → `dismantleRoll` ([rollsController.js:923](../backend/controllers/rollsController.js)) | lote, bobina, máquina, secuencia | Borra el lote | — |

**Ninguno de los cuatro limpia las marcas de impresión ni el grupo manual.**

Cambiar el estado no tiene efectos afuera: `changeOrderState` solo actualiza la orden, escribe el historial y avisa por socket. No sincroniza con el ERP ni le avisa al cliente (verificado, [stateManagerService.js:124](../backend/services/stateManagerService.js)).

La pantalla del lote se refresca sola cuando una orden sale (verificado, [RollDetailsModal.jsx:459](../src/components/modals/RollDetailsModal.jsx)): la orden desaparece de la lista, pero **sin ningún mensaje**.

---

## 4. Efecto según en qué punto esté el lote (común a las tres áreas)

| Momento | En el sistema | En la planta |
|---|---|---|
| **En mesa** (`Abierto`) | Sin problemas: es lo mismo que "Sacar del Rollo" hoy. Si queda vacío se borra, y está bien. | Sin efecto, salvo que ya hayan bajado los archivos del lote (**no sé** si lo hacen en este punto). |
| **En la cola de una máquina** (`En cola`) | Igual que en mesa. Si queda vacío se borra, pero `unassignOrder` pone la máquina en `Detenido` **aunque esté imprimiendo otro lote** que tenía adelante (hallazgo 2). | **Depende de cuándo arman el trabajo.** Si los archivos ya se bajaron y el trabajo ya se armó, la orden se imprime igual. **No sé** en qué momento lo hacen. |
| **Imprimiendo** (`En maquina`) | Si era la última orden, el lote se borra con la bitácora abierta. Si ya estaba marcada, vuelve a Pendiente con la marca puesta. | **El trabajo ya está en la máquina.** Si nadie la saca a mano, se imprime. Cuando el cliente responde "continuar", entra en otro lote y **se imprime dos veces**. |
| **En pausa** (`Pausado`) | Igual que imprimiendo. La bitácora ya está cerrada, pero el lote se borra igual si queda vacío. | Igual que imprimiendo: el trabajo quedó a medias en la máquina. |
| **Vuelto a la cola a medio imprimir** | Puede tener órdenes ya impresas con estado `En Lote`. | Las impresas ya gastaron material. |

Al liberarse la consulta, la orden vuelve a **Pendiente, no a su lote** (inferido: el estado que se guarda al congelar sería el de después de sacarla, [consultasClienteService.js:202](../backend/services/consultasClienteService.js)). Alguien la tiene que volver a armar en un lote.

---

## 5. Por área

### Sublimación (SB)

- **Imprime en cola y marca en orden** (verificado). El detalle del lote solo deja marcar "impreso" en secuencia, sin saltear ([RollDetailsModal.jsx:924](../src/components/modals/RollDetailsModal.jsx)). El lote no se puede finalizar sin todas marcadas ([productionController.js:305](../backend/controllers/productionController.js)). **Mientras imprime, la marca refleja por dónde va la máquina**: es el área donde el sistema mejor sabe qué ya salió.
  - Inferido: igual puede pasar que el trabajo completo del lote ya esté cargado en la máquina y que las pendientes salgan después aunque no estén marcadas.
- **Dos estaciones, impresora y calandra.** A la calandra solo entra un lote con todas las órdenes marcadas impresas (verificado, [productionKanbanController.js:207](../backend/controllers/productionKanbanController.js)). **En calandra el papel ya está impreso: consultar ahí no frena nada.** Hay que bloquearlo.
- **Sacar una pendiente del medio de la cola no desordena lo impreso.** El detalle ordena las impresas por `FechaImpreso` y las pendientes por secuencia (verificado en los comentarios de [rollsController.js:1519](../backend/controllers/rollsController.js)).
- **Grupo manual.** `GrupoManual` no se limpia al sacarla. El detalle arma grupos con todas las órdenes que comparten el número ([RollDetailsModal.jsx:652](../src/components/modals/RollDetailsModal.jsx)). Si la orden entra después en otro lote que tiene un grupo con el mismo número, **queda agrupada con órdenes ajenas** (verificado en el código, no lo vi pasar).
- **Si tenía la marca de impreso y se la saca**, vuelve con la marca y la fecha. En el próximo lote aparece entre las impresas y **el lote se puede finalizar sin imprimirla** (verificado: la condición para finalizar solo mira la marca).
- **Tela de cliente:** los metros se descuentan al crear el pedido y se devuelven al cancelar. No dependen del lote, así que sacarla no los toca (verificado: `unassignOrder` no toca la tela).

### DTF

- **Marcado libre.** Se puede marcar cualquier orden en cualquier momento, sin secuencia (verificado, [RollDetailsModal.jsx:360](../src/components/modals/RollDetailsModal.jsx): "son las áreas que no imprimen en cola"). La marca es obligatoria para finalizar, pero **durante la impresión una orden sin marcar puede estar ya impresa**.
- **El film junta varias órdenes.** Inferido del "no imprimen en cola": si el trabajo del film ya se armó con la orden, sacarla en el sistema no la saca del film. **No sé** si arman un trabajo por lote en PhotoPrint ni en qué momento.
- **Órdenes de falla (-F):** el lote no se finaliza sin sus metros ([productionController.js:234](../backend/controllers/productionController.js)). Sacar una orden normal no lo afecta.
- **Lote por material y variante:** sacar una orden no rompe esa regla.
- **Armado Mágico:** en DTF no está habilitado. El botón solo corre en `ECOUV`/`DTF` ([AreaView.jsx:47](../src/components/production/areas/AreaView.jsx)) y la ruta del área es `DF`.

### ECOUV

- **Marcado libre y además opcional.** ECOUV no está en `AREAS_GATE_MARCADO` ([productionController.js:67](../backend/controllers/productionController.js)): el lote se finaliza sin marcar nada. **El sistema no tiene cómo saber si una orden de un lote que está imprimiendo ya salió.** Un bloqueo "si ya está impresa" no protege nada en ECOUV salvo que marquen. La consulta Q1 de la sección 9 mide si marcan.
- **Hermana de terminaciones** (XEUV, área TERMINAC): ya se frena junto con la ECOUV al consultar y se libera al responder (verificado, [consultasClienteService.js:185](../backend/services/consultasClienteService.js)). No está en ningún lote, así que sacar la ECOUV no la afecta.
- **Tinta UV / Ecosolvente:** el lote se asigna a la máquina según la tinta ([productionKanbanController.js:177](../backend/controllers/productionKanbanController.js)). Sacar una orden no lo afecta.
- **Armado Mágico:** es la única área donde está habilitado, y **hoy toma órdenes frenadas por consulta** (hallazgo 1). Con este cambio pasaría más seguido.

---

## 6. Problemas que existían (independientes de esta decisión)

**Actualización del 23/09:** los tres primeros quedaron arreglados, con la lógica compartida en `backend/utils/salidaDeLote.js` (ver CHANGELOG del 23/09). El 4 queda como está, porque conservar la máquina es a propósito (comentario del paso 2). Probado contra la base local, con los controladores corriendo de verdad y todo revertido al final:
- sacar la última orden de un lote imprimiendo lo cierra como `Finalizado`, cierra su bitácora y no toca la configuración de la máquina;
- sacar la última orden de un lote que nunca arrancó lo borra, como antes;
- mover una orden a otro lote conserva la marca de impreso y le saca el grupo;
- una orden con avance por contador conserva su avance;
- el Armado Mágico ya no toma una orden frenada por consulta.

"Desarmar lote" fallaba en todas las bases: limpiaba `Ordenes.BobinaID`, una columna que no existe ni en local ni en producción (confirmado el 23/09 con `COL_LENGTH`). Lo mismo les pasaba a asignar bobina y al relevo de bobina. Se sacaron esas tres escrituras (nada leía el dato) y ahí se pudo probar desarmar: las órdenes vuelven a Pendiente sin marcas y el lote se borra.

1. **El Armado Mágico mete en lotes órdenes frenadas por consulta (ECOUV).** Toma todas las órdenes con estado `Pendiente` sin lote ([rollsController.js:2045](../backend/controllers/rollsController.js)). Una orden frenada tiene estado general `Pendiente`, porque "Esperando Cliente" cuelga de "Pendiente" (verificado en la base local; en producción lo crea el mismo código). Resultado: la orden entra a un lote y "Esperando Cliente" se pisa con "En Lote" mientras el cliente todavía no respondió. La asignación a lote por el otro camino sí lo controla ([ordersController.js:1541](../backend/controllers/ordersController.js)).
2. **Se borra un lote que está imprimiendo si queda vacío.**
   - "Sacar del Rollo" lo borra y deja abierto el registro de producción de la máquina (sin fecha de fin). Además pone la máquina en `Detenido` sin mirar si está imprimiendo otro lote.
   - El barrido de `moveOrder` borra cualquier lote vacío de más de 10 minutos, sin mirar el estado.
   - En la base local no hay ninguna clave foránea hacia `Rollos` que lo impida (verificado).
   - La forma correcta ya existe en la impresión parcial: cerrar el lote como `Finalizado` y cerrar la bitácora.
3. **Sacar una orden de un lote no limpia sus marcas** (`Impreso`, `FechaImpreso`, `CantidadImpresa`, `Calandrado`, `CantidadCortada`, `GrupoManual`). Pasa en los cuatro caminos. Una orden impresa que vuelve a otro lote aparece como ya impresa. En SB puede sumarse a un grupo ajeno.
4. **`unassignOrder` no limpia la máquina de la orden**, aunque el comentario dice que sí ([ordersController.js:2963](../backend/controllers/ordersController.js) y 3012). Es menor: se corrige al reasignarla.

---

## 7. Qué habría que hacer si se implementa

1. `crearConsulta`: si la orden está en un lote, sacarla dentro de la misma transacción, con la receta de `unassignOrder`, y **después** congelarla. Así el estado que se guarda para restaurar es Pendiente.
2. **Bloquear** si la orden tiene `Impreso = 1`, `CantidadImpresa > 0` o `Calandrado = 1`. Eso incluye siempre SB en calandra.
3. **Lote que queda vacío:** si estaba en mesa o en cola, borrarlo como hoy. Si estaba imprimiendo o en pausa, **cerrarlo** como la impresión parcial.
4. **Limpiar `GrupoManual`** al sacarla.
5. **Aviso a planta.** Hoy no hay forma de hacerlo: la pantalla del lote se refresca, pero no muestra ningún mensaje. Mínimo: un aviso por socket a quien tenga abierto ese lote o esa máquina ("DTF-26019 salió del lote X por una consulta al cliente: sacala del trabajo de la máquina"), más una línea en el historial del lote.
6. **Front:** abrir `puedeConsultar` a esos estados y que el modal diga qué va a pasar ("Está en el lote X, en la máquina Y, imprimiendo. Al enviar la consulta sale del lote y vuelve a Pendiente").
7. **Arreglar el Armado Mágico** (hallazgo 1). Sin eso, la orden frenada puede volver a un lote sola.

---

## 8. Opciones

| | Qué permite | Riesgo |
|---|---|---|
| **A** | Lote en mesa o en la cola de una máquina sin arrancar, y la orden sin marcas | Bajo en el sistema. En planta, depende de la pregunta 1 |
| **B** | A + lote imprimiendo o en pausa, orden sin marcas, lote cerrado bien y aviso a planta | En SB, medio: la marca es confiable, pero el trabajo cargado no cambia solo. **En DTF y ECOUV, alto**: el sistema no sabe si la orden ya salió |
| **C** | Todo, incluso impresas | No recomendado: doble impresión, marcas viejas, SB en calandra |

**Recomiendo A para las tres áreas.** Si hace falta el caso imprimiendo, B solo en SB.

---

## 9. Decisión de Santiago (23/09)

- La consulta se hace **antes de descargar los archivos**, así que la descarga no se tiene en cuenta por ahora.
- Las consultas **las hacen los operarios**: no hace falta un aviso a planta.
- Cuando el cliente responde, la orden **vuelve a Pendiente**, sin lote.
- Regla: se puede consultar con la orden en un lote **en mesa** o en un lote de una máquina que **no sea el que se está imprimiendo** (en cola o en pausa sí; `En maquina` no). En todos los casos, solo si la orden **no está marcada como impresa**. Ejemplo: un lote `EN MAQUINA` no; uno `PAUSADO` o `EN COLA` sí, si la orden no está marcada.

**Implementado el 23/09 (sin deployar):**
- `evaluarConsultable` en el servicio de consultas es la regla única. La usa `crearConsulta` y también `GET /api/consultas/orden/:id/elegibilidad`, que es lo que mira el detalle para mostrar el botón.
- `sacarDelLote` saca la orden del lote antes de congelarla y deja Pendiente como estado previo.
- Las -F quedan afuera: son internas.

Probado contra la base local, con el servicio real y revirtiendo todo:
- **Lote pausado:** la orden sale y el lote se cierra.
- **Lote imprimiendo:** se rechaza.
- **Orden marcada:** se rechaza.
- **Lote en cola que nunca arrancó:** la orden sale y el lote se borra.
- **Lote en mesa con otra orden:** sale solo esa.
- **Pendiente sin lote:** como antes.

## 10. Preguntas que se hicieron para decidir

**Preguntas:**
1. ¿En qué momento el operario baja los archivos del lote y arma el trabajo en la máquina: al armar el lote, al asignarlo a la máquina o al arrancar? Si es al asignarlo, "en cola" ya tiene el mismo riesgo que imprimiendo.
2. ¿Quién hace las consultas en la práctica: el operario de la máquina o alguien de oficina o atención? Si no es el de la máquina, el aviso a planta es obligatorio.
3. Cuando el cliente responde "continuar", ¿la orden vuelve a Pendiente para armarla de nuevo, o querés que intente volver a su lote si sigue abierto?
4. ¿Arreglo los problemas de la sección 6? Son independientes de esta decisión.

**Queries para correr en producción (solo lectura):**

```sql
-- Q1. ¿Se marca "impreso" en cada área? Órdenes de lotes arrancados en los últimos 30 días.
SELECT o.AreaID,
       COUNT(*) AS Ordenes,
       SUM(CASE WHEN ISNULL(o.Impreso, 0) = 1 THEN 1 ELSE 0 END) AS MarcadasImpresas
FROM dbo.Ordenes o WITH (NOLOCK)
JOIN dbo.Rollos r WITH (NOLOCK) ON CAST(r.RolloID AS VARCHAR(50)) = o.RolloID
WHERE r.Estado = 'Finalizado'
  AND r.FechaInicioProduccion >= DATEADD(DAY, -30, GETDATE())
  AND o.AreaID IN ('SB', 'DF', 'ECOUV')
  AND o.Estado <> 'Cancelado'
GROUP BY o.AreaID;
```

```sql
-- Q2. ¿Cuántas órdenes se sacan hoy de un lote, y desde qué estado? Últimos 60 días.
WITH H AS (
    SELECT h.OrdenID, h.Estado, h.Detalle,
           LAG(h.Estado) OVER (PARTITION BY h.OrdenID ORDER BY h.FechaInicio, h.HistorialID) AS EstadoAnterior
    FROM dbo.HistorialOrdenes h WITH (NOLOCK)
    WHERE h.FechaInicio >= DATEADD(DAY, -60, GETDATE())
)
SELECT o.AreaID, H.EstadoAnterior, COUNT(*) AS Retiros
FROM H
JOIN dbo.Ordenes o WITH (NOLOCK) ON o.OrdenID = H.OrdenID
WHERE (H.Detalle LIKE 'Retirado del Lote%' OR H.Detalle = 'Movida a Pendientes')
  AND o.AreaID IN ('SB', 'DF', 'ECOUV')
GROUP BY o.AreaID, H.EstadoAnterior
ORDER BY o.AreaID, Retiros DESC;
```

- **Q1:** si en ECOUV casi ninguna orden aparece marcada, confirma que ahí el sistema no sabe qué se imprimió.
- **Q2:** si ya se sacan seguido órdenes que estaban "En Maquina", la planta ya tiene la costumbre de ajustar el trabajo a mano, y el riesgo de B baja.
