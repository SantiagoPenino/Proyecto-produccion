# Texturas TPU

Las texturas que el cliente puede aplicar a cada zona del parche en el visor 3D
(pantalla de aprobación del boceto).

**Esta carpeta ES el catálogo**: no hay tabla ni panel de administración. Para agregar una
textura, soltá el archivo acá. Para sacarla, ver la advertencia de abajo.

## Requisitos del archivo

- **Formato: SVG.** Es el único que el browser carga nativo y que se puede rasterizar al tamaño
  exacto que haga falta. Usá **PNG** solo si la textura es una foto o escaneo de un material real.
- **Seamless (tileable)**: el borde derecho tiene que continuar en el izquierdo y el de arriba en
  el de abajo. Se repite para cubrir el parche; si no calza, se ve una grilla de costuras.
- **Imágenes embebidas, no vinculadas** (data URI / opción "Embed" de Illustrator): un SVG
  cargado en `<img>` no puede traer archivos externos.

La textura **no pinta color**: el color lo pone el arte del boceto. Se usa como **relieve**, o sea
que solo cuenta el brillo de cada trazo. Un dibujo oscuro sobre fondo transparente funciona bien.

## `texturas.json` — ajuste por textura (opcional)

En esta misma carpeta, un archivo con la repetición y la altura de cada textura:

```json
{
  "textura1.svg": { "repeticiones": 14, "altura": 0.5 },
  "textura3.svg": { "repeticiones": 8,  "altura": 0.9 }
}
```

- **`repeticiones`** — cuántas veces entra a lo ancho del parche. No se puede deducir del archivo:
  los SVG traen `viewBox` pero no medida física, así que no hay tamaño real del que sacarlo.
  Default: **2** (`REPETICIONES_DEFAULT` en `webOrdersController.js`).
- **`altura`** — cuánto se marca el relieve. `0` = plano, `1` = el contraste tal cual viene del
  archivo, más de 1 lo exagera. Default: **1**.
- **`escalaMin`** y **`trazoMm`** — NO se escriben a mano: los calcula
  `backend/python/medir_trazo_texturas.py`. `trazoMm` es el trazo mediano del relieve a escala 1 en
  un parche de 60 mm; `escalaMin` es hasta dónde puede achicar el cliente la trama en "Armá tu
  matriz". Las finas quedan en 0,5 y las de trazo grueso bajan hasta 0,2. **Volvé a correr el
  script cada vez que agregues una textura o le cambies las `repeticiones`**
  (`python python/medir_trazo_texturas.py`, desde `backend/`). Sin `escalaMin` la textura usa 0,5.
- **`escalaMinFija`** — (a mano, opcional) un mínimo decidido a ojo que manda sobre la cuenta: el
  script lo respeta y lo copia a `escalaMin`. Hoy solo `textura2.svg` = 1 (no se achica). Si lo
  cambiás, corré `python python/medir_trazo_texturas.py --recalcular` (no vuelve a medir).

Lo que no esté listado usa los defaults. Si el JSON tiene un error de sintaxis se ignora entero y se
avisa en el log — las texturas siguen funcionando.

### Cómo encontrar los números

Abrí el visor 3D con **`?calibrar=1`** en la URL (`/portal/factory?calibrar=1`). Debajo de las
muestras aparecen dos sliders para la textura de la zona activa y, abajo, la línea ya armada para
copiar y pegar acá. El cliente no ve nada de esto.

## El nombre del archivo es el nombre que ve el cliente

`lino-crudo.svg` → **"Lino crudo"**. Guiones y guiones bajos pasan a espacios.

## ⚠️ No renombrar ni borrar

La elección del cliente se guarda **por nombre de archivo**. Si renombrás o borrás una textura,
los pedidos que ya la eligieron quedan apuntando a un archivo que no existe (el front lo muestra
como "textura no encontrada", pero se pierde el dato de qué había elegido).

Para sacar una textura de circulación sin romper el historial: sacala de esta carpeta solo cuando
ya no queden pedidos abiertos que la usen.
