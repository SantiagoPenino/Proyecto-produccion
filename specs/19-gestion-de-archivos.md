# Spec 19 — Gestión de Archivos del Cliente (to-be)

> Spec de escalamiento. Los archivos (artes, bocetos, tizadas, referencias, comprobantes,
> PDFs generados) se tratan como un **repositorio estructurado con metadata**, no como
> nombres-con-convención en carpetas. La validación de archivos del cliente se vuelve un
> **pipeline configurable por servicio**.
> Entidades definidas aquí: **Archivo**, **Versión de Archivo**, **Derivado**,
> **Regla de Validación**, **Pipeline de Validación**.

## 1. Diagnóstico del sistema actual

Lo que funciona (y se conserva como idea): tipificación de archivos (arte / boceto /
referencia / tizada / logo / prediseño / planilla), validación doble (navegador +
servidor), subida por manifiesto con progreso, medición automática, miniaturas y perfil
de color en segundo plano, reuso del archivo original en reposiciones.

Lo que falla:
1. **El nombre ES la identidad**: la convención de renombrado carga material, orden,
   cliente e índice dentro del nombre del archivo — cualquier cambio de convención (el
   interruptor por área actual) o un carácter raro es un riesgo; y "archivo i de n" se
   recalcula sobre el total ordenado por antigüedad.
2. **Carpetas ad-hoc**: descarga a "la carpeta local del área", almacenamiento externo
   (Drive) mezclado, sin estructura declarada ni dueño claro.
3. Validaciones potentes pero **cableadas por servicio en el código** (formatos, DPI,
   páginas, medidas, tolerancias) — agregar un servicio o cambiar una tolerancia es tocar
   código en dos lugares (front y back).
4. El **preflight** avanzado (fuentes, transparencias, espacios de color) existe pero
   está apagado, sin camino claro para activarlo por partes.
5. Derivados (miniatura, capa blanca, medición) generados por caminos distintos, sin
   estado visible si fallan.

## 2. El repositorio: identidad, estructura y metadata

- **INV-ARC.01** **Un Archivo tiene identidad propia y estable** (id), independiente de su
  nombre. El nombre visible es **presentación generada** desde la metadata (material,
  orden, cliente, índice, copias) — cambiable sin tocar el archivo ni romper referencias.
  La convención de nomenclatura actual pasa a ser una plantilla de presentación por área.
- **RN-ARC.02** La **estructura de carpetas es derivada, no autoritativa**:
  `cliente / pedido / orden / tipo-de-archivo`, generada desde la metadata para quien
  navega por sistema de archivos (operarios, RIPs de máquina). La verdad vive en la base:
  tipo, dueño, orden, medidas, resolución, páginas, perfil de color, hash, estado.
- **RN-ARC.03** **Deduplicación por hash**: el mismo archivo subido dos veces (o reusado
  por una reposición o una matriz) se almacena una vez y se referencia N veces — el reuso
  de reposiciones deja de ser una copia especial y pasa a ser el comportamiento normal.
- **RN-ARC.04** **Versionado**: un reemplazo (arte corregido, boceto re-subido tras
  rechazo) es una versión nueva del mismo Archivo; las anteriores se conservan con quién
  y por qué. Lo que producción ya usó referencia la versión exacta que usó.
- **RN-ARC.05** **Acceso con pertenencia** (Spec 12): el cliente descarga solo lo suyo;
  las URLs de descarga son firmadas y con vencimiento; toda descarga sensible queda en el
  libro (Spec 13).
- **RN-ARC.06** **Retención declarada por tipo**: artes de pedidos entregados, bocetos
  rechazados, comprobantes — cada tipo declara cuánto se conserva "caliente", cuándo se
  archiva en frío y cuándo puede purgarse (nunca lo referenciado por documentos fiscales).

## 3. Validación: pipeline configurable por servicio

- **RN-ARC.07** Cada servicio declara su **Pipeline de Validación** como datos: la lista
  ordenada de Reglas con sus parámetros. Las reglas son un catálogo cerrado y probado:

| Regla (catálogo) | Parámetros | Hoy existe en |
|---|---|---|
| Formato permitido | extensiones, exige transparencia | Todos los servicios |
| Una página por arte | — | Todos |
| Resolución obligatoria | mínimo DPI | Impresión (rechazo sin DPI) |
| Ancho vs material | margen (3 cm) | Impresión |
| Medida exacta | ancho×alto, tolerancia, ¿acepta girado? | Confeccionados, productos UV |
| Alto mín/máx | límites | DTF |
| Mesa de corte | límites físicos del equipo | Corte |
| Medible | el archivo debe poder medirse | Corte (sin medición no hay pedido) |
| Frente=dorso | tolerancia | Tela doble cara |
| Preflight avanzado | fuentes, transparencias, color | Existe apagado |

- **INV-ARC.02** **El pipeline corre siempre en el servidor** (el navegador lo anticipa
  para la experiencia, pero la verdad es del server — regla actual, elevada a
  invariante). Un archivo que no pasó su pipeline no habilita la orden.
- **RN-ARC.08** Cambiar una tolerancia, activar el preflight para un área o sumar una
  regla a un servicio es **edición de configuración**, versionada y auditada — no un
  deploy.
- **RN-ARC.09** El resultado de la validación se guarda con el archivo (qué reglas
  corrieron, con qué parámetros, qué dio cada una): cuando un cliente discute "me lo
  rechazó", la respuesta está registrada.

## 4. Derivados

- **RN-ARC.10** Los **Derivados** de un archivo (miniatura, capa de tinta blanca,
  medición de tizada, vectorización, preview 3D, PDF renombrado para el RIP) se generan
  por **jobs idempotentes** (Spec 15) ligados a la versión exacta del original, con
  estado visible (pendiente / listo / falló) — un derivado que falló no desaparece: queda
  reclamable y reintenta.
- **INV-ARC.03** **El original nunca se modifica.** Toda transformación produce un
  derivado o metadata; reprocesar es regenerar el derivado, no tocar la fuente.

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 02 | El pipeline por servicio es la formalización de las validaciones de ingreso; "sin arte no hay pedido" y "sin medición no hay corte" son reglas del pipeline. |
| Spec 20 | Las operaciones de imagen consumen y producen archivos/derivados de este repositorio. |
| Spec 18 | Los PDFs generados se almacenan aquí como archivos con su metadata. |
| Spec 03 | Producción referencia la versión exacta que imprimió; el nombre para el RIP es presentación por plantilla de área. |
| Spec 12/13 | Pertenencia, URLs firmadas, descargas al libro. |
