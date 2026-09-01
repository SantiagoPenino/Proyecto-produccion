# Spec 30 — Contenido del Portal y Sitio Público (CMS) (to-be)

> Spec de escalamiento. Hoy no hay un CMS: hay cinco piezas administrables con tres
> mecanismos distintos, contenido público escrito en código (cambiar la dirección del
> local tocó seis archivos), y la API de contenido **escribible sin autenticación**.
> El sistema nuevo unifica todo el contenido editable en un módulo con reglas comunes.
> Entidades definidas aquí: **Pieza de Contenido**, **Vigencia**, **Ubicación de
> Contenido**, **Publicación**.

## 1. Diagnóstico del sistema actual

Lo que funciona (se conserva como idea): banners laterales y popup administrables con
orden y activo/inactivo; interruptor de visibilidad por servicio del portal; texto e
imagen "información importante" por servicio; complementarios habilitados por servicio;
lista de precios públicos con doble audiencia (portal completo / sitio público filtrado);
banner de instalación de la app con descarte definitivo; aviso de mantenimiento.

Lo que falla:
1. **La API de contenido no exige sesión** — cualquiera podría publicar un popup en el
   portal (el hueco de seguridad más grave detectado en todo el sistema).
2. **Sin vigencia por fechas en nada**: apagar una promo vencida depende de que alguien
   se acuerde.
3. Sin borrador, sin previsualización, sin versiones, sin autoría, sin medición; el
   borrado es definitivo.
4. Solo un popup "al aire" elegido implícitamente por el orden; se muestra en **cada**
   entrada sin límite de frecuencia.
5. El sitio público entero (landing, contacto, términos, textos de servicios) está en
   código; los banners laterales solo se ven en pantallas muy anchas (invisibles para la
   mayoría).
6. La lista de precios públicos vive en una planilla externa con regla de barrido (si la
   planilla falla, se cae toda la lista) y sin relación con el motor de precios real.

## 2. El modelo: pieza × ubicación × vigencia

- **RN-CMS.01** Toda **Pieza de Contenido** (banner, popup, aviso por servicio, bloque de
  la landing, texto legal, novedad) comparte el mismo contrato: tipo, contenido (imagen
  del repositorio — Spec 19 — texto, link), **Ubicación** donde se muestra (nomenclador:
  columna de novedades, popup del portal, cabecera del formulario del servicio X, sección
  de la landing…), orden dentro de la ubicación, estado y vigencia.
- **RN-CMS.02** **Vigencia por fechas**: toda pieza puede programarse (visible desde /
  hasta); vencida se apaga sola. El estado efectivo = activa ∧ dentro de vigencia. Lo que
  hoy es manual-y-memoria pasa a ser automático.
- **RN-CMS.03** Ciclo editorial mínimo (Spec 14): **borrador → publicada → archivada**,
  con **previsualización** antes de publicar y versiones conservadas (nada se borra
  definitivo; se archiva). Autoría y cambios al libro (Spec 13).
- **INV-CMS.01** **Toda escritura de contenido exige permiso** (Spec 12): la publicación
  es una operación con rol propio. Cierra el hueco de la API abierta.
- **RN-CMS.04** **Reglas de exhibición del popup**: uno solo al aire por vigencia
  explícita (no por orden implícito); **frecuencia configurable** (una vez por sesión /
  por día / siempre) y respeto del cierre del cliente.
- **RN-CMS.05** Los banners de novedades se muestran en **todas las pantallas** (diseño
  responsive — Spec 17), no solo en monitores anchos.
- **RN-CMS.06** **Medición**: impresiones y clicks por pieza, visibles junto a la pieza —
  hoy no se sabe si alguien vio una promo.

## 3. Contenido del sitio público (sacar la landing del código)

- **RN-CMS.07** Los contenidos institucionales editables sin deploy: textos e imágenes de
  la landing, datos de contacto y dirección (**un solo lugar** — la lección de los seis
  archivos), términos y condiciones (con versión y fecha de vigencia), página de trabajo,
  showroom. La estructura de la página es del front (Spec 17); los textos e imágenes son
  piezas de este módulo.
- **RN-CMS.08** El **catálogo de servicios del portal** (nombre visible, descripción,
  ícono, imagen, texto de información importante, complementarios habilitados,
  visibilidad) es dato administrable completo — hoy solo la mitad lo es; crear o
  renombrar un servicio de cara al cliente no debe requerir deploy (el formulario técnico
  detrás sí es desarrollo).

## 4. Lista de precios públicos

- **RN-CMS.09** La lista pública se administra **en el sistema** (no en una planilla
  externa): por artículo publicable, con descripción comercial, moneda y precio de
  vidriera, doble audiencia (portal completo / sitio público marcado), y vigencia. Puede
  **sincronizarse desde el precio base real** (Spec 09) con un margen/redondeo declarado,
  o fijarse a mano — pero la relación con el precio real es **visible** ("difiere del
  precio de lista en X%"), no un misterio.
- **RN-CMS.10** Se conserva la captura de leads a cambio de la lista (Spec 26 RN-CRM.01).

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 12 | Publicar es permiso; se cierra la API abierta. |
| Spec 13 | Autoría y versiones de todo cambio de contenido. |
| Spec 19 | Imágenes del contenido en el repositorio. |
| Spec 17 | Ubicaciones renderizadas por los patrones del front, responsive. |
| Spec 26 | La lista pública alimenta la captura de leads. |
| Spec 09 | Relación declarada entre precio de vidriera y precio real. |
