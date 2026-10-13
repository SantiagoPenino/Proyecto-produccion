# Horas de uso y rendimiento de las máquinas

**Estado (08/10/2026):** análisis, con los números de producción. No se cambió código.

Pedido de Santiago, después de la ficha técnica de máquinas: ver si dos cosas del HTML de ficha técnica se pueden sacar del sistema, en vez de cargarlas a mano:
- las **horas de uso**, para programar mantenimientos «cada N horas»;
- el **rendimiento real contra la ficha**.

Consultas para producción: [`horas-uso-rendimiento-consultas.sql`](horas-uso-rendimiento-consultas.sql).

---

## 1. Qué tenía el HTML

- **Contador de horas de uso:** el campo «Contador actual de horas de uso» se cargaba a mano. Las tareas preventivas se podían programar «cada N horas de uso». El ejemplo del HTML es el cambio de filtros de tinta cada 500 h: si el último se hizo a las 2.900 h, el próximo toca a las 3.400 h. La tarea se marca «Próximo» cuando falta el 10 % de las horas.
- **Rendimiento vs. nominal:** es la producción real dividida por la capacidad nominal. La producción y las horas del período también se cargaban a mano.
- **Servicio Técnico hoy:** el preventivo es solo por fecha. `ST_Planes.CadaUnidad` admite DIA, SEMANA o MES.

## 2. Qué dato hay en el sistema (verificado en el código)

`dbo.BitacoraProduccion` guarda un **tramo** por cada vez que un lote corre en una máquina. Sus columnas son RolloID, MaquinaID, FechaInicio, FechaFin y UsuarioID.

- **Se abre** con ▶ en la máquina (`productionController`, acción `start`).
- **Se cierra:**
  - al pausar;
  - al finalizar, con cualquier destino: Control, calandra o samurai, volver a la cola, impresión parcial;
  - cuando el lote queda vacío después de arrancar (`utils/salidaDeLote.js`).
- **No se cierra si un lote en marcha se arrastra** a otra máquina o a la mesa (`productionKanbanController.assignRoll` / `unassignRoll`).
  - El tablero lo permite: solo bloquea el arrastre en las calandras de SB.
  - El tramo queda abierto hasta que el lote se pausa o se finaliza en otra máquina, y ahí se cierra con esa hora. La primera máquina se queda con horas que no trabajó.
  - Si el lote no vuelve a correr, el tramo queda abierto para siempre.
- **`DuracionMinutos` no la escribe nadie.**
- **Qué mide:** el tiempo entre ▶ y la pausa o el fin, no el tiempo real imprimiendo. Depende de que el operario toque ▶ al empezar y ⏸ en las pausas.

## 3. Las consultas

Todas son de lectura. En la copia local tardan menos de medio segundo.

| | Qué mide | Qué mirar |
|---|---|---|
| Q1 | Tramos por máquina: abiertos, de más de 12 h, de menos de 1 min y horas normales | Si los abiertos viejos o los de segundos son muchos, esa máquina no mide bien |
| Q2 | Tramos cerrados que se pisan en una misma máquina | Horas que se contarían dos veces |
| Q3 | Lotes que arrancaron en otra máquina con el tramo de la primera todavía abierto | Cuántas veces se mueve un lote en marcha |
| Q4 | Días con más de 16 h de tramos en una máquina | Días imposibles: horas que habría que recortar al horario |
| Q5 | Horas por máquina y por mes | El ritmo: con N horas por mes, «cada 500 h» cae cada 500/N meses |
| Q6 | Rendimiento real contra la ficha, últimos 60 días | Si da un porcentaje creíble y parecido entre máquinas iguales |

## 4. Lo que da producción (08/10)

Santiago corrió Q1 a Q6 en producción el 08/10. Dan casi igual que la copia local.

En total hay 4.124 tramos desde el 11/06. De esos, 1.250 (30 %) duran menos de un minuto y 337 (8 %) siguen abiertos desde hace más de un día.

**Por máquina.** La última columna es mi lectura de los números, no un dato.

| Máquina | Tramos | De menos de 1 min | Abiertos viejos | De más de 12 h | Horas en septiembre | ¿Mide? |
|---|---|---|---|---|---|---|
| DTF-1 | 491 | 22 % | 66 | 10 | 139 | Sí, con arreglos |
| DTF-3 | 453 | 17 % | 59 | 2 | 134 | Sí, con arreglos |
| ECOSOLVENTE | 487 | 28 % | 23 | 3 | 111 | Sí, con arreglos |
| ECOSOLVENTE 2 | 270 | 18 % | 21 | 5 | 104 | Sí, con arreglos |
| UV | 357 | 24 % | 14 | 0 | 86 | Sí, con arreglos |
| CALANDRA 1 | 664 | 18 % | 33 | 37 | 139 | Sí, pero inflado |
| FEDAR 1 | 230 | 36 % | 2 | 10 | 162 | Sí, pero inflado |
| FEDAR 2 | 286 | 30 % | 1 | 1 | 176 | Sí, pero inflado |
| DTF-2 | 89 | 39 % | 9 | 3 | 12 | Se usa poco: no se sabe |
| DTF-UV-1 | 460 | 54 % | 90 | 4 | 69 | No |
| DIRECTA 1 | 23 | 48 % | 0 | 0 | 12 | No |
| TPU 1 | 45 | 40 % | 1 | 3 | 8 | No |
| MIMAKI | 156 | 66 % | 15 | 2 | 7 | No |
| SAMURAI | 96 | 82 % | 3 | 2 | 0,7 | No |
| TPU 2 | 15 | 87 % | 0 | 0 | 0 | No |

