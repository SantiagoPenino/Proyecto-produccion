# TPU — El cliente sube el vector y el sistema genera las planchas

**Fecha:** 11/08/2026 · **Estado:** PLAN DEFINIDO — nada implementado.

Objetivo: el cliente sube un vector, el sistema verifica que lo sea, el cliente elige zonas
(por color, por clic o mezcla) y texturas, y el sistema genera la plancha con los parches
impuestos en filas y columnas + los PDFs `CMYK`, `Spot 1`, `Spot 2`, `Spot 3` y el corte.

---

## 1. Lo que se confirmó (medido sobre los archivos reales)

**`Script TPU 240726v2.jsx`** (el que corre hoy en Illustrator) **no separa nada**: replica las capas
que el diseñador ya armó, las impone en grilla y exporta **un PDF por capa** prendiendo/apagando
visibilidad. La separación es trabajo humano previo.

**`TPU UV.ai`** (arte fuente, 35 × 10 cm) — medido con pdfjs:

| Capa | Trazados |
|---|---|
| CMYK | 31 |
| Corte | 2 |
| Spot 1 (Relieve 1) | 45 |
| Spot 2 (Relieve 2) | **45 — geometría idéntica a Spot 1** |
| Spot 3 (Barniz) | 2 |

- **Vector puro**: 0 imágenes rasterizadas, 0 patterns, 0 degradados.
- Spot 1 ≡ Spot 2 confirma la regla del relieve doble (todo el parche va alto en este arte).
- El relieve es **una sola tinta (negro)**; los colores viven en el CMYK.

### Reglas de negocio (confirmadas por el usuario)

- **Relieve 2 ⊆ Relieve 1, con la MISMA textura.** Zona con textura solo en Spot 1 = relieve normal;
  la misma textura en Spot 1 y Spot 2 = doble altura. Nunca texturas distintas entre ambos.
- **Las zonas las SELECCIONA el cliente; la geometría sale del diseño.** El cliente nunca dibuja: elige
  formas que **ya existen** en su vector, agrupando **por color** (todas las del mismo relleno),
  **por clic** (una a una), o mezclando ambas (arranca por color y suma/quita con clic). Una zona
  puede ser una forma o varias. La textura se aplica **adentro** de esa geometría. Mismo modelo que
  ya usa el visor 3D — lo único que cambia es de dónde salen las zonas (antes, capas OCG del boceto
  del operario; ahora, la selección del cliente sobre el vector plano).
- **La capa de relieve es una MÁSCARA BINARIA**: donde hay negro hay relieve, donde no hay nada no
  hay. De ahí salen los dos casos:
  - **liso** → la zona **entera** pintada de negro (superficie levantada uniforme). Es lo que tiene
    el archivo de ejemplo: 45 formas sólidas, todo el escudo liso y doble.
  - **con textura** → dentro de la zona se pinta **solo la textura** (rayas, puntos…); el resto queda
    vacío. **La textura ES la geometría del relieve**, no un relleno decorativo.
- **"Sin relieve" NO es una opción**: un TPU sin relieve es una impresión común. Toda zona lleva
  relieve. Por eso la elección por zona es solo: **liso o textura X** + **normal o alto** + **barniz**.
- **El sangrado sale del CMYK, no del corte** (corregido 11/08):
  - **Corte** = el borde del CMYK **exacto**, sin agrandar. Es la línea por donde pasa la cuchilla.
  - **CMYK** = esa misma silueta **expandida 1 mm hacia afuera**. El arte sigue más allá del corte
    para que no aparezca filo blanco si la cuchilla se corre.
  - O sea, el offset de polígono se aplica **al arte**, y la silueta original queda como troquel.
- **Plancha**: ancho 50 cm (el script permite 20–50, default 30).

### Parámetros de imposición (del script, listos para portar)

- Copias por fila: `1 + floor((anchoPlancha − anchoArte + 0.5) / (anchoArte + separación))`
- Alto de plancha: `altoArte×filas + espacioFilas×(filas+1) + 5mm + 2×5mm`
- Separación entre copias: −10 a 20 mm (default 0) · entre filas: default 5 mm
- Filas: 1 a 20 (default 5)
- Marcas de registro: círculos negros de **5 mm** de diámetro, a **5 mm** de cada borde lateral, en
  **cada límite de fila** (filas+1 pares), dibujadas **solo en CMYK y Corte**
- Mesa de trabajo recortada al contenido + 5 mm

---

## 2. Modelo de datos

`OrdenTexturasTPU` ya guarda por zona: `ArchivoTextura`, `Barniz`, `Escala`, `Altura`, `OffsetX/Y`.

**No hace falta ninguna columna nueva.** El schema actual ya alcanza:

| Campo | Qué decide |
|---|---|
| **`Altura`** | **1 = solo Spot 1 · 2 = Spot 1 + Spot 2** (la altura física *es* la cantidad de pasadas; el 3D usa el mismo número para el render) |
| `ArchivoTextura` | **NULL = liso** (zona entera en negro) · con valor = esa textura recortada a la zona |
| `Barniz` | va o no a Spot 3 |
| `Escala`, `OffsetX/Y` | cómo queda puesta la textura dentro de la zona |

`ArchivoTextura = NULL` **no es ambiguo**: como toda zona lleva relieve, NULL significa liso. No hace
falta un estado extra para distinguir "sin relieve", porque ese caso no existe.

**Generación por zona** (todas las zonas entran en Spot 1):

