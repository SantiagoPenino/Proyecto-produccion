# Deploy del WMS propio — checklist de corrida

VPS `srv1419478` · `/var/www/sistema-produccion` · pm2 `sistema-produccion`
Última revisión: **22/09/2026** · versión para imprimir, más completa: `docs/deploy-wms-produccion.pdf`

Son **dos partes independientes**, y la segunda puede esperar días o semanas:

- **Parte A — Subir todo (se puede hacer ya).** Deja el código y las tablas en producción **sin cambiar nada de lo que la gente usa hoy**: el flag `WMS_INTERNO` queda apagado y el stock sigue saliendo del WMS externo.
- **Parte B — El cutover.** El día que decidas cambiar: foto final del WMS viejo, import, paridad y recién ahí el flag.

> **Regla de oro:** `WMS_INTERNO=true` va **último**, recién cuando la migración cerró con **paridad en cero**. Si se prende antes, la tienda, el configurador y el catálogo leen tablas vacías y todo el stock aparece en cero de cara al cliente.

**Ya hecho (01/09/2026):** el SQL de módulos/menú corrió en producción — Stock, Marketing (Precios y Productos), Presupuestos, Diseñadores y Calibración de Color, todos **visibles solo para el rol 1 (admin)**. Ojo: hasta terminar la Parte A esos ítems del menú dan error, porque apuntan a páginas y rutas que todavía no están en el server. Nadie más que vos los ve.

---

## PARTE A — Subir todo (sin cutover)

### A1 · SQL contra la base de producción

Desde SSMS en tu máquina, en este orden:

**1. `docs/wms-data/DDL-wms-propio.sql`** — Una sola vez. Son 18 `CREATE TABLE` pelados, **sin guardas**: si se corta a la mitad y lo repetís, falla con *"There is already an object named..."*. Si eso pasa: borrá las tablas `Wms_*` que se crearon y arrancá de nuevo.

**2. `docs/wms-data/DDL-wms-compras.sql`** — Idempotente, se puede repetir sin miedo. Trae las 8 tablas de abastecimiento y las columnas nuevas: `Bultos`, `FechaEstimadaArribo`, `VolumenM3`, `PesoKg`, `Incoterm`, y la ficha textil `GramajeGsm` / `AnchoMetros` / `Composicion` (esta última del 22/09; si el archivo ya estaba corrido, volvé a correrlo o dejá que el backend la cree solo al abrir el stock).

El de menú (`menu_stock_gestion.sql`) **ya está corrido** — no hace falta.

**Verificá antes de seguir.** Tienen que existir 26 tablas:

```sql
SELECT COUNT(*) FROM sys.tables WHERE name LIKE 'Wms[_]%';
```

### A2 · Subir el backend

Carpetas **enteras**, no archivos sueltos: el 502 del 31/08 fue una subida a medias de `routes/` (el server queda en bucle de reinicios).

```
scp -r backend/controllers backend/routes backend/services backend/scripts backend/utils root@srv1419478:/var/www/sistema-produccion/
```

En el server **no hay subcarpeta `backend/`**: el contenido de `backend/` va directo a `/var/www/sistema-produccion/`. Esto no toca `.env`, `public/` ni `uploads/`.

Si conectás por IP en vez de por nombre, cambiá `srv1419478` por la IP.

### A3 · Build del frontend y subirlo

```
npm run build
```

```
scp -r backend/public root@srv1419478:/var/www/sistema-produccion/
```

El build **pisa `backend/public/` entero** — el catálogo FNC vive aparte en `backend/catalogos/` justamente por eso.

### A4 · Reiniciar y mirar el log (en el VPS)

```
pm2 restart sistema-produccion
```

```
pm2 logs sistema-produccion --lines 30
```

No tiene que aparecer `Route.get() requires a callback` ni `MODULE_NOT_FOUND`: eso es un archivo que faltó subir, y con el server en bucle todo el sistema queda en 502.

### A5 · Verificar

- Entrás como admin → **Stock** en el menú → la sección abre **sin datos**. Correcto: los datos llegan con el import de la Parte B.
- `/ventas/presupuestos` abre y deja armar un presupuesto.
- `/marketing/precios` → buscar "jacq": Charrúa y Supreme sin chip rojo.
- **Nada del sistema viejo cambió**: el stock sigue saliendo del WMS externo.

---

## PARTE B — El cutover

Hacerlo **con el depósito quieto**: la foto es el corte.

### B1 · Sacar la foto final

Desde tu PC, que es la que llega al proxy del WMS:

```
cd C:\Users\Santiago\Desktop\proyecto\Proyecto-produccion\backend
```

```
node scripts\wmsBajarSnapshot.js C:\Users\Santiago\Desktop\wms-snap-final
```

### B2 · Copiarla al VPS

```
scp -r C:\Users\Santiago\Desktop\wms-snap-final root@srv1419478:/root/
```

Son ~21 MB: tarda un rato pero es una sola pasada. Verificá que llegaron los 21 archivos (en el VPS):

```
ls /root/wms-snap-final/*.json | wc -l
```

### B3 · Importar — todavía con el flag apagado

```
cd /var/www/sistema-produccion
```

```
node scripts/wmsImportSnapshot.js --dir=/root/wms-snap-final
```

Lee los JSON del disco, no sale a internet. Es **re-ejecutable**: cada corrida deja la copia idéntica al snapshot, así que se puede repetir sin miedo. Tarda ~1 minuto.