**Horas infladas (Q4 y Q5).** Según la configuración de mi copia local, SB trabaja de 7 a 15 (8 h por día) y DF de 6 a 21:30 (15,5 h). No verifiqué si producción tiene el mismo horario.
- CALANDRA 1 suma 21 a 23 h en casi todos los días que aparecen, y hasta 72 h en un día (Q4 cuenta cada tramo en el día en que arrancó).
- FEDAR 2 sumó 176 h en septiembre, más que un mes entero de 8 h por día (unas 168 h).
- O sea: los lotes quedan «en marcha» fuera del horario, de un día para el otro.

**Lotes movidos en marcha (Q3):** fueron 14.
- Tres quedaron abiertos para siempre: el lote 455 en FEDAR 2 desde el 07/07 (92 días), el 1141 en DTF-2 desde el 07/08 (62 días) y el 1621 en ECOSOLVENTE 2 desde el 20/08 (49 días).
- El lote 354 tiene dos tramos a la vez en DTF-1: se arrancó dos veces el 01/07.

**Tramos que se pisan (Q2):** DTF-1 suma 77,7 h contadas dos veces y SAMURAI 23 h. En el resto es poco.

**Rendimiento contra la ficha (Q6, últimos 60 días):**
- DTF-1, DTF-2 y DTF-3 rinden entre 48 y 55 %; CALANDRA 1 el 56 %; MIMAKI el 61 %; TPU 1 el 41 %.
- FEDAR 1 rinde 107 % y FEDAR 2 149 %, aun con las horas infladas. Infiero que la ficha de 63 m/h está baja.
- ECOSOLVENTE rinde 27 %, ECOSOLVENTE 2 15 % y UV 7 %. Puede ser que la ficha (35 y 80 m²/h) sea la velocidad máxima y no la de producción, o que la Magnitud de ECOUV no esté en m². No lo sé.
- SAMURAI (99 %) y TPU 2 (1500 %) salen de 7 h y de 0 h: no significan nada.

**Conclusión, confirmada en producción.** Tal como se usa hoy:
- **En 7 máquinas la bitácora no mide:** DTF-UV-1, MIMAKI, SAMURAI, TPU 1, TPU 2, DIRECTA 1 y DTF-2. La mayoría de sus tramos son de segundos, o casi no tienen horas.
- **En las otras 8 mide, pero inflado:** los lotes quedan en marcha de un día para el otro, y los que se mueven en marcha no se cierran.
- **El rendimiento todavía no es creíble:** mezcla tiempos inflados con fichas que parecen mal cargadas (FEDAR y ECOUV).

## 5. Propuesta

**A. Arreglar la bitácora.** Es la base de todo lo demás.
1. **Cerrar el tramo** cuando un lote en marcha se mueve a otra máquina o a la mesa, igual que al pausar (en `assignRoll` y `unassignRoll`). La alternativa es no dejar moverlo sin pausarlo antes.
2. **Contar solo dentro del horario del área:** recortar cada tramo al horario de Planificación (`ConfigHorarioLaboral`, sin los feriados). Es la misma cuenta que ya hace la disponibilidad de la ficha técnica (`disponibilidadDe` en `stEquiposController`). Así, un lote que quedó en marcha de noche no suma esas horas.
3. **Proceso:** que los operarios toquen ▶ al empezar y ⏸ en las pausas, sobre todo en las 7 máquinas que no miden. No es código.
4. **Tramos viejos abiertos o de más de 12 h:** no inventarles un fin; se dejan afuera de las cuentas.

**B. Horas de uso.** Va después de A.
- **Contador por máquina:** la suma de los tramos recortados al horario, desde el arreglo. Opcionalmente, más una lectura inicial: la del horómetro de la máquina, si tiene.
- **Dónde se ve:** en el Resumen de la ficha.
- **Preventivo «cada N horas de uso»:**
  - Una unidad nueva, HORA, en `ST_Planes`.
  - La próxima fecha se estima con el promedio de horas por día de las últimas 4 semanas y se recalcula cada día.
  - «Próximo» cuando falta el 10 % de las horas, como en el HTML.
- **Máquinas que no miden:** o el técnico carga cada tanto la lectura del horómetro (como en el HTML), o se quedan con el preventivo por fecha.

