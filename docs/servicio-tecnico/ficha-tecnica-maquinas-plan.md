# Ficha técnica de máquinas (Servicio Técnico) — plan

08/10/2026 · Base: `Desktop/Ficha Técnica de Máquinas.html`.

**Estado:** las cuatro partes están implementadas desde el 08/10, sin deployar, incluida la disponibilidad (Santiago dijo "sumalo"). Diferencias con este plan:
- La sub-pestaña de Servicio se llama **Historial** y no Estados, porque ahí también quedan la ficha y la capacidad.
- Al copiar una ficha tampoco se copian la ubicación ni la fecha y el estado de cabezales y herramientas (quedan en «Operativo»).

## Decisiones tomadas (Santiago, 08/10)

- La ficha de cada máquina pasa a **página propia**: `/servicio-tecnico/maquinas/:id`. Hoy es un panel lateral (`MaquinaFicha.jsx`, `max-w-2xl`).
- La **capacidad** se edita **desde ST**. En Configuración → Equipos queda de solo lectura. Son cabezales, velocidad, unidad y preparación, estándar y real.
- Se quedan en Configuración y no se tocan: nombre, área, estado config/proceso, activo, alta/baja y el tilde **"Pasa por otra máquina antes de Control"** (hasta el 08/10 se llamaba "Es impresora").
  - **Cambio del 08/10:** también se puede dar de **alta** una máquina desde Servicio Técnico (nombre, área, tipo y ese tilde). El tilde se elige solo al crearla; después se cambia únicamente en Configuración.
  - Ese tilde es `SeparacionImpresion` y quiere decir "el lote pasa a la calandra del área (en TPU, al samurai) antes de Control", no "es una impresora". Por eso se le cambió el nombre.
  - Lo usan producción, el kanban y los rollos.
- Van **todas las secciones** del HTML, cada una según el **tipo de máquina**.
- Tipos: Impresora, Calandra / prensa térmica, Bordadora, Corte láser, **Corte** (SAMURAI), Máquina de coser y Otra. TPU 1 y TPU 2 son impresoras.

## Qué NO se duplica (ya existe con datos reales)

| Del HTML | Ya está en ST |
|---|---|
| Historial de intervenciones | Solicitudes (técnico, parada, resolución) + Cambios (costo, adjuntos) + Estados |
| Mantenimiento preventivo | Planes y trabajos (`ST_Planes.EquipoId`) |
| Repuestos y stock | Insumos del /stock (WMS) |
| Contador de horas de uso | No existe y nadie lo cargaría: queda afuera |

## ⚠️ Cabezales: dos cosas distintas

Planificación calcula **velocidad × `ConfigEquipos.Cabezales`**, porque la velocidad es por cabezal (`planificacionController.js` ~l.330-342). Las impresoras no tienen `Cabezales` cargado, así que cuenta 1 y la velocidad queda como la de la máquina entera.

- **Bordadora:** cada cabezal borda una prenda a la vez. Los cabezales de la ficha **son** los de Planificación: la tabla por cabezal tiene tantas filas como `Cabezales`, y los que funcionan son `CabezalesReal`.
- **Impresora:** los cabezales de impresión (i3200, XP600…) **no** multiplican nada. Se guardan en la ficha y **nunca** se escriben en `ConfigEquipos.Cabezales`. Si se escribieran, una DTF con 2 cabezales pasaría de 30 a 60 m/h en Planificación.

## Tipo de máquina

El tipo se guarda en la ficha. Mientras una máquina no tenga tipo, la página lo **sugiere** por área y nombre, y el técnico lo confirma:

| Área | Sugerencia |
|---|---|
| Impresión DTF, Directa 3.20, ECO UV | Impresora |
| Sublimación | Impresora; `calandra%` → Calandra |
| TPU | Impresora; `samurai%` → Corte |
| Estampado | Calandra / prensa térmica |
| Bordado | Bordadora |
| Corte Láser | Corte láser |
| Taller Costura | Máquina de coser |
| Otra área | Otra |

## Secciones

Un "3/5" en cada sección cuenta los campos principales cargados. Una sección vacía dice "Sin cargar" y no estorba. Las cuentas (amperes, m², producción por turno) salen solas, como en el HTML.

### Comunes (todos los tipos)

1. **Identificación:**
   - Tipo, marca, modelo, n.º de serie, año.
   - **Local**: de la tabla `Locales`, la misma de las solicitudes; "otro" → especificar.
   - Ubicación dentro del local (texto).
2. **Dimensiones:**
   - Largo, ancho y alto (mm), peso (kg), espacio libre para servicio (mm).
   - Se calculan la superficie, el volumen y la huella con el espacio de servicio.
3. **Eléctrico:**
   - Tensión, fases, frecuencia, potencia nominal, máxima y en reposo, corriente según fabricante y protección recomendada.
   - Se calculan la corriente estimada y la energía por turno.
