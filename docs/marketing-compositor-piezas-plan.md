# Compositor de piezas en Marketing — plan

**Fecha:** 2026-10-15 · **Estado:** F1 implementada el 15/10, sin deployar (detalle en el CHANGELOG, «Sin deployar») · **Origen:** `Desktop/user-marca/user-marca/compositor/compositor-user.html` (compositor hecho para claude.ai) y el kit de marca de la misma carpeta (`USER-sistema-visual.md`, `logos/`, `elementos-png/`).

**Objetivo:** que Marketing arme posteos de feed e historias con la identidad de user desde el sistema, en `/marketing/piezas`. Puede crear títulos, textos, precios, etiquetas, imágenes y logos, arrastrarlos y acomodarlos dentro del recuadro, y bajar el PNG.

**Fuera de alcance:** la IA (el chat del HTML). Decidido el 15/10. La pieza queda guardada como datos (JSON), así que se podría sumar después sin rehacer nada.

---

## 1. Qué cambia respecto del HTML

El HTML tiene un diseño fijo: pill arriba, título, precio, unidad, nota y foto abajo, siempre en ese orden. Los campos se llenan desde un formulario.

En el sistema la pieza pasa a ser **un fondo más una lista de capas**:

- **Fondo y marco:** se toman tal cual del HTML. Negro con halos o tinta a pleno, grano y el recuadro redondeado de 3 px.
- **Capas:** cada elemento (título, texto, precio, etc.) es una capa con su posición, su tamaño y sus propiedades. Se agrega, se selecciona, se arrastra, se cambia de tamaño, se duplica, se borra y se ordena (adelante o atrás).

El dibujo de cada capa reutiliza el código del HTML: el ajuste del título en 2 o 3 líneas, el precio con la moneda en Regular y el número en Bold, la pill y la barra de proceso. La diferencia es que cada capa se dibuja en su propia caja, en vez de ir apilada.

## 2. Capas

| Capa | Qué tiene | Propiedades |
|---|---|---|
| **Título** | Inter Bold Italic en mayúsculas, como el HTML | texto, tamaño, color, alineación, ancho de la caja (corta en líneas) |
| **Texto** | Inter | texto, tamaño, peso (Light / Regular / Bold), color, alineación, ancho, mayúsculas sí/no |
| **Dato técnico** | Roboto Mono, la «tipografía de precisión» del manual | texto, tamaño, color, con o sin `< >` |
| **Precio** | moneda en Regular y número en Bold | moneda, monto, tamaño, color |
| **Etiqueta** | la pill con borde de la categoría | texto, tamaño, color del borde |
| **Imagen** | foto subida o de la vitrina, recortada como «cover» | forma (redondeada, la de la marca con dos esquinas grandes, círculo), borde sí/no, zoom y encuadre de la foto dentro de la caja |
| **Logo** | isotipo o logotipo reducido, de los paths del HTML | versión, tamaño. Sobre fondo de tinta va el isotipo en negro, como en el HTML |
| **Barra de proceso** | la cápsula CMY + blanco, o negro sobre tinta | ancho |
| **Asterisco** | `logos/user-asterisco-blanco.svg`, la viñeta del manual | tamaño, color |

Los colores se eligen de la paleta de la marca: blanco, negro, cian, magenta, amarillo y gris. No hay selector libre, para que no se salga de la identidad.

**Todas las capas se pueden rotar** (agregado el 15/10).

## 3. Cómo se edita

- **Agregar:** una barra con un botón por tipo de capa. La capa nueva aparece en el centro y queda seleccionada.
- **Mover:** se arrastra con el mouse. **No sale del recuadro:** la caja de la capa queda siempre dentro del borde interior del marco, y si está rotada cuenta la caja girada. Si se apaga el marco, el límite es el borde de la pieza.
- **Tamaño:** con las manijas de las esquinas.
  - En los textos, la manija lateral cambia el ancho (y por lo tanto dónde corta la línea) y la de la esquina cambia el tamaño de la letra.
  - En la imagen cambia la caja, y la foto se re-encuadra sola.
