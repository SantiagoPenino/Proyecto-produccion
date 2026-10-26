# Propuesta: generación automática de la capa de tinta blanca (DTF) con Python

**Estado:** 🟡 Pendiente de respuestas del cliente (ver sección "Preguntas pendientes"). No es prioridad ahora.
**Fecha de la charla:** 2026-07-01

---

## Contexto

En DTF, para que la impresora tire **tinta blanca** (el under-base que después va al horno y se pega a la poliamida), hoy la empresa usa una **"acción"** que agarra el PDF original del cliente y le genera una capa (descrita como "ponerle un fondo negro"). El operario en **PhotoPrint** une las dos capas (color + blanco) para imprimir.

## Objetivo / flujo deseado

Automatizarlo: **cuando un cliente sube un archivo para DTF**, luego de que la orden se crea correctamente, generar automáticamente el archivo de la capa de blanco. Así, cuando el operario descarga, baja **dos archivos**:
1. El original del cliente (color).
2. El generado para la tinta blanca.

Y los une en capas en PhotoPrint para imprimir.

## Factibilidad

**Sí, es totalmente factible con Python.** Encaja con el flujo actual de subida, donde ya se generan derivados del archivo (thumbnail, perfil ICC). Además ya se corren scripts de Python del lado del server (ej. `color_calibrate.py`), así que sumar un generador de capa de blanco es consistente con la arquitectura.

## Cómo funcionaría técnicamente (enfoque raster, estándar en DTF)

1. Rasterizar el PDF del cliente a alta resolución (300 DPI o el que usen) **conservando la transparencia** → `PyMuPDF` (`fitz`).
2. Del canal **alpha** sacar dónde está el arte (la silueta / cobertura).
3. Generar la capa de blanco: rellenar esa zona con negro (o el color/canal que espere PhotoPrint), transparente donde no hay diseño → `Pillow`.
4. (Recomendado) un pequeño **choke** — achicar la silueta unos px — para que el blanco no asome por debajo del color.
5. Guardar a la **misma medida exacta** que el original (para que registren en PhotoPrint), como PDF/PNG/TIFF.

Librerías: `PyMuPDF` (render del PDF con alpha) + `Pillow` (manipulación de la máscara/silueta).

## Preguntas pendientes (para completar y después implementar)

> **P1 — La "acción" actual, ¿qué es?**
> ¿Un action de Photoshop, un script, un hot-folder de PhotoPrint? Idealmente el paso a paso, o mejor un **ejemplo real: el PDF original + el archivo negro que genera hoy**. Con eso se reproduce exacto.
>
> **R:** _(pendiente)_

> **P2 — ¿Qué es exactamente el "fondo negro"?**
> ¿El negro cubre **solo la forma del diseño** (silueta → blanco solo bajo el arte), o es un **rectángulo negro detrás de todo el lienzo**? Cambia bastante la lógica.
>
> **R:** _(pendiente)_

> **P3 — ¿El PDF del cliente siempre viene con fondo transparente?**
> Si a veces viene con fondo blanco/color, la silueta no sale sola y hay que resolverlo distinto.
>
> **R:** _(pendiente)_

> **P4 — En PhotoPrint, esa capa negra ¿cómo se usa?**
> ¿Se asigna a un **canal de tinta blanca** (spot), o el negro dispara el blanco por config del RIP? ¿Tiene un nombre de canal/perfil específico?
>
> **R:** _(pendiente)_

> **P5 — ¿Se achica el blanco (choke) o va 1:1 con el color?**
>
> **R:** _(pendiente)_

## Consideraciones / riesgos

- **Registro:** las dos capas deben quedar exactamente a la misma medida/posición, si no el blanco se corre. Conviene que ambas salgan al mismo DPI/medida.
- **Transparencia:** depende de que el arte tenga alpha real para sacar la silueta limpia (por eso se bloqueó JPEG en las subidas de arte — solo PNG/PDF con transparencia).
- **Vector vs raster:** si el color se imprime vectorial y el blanco es raster, hay que rasterizar a la misma medida para que aliñen.

## Integración con el sistema

- Disparar la generación **después de la subida**, solo para órdenes **DTF** (gate por área), igual que el thumbnail / perfil ICC (`uploadOrderFile` en `webOrdersController.js`).
- Guardar el archivo generado junto al original (para que el operario lo descargue con el resto).
- El generador sería un **script Python** invocado desde el backend Node (mismo patrón que el resto de utils de imagen), o un servicio aparte.