4. **Capacidad** (columnas de `ConfigEquipos`, la que lee Planificación):
   - Cabezales, velocidad + unidad y preparación, estándar y real.
   - Más dos datos de la ficha: horas por turno y condición de medición.
   - Se calcula la producción por hora, por turno y por mes (22 días).
   - El campo "Cabezales" se explica según el tipo, para que quede claro que multiplica la velocidad.
5. **Instalación:**
   - Temperatura y humedad (mín/máx), ventilación y caudal de extracción.
   - Aire comprimido (presión y caudal), conexión de datos, piso y nivelación.
6. **Garantía y soporte:**
   - Fecha de instalación, meses de garantía, cobertura, proveedor, factura / orden de compra.
   - Contacto, teléfono y email del soporte del fabricante.
   - Se calculan el vencimiento, el estado y la antigüedad.
7. **Observaciones técnicas.**

### Software y conectividad (impresora, bordadora, láser, corte)

Firmware, software (RIP / diseño / control), versión, licencia, PC y sistema operativo, IP. La IP se valida al cargarla.

### Propias de cada tipo

- **Impresora:**
  - Cantidad y modelo de cabezal, tecnología, resolución máxima, tipo de tinta, ancho máximo de impresión y periféricos (shaker, horno, secador).
  - **Tabla por posición**: canal / color, n.º de serie, fecha de colocación y estado (Operativo / Revisar / Reemplazar).
- **Calandra / prensa térmica:**
  - Tipo (calandra rotativa, plancha, neumática, hidráulica), ancho útil o área de plato, temperatura máxima, presión, calentamiento (eléctrico / aceite) y diámetro del cilindro.
  - Fecha del último cambio de manta / fieltro.
- **Bordadora:**
  - **Tabla por cabezal** con estado. La cantidad de filas = `Cabezales` de la capacidad (ver la pregunta 1).
  - Agujas por cabezal, área máxima de bordado, velocidad máxima (ppm), bastidores (plano, tubular, gorra), recortador automático y formato de archivo.
- **Corte láser:**
  - Tipo de tubo (CO2 vidrio, CO2 RF, fibra, diodo), potencia (W), marca y modelo del tubo, fecha de colocación y vida útil estimada (h).
  - Chiller (modelo y temperatura), lente (distancia focal), aire asistido, área de corte, materiales y espesor máximo.
- **Corte (SAMURAI):**
  - Área útil de corte, espesor máximo, mesa de vacío (potencia de la bomba), cinta transportadora y lector de marcas / cámara.
  - **Tabla de herramientas**: herramienta (drag, hidráulica, cartón, acrílico, oscilante, fresa…), modelo / código, n.º de serie, estado y notas.
- **Máquina de coser:**
  - Tipo de máquina del catálogo **`MaquinasCostura`**, el mismo de las costuras paso a paso. Así las puntadas ISO que puede hacer salen de `CosturasISO.MaquinaCosturaID`. Solo se lee el catálogo; el módulo de Yoania no se toca.
  - Agujas, hilos y velocidad máxima (ppm).

## Página `/servicio-tecnico/maquinas/:id`

- **Ruta:** el router ya resuelve por prefijo, así que `/servicio-tecnico/maquinas/12` cae en la entrada de menú "Máquinas" (`MainAppContent.jsx` ~l.1045). La ve quien tenga Máquinas en su rol. No hace falta SQL de menú.
- **Encabezado:**
  - ← Máquinas, nombre, área, estado, tipo y "marca modelo · serie".
  - Botones para técnicos: Registrar cambio, Cambiar estado, Copiar ficha de otra máquina.
- **Columna izquierda** en pantallas anchas, como el HTML: las máquinas con un buscador, para saltar de una ficha a otra. En celular no se muestra (se vuelve con ←).
- **Pestañas:**
  - **Resumen:** tarjetas de hoy (abiertas, fallas, parada, resolución), capacidad y producción, garantía y cuánto está completa cada sección.
  - **Ficha técnica:** las secciones del tipo. Cada sección se edita **por separado** (lápiz → Guardar / Cancelar), así no hay un formulario gigante que se pierde.
  - **Servicio:** fallas, cambios, estados e insumos (lo que hoy tiene el panel).
  - **Comercial y documentos:** la garantía y, en la parte 3, archivos.
- Los links que hoy abren el panel pasan a navegar a la página: lista de máquinas, Reportes, detalle de solicitud y detalle de trabajo.
- Estilo de siempre: Lucide en brand-cyan, `Selector` / `SelectorFecha`, ventanas a pantalla completa en celular y en `z-[6000]`+.
- **Copiar ficha de otra máquina:** copia todo menos n.º de serie, IP, licencia, fecha de instalación, factura y los n.º de serie de cabezales y herramientas.

## Datos

Script `docs/servicio-tecnico/st-ficha-tecnica.sql` (idempotente; va después de st-etapa2 y st-locales):

