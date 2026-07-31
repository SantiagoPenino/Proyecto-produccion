# TPU — Texturas por zona en el visor 3D (plan)

Estado: **IMPLEMENTADO (F0–F5)** el 30/07/2026. Falta correr el `CREATE TABLE`, dejar los SVG en
`public/assets/textures/` y probarlo de punta a punta (restart backend + build front).

## Qué se quiere

En la pantalla de aprobación, el cliente abre el boceto en 3D y puede elegir una **textura por cada
zona** del diseño. Lo que elige se ve en el render, y queda guardado para que **producción lo fabrique
así**. No afecta el precio.

---

## Decisiones tomadas

1. **No cambian el precio.** No se toca cotización, `ServiciosExtraOrden` ni ERP.
2. **Los grupos no llevan nombre.** Son zonas a diferenciar → se numeran: *Zona 1 … Zona N*.
3. **La elección persiste** y producción la ve.
4. **Se elige en la aprobación**, al abrir el visor 3D del boceto.
5. **Formato: SVG** (PNG para las que sean fotográficas). En `public/assets/textures/`.
6. **El nombre visible sale del nombre del archivo.**
7. **Un solo roughness para todas** (constante en el código, no por textura).
8. **Cualquier textura va en cualquier zona.** Sin tabla de compatibilidad.
9. **Se puede aprobar con zonas sin textura.** No es requisito.
10. **El operario puede modificar la elección**, cualquier rol interno.
11. Arranca con **5 texturas** de prueba.

---

## Glosario

| Término | Qué es | Por qué importa acá |
|---|---|---|
| **seamless** (tileable) | Imagen que se repite sin que se vea la juntura | La textura es chica y cubre el parche repitiéndose. Ya vienen preparadas |
| **roughness** | Cuán mate (1) o brillante (0). No es el color: es cómo devuelve la luz | Un satén y un algodón del mismo color se distinguen SOLO por esto |
| **normal map** | Imagen que simula relieve sin agregar geometría | Hace que la textura no parezca una foto pegada. Queda para después |

---

## Por qué SVG y no PDF

El PDF es el único formato que el browser no carga nativo: obligaría a pdf.js en el cliente o a
pre-rasterizar con `pdftoppm` en el server, más una caché de PNGs. Con SVG:

```js
const img = new Image();
img.src = '/assets/textures/lino-crudo.svg';
ctx.createPattern(img, 'repeat');
```

Y como es vectorial, se rasteriza al **tamaño entero exacto** que pida la escala. Eso elimina de raíz
el problema de la línea visible por redondeo de DPI (rasterizar 50 mm "a 300 dpi" da 590,55 px, y ese
medio píxel se acumula en cada repetición hasta que aparece una costura).

**Requisito al exportar:** el SVG debe declarar medida física — `width="50mm" height="50mm"` junto al
`viewBox`. Es de ahí que sale el tamaño real del tile. Con `width="500"` pelado se pierde y hay que
hardcodearlo. Además, cualquier imagen incrustada tiene que ir **embebida** (data URI, opción "Embed"
de Illustrator), no vinculada: un SVG cargado en `<img>` no puede traer archivos externos.

Los archivos viven en `public/assets/textures/` → build los copia a `backend/public/assets/textures/`
→ los sirve el mismo Express. Mismo origen, así que dibujarlos a canvas no lo contamina.

---

## Cómo se separan las zonas

**Vía elegida: OCG (optional content groups) del PDF del boceto** = las capas de Illustrator.

API verificada contra el `pdfjs-dist` 5.4.624 instalado:

```js
const cfg = await pdf.getOptionalContentConfig();
for (const [id, grupo] of cfg) { /* el config es ITERABLE — no hay getGroups() */ }
const orden = cfg.getOrder();   // define la numeración de zonas
cfg.setVisibility(id, false);   // apagar todas menos una
await page.render({ ...mismoViewportYTransform, optionalContentConfigPromise: Promise.resolve(cfg) });
```

