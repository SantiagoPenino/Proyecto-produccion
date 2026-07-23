# Diseño: separar físicamente Impresión y Terminaciones en ECOUV

> Documento para la sesión que trabaja el rediseño de ECOUV (variantes + terminaciones).
> Redactado desde la sesión de Impresión Directa a pedido del negocio.

## El pedido del negocio

El área de **Impresión** ECOUV y el área de **Terminaciones** van a estar en **locales físicos
distintos**. La orden tiene que "viajar" del local de impresión al de terminaciones y recién
finalizar cuando las terminaciones estén hechas — **sin generar una orden nueva por terminación**
y **sin tener que modificar el mecanismo de `ProximoServicio` / flujo entre áreas** que ya existe.

## Buena noticia: el mecanismo YA está implementado (y sin tocar el flujo)

Revisando el código, la separación **no usa `ProximoServicio` ni cambia el `AreaID`** de la orden.
Usa un **sub-estado dentro de la MISMA área ECOUV**: `EstadoenArea = 'En Terminaciones'`.

Flujo actual (ya andando):
1. La orden se imprime en ECOUV (`AreaID = 'ECOUV'` **siempre**, nunca cambia).
2. Al pasar **Control**, el sistema mira si la orden tiene `OrdenTerminaciones` en `Pendiente`
   (`productionFileController.js` ~L828-852):
   - **Con terminaciones pendientes** → `EstadoenArea = 'En Terminaciones'` y
     `EstadoLogistica = 'En Terminaciones'` (NO va a Canasto Producción todavía).
     Detalle registrado: *"Control OK — pasa a Terminaciones ECOUV"*.
   - **Sin terminaciones** → sigue el camino normal (Canasto Producción → Depósito).
3. La **bandeja de Terminaciones ECOUV** (`ecoUvFinishingController.getFinishingOrders`) la trabaja;
   se marcan las `OrdenTerminaciones` (`updateTerminacionEstado`) y al finalizar, la orden pasa a
   Pronto / Canasto Producción → Depósito.

**Por qué esto es "cero impacto en el flujo":** la orden nunca cambia de `AreaID`, así que
`ProximoServicio`, `ConfiguracionRutas`, el despacho entre áreas y las etiquetas por área
**no se tocan**. El único punto de decisión es el gate ya existente (En Terminaciones vs
Canasto Producción), que vive dentro del propio control de ECOUV.

## Lo único que falta para separar FÍSICAMENTE los dos locales

Como la orden se distingue por `EstadoenArea` ('En Terminaciones' o no), separar los locales
es **solo cuestión de vistas** — no hay que tocar el motor de producción:

1. **Vista del local de IMPRESIÓN** (`/area/ecouv`, la de siempre):
   que muestre solo las órdenes ECOUV que **NO** están `'En Terminaciones'`
   (las que se están imprimiendo / en control).

2. **Vista del local de TERMINACIONES** (bandeja de acabado ECOUV):
   filtrar `getFinishingOrders` por `EstadoenArea = 'En Terminaciones'`, para que ese local
   vea **solo** las órdenes ya impresas que están esperando terminación. Hoy la query trae
   todas las ECOUV con `OrdenTerminaciones` (incluidas las que aún se imprimen) — agregar el
   filtro `AND O.EstadoenArea = 'En Terminaciones'` es el ajuste puntual.
   Ref: `ecoUvFinishingController.js:20-27` (query principal) y su fallback legacy L41-43.

3. **Opcional — etiqueta/QR para el traslado físico**: si el bulto tiene que moverse de un
   local a otro con escaneo, que la etiqueta/estado refleje "En Terminaciones" para el control
   de movimiento. Si el traslado es manual (a la vista), no hace falta nada.

Con eso, cada local ve su cola y la orden "viaja" lógicamente de impresión a terminaciones
por su `EstadoenArea`, sin que el flujo de próximo servicio se entere.

## Resumen de por qué NO hay que modificar el flujo actual

| Pieza del flujo | ¿Se toca? |
|---|---|
| `ProximoServicio` de la orden | ❌ No |
| `ConfiguracionRutas` (saltos entre áreas) | ❌ No |
| `AreaID` de la orden (sigue ECOUV) | ❌ No |
| Despacho / recepción entre áreas | ❌ No |
| Gate "no finalizar con terminaciones pendientes" | ✅ Ya implementado (sub-estado) |
| Vistas por local (impresión vs terminaciones) | ⚠️ Ajuste de filtro por `EstadoenArea` |

## ⚠️ Tensión con REMITOS / logística (a resolver con el negocio)

