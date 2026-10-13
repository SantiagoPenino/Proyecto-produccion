# Catálogos para clientes — plan

**Fecha:** 2026-08-26 · **Estado:** propuesta, sin implementar · **Origen:** el catálogo de verano FNC (`Desktop/catalogo-fnc-verano.html`, optimizado 13,5→8,1 MB el 26/08) probó formato y UX. Objetivo: que armar un catálogo así para cualquier cliente sea una función del sistema, no un archivo artesanal.

**Principio rector:** UN solo template React parametrizado + datos por catálogo. Todo lo específico de FNC resultó ser data (productos, fotos-mockup con la marca del cliente, etiquetas Patricia/Pilsen/Pepsi, acentos de color, eslogan, teléfono del comercial); la estructura — hero, nav por grupos, tarjetas con carrusel, lightbox táctil, visor 3D, carpeta de interés → WhatsApp — es idéntica. **No** construir un sistema de plantillas/layouts: un template bueno con colores, logo y grupos configurables alcanza, y es lo que el archivo demuestra.

---

## 1. Modelo de datos

Jerarquía calcada del archivo FNC (producto → variantes/"ángulos" → fotos con etiqueta de marca):

- **`Catalogos`** — id, `CliIdCliente` (nullable: un catálogo puede ser para un prospecto sin ficha), NombreCliente (display), Titulo, Eslogan, `Slug` (único, URL pública), Estado (BORRADOR / PUBLICADO / ARCHIVADO), TelefonoComercial (el wa.me de la carpeta), VendedorUsuarioId, TemaJSON (logo, acentos), FechaCreacion / FechaPublicacion.
- **`CatalogoGrupos`** — CatId, Clave, Label ("Ambientación"), Acento (color), Orden.
- **`CatalogoItems`** — CatId, GrupoClave, Orden, Nombre, Eco (bit), `ProIdProducto` (nullable — vínculo opcional al artículo real), `TiendaProductoId` (nullable — para heredar fotos de la vitrina), Model3DPath (nullable), Descripcion.
- **`CatalogoItemVariantes`** — ItemId, Label ("Feather 3M", "Canguro"), Orden, EsMultiAngulo (bit), NotaInterna (el "FOTO PENDIENTE" del armado: **nunca** se renderiza — lección del archivo actual, donde solo no se ve de casualidad porque toda variante tiene foto).
- **`CatalogoItemFotos`** — VarianteId, Path, EtiquetaMarca ("Pilsen"), Orden.

Las fotos son **mockups con la marca del cliente** (el buzo CON el logo Pilsen) — por eso cada variante sube fotos propias, además de poder heredar las genéricas de la vitrina. Se guardan como archivos en `uploads/catalogos/{slug}/` servidos estáticos: el render público NO embebe base64 (eso queda solo para el export de F4). Límite al subir: redimensionar a ~1024 px máx (las FNC son 820×820/62 KB y sobran).

## 2. Render público

- Ruta **`/catalogo/:slug`** en el portal, **sin login** (es para mandarle el link al cliente), solo catálogos PUBLICADO, con `noindex`.
- Componente React portando el template FNC tal cual: hero + nav de grupos sticky + tarjetas (carrusel de fotos por variante, badges ECO / MULTI-ÁNGULO / 3D) + **lightbox táctil** (doble tap, pellizco, swipe — el código vanilla del archivo se transplanta, ya está probado) + tema claro/oscuro.
- **3D**: `<model-viewer>` es un web component — funciona en React directo. **Import dinámico solo en esta ruta** (el bundle de model-viewer/three es ~1 MB; no puede colarse en el resto del portal). El GLB se sirve como archivo (no base64) — carga más rápido que hoy.
- **Carpeta de interés**: igual que FNC (steppers de cantidad, resumen, botón WhatsApp al TelefonoComercial + copiar) — ver pregunta (c) sobre registrar el lead.
- Porteo de estilos: revisar que no viaje ningún `backdrop-blur` (regla de la casa) ni la nota interna de variantes.

## 3. Editor (sección marketing)

`/marketing/catalogos` — mismo rol y patrones de la sección marketing existente:

- Lista de catálogos (estado, cliente, fecha) + duplicar (el catálogo de verano 2027 nace copiando el de 2026).
- Editor: datos generales (cliente, título, eslogan, teléfono, colores/logo) → grupos → items: **picker de la vitrina** (`TiendaProductos`, hereda fotos) o item ad-hoc, orden por arrastre, variantes con sus fotos etiquetadas por marca, flag eco.
- **Subida de GLB con optimización automática**: al subir un modelo corre el pipeline vía `gltf-transform` en node: weld + **compresión Draco/meshopt de la geometría** (con el decodificador auto-hosteado en los assets del sistema — decisión 26/08: al servirse online, la restricción offline no aplica) + texturas → JPEG (baseColor 2048 q85, normales q92). **La malla va SIEMPRE completa** — con Draco no hace falta simplificar, así que el riesgo visual que rompió el modelo de FNC desaparece del flujo. Aviso de peso si el resultado queda >2 MB.
- Vista previa = abrir la ruta pública en BORRADOR (con token de preview).

## 4. Fases

- **F0** — responder las preguntas de §5, congelar tablas.
- **F1** (~1 día) — tablas + CRUD + endpoint público por slug + upload de fotos/GLB.
- **F2** (~2 días) — render público completo. **Prueba de fuego: migrar FNC** con un script one-shot que parsea el `PRODUCTS` del HTML actual e importa todo (productos, variantes, fotos, GLB) — valida el modelo de datos entero y deja el primer catálogo real andando.
- **F3** (~2-3 días) — editor en marketing.
- **F4** (opcional, después) — estadísticas de visitas por catálogo + export "HTML autocontenido" para mandar por archivo (perdió importancia con los catálogos hosteados; si algún día se usa, el GLB del export se regenera SIN Draco — cuantización sola — porque el archivo suelto no tiene los decodificadores del sistema).

## 5. Preguntas abiertas (F0)

- **(a) Acceso al link público**: ¿slug legible a secas (`/catalogo/fnc-verano`, adivinable) o slug + token corto (`/catalogo/fnc-verano-x7k2`)? Recomendación: **con token** — son precios/productos armados para UN cliente, mejor que no los encuentre la competencia probando nombres.
- **(b) Vigencia**: ¿los catálogos expiran? Recomendación: no expiran solos; se **archivan** a mano (el link archivado muestra "catálogo no disponible, contactanos") y la temporada nueva es un catálogo nuevo duplicado.
- **(c) La carpeta de interés, ¿se registra en el sistema?** Hoy solo abre WhatsApp. Recomendación: **sí** — un POST anónimo barato que guarda la carpeta (items + cantidades + fecha) asociada al catálogo, visible en el editor como "intereses recibidos". Es el lead comercial en oro y no cambia nada para el cliente (el WhatsApp se abre igual).
- **(d) ¿Quién crea catálogos?** Recomendación: el rol marketing existente (misma sección); los vendedores solo reciben el WhatsApp.

## 6. Qué no cambia / riesgos

- Tienda, vitrina y precios: intactos — el catálogo solo LEE la vitrina cuando el item la referencia.
- El HTML de FNC sigue vivo y usable hasta que F2 lo migre.
- Riesgos: el peso de model-viewer en el bundle (mitigado con import dinámico); fotos sin límite de tamaño (mitigado con resize al subir); y el porteo del lightbox táctil — es la pieza con más fricción de React (eventos touch + refs), reservarle margen en F2.
