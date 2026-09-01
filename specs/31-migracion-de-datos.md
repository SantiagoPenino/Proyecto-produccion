# Spec 31 — Migración de Datos y Convivencia (to-be)

> Qué datos del sistema actual se importan al nuevo, con qué criterio de limpieza, y cómo
> conviven los dos sistemas durante la transición. Principio rector: **migrar data sucia
> es infectar al sistema nuevo el día uno** — y la suciedad está inventariada (deudas
> duplicadas, saldos descuadrados, marcadores cross-moneda, huérfanos, cobros sin
> movimiento).

## 1. Qué se migra, qué se recalcula, qué se abandona

| Categoría | Decisión | Criterio |
|---|---|---|
| **Clientes** (fichas) | Migrar depurado | Unificar duplicados conocidos; validar correos/teléfonos (la basura histórica '-', 'a', truncados NO entra); separar correo comercial vs portal tal cual |
| **Catálogo** (artículos, categorías, terminaciones, combos) | Migrar depurado | Asignar identificador único nuevo (muere el código repetible entre grupos); ocultos y muertos: solo si tienen historia que los referencia |
| **Precios** (base, perfiles, excepciones) | Migrar limpio | Purgar reglas duplicadas por cliente (existen); validar moneda por fila (el bug de doble columna de moneda no viaja) |
| **Saldos de clientes** | **Recalcular, jamás copiar** | El acumulado guardado está corrompido; el saldo inicial del cliente en el nuevo = recálculo desde movimientos con la fórmula limpia, validado contra el 360 |
| **Deudas vivas** | Migrar depurado | Deduplicar (una viva por documento); fecha real del documento origen; conciliadas contra el recálculo de saldo |
| **Planes de recursos vivos** | Migrar | Con su restante real (herencias de sobregiro resueltas); planes cerrados: solo como historia consultable |
| **Telas del cliente / bobinas vivas** | Migrar | Con ledger conciliado contra físico (los divergentes se resuelven ANTES de migrar, con el cliente si hace falta) |
| **Pedidos/órdenes EN CURSO** | **No se migran: se terminan en el viejo** | Regla de corte por pedido (ver §3) |
| **Documentos fiscales históricos** | Migrar como **archivo consultable** | Solo lectura: documento + PDF + estado DGI + deuda/pagos. No se re-asientan; el plazo fiscal (Spec 25) los exige disponibles |
| **Asientos históricos** | Archivo consultable | Igual: se consultan, no se recalculan |
| **Historia operativa** (estados, avisos, remitos viejos) | Archivo consultable selectivo | Lo referenciado por documentos vigentes; el resto queda en el sistema viejo apagado-consultable |
| **Usuarios internos** | Re-alta | Con contraseña nueva (las viejas están en texto plano: NO se migran ni se convierten — se resetean) y permisos re-otorgados en el modelo nuevo |
| **Configuración / nomencladores** | **Re-crear como seeds** | El sistema nuevo nace de sus propios seeds (Spec 21); la config vieja es referencia, no fuente |

- **INV-MIG.01** **Todo lo migrado pasa las constraints del sistema nuevo.** La migración
  no tiene modo permisivo: si una fila vieja viola un invariante (deuda duplicada, saldo
  imposible, huérfano), se **repara o se excluye con registro** — nunca se fuerza.

## 2. El proceso de migración

- **RN-MIG.01** **Fase de depuración EN EL VIEJO, antes de migrar**: los scripts de
  reparación pendientes conocidos (deudas duplicadas, cierres descuadrados, marcadores,
  cobros sin movimiento, moneda de PreciosBase, bobinas) se ejecutan y verifican en el
  sistema actual primero. Migrar es más fácil cuanto más limpio está el origen.
- **RN-MIG.02** La migración es un **pipeline repetible**: extracción → transformación →
  validación → carga, ejecutable N veces contra la réplica hasta que la verificación dé
  perfecta. El día real es una ejecución más del mismo pipeline, no un evento artesanal.
- **RN-MIG.03** **Verificación con cifras de control** (el checklist del corte): cantidad
  de clientes, suma de deudas vivas por moneda, suma de saldos por moneda, restantes de
  planes, metros de bobinas — **el viejo y el nuevo deben dar lo mismo**, y el reporte de
  diferencias con su explicación (excluidos y por qué) se conserva como documento.
- **RN-MIG.04** Todo lo excluido o reparado queda en un **registro de decisiones de
  migración**: qué fila, por qué, quién decidió. Ese registro es la respuesta a "¿y esta
  deuda vieja dónde está?" dos años después.

## 3. Convivencia y corte

- **RN-MIG.05** **Corte por pedido, no big-bang de módulos**: a partir de la fecha de
  corte, los pedidos NUEVOS nacen en el sistema nuevo; los pedidos en curso **se
  terminan, cobran y facturan en el viejo**. La convivencia dura lo que tarde en vaciarse
  el pipeline del viejo (semanas, no meses).
- **RN-MIG.06** Durante la convivencia, **cada sistema es dueño exclusivo de sus
  pedidos**: no hay doble escritura ni sincronización bidireccional (la fuente de bugs
  más segura que existe). Lo único compartido de solo-lectura: la ficha del cliente y su
  saldo consolidado, visibles desde el nuevo con la marca "incluye saldo del sistema
  anterior".
- **RN-MIG.07** Los **saldos y deudas se migran al final de la convivencia** (segunda
  pasada del pipeline): cuando el viejo ya no genera movimientos, se recalcula y se
  transfiere el estado financiero final. La primera migración (catálogos, clientes,
  precios) ocurre antes del corte; la financiera, después del vaciado.
- **RN-MIG.08** El sistema viejo queda **apagado-consultable**: solo lectura, sin jobs,
  accesible para consultas históricas durante el plazo legal (Spec 25). Se documenta cómo
  encenderlo en solo-lectura y quién puede.
- **RN-MIG.09** **Criterio de vuelta atrás**: hasta el fin de la primera semana
  post-corte, si el nuevo no sostiene la operación, los pedidos nuevos vuelven a nacer en
  el viejo (que sigue intacto) y lo nacido en el nuevo se re-ingresa a mano (el volumen
  de una semana lo permite). Pasada esa ventana, la vuelta atrás deja de ser un botón y
  pasa a ser un proyecto — se declara el punto de no retorno.

## 4. Interacciones

| Con | Relación |
|---|---|
| Spec 11 | Las constraints del modelo nuevo son el filtro de calidad de la migración. |
| Spec 21 | Seeds para lo re-creado; chequeos de consistencia como verificación continua post-corte. |
| Spec 25 | Qué histórico es obligatorio conservar accesible. |
| Spec 32 | El plan de construcción decide CUÁNDO ocurre cada fase de esta spec. |