> **Desde el 22/09 también borra lo que el origen ya no tiene.** Antes solo insertaba y actualizaba, así que una foto más nueva dejaba lo que el WMS externo había borrado: con la foto del 22/09 habrían quedado 31.246 etiquetas de una compra eliminada allá, y la paridad no lo veía porque solo cuenta etiquetas activas. El borrado corre en una sola transacción antes de cargar, y se frena solo en dos casos, revirtiendo todo sin tocar nada: si la foto trae una tabla vacía que acá tiene filas (foto rota), o si algún dato registrado por el sistema propio apunta a algo que el origen ya no tiene. `--sin-borrar` vuelve al comportamiento anterior.
>
> **Se niega a correr con `WMS_INTERNO=true`.** Después del cutover las tablas propias tienen ventas, recepciones y remitos que el WMS externo no conoce, y borrar lo ausente los eliminaría. `--solo-paridad` sí corre, porque no escribe.

> **Condición de corte.** Al final compara etiquetas y unidades activas de los **7 depósitos** contra el snapshot y **sale con código 1 si hay diferencia**. Tiene que terminar con **"PARIDAD PERFECTA"**. Si no cierra: no sigas, no prendas el flag — mientras esté apagado el sistema sigue andando contra el WMS externo, así que no hay apuro.

Para recomparar sin escribir nada:

```
node scripts/wmsImportSnapshot.js --solo-paridad --dir=/root/wms-snap-final
```

**Alternativa:** si el VPS llega a `http://3.85.26.173:5005`, se pueden saltear B1 y B2 y correr `node scripts/wmsImportSnapshot.js` sin `--dir`, que lee el WMS en vivo.

### B4 · Prender el cutover

Recién ahora, con la paridad perfecta. En el `.env` del VPS:

```
WMS_INTERNO=true
```

```
pm2 restart sistema-produccion
```

`STOCK_COMPRAS_PATH` podés no ponerlo: cae por default en `<raíz>/stock/compras` y las carpetas por compra se crean solas al subir el primer archivo.

### B5 · Abrir el menú al resto de los roles

Hoy la sección solo la ve el rol 1. Por cada rol que tenga que entrar (cambiá los números por los que correspondan):

```sql
DECLARE @Mod INT = (SELECT TOP 1 IdModulo FROM dbo.Modulos WHERE Ruta = '/stock');
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, @Mod FROM (VALUES (2),(3)) AS r(IdRol)
WHERE NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles p WHERE p.IdRol = r.IdRol AND p.IdModulo = @Mod);
```

`Modulos.IdModulo` es IDENTITY: los ids de producción **no** coinciden con los de local, por eso el módulo se busca por `Ruta` y nunca por número.

### B6 · Chequeo después del restart

- `/stock` → Panel de Control carga y muestra el capital valorizado.
- Inventario Global → Inventario abre en uso global y los números coinciden con el sistema viejo.
- Compras lista las compras migradas y la importación de China con sus 4 compras.
- **La tienda muestra stock** (no todo en cero) — es la señal de que el cutover leyó bien.
- **Alta de productos nuevos** → en Catálogo y WMS, el menú de "+ Nuevo" muestra "Producto con stock" activo (antes del cutover se ve apagado con la explicación). **Desde acá se dan de alta los productos de stock**: el sistema viejo ya no se usa para eso.
- **Catálogo y WMS** (`/admin/products-integration`) → al editar un artículo, el desplegable de maestros del WMS lista los productos y al elegir uno aparecen sus variantes. Desde el 22/09 esas cuatro operaciones respetan `WMS_INTERNO` y leen las tablas propias; antes iban siempre al externo.
- **Atención al cliente → Pedidos WMS → "Sincronizar"** termina bien. Desde el 22/09 también respeta `WMS_INTERNO`; antes leía siempre el catálogo del externo y, después del cutover, habría vuelto a vincular artículos contra ese catálogo.

### B7 · Completar la ficha de las telas

Las telas traen el ancho, el gramaje y la composición escritos en el nombre de la variante, no en sus campos, así que el stock no puede pasar kilos a metros. Este script los lee del nombre. Va después del import final (antes, en producción, no hay telas que completar), con el flag prendido o apagado, da igual.

```
cd /var/www/sistema-produccion
```

Primero solo muestra lo que propone, variante por variante, sin escribir nada:

```
node scripts/wmsRellenoTelas.js
```

Si la lista está bien, se guarda con:

```
node scripts/wmsRellenoTelas.js --aplicar
```

Completa solo campos vacíos (lo cargado a mano no se pisa) y vacía los colores que eran restos del nombre ("PRO 1,60", "1,83 M"), así que se puede repetir. Con la foto del 22/09 completa el ancho de 79 de las 80 variantes, pero el gramaje solo de 15: de las 57 telas que se llevan por kilo, 46 quedan sin metros hasta que se les cargue el gramaje en **Stock → Gestión → Artículos** (lápiz de cada variante).

Chequeo: en Inventario Global → Inventario, una tela por kilo con ficha completa (ej. PANAMÁ 1,60 m) muestra debajo del nombre "ancho 1,60 m · 140 g/m² · 100% Polyester" y, al lado de los kilos, "≈ … m".

### Vuelta atrás

`WMS_INTERNO=false` en el `.env` + `pm2 restart sistema-produccion`. Vuelve todo al WMS externo al instante, y los datos ya importados quedan quietos sin molestar a nadie.

**Después de volver atrás, no corras el import** para "sincronizar": con el interruptor apagado el script ya no está frenado, y lo que el sistema registró durante el cutover no existe en el WMS externo. Si algún movimiento propio apunta a esas filas el borrado se revierte solo, pero no hay que depender de eso.