Se rasteriza la **misma página N+1 veces** (una por zona + una con todo). Como es el mismo `viewport`
y `transform` que ya usa `rasterizar()` en [Tpu3DViewer.jsx](../src/client-portal/modulos/Tpu3DViewer.jsx),
las máscaras salen **alineadas al píxel** con el arte, gratis.

**Identidad de la zona = su índice en `getOrder()`** (no hay nombre). Si se re-sube el boceto la
numeración puede correrse → las elecciones guardadas se **descartan** y el cliente vuelve a elegir. Es
lo correcto: si cambió el boceto, cambió el diseño.

**Requisito de diseño (bloqueante):** el boceto debe exportarse con *"Crear capas de Acrobat a partir
de capas de nivel superior"*, **una capa por zona**. Sin eso llega como una sola zona y no hay forma de
recuperar la separación desde el raster.

> ⚠️ **Capas, NO grupos.** Es la confusión más probable al pasarle la instrucción al diseñador, porque
> OCG significa *optional content **group*** y en la jerga del PDF se llaman "grupos" — pero en
> Illustrator se crean desde el panel **Capas**. Un grupo de Illustrator (Ctrl+G) queda como contenido
> anidado en el stream de la página, sin nada que se pueda prender ni apagar: pdf.js no lo puede
> aislar. Un boceto organizado con grupos llega igual que uno aplanado.

**Fallback:** si un boceto no trae capas, el visor muestra una sola zona (el parche entero) y avisa.
No se rompe nada, simplemente no hay elección.

---

## Cómo se aplica al render

**La textura NO pinta color: va como RELIEVE, debajo del arte.** El color lo sigue poniendo el
boceto; la textura solo cambia cómo pega la luz — que es como se ve en el parche real (el material
tiene trama, la tinta va encima). Pintarla como color hacía que el diseño quedara tapado por el
patrón, que no es lo que se fabrica.

Se compone un segundo canvas en grises (`cRelieve`) y se cuelga del material como `bumpMap`:

```js
const patron = ctx.createPattern(tileEnGrises, 'repeat');
// clip con la máscara de la zona → pintar el patrón en el canvas de relieve
matArte.bumpMap = new THREE.CanvasTexture(cRelieve);
matArte.bumpScale = RELIEVE_FUERZA;   // la perilla si se ve plano o exagerado
```

- El tile se rasteriza **sobre blanco** antes de pasarlo a grises: las texturas suelen ser trazo
  oscuro sobre fondo transparente, y sin ese relleno todo daba 0 (relieve plano).
- El canvas de relieve arranca en blanco, así una zona sin textura queda al mismo nivel que el fondo
  del tile y el borde entre zonas no salta.
- Sigue siendo **un** mesh: no cambia la geometría ni los UVs.
- `matArte` es `MeshStandardMaterial` sobre `PlaneGeometry`, con el `roughness` constante para todas.

**Escala: por repeticiones, no por milímetros.** La idea original era sacar el tamaño del tile de la
medida física del archivo. **No funcionó**: los SVG reales traen `viewBox` pero **sin** `width="50mm"`,
así que el browser reporta el viewBox como tamaño intrínseco (370 px → ~98 mm) y el tile salía casi del
porte del parche — la textura se dibujaba **una sola vez**.

Se reemplazó por un valor explícito **por textura**, en `assets/textures/texturas.json`:

```json
{ "textura1.svg": { "repeticiones": 14, "altura": 0.5 } }
```

- `repeticiones` = cuántas veces entra a lo ancho del parche (default 12). El lado del tile se redondea
  a entero, así el patrón calza consigo mismo en cada repetición.
- `altura` = cuánto se marca el relieve (default 0.6). Se aplica **horneándola en el mapa** (comprimiendo
  el gris contra el blanco neutro), no con `bumpScale`: éste es del material y hay un solo material para
  todas las zonas, así que no permitiría una altura distinta por zona.