**C. Rendimiento contra la ficha.** Va después de A.
- **Antes:** revisar las fichas de las FEDAR (63 m/h) y de ECOUV (35 y 80 m²/h).
- **Qué se ve:** una tarjeta en el Resumen con los últimos 30 o 60 días.
- **En qué máquinas:** solo en las que miden, y donde la unidad de la ficha coincide con la de las órdenes.
- **Solo informativo, en Servicio Técnico:** no toca Planificación. En agosto se decidió no calibrar la capacidad con datos del pasado; está anotado en `planificacionController`.

## 6. Decisiones (respuestas de Santiago, 08/10)

1. **Cerrar el registro al mover un lote en marcha: sí. HECHO (sin deployar).** Se cierra en `assignRoll` y `unassignRoll` (`productionKanbanController`), y también al dividir (`splitRoll`) y al desarmar un lote (`dismantleRoll`, `rollsController`), que tenían el mismo problema. Probado en local con los handlers reales (12 pruebas). Los registros viejos que quedaron abiertos no se tocan: se dejan afuera de las cuentas.
2. **Contar solo dentro del horario del área: sí.** Se aplica cuando se arme el contador.
3. **Las 7 máquinas que no miden: pendiente.** Santiago preguntó qué es un horómetro: es el contador de horas de funcionamiento que traen algunas máquinas, como el cuentakilómetros de un auto pero en horas. Se ve en el panel, en el menú de información o mantenimiento, o en el software del fabricante. No sé cuáles de estas máquinas lo tienen.
4. **Desde cuándo contar: todavía no está decidido.**
5. **Revisar las fichas de FEDAR y ECOUV: revisado con los datos de producción** (sección 7). Falta que el técnico confirme las velocidades.

**No lo sé:**
- qué máquinas tienen horómetro propio;
- si producción tiene el mismo horario que mi copia local.

## 7. Revisión de las fichas (decisión 5)

**De dónde salieron las velocidades:** no lo sé. No hay ningún script ni nota en el repositorio; se cargaron a mano en Configuración → Equipos. Hoy ninguna máquina tiene cargada la «velocidad real de planta» (`VelocidadValorReal`).

**Consultas nuevas:** Q7 (velocidad real por lote, con la mediana) y Q8 (unidades de las órdenes de ECOUV), en el mismo archivo `.sql`. Santiago las corrió en **producción** el 08/10; dieron casi igual que la copia local.

**Unidades de ECOUV (Q8): están bien.** De 1.601 órdenes en m², 1.588 (99 %) tienen la Magnitud igual a los metros de sus archivos. Hay además 280 órdenes en unidades, sin archivos (servicios): suman 425 unidades contra 4.597 m², así que casi no mueven la cuenta. El rendimiento bajo de ECOUV no es por la unidad.

**Velocidad real por lote (Q7, producción).** La mediana es la velocidad que supera la mitad de los lotes. El P75 la supera solo una cuarta parte: está más cerca de «a pleno».

| Máquina | Lotes | Ficha | Mediana | P75 | Lectura |
|---|---|---|---|---|---|
| FEDAR 1 | 96 | 63 m/h | 72 m/h | 108 m/h | La ficha está baja |
| FEDAR 2 | 147 | 63 m/h | 96 m/h | 128 m/h | La ficha está baja |
| CALANDRA 1 | 357 | 300 m/h | 176 m/h | 207 m/h | Ficha alta, o es la velocidad máxima |
| DTF-1 | 192 | 30 m/h | 16 m/h | 25 m/h | Ficha cerca del máximo |
| DTF-3 | 175 | 30 m/h | 17 m/h | 23 m/h | Ficha cerca del máximo |
| ECOSOLVENTE | 258 | 35 m²/h | 6,6 m²/h | 13 m²/h | La ficha parece la velocidad máxima |
| ECOSOLVENTE 2 | 170 | 35 m²/h | 5,5 m²/h | 8,3 m²/h | Ídem |
| UV | 219 | 80 m²/h | 4,8 m²/h | 9,4 m²/h | Ídem |

Las máquinas que no miden (sección 4) quedan afuera de esta tabla: DTF-UV-1, MIMAKI, TPU 1 y SAMURAI tienen pocos lotes limpios o tramos de segundos.

**Ojo, esto toca Planificación.** La velocidad de la ficha (`VelocidadValor`) es la que usa Planificación para calcular la capacidad de cada área. Si en ECOUV la ficha está 4 a 8 veces arriba de lo real, sus fechas proyectadas salen demasiado optimistas (inferido de estos números; no lo verifiqué en la pantalla de Planificación). Si se corrigen las fichas, cambian esas fechas.

**Propuesta:**
1. **El técnico confirma** el modelo y el modo de impresión que se usa en las FEDAR y en las de ECOUV, y con eso la velocidad de producción de cada una.
2. **Dónde cargarla, a elegir:**
   - en la **velocidad estándar**, si la de hoy está mal (las FEDAR);
   - en la **velocidad real de planta**, si la estándar es la del fabricante y en planta se usa un modo más lento (ECOUV). Planificación ya usa la real cuando está cargada.
3. **Es una decisión de Santiago, no automática:** en agosto se decidió no calibrar Planificación con datos del pasado. Estos números sirven para que el técnico confirme, no para cargarlos solos.
