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
- **Medida física en el SVG**: `width="50mm" height="50mm"` junto al `viewBox`. De ahí sale el
  tamaño real del tile — sin eso la trama se ve más grande o más chica de lo que es.
- **Imágenes embebidas, no vinculadas** (data URI / opción "Embed" de Illustrator): un SVG
  cargado en `<img>` no puede traer archivos externos.

## El nombre del archivo es el nombre que ve el cliente

`lino-crudo.svg` → **"Lino crudo"**. Guiones y guiones bajos pasan a espacios.

## ⚠️ No renombrar ni borrar

La elección del cliente se guarda **por nombre de archivo**. Si renombrás o borrás una textura,
los pedidos que ya la eligieron quedan apuntando a un archivo que no existe (el front lo muestra
como "textura no encontrada", pero se pierde el dato de qué había elegido).

Para sacar una textura de circulación sin romper el historial: sacala de esta carpeta solo cuando
ya no queden pedidos abiertos que la usen.