```
ST_FichaEquipo
  EquipoId        INT PK  (FK ConfigEquipos)
  Tipo            VARCHAR(20)   IMPRESORA | CALANDRA | BORDADORA | LASER | CORTE | COSTURA | OTRA
  Marca, Modelo, Serie  NVARCHAR(100)   ← en columnas para poder buscar
  Anio            SMALLINT
  LocalId         INT NULL (FK Locales), LocalOtro NVARCHAR(100)
  Datos           NVARCHAR(MAX)  (JSON, CHECK ISJSON) ← todo lo demás, incluidas las tablas de cabezales/herramientas
  FechaModif, UsuarioId, UsuarioNombre
```

- El resto va en JSON porque cada tipo tiene campos distintos: agregar o sacar un campo después no necesita SQL. Los campos se definen en un archivo del front, como `SECS` y `LISTS` del HTML.
- Cada guardado anota en `ST_Historial` (Entidad `EQUIPO`) **qué cambió**, por ejemplo "Firmware 1.08 → 1.10" o "Velocidad real 30 → 25". Se ve en la pestaña Estados.
- Mientras el script no esté corrido, la página funciona igual y la ficha técnica muestra el aviso.

**API** (`/api/servicio-tecnico`):
- `GET /equipos/:id/ficha`: lee cualquier usuario interno.
- `PUT /equipos/:id/ficha` y `PUT /equipos/:id/capacidad`: técnicos (área SERVICIO) o Admin, igual que los cambios.

**Configuración → Equipos** (`ConfigPrintersModal` + `areasController`):
- Los 7 campos de capacidad se muestran sin poder editarse, con "se edita en Servicio Técnico → Máquinas".
- `updatePrinter` deja de escribirlos siempre, y `addPrinter` crea la máquina sin capacidad.
- **Ojo 1:** hoy los valores **reales** los puede cambiar cualquiera que entre a Configuración (el candado solo cubre los estándar). Con esto quedan solo para técnicos y Admin.
- **Ojo 2:** Planificación ignora las máquinas sin velocidad (`WHERE VelocidadValor IS NOT NULL`). Una máquina nueva no cuenta hasta que ST le cargue la capacidad. En la lista de ST va a aparecer "Sin capacidad".

## Partes

1. **Página propia + ficha técnica completa por tipo + capacidad editable en ST** (Configuración de solo lectura) + copiar ficha.
2. **Servicio conectado a la ficha** (hecha el 08/10: tabla `ST_EquipoRepuestos` en el mismo script; endpoints `GET /equipos/:id/preventivo`, `GET/POST/DELETE /equipos/:id/repuestos` y el campo `ficha` de `POST /equipos/:id/cambios`; front `MaquinaServicio.jsx`):
   - Preventivo de la máquina (sus planes y trabajos).
   - **Repuestos críticos**: variantes del /stock por máquina, con el stock actual contra los límites de la variante.
     - **Corrección (08/10):** decía que `CantidadAlerta` y `CantidadCritica` no las usaba nada. Era falso: el panel del /stock ya las usa para sus alertas, y se cargan en Stock → Gestión de Sistema → Alertas de stock. Antes había buscado solo `StockMinimo`. Por eso los repuestos usan la **misma regla y los mismos límites que el /stock**: stock global, crítico si llega a la crítica y alerta si llega a la de alerta. La única diferencia es que un repuesto en 0 se marca "Sin stock", porque el panel del /stock lo deja afuera. `StockMinimo` no se usa: solo lo carga el script de importación.
   - Un cambio tipo "Cabezal" pide la posición y actualiza su fila. Un cambio tipo "Firmware / software" ofrece actualizar la versión de la ficha.
3. **Documentos** (hecha el 08/10: `POST/PUT/DELETE /equipos/:id/adjuntos`, `documentos` en `GET /equipos/:id`, sección "Fotos y archivos" y la sección de ficha "Manuales y enlaces", Datos.doc.links):
   - Fotos (máquina, placa de datos, conexiones) en `ST_Adjuntos` con Entidad `EQUIPO`.
   - Links a manuales.
4. **Alertas e indicadores** (hecha el 08/10; disponibilidad = `disponibilidadDe` en stEquiposController, con el horario del área y los feriados de Planificación, paradas solo dentro del horario y sin contar dos veces lo que se pisa, últimos 90 días o desde la primera solicitud del módulo sin los tickets viejos; las alertas las calcula `GET /equipos`; entre fallas = (última − primera) / (cantidad − 1) con las fallas no canceladas del último año; reparación = parada promedio de las que pararon la máquina y se cerraron):
   - Chips en las tarjetas de la lista: preventivo vencido, garantía por vencer, repuesto bajo, cabezal para reemplazar, sin capacidad.
   - Tiempo medio entre fallas y tiempo medio de reparación, con las solicitudes.
   - Disponibilidad: Planificación ya tiene el horario de planta y los feriados, se podría usar como "horas programadas" (a confirmar).

## Respuestas (Santiago, 08/10)

1. **Bordadoras:** al guardar un cabezal fuera de servicio, se le **pregunta** al técnico si actualiza "Cabezales funcionando" (lo que lee Planificación), con el número ya calculado. No se actualiza solo.
2. **Licencias e IP:** las ve todo el que ve Máquinas. Quién ve Máquinas se maneja con los roles del menú.
