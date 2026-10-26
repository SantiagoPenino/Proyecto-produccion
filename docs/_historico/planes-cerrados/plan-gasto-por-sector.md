# Gasto en insumos por sector — dónde y cómo entraría en /stock

Maqueta: `Desktop/maqueta_gasto_por_sector.html` (24/09/2026). Un bloque mensual: total gastado en insumos,
una fila por sector con barra, importe, % del mes y variación contra el mes anterior; al costado, el detalle
del sector elegido (top 3 insumos con "cantidad × valor unitario") y un link a todos sus consumos.

## Dónde

**Panel de Control** (`TabPanel` en `StockGestionPage.jsx`), como primer bloque de ancho completo, entre las
cuatro tarjetas de arriba (activos, volumen, diversidad) y "Más consumido este mes". Es el mismo público
(gerencial) y el mismo tipo de dato que ya muestra el panel; hoy el panel dice *qué* se consume (en unidades)
y no *cuánto cuesta* ni *quién*.

- La lista de sectores y el detalle van en el mismo bloque, como en la maqueta: se toca una fila y el
  costado muestra sus insumos.
- El link "Ver todos los consumos de DTF →" lleva a **Inventario Global → Historial**. Hoy el Historial
  filtra por grupo, texto y un día; hay que agregarle filtro por depósito y por mes (chico: dos parámetros
  en `getHistorial` y dos controles en la pantalla).
- Opcional, después: en **Mi Sector**, una tarjeta "Gasto de mi sector este mes" con el mismo endpoint
  filtrado por su depósito.

## De dónde salen los números

Todo ya existe; no hace falta SQL nuevo.

| Dato | Fuente |
|---|---|
| Consumos | `Wms_Movimientos` (lo nuevo) UNION `Wms_HistoricoExterno` (lo importado del viejo), como ya hace el Panel |
| Tipo | `baja_consumo` — ver pregunta 1 por `baja_merma` |
| Sector | `DepOrigenId` del movimiento (el depósito de la etiqueta al consumir). En local, el 100 % de los `baja_consumo` viejos lo tienen |
| Valor unitario | `COALESCE(NULLIF(Etiqueta.CostoUnitarioReal, 0), Variante.Costo, 0)`, igual que la valorización del Panel |
| Moneda | `Variante.Moneda` (USD/UYU) + `Cotizaciones.CotDolar` para mostrar todo en una sola, como el Panel |
| Mes | `Fecha` del movimiento; "vs anterior" = el mismo cálculo un mes atrás |

Cobertura de costo en local: ~93 % de los consumos viejos tienen valor (Impritex 1.591 de 1.697, DTF 732 de
797). Lo que no tiene costo suma 0: el bloque debería decir "N consumos sin costo" y esos se arreglan cargando
el costo en Gestión de Sistema → Artículos.

Local, septiembre hasta el 22: 342 consumos, USD 26.334 + $ 10.912 a costo. Sectores con consumo: Impritex,
DTF, Ventas, ECOUV, Centro de stock general (12 bajas grandes, 5.063 unidades), Impresión Directa, TPU.

## Cómo

- **Endpoint** `GET /api/wms-interno/gasto-sectores?mes=2026-09&moneda=USD` → total del mes y del anterior,
  cantidad de consumos sin costo, una fila por sector (gasto, gasto anterior, unidades) y, por sector, sus
  5 insumos más caros del mes (cantidad, valor unitario, gasto). Una sola consulta con UNION ALL, agrupada por
  depósito y mes; el detalle sale en la misma llamada.
- **Frontend**: bloque `PanelGastoSectores` en `TabPanel`, con selector de mes (últimos 12), botón USD/UYU,
  total con variación, filas con barra y el costado con el detalle. Estilo del resto de /stock (tema blanco,
  números en `font-gsanscode`), no las fuentes de la maqueta.

## Decisiones (24/09, Santiago) — IMPLEMENTADO ese día, sin deployar

1. Gasto = `baja_consumo` + `baja_merma`. Ventas web y venta libre no.
2. Centro de stock general es una fila más.
3. Cotización del día de cada consumo (la última anterior o igual a la fecha del movimiento; si no hay, la última).
4. Mes en curso: mismo tramo de días contra el mes anterior.
5. Historial con filtro por depósito y mes, y grupo "Consumos".

Implementación: `GET /api/wms-interno/gasto-sectores?mes=YYYY-MM` (devuelve USD y UYU juntos; el botón de moneda no vuelve a pedir), bloque `PanelGastoSectores` en `TabPanel`, `TabHistorial` con `dep`/`mes` y el grupo CONSUMOS, navegación Panel → Historial vía `irA`.

## Preguntas que se hicieron (respondidas arriba)

1. **¿Qué cuenta como gasto?** Propongo `baja_consumo` y también `baja_merma` (rotura o pérdida es plata que
   el sector gastó). No las ventas web (`egreso_venta_web`, son ingresos de Ventas) ni la venta libre
   (`egreso_final`).
2. **Centro de stock general**: tiene 12 bajas por consumo con 5.063 unidades. ¿Es una fila más o se excluye,
   porque no es un sector que produce?
3. **Cotización**: ¿la del día de cada consumo (hay historial en `Cotizaciones`) o la última? Para comparar
   meses, la del día es más justa; la última es más simple.
4. **Mes en curso**: comparar septiembre completo contra agosto completo da siempre "bajó" hasta fin de mes.
   Propongo comparar el mismo tramo de días (1 al 24 contra 1 al 24).
5. **Historial**: ¿agrego el filtro por depósito y por mes junto con esto, para que funcione el link?
