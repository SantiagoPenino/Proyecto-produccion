# TPU — Reuso de matriz: arreglos del 03/08/2026

Todo lo que se tocó en la tarde del 03/08. **Requiere restart del backend** (ya hecho en local a las 17:07:44).

---

## 1. "Mis matrices" no listaba nada

`getMisMatrices` (`backend/controllers/webOrdersController.js`) exigía **tres** condiciones y la tercera dejaba la lista vacía:

1. Orden del cliente y del área TPU.
2. `Estado` en `Finalizado`, `Entregado` o `Cerrado`. ← ojo: **"Pronto" no cuenta**.
3. ~~Tener un archivo con `cmyk` en el nombre.~~ **ELIMINADA.**

La 3 se sacó a pedido: una orden podía finalizarse con las 5 capas subidas y, si ninguna llevaba `cmyk` en el nombre, nunca aparecía como matriz y no había ningún aviso.

## 2. La vista previa usa el BOCETO, no el cmyk

Las subconsultas de la miniatura buscaban `%cmyk%`. Ahora buscan `%boceto%` (el PDF que subió el operario y aprobó el cliente) y los campos se renombraron:

| Antes | Ahora |
|---|---|
| `CmykArchivoID` | `ArteArchivoID` |
| `CmykNombre` | `ArteNombre` |

Consumidores actualizados: `OrderForm.jsx` y `PrendaOrderForm.jsx`. El nombre quedó neutro (`Arte…`) porque el cambio a boceto es "por ahora".

**En local la miniatura NO se ve** y es esperable: el JPG se genera al subir el archivo y vive en el disco del server (`backend/thumbnails/`). La base local está sincronizada, el disco no. Se muestra "SIN VISTA PREVIA".

## 3. `IdCliReact` — "Validation failed ... Invalid string"

`Ordenes.IdClienteReact` es **NUMERIC**: el driver lo devuelve como `number` y `reuseMatrizTPU` lo bindeaba como `sql.VarChar(50)` sin convertir. Fix (mismo patrón que `createWebOrder`):

```js
.input('IdCliReact', sql.VarChar(50), mat.IdClienteReact ? mat.IdClienteReact.toString() : null)
```

Se revisaron los otros seis bindings del mismo INSERT contra el tipo real de cada columna: `Cliente`, `Material`, `Variante`, `CodArticulo` (texto) y `ProIdProducto`, `CliIdCliente` (int) coinciden.

## 4. Estados del reuso — se eliminó `Cargando...`

`Cargando...` es el estado de un pedido web que todavía está subiendo archivos. Una orden de reuso nace completa, así que no tiene por qué pasar por ahí. Ahora usa la máquina de estados real de TPU:

| Caso | Estado general | Estado en área |
|---|---|---|
| Misma cantidad → el arte se copia y sirve tal cual | `Produccion` | `Diseñado` |
| Cantidad distinta → hay que regenerar las 5 capas | `Pendiente` | `Aprobado` |

El INSERT escribía el mismo valor en las dos columnas; ahora son dos parámetros (`@EstadoGen`, `@EstadoArea`).

## 5. El reuso quedaba clavado en Pendiente con las 5 capas subidas

`uploadProductionFile` (`backend/controllers/ordersController.js`) pasa la orden a `Diseñado` al subir la última capa, pero exigía `FechaAprobacionCliente` — y **una orden de reuso nunca la tiene**: el diseño lo aprobó el cliente en la orden original. La bandera `esReusoTPU` ya existía tres líneas más arriba (el gate del boceto sí la usaba); faltaba acá:

```js
if (esTPUOrden && (orden.FechaAprobacionCliente || esReusoTPU) && (nArchivos + 1) === CAPAS_ARTE_TPU) {
```

## 6. La medida del parche en el reuso

La rama de reuso hace `return` antes de la validación general, así que los selectores de ALTO y ANCHO se mostraban con `*` pero nadie los miraba, y la medida no se guardaba.

- **Portal** (`OrderForm.jsx`): misma validación y mismo mensaje que en trabajo nuevo, y manda `medida: "10 x 8 cm"` al endpoint.
- **Backend**: `reuseMatrizTPU` lee `req.body.medida` y la pega a la nota como `[Medida: 10 x 8 cm]`.
- **Producción** (`OrderDetailModal.jsx`): la muestra en cyan al lado de Material / Sustrato, parseando `\[Medida:\s*([^\]]+)\]` de `currentOrder.note`.

El alto/ancho de un TPU **no tiene columna propia** en `Ordenes`: viaja dentro de la nota, igual que en un trabajo nuevo.

> **Órdenes viejas no tienen medida.** `TPU-11540` (17:03 hora real) y `TPU-11541` se crearon antes de que existiera el código que la manda, así que su nota no la trae y el modal no muestra nada. No se pueden parchear: nunca se eligió una medida. Hay que crear un reuso nuevo para verlo.

---

## 7. Fechas: TODO el sistema mostraba 3 horas menos

Aparte de TPU, y con más alcance.

`backend/config/db.js` no seteaba `useUTC` y el default de `mssql` es `true`, o sea "lo que hay en la base está en UTC". Pero las fechas se escriben con `GETDATE()` = **hora local de Uruguay**, en columnas `datetime` que no guardan zona. El driver devolvía las 17:03 etiquetadas como `17:03Z` y el navegador las volvía a pasar a local: **14:03**.

```js
useUTC: false
```

Verificado contra la base: `FechaIngreso` de `TPU-11541` pasó a leerse `17:03`, la hora real.

**Afecta toda fecha del sistema**: ingreso, entrega, historiales, estados. Después del restart se corrigen todas de una.

⚠️ **Antes de deployar, confirmar en el server que el SQL Server también está en hora de Uruguay.** Si estuviera en UTC, el default era el correcto y este cambio lo rompe:

```sql
SELECT GETDATE() AS Local, GETUTCDATE() AS Utc;
```

`Local` tiene que dar la hora de Montevideo (3 menos que `Utc`).

---

## Para revisar

- [ ] Crear un reuso nuevo y confirmar que la medida sale al lado del material.
- [ ] Confirmar la zona horaria del SQL Server de producción con la query de arriba.
- [ ] Chequear un par de pantallas con fechas conocidas después del restart.
- [ ] Definir si "Pronto" debería contar como matriz disponible (hoy no cuenta: solo Finalizado / Entregado / Cerrado).