El sub-estado (arriba) mueve la orden **lógicamente**, pero para la logística la orden **sigue
en ECOUV** — porque toda la logística está construida sobre "una orden por área":
- `createRemito` despacha `areaOrigen → areaDestino` (`logisticsController.js:365`).
- Candado "pedido completo" y etiquetas trabajan por `AreaID`.
- Un pedido multi-área se materializa como **órdenes hermanas** (mismo NoDocERP, un `AreaID`
  y `CodigoOrden` por área); los remitos mueven bultos entre esas áreas.

**Consecuencia:** con terminaciones como sub-estado (sin orden), **NO hay remito
ECOUV→Terminaciones**. El traslado físico entre los dos locales no tiene remito, candado ni
etiqueta. Si el negocio necesita ese control físico, el sub-estado no alcanza.

### No hay atajo: remito entre locales ⇒ Terminaciones como ÁREA con orden

Remito, candado y etiqueta son POR ÁREA. Para tener remitos entre el local de impresión y el
de terminaciones, Terminaciones tiene que ser un **área con su orden hermana** — el mismo patrón
que **Corte y Costura**, que ya generan orden hermana y ya tienen remitos/candados/etiquetas
funcionando. El encadenado ECOUV → TERMINAC → Depósito se arma solo, igual que hoy
ECOUV → Corte → Depósito. **Se reusa toda la logística sin tocarla**; el costo es que sí se
genera una orden hermana de terminaciones (contradice el "no generar orden").

| Prioridad del negocio | Camino | Costo |
|---|---|---|
| No generar orden nueva | Sub-estado `'En Terminaciones'` (lo que hay hoy) | Sin remito/candado/etiqueta entre locales |
| Remitos + control físico entre locales | Terminaciones = área complementaria con orden hermana (patrón Corte/Costura) | Sí genera orden hermana; reusa toda la logística |

**Decisión de negocio pendiente:** ¿pesa más "no generar orden" o "tener remitos entre locales"?
No se puede tener ambos: la logística entera asume una orden por área.

### ✅ Camino recomendado: orden hermana "contenedora" (volver a generar la orden, bien hecho)

No es volver al modelo viejo (una orden por CADA tipo de terminación, que multiplicaba órdenes).
La idea: **una sola orden hermana de Terminaciones por orden ECOUV**, que además **mantiene el
detalle por archivo dentro** (`OrdenTerminaciones` sigue colgando). Combina lo mejor de los dos:

- Se genera **una** orden hermana (mismo NoDocERP, `AreaID='TERMINAC'`, `CodigoOrden` propio),
  igual que Corte/Costura → remito, candado, etiqueta y kanban **gratis**.
- El detalle fino (`OrdenTerminaciones` por archivo, Estado, cobro) **no se toca** — sigue vivo,
  ahora referenciado a/desde la orden hermana.
- Gate: la orden TERMINAC no sale del local (a Depósito) hasta que **todas** sus
  `OrdenTerminaciones` estén `Hecha`. Reemplaza al sub-estado `'En Terminaciones'` actual.

Puntos a definir para este camino:
- **Cuándo materializar la orden hermana**: al crear el pedido (si el form ya trae las
  terminaciones por archivo, patrón Corte/Costura) **o** al pasar Control de impresión (just-in-time).
- **Una sola** orden hermana por orden ECOUV (NO una por terminación) para no multiplicar remitos.
- Cómo se repunta `OrdenTerminaciones` a la orden hermana (o la hermana la referencia por NoDocERP/archivo).
- Retirar/adaptar el gate actual de sub-estado `'En Terminaciones'` (`productionFileController.js`
  ~L828-852) para que ahora el "pase a terminaciones" sea el avance de área ECOUV→TERMINAC.

## Puntos a confirmar con el negocio
- La decisión de la tabla de arriba (sub-estado vs orden-hermana para terminaciones).
- Si va por sub-estado: ¿el traslado del bulto entre locales se controla de algún modo custom,
  o es a la vista sin registro?
- ¿El pase impresión→terminaciones queda automático (al pasar Control si hay terminaciones
  pendientes) o con botón manual "Enviar a Terminaciones"?
- ¿Alguna orden ECOUV sin `OrdenTerminaciones` igual debe pasar por el local de terminaciones?
  (hoy: no — va directo a Depósito).

---
### Alternativa (NO recomendada dado lo anterior): Terminaciones como ÁREA física propia
Crear un `AreaID` nuevo (ej `ECOUVT`) y que la orden cambie de área ECOUV→ECOUVT→DEPOSITO
reusando `ConfiguracionRutas`. Es más "ortodoxo" con el modelo de áreas, pero **toca más cosas**
(alta de área, rutas, despacho, etiquetas, ProximoServicio) — justo lo que se quiere evitar.
Solo tiene sentido si en el futuro Terminaciones necesita su propio kanban de máquinas,
operarios y reportes como un área de producción independiente.