- **Rotar:**
  - Con la manija de giro, arriba de la caja.
  - Se pega a 0°, 45°, 90° y sus múltiplos. Con Shift gira de a 15°.
  - En el panel hay un campo con los grados, para un valor exacto, y un botón para volver a 0°.
  - Si al girar la caja tocaría el marco, el giro se frena ahí.
  - El texto rotado se sigue editando: el cuadro para escribir aparece girado igual que la capa.
- **Guías magnéticas:** al arrastrar, la capa se pega al centro horizontal y vertical de la pieza, a los márgenes del marco y a los bordes y centros de las otras capas, con una línea cian de guía. Con Alt apretado no se pega.
- **Escribir:**
  - Doble clic sobre un texto abre un cuadro encima de la capa para escribir ahí mismo.
  - El panel de la derecha también tiene el campo, y es la alternativa si el cuadro sobre la pieza da problemas.
- **Teclado:**
  - Flechas: mueven 1 px. Con Shift, 10 px.
  - Supr: borra la capa.
  - Ctrl+D: la duplica.
  - Ctrl+Z / Ctrl+Y: deshacen y rehacen, hasta 50 pasos.
- **Lista de capas:** en el panel de la derecha. Permite cambiar el orden, ocultar, bloquear (no se mueve por accidente) y borrar.
- **Historia:** muestra la zona segura de arriba y de abajo, donde Instagram tapa con su interfaz. Es solo una guía y no sale en el PNG.
- **Cambiar de feed a historia:** las capas mantienen su posición proporcional en altura y se vuelven a encerrar en el recuadro.

## 4. Datos del sistema

- **«Elegir producto»:** busca en la lista de precios (`GET /prices/base`, la de `/marketing/precios`) y llena la pieza:
  - título con la descripción del artículo;
  - precio en US$ o $, a elección;
  - dato técnico con la «descripción para lista», si la tiene;
  - etiqueta con la familia.
  - Si el producto está en la vitrina, ofrece su foto principal y las fotos por color, que ya tienen el fondo quitado.
  - Cada capa de la plantilla tiene un rol (título, precio, etc.), así el producto llena la capa que corresponde aunque se haya movido. Si falta una, la crea.
- **Plantillas de arranque:**
  - «Precio con foto»: el diseño del HTML pasado a capas.
  - «Precio sin foto»: con la barra de proceso en lugar de la foto.
  - «En blanco».
- **Imagen propia:** se sube desde la PC o se arrastra sobre la pieza. No se guarda en el servidor.

## 5. Guardar y exportar

- **Borrador automático:** la pieza que se está armando se guarda en el navegador, por usuario, como el borrador de Reposiciones. Si se recarga la página (por ejemplo, en un deploy), sigue donde estaba.
  - La foto subida desde la PC no entra en el borrador: el navegador no da tanto espacio. Al volver, la capa de imagen avisa que hay que subirla de nuevo.
  - Las fotos de la vitrina sí vuelven, porque son direcciones del sistema.
- **Descargar PNG:** 1080 × 1350 en feed y 1080 × 1920 en historia, en RGB. Se dibuja de nuevo sin la selección ni las guías y espera a que estén las fuentes. El nombre sale del título, por ejemplo `user-feed-dtf-comun.png`.

## 6. Cómo se construye

- **Librería (15/10, a confirmar): Konva con `react-konva`.** Con la rotación, mover, cambiar el tamaño y girar es justo lo que resuelve su `Transformer`.
  - El sistema usa React 18, así que va `react-konva` de la línea 18. La 19 pide React 19.
  - El fondo, la pill y la barra de proceso se dibujan con el mismo código del HTML, dentro de figuras propias de Konva.
  - El PNG sale con `toDataURL` a 1080 px de ancho, sin las manijas.
  - La pieza sigue siendo un JSON del lado de React; Konva solo la dibuja. Eso deja listo guardarla en F2.
  - Se carga solo en esta pantalla, como el resto de las de Marketing.
  - Alternativas evaluadas:
    - **Fabric.js:** trae la edición de texto sobre el canvas resuelta, pero maneja su propio estado y cuesta más atarlo al panel, la lista y el deshacer.
    - **react-moveable:** solo da manijas y guías para elementos HTML. El dibujo y el PNG serían aparte.
    - **Polotno:** es un editor tipo Canva completo, pero es pago.
    - **Sin librería:** se puede, pero la rotación (manijas giradas, límites, guías) suma uno o dos días.