**Calibración:** el visor con `?calibrar=1` (mismo truco que el `?tablet=1` de planta) muestra dos
sliders para la textura de la zona activa y la línea de JSON lista para pegar. El cliente no la ve.

**Interacción:** el plano tiene UVs limpias (0..1), así que un raycast devuelve `intersection.uv` → se
consulta qué máscara cubre ese píxel → **clic directo sobre la zona del parche**. Más chips *Zona 1..N*
como alternativa para móvil.

---

## Catálogo: la carpeta ES el catálogo

Con el nombre saliendo del archivo, un roughness único y sin reglas por zona, **no hay ningún dato por
textura**. No hace falta tabla: un endpoint lista el directorio.

```
GET /api/web-orders/texturas-tpu → [{ archivo: 'lino-crudo.svg', nombre: 'Lino crudo' }, ...]
```

Agregar una textura = soltar el archivo en la carpeta. El `nombre` se deriva del filename (guiones a
espacios, capitalizar).

**Detalle dev/prod:** en producción la carpeta vive en `backend/public/assets/textures` (salida del
build); en desarrollo el front la sirve Vite desde `public/assets/textures` y el backend corre aparte.
El endpoint tiene que resolver las dos rutas.

**Regla operativa:** no renombrar ni borrar archivos — la elección guardada apunta al filename. Si
igual pasa, la UI degrada a "textura no encontrada" en vez de romper. Si más adelante hace falta
ordenar o desactivar texturas, se agrega una tabla chica sin cambiar cómo se guarda la elección.

---

## Persistencia

Una sola tabla, una fila por zona elegida. **SQL a correr antes de usar la feature:**

```sql
CREATE TABLE dbo.OrdenTexturasTPU (
    OrdenID                INT           NOT NULL,
    ZonaIndice             INT           NOT NULL,
    ArchivoTextura         NVARCHAR(255) NULL,          -- NULL = "sin textura" (queda el arte)
    Barniz                 BIT           NOT NULL CONSTRAINT DF_OrdTexTPU_Barniz DEFAULT (0),
    ElegidaPor             VARCHAR(10)   NOT NULL CONSTRAINT DF_OrdTexTPU_Por   DEFAULT ('CLIENTE'),
    FechaEleccion          DATETIME      NOT NULL CONSTRAINT DF_OrdTexTPU_Fecha DEFAULT (GETDATE()),
    ModificadaPorUsuarioID INT           NULL,
    FechaModificacion      DATETIME      NULL,
    CONSTRAINT PK_OrdenTexturasTPU PRIMARY KEY CLUSTERED (OrdenID, ZonaIndice)
);
```

- `ElegidaPor` distingue **cliente** de **operario**: sin eso nadie sabe si lo cargado es lo que pidió
  el cliente o lo que tocó alguien después.
- **Producción lo ve** en el detalle de la orden: *Zona 1 → Lino crudo* con su miniatura. Si esto no
  está, el 3D queda lindo pero no se fabrica lo que el cliente eligió.
- La elección del cliente se **congela al aprobar**. El operario puede cambiarla después (F5) y ese
  cambio queda en el historial de la orden.

---

## Fases

**F0 — Spike ✅ HECHO (30/07/2026)**
Verificado con un boceto real (escudo de Peñarol, 3 capas). Ver "Resultado de F0" más abajo.

**F1 — Catálogo ✅**
`GET /api/web-orders/texturas-tpu` → lista `assets/textures` resolviendo prod (`backend/public/…`) y
dev (`public/…`). Nombre derivado del filename. `README.md` en la carpeta con los requisitos.

**F2 — Extracción de zonas ✅**
`Tpu3DViewer`: `getOptionalContentConfig()` → una rasterización del **mismo recorte** por capa, con solo
esa capa visible. Las capas sin tinta dentro del recorte se descartan (no serían zonas útiles).

**F3 — UI + render ✅**
Chips por zona + grilla de swatches, y clic directo sobre el parche (raycast → UV → máscara). La
composición repinta el canvas de color y avisa con `needsUpdate`: no rearma la escena. Los tiles se
rasterizan a tamaño **entero** en píxeles, escalados por `tileMm / anchoParcheMm`.

