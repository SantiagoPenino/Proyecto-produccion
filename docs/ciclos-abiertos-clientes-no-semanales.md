# Ciclos semanales abiertos en clientes que no son semanales

Análisis del 30/09/2026 sobre una copia de producción restaurada ese día. Solo lectura: no se cambió código ni datos.

## Qué pasa

- Hay **47 ciclos abiertos de 42 clientes que hoy no son semanales**: 41 comunes y 6 de rollo por adelantado. En total hay 128 ciclos abiertos; los otros 81 son de semanales.
- **22 de esos 47 tienen órdenes cargadas sin facturar:** 123 órdenes, US$ 9.571,11 y $ 3.066.
  - Algunos cargos son de junio.
  - Otros son de esta semana (24–30/09), así que el problema sigue ocurriendo.
- Esos cargos no se facturan nunca. Administración factura con «Facturar semanales» a los clientes semanales, y a estos clientes no los mira nadie.

Ejemplos:

| Cliente | Tipo hoy | Ciclo abierto desde | Sin facturar |
|---|---|---|---|
| Samiplus Sa | Común | 23/07 | 12 órdenes, US$ 2.884,58, desde el 12/06 |
| Gonzalo Garcia | Común | 28/07 | 6 órdenes, US$ 1.441,62, desde el 23/06 |
| Rdssport | Común | 22/07 | 21 órdenes, US$ 1.318,37, desde el 12/06 |
| RXD | Rollo | 02/07 | 20 órdenes, US$ 322,98, desde el 12/06 |
| Miguel A Berrospe | Común | 11/06 | 4 órdenes cargadas el 29/09 |

## Por qué pasa (verificado en el código)

1. **Al cerrar un ciclo, el sistema abre el siguiente sin mirar el tipo de cliente.**
   - En `cerrarCicloCompleto`, [contabilidadService.js](../backend/services/contabilidadService.js), el paso 7 («Abrir ciclo siguiente automáticamente», línea ~3981) llama siempre a `abrirCicloPorCuenta`.
   - El cierre sin factura (línea ~3437) hace lo mismo.
   - En los datos se ve: el ciclo abierto de cada uno de estos clientes empezó el mismo día de su último cierre (Rdssport el 22/07, Samiplus el 23/07, Gonzalo Garcia el 28/07, Raul Rivero el 23/07…).
2. **Cambiar el tipo de un cliente no toca sus ciclos.**
   - El tipo se cambia en `clientsController.js`: la edición del cliente (línea ~966) y el cambio rápido de la cartera (línea ~1214).
   - Ninguno de los dos cierra ni revisa ciclos.
   - Casi todos estos clientes tuvieron cierres semanales en junio y julio. **Inferido, no verificado:** eran semanales y se les cambió el tipo. No hay historial de cambios de tipo de cliente para confirmarlo; `Clientes` solo tiene `FechaRegistro`.
3. **Todo cargo va al ciclo si la cuenta tiene uno abierto, sea del tipo que sea el cliente.**
   - Al cargar una orden, contabilidadService (línea ~694, «Si la cuenta tiene ciclo activo → acumular en él») y el motor de eventos (línea ~6267) acumulan en el ciclo y **no crean la deuda de la orden**.
   - La decisión es por `obtenerCicloActivo(CueIdCuenta)`, no por el tipo de cliente.
4. **Nadie cierra estos ciclos.**
   - El cierre automático está desactivado:
     - `ciclosCredito.job.js` → `ejecutarCierreCiclos` devuelve sin hacer nada («se hace manualmente desde la UI»);
     - en `estadosCuenta.job.js`, `forzarCierreTodosCiclosAbiertos` está comentado.
   - Solo se cierran cuando Administración factura desde el Panel 360. A estos clientes no los factura nadie.
5. **Un ciclo nuevo se queda con los cargos sueltos del último mes** (`abrirCicloPorCuenta`, línea ~3141). Por eso hay cargos de junio en ciclos abiertos en julio.

## Qué consecuencias tiene