- **Lista de capas:** se ordena arrastrando con `@hello-pangea/dnd`, que ya está instalada.
- **Archivos:**
  - `src/components/pages/MarketingPiezasPage.jsx`: la pantalla.
  - `src/components/marketing/piezas/marca.js`: colores, paths del isotipo y del logotipo.
  - `src/components/marketing/piezas/dibujo.js`: fondo, marco y el dibujo de cada capa, portado del HTML.
  - `src/components/marketing/piezas/capas.js`: tipos de capa, valores por defecto, plantillas, cálculo de cajas, límites del recuadro y guías.
  - `src/components/marketing/piezas/useEditorPieza.js`: estado, selección, deshacer/rehacer y borrador.
  - `src/components/marketing/piezas/PanelCapa.jsx` y `ListaCapas.jsx`: el panel de la derecha.
  - `MainAppContent.jsx`: la ruta, en los dos lugares donde están las otras de marketing.
- **Fuentes:**
  - `main.jsx` suma `@fontsource/inter/300.css` y `800-italic.css`. Ya están instaladas.
  - `index.css` suma Roboto Mono al `@import` de Google Fonts que ya existe.
  - Sin la itálica real, el canvas inventa una inclinada.
- **Estilo de la pantalla:** los paneles van en el tema claro de las otras pantallas de Marketing, con el `Selector` propio, íconos Lucide en brand-cyan sin fondo y sin `backdrop-blur`. La pieza mantiene el negro de la marca.
- **Menú:** INSERT en `Modulos` y `PermisosRoles` para el rol de marketing. Se pasan como script, no se corren.
- **Sin backend ni tablas en F1.**
- **Fotos de la vitrina en el canvas:** para poder exportar tienen que venir del mismo servidor que la página.
  - En local, el proxy de Vite pasa `/uploads`.
  - En producción el backend sirve el front. Lo infiero de `server.js` y hay que confirmarlo al probar.

## 7. Fases

- **F1 — Editor (~3 a 4 días con Konva; uno o dos más sin librería):**
  - capas, arrastre con límites, rotación, guías, panel y lista de capas;
  - plantillas, «Elegir producto»;
  - borrador y PNG.
- **F2 — opcional, después:**
  - guardar piezas en el sistema (tabla `MarketingPiezas` con el JSON y el PNG en `/uploads/marketing/piezas/`);
  - «Mis piezas» para reabrir y duplicar;
  - guardar una pieza como plantilla propia;
  - los elementos del kit (esfera, pill de vidrio, halos, arcoíris) como capas;
  - los logos de las sub-marcas cuando Marketing los pase.
- **Más adelante, si se decide:** la IA.

## 8. Decidido (se puede cambiar)

- Las capas no salen del recuadro, imágenes incluidas.
- Con rotación en F1, para todas las capas.
- Konva como librería, si se aprueba instalarla (`konva` y `react-konva`).
- Colores solo de la paleta de la marca.
- El borrador vive en el navegador. Guardar en el sistema es F2.
- Pensado para PC. En el celular se puede mover con el dedo, pero no es la prioridad.

## 9. A tener en cuenta

- **El cuadro para escribir sobre la pieza** es lo más delicado: tiene que calzar con la letra del canvas a la escala de la pantalla, y ahora también con el giro. Si no queda bien, se escribe desde el panel y el resto no cambia.
- **Guías con capas rotadas:** las guías usan la caja girada de cada capa. Un texto rotado se pega por su contorno, no por sus letras.
- **Erratas de color del manual:** el logo usa los colores de los vectores (`#00ABFF` / `#FF009D`) y las tintas usan los del texto (`#22A9FF` / `#FF0099`). Se deja como en el HTML hasta que Marketing confirme.
- **Salida solo RGB, para redes.** Para imprenta siguen los archivos CMYK oficiales.