| Elección | Qué se dibuja en Spot 1 | Costo técnico |
|---|---|---|
| Liso | la forma de la zona, negro pleno | trivial: copiar el path y pintarlo |
| Textura X | la textura recortada a la silueta de la zona | `clipPath` + `pattern` en SVG (las texturas del catálogo ya son SVG → sale vectorial, sin rasterizar) |

Spot 2 = las zonas con `Altura = 2`, con **exactamente el mismo contenido** que en Spot 1.

---

## 3. Fases

| # | Fase | Qué entrega | ¿Garantizable? |
|---|---|---|---|
| **F1** | **Verificación de vector** | Al subir: cero rasters = vector (determinístico, ver §4). Veredicto al cliente en el momento. | **Sí, 100%** |
| **F2** | **Imposición** | Toma 5 capas ya armadas → plancha con registros → PDFs por capa. Port directo del script. | **Sí** — se verifica comparando contra la plancha del script con el mismo arte |
| **F3** | **Zonas desde vector plano** | `pdftocairo -svg` → agrupar por `fill` → UI de selección por color / clic / mezcla | Sí, con casos borde (degradados, trazos) |
| **F4** | **Elección por zona** | textura (o liso) + altura 1/2 + barniz. Reusa el visor 3D y `OrdenTexturasTPU` **sin cambios de schema** | Sí |
| **F5** | **Generación de capas** | zonas → Spot 1 / Spot 2 / Spot 3 + Corte (offset 1 mm) → alimenta F2 | Parcial — necesita revisión humana |
| **F6** | **Revisión del operario** | Los 4 PDFs quedan como **borrador** en el detalle de la orden: aprobar o reemplazar antes del lote | — |

**F2 sirve sola**: aunque no se haga nada más, el operario deja de abrir Illustrator para imponer.
Por eso va primero: es la mitad verificable y el riesgo se paga en el orden correcto.

---

## 4. Cómo se verifica que es vector (100%)

Regla estricta: **el PDF no contiene ni una imagen rasterizada**. No es heurística — el raster solo
puede entrar por XObjects `/Image`, imágenes inline (`BI…ID…EI`) o anidado en Form XObjects/patterns;
recorriendo el árbol completo, cero imágenes = dibujado íntegramente con trazados.

Lo que **no** garantiza ningún chequeo automático: que el vector *sirva* (autotrace con miles de
trazados basura, tipografías sin curvar, sin trazo de corte, RGB en vez de CMYK). Eso lo firma
producción — de ahí F6.

---

## 5. Dependencias nuevas

- **SVG → PDF**: `rsvg-convert`, `cairosvg` o Inkscape. Poppler solo hace el camino inverso.
- **Offset de polígono** (expandir el CMYK 1 mm; el corte va sin tocar): Clipper (JS) o Shapely.
- `pdftocairo` y `pdfimages` ya están (vienen con poppler, instalado para los thumbnails).

---

## 6. El `.plt` — se genera directo (saca Corel del flujo)

**Hoy:** el script exporta *Corte* a PDF → se abre en **Corel** → se exporta a `.plt`. Paso manual.

**Se puede generar directo.** El `.plt` es HPGL: texto plano con comandos elementales (`IN;`
inicializar, `SP1;` pluma, `PU x,y;` mover sin cortar, `PD x,y;` cortar). Un contorno de corte es una
polilínea. El procedimiento es: tomar la geometría de *Corte*, **aplanar las curvas Bézier** a
segmentos (tolerancia ~0,05 mm — es lo que hace igual el plóter internamente), convertir a unidades
de plóter (**40 por mm**) y escribir los `PU`/`PD`. Pocas decenas de líneas, sin dependencias nuevas.
Es de las piezas más simples del proyecto y elimina un paso manual del flujo actual.

### Dialecto — DECODIFICADO de `leones.plt` (muestra real que la cortadora aceptó)

**Cabecera fija:**
```
IN;                        inicializar
VS32,1; … VS32,8;          velocidad 32, plumas 1 a 8
WU0;                       unidades de ancho: métricas
PW0.350,1; … PW0.350,8;    ancho de pluma 0,35 mm, plumas 1 a 8
```

**Cuerpo:** un bloque por contorno, cada uno precedido por su `SP`:
- **`SP1`** → **marcas de registro**: polígono cerrado de 17 puntos (el círculo aproximado con 16
  segmentos).
- **`SP7`** → **contornos de corte** (el troquel del escudo).
- **`SP0;`** cierra el archivo.

**Geometría (medida sobre la muestra):**

| Dato | Valor |
|---|---|
| Unidades | **40 por mm** (marca de registro = 199 u = 4,97 mm ≈ los 5 mm del script) |
| Origen | **centro de la plancha** (coordenadas con signo en ambos ejes) |
| Eje Y | positivo hacia arriba |
| Plancha de la muestra | 270 × 485 mm |
| Disposición | 3 columnas × 5 filas = **15 escudos**, paso entre filas **96 mm** |
| Marcas de registro | 12 (6 filas × 2), en X = ±132,5 mm |
| Curvas | **aplanadas a segmentos** (escudo ≈ 57 puntos por contorno) |
| Contornos | cerrados: el último punto repite el primero |

**Conclusión: no queda nada que adivinar.** Generar el `.plt` es emitir la cabecera fija, aplanar las
curvas y escribir `PU`/`PD` en unidades de 40/mm con origen al centro. La verificación es directa:
generar el `.plt` del mismo arte y comparar contra esta muestra.

## 7. Pendiente de confirmar

- Medidas: ¿la separación entre copias y filas se deja elegir al cliente, o se fija?