- **Clientes comunes.**
  - Al retirar, el sistema no mira el ciclo (`retiroService.js` línea ~415 solo lo mira para semanales y rollo), así que la orden frena en caja.
  - Si se cobra en caja, la factura queda enganchada al cargo del ciclo (`cajaService.js` línea ~1776) y no hay doble facturación.
  - El problema son las órdenes que salieron sin pasar por caja, como las de junio y julio cuando el cliente todavía era semanal. Esos cargos quedan en el ciclo, sin deuda y sin factura.
- **Clientes de rollo por adelantado.**
  - Para el sistema, un ciclo abierto es crédito (`retiroService.js` línea ~411: «rollo que ADEMÁS opera a crédito»).
  - Todas las órdenes con costo salen sin pasar por caja y se acumulan en un ciclo que nadie factura. Es una fuga que sigue abierta: Odysseus Ltda y Marisa Perez tienen cargos de esta semana.

## Otro hallazgo: la tarea que abre ciclos a los semanales no funciona

- `asegurarCiclosSemanalesAbiertos` ([estadosCuenta.job.js](../backend/jobs/estadosCuenta.job.js) línea ~188) busca cuentas con `CueTipo IN ('UYU','USD','ARS')`.
- En la base los tipos son `DINERO_USD`, `DINERO_UYU` y `MTS`, así que nunca encuentra nada.
- Hoy hay 2 cuentas en pesos de clientes semanales sin ciclo abierto.
- Los ciclos igual se abren al crear la cuenta de un semanal (contabilidadService línea ~121), así que el impacto es chico.

## Propuesta

1. **Abrir el ciclo siguiente solo si el cliente sigue siendo semanal**, o de rollo con crédito si eso es válido (ver la pregunta 1), en los dos puntos de `cerrarCicloCompleto`. Es un cambio chico y evita que el problema se repita. Tiene que ir **antes** de que Administración facture a estos clientes: si no, al facturar se les abre otro ciclo.
2. **Al cambiarle el tipo a un semanal**, en la edición y en el cambio rápido de `clientsController`:
   - si tiene órdenes sin facturar en un ciclo, avisar y no dejar cambiar hasta facturarlas (o pedir confirmación, ver la pregunta 2);
   - si sus ciclos están vacíos, cerrarlos sin factura.
3. **Avisar a Administración** desde la tarea diaria: ciclos con cargos sin facturar de hace más de 7 días, y ciclos abiertos de clientes que no son semanales. Por ejemplo, un aviso en la campanita a los usuarios de Administración.
4. **Arreglar el filtro** de `asegurarCiclosSemanalesAbiertos`: `CueTipo LIKE 'DINERO%'` y solo la cuenta principal.

**Limpieza de lo que ya existe, en este orden:**
1. Deployar la propuesta 1.
2. Administración factura los 22 ciclos con cargos. Primero confirma en Macrosoft los cargos de antes del 03/07 (están en el PDF "Cobros semanales a revisar").
3. Cerrar sin factura los 25 ciclos vacíos de clientes no semanales, con un SQL que se prueba antes en local.

## Preguntas abiertas

1. **¿Un cliente de rollo por adelantado puede operar con crédito semanal?** El código lo permite a propósito (`retiroService` línea ~411). Si es válido, esos clientes tienen que entrar en la rutina de «Facturar semanales» y la propuesta 1 tiene que abrirles el ciclo siguiente. Si no es válido, hay que cerrarles el ciclo y sus órdenes pasan a frenar en caja.
2. **Al pasar un semanal a común con órdenes sin facturar, ¿bloquear o permitir?** Bloquear obliga a facturar primero. Permitir con aviso deja el ciclo abierto hasta que se facture y recién ahí lo cierra.
3. **¿Se quiere volver a cerrar los ciclos automáticamente?** Está desactivado desde que el cierre pasó a hacerse a mano desde la pre-factura. Si no, el aviso de la propuesta 3 es la red de seguridad.
4. **¿Está bien cerrar por SQL los 25 ciclos vacíos**, o se prefiere que los cierre Administración desde la pantalla?