**F4 — Persistencia ✅**
`OrdenTexturasTPU` + `GET/POST /api/web-orders/orden/:ordenId/texturas` (scopeados al cliente). El POST
exige `AprobacionPendiente = 1 AND Estado = 'Cargando...'` → **al aprobar, queda congelada**. Lectura
interna en `GET /api/orders/:ordenId/texturas` y sección en la pestaña Referencias del detalle.

**F5 — Edición interna ✅**
`PUT /api/orders/:ordenId/texturas` con `soloInternoConRol()` (cualquier rol interno). Manda **solo la
zona tocada**, así las demás conservan su `ElegidaPor`. Marca `OPERARIO`, badge "Modificada" en el
detalle, y fila cerrada en `HistorialOrdenes` con el diff (`Zona 2: lino.svg → arena.svg`) —
mismo patrón que la edición de archivos, para no pisar la fila abierta del estado real.

### Para poder probarlo

1. Correr el `CREATE TABLE` de arriba.
2. Dejar los SVG en `public/assets/textures/` (ver el README de esa carpeta).
3. Restart del backend + build del frontend.

---

## Resultado de F0 (30/07/2026) ✅

Boceto de prueba: escudo de Peñarol, exportado desde Illustrator con 3 capas de nivel superior.

```
OCGs: 3        Página 1: 1348,4 x 870,9 pt = 475,7 x 307,2 mm
  id="5R"  "Capa 1"   →   9 ops de dibujo
  id="6R"  "Capa 2"   →  50 ops
  id="7R"  "Capa 3"   →  10 ops
getOrder(): ["7R", "6R", "5R"]
```

Rasterizando la página una vez por capa (mismo viewport, 1024 px de ancho), las zonas salen **limpias
y ninguna vacía**:

| Zona | Capa | Contenido | px con tinta |
|---|---|---|---|
| 1 | Capa 3 | Borde del escudo + bastones (amarillo) | 90.527 |
| 2 | Capa 2 | Las 11 estrellas | 15.879 |
| 3 | Capa 1 | Cuerpo negro del escudo (estrellas y bastones calados) | 152.479 |
| — | todas | referencia | 253.025 |

Lo que confirma el spike:

- **La separación funciona.** Cada capa aísla una región texturable real, no un residuo.
- **Prioridad = `getOrder()`.** La suma de las zonas da 2,3 % más que el render completo: se solapan
  apenas, en el borde donde el amarillo pisa al negro. `getOrder()[0]` es la capa de más arriba del
  panel (la última en dibujarse) → **la primera que cubre un píxel gana**. Coincide con cómo el PDF
  se renderiza.
- **La granularidad de las zonas = cómo el diseñador parte las capas.** Acá borde y bastones están en
  la misma capa, así que son *una* zona: el cliente no puede darles texturas distintas. Si se quisiera,
  hay que separarlos en dos capas. Es decisión de diseño, no del código.
- **El tamaño de página NO es el tamaño del parche.** 475 × 307 mm es la mesa de trabajo. Esto, sumado
  a que las texturas tampoco declaran medida física, terminó descartando el enfoque por milímetros:
  la escala del tile se define por `repeticiones` en `texturas.json` (ver arriba).

Nota para quien lo reproduzca en Node: pdf.js v5 usa `Path2D`/`DOMMatrix` globales y `@napi-rs/canvas`
solo acepta los suyos — hay que asignarlos a `globalThis` **antes** de importar pdf.js. En el browser
son nativos, así que esto no afecta al visor.

---

## Riesgo principal

Todo descansa en que los bocetos se exporten con capas. Un boceto aplanado llega como una sola zona y
no hay forma de recuperar la separación desde el raster. F0 confirma que **el flujo de exportación
funciona**; falta que sea la práctica estable de todos los bocetos, no la de uno.
