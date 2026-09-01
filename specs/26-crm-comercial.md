# Spec 26 — CRM y Gestión Comercial (to-be)

> Spec de escalamiento. El dominio comercial actual son dos piezas que no se tocan (un
> CRM de leads aislado y la ficha del cliente); el sistema nuevo las une en un solo
> circuito comercial.
> Entidades definidas aquí: **Lead**, **Vendedor**, **Cartera**, **Zona Comercial**,
> **Interacción Comercial**, **Sector Comercial**.

## 1. Diagnóstico del sistema actual

Lo que funciona (se conserva como regla): captura de leads en el sitio público (correo +
celular a cambio de la lista de precios), asignación automática de vendedor por zona con
reparto al de menor carga, elección manual del asesor con foto al registrarse, bloqueo de
cliente consistente en todos los canales, sectores comerciales como mapeo reconfigurable
(el histórico se reagrupa solo), vista 360 del vendedor **deliberadamente solo-lectura**.

Lo que falla:
1. **Lead y Cliente son mundos separados**: "compra concretada" es un rótulo — no
   convierte, no vincula, no deja historia.
2. **Dos criterios de asignación** para la misma decisión: el portal asigna al de menor
   carga; el alta interna, al azar. Y el vendedor se referencia por **dos identificadores
   distintos** según el camino (el vínculo usuario↔trabajador no existe formalmente):
   clientes que no muestran vendedor según quién pregunte.
3. **Cero auditoría comercial**: reasignar vendedor, cambiar tipo de cliente o
   bloquear/desbloquear no registra quién, cuándo ni por qué.
4. **La API de clientes no valida sesión ni rol** — cualquiera que la alcance puede
   crear, reasignar, bloquear o borrar (cubierto por Spec 12, se cita como urgencia).
5. Duplicados masivos (grupos de hasta 91 fichas) con fusión manual sin rastro ni
   reasignación de historia.
6. Las zonas no se administran desde ninguna pantalla (solo por base).
7. No existen: notas sobre clientes, historial de contactos, recordatorios, reportes por
   vendedor, comisiones ni metas.

## 2. Leads y conversión

- **RN-CRM.01** Un **Lead** nace de los canales de captura (sitio público a cambio de la
  lista de precios — se conserva; otros canales configurables) con su origen registrado.
  Estados: nuevo → contactado → pedido iniciado → convertido / perdido (nomenclador,
  Spec 14).
- **RN-CRM.02** **La conversión existe de verdad**: convertir un lead crea (o vincula a)
  la ficha del Cliente, hereda sus datos de contacto y conserva el vínculo lead→cliente —
  el embudo se puede medir de punta a punta (captados → convertidos → primera compra).
- **RN-CRM.03** Todo lead tiene **dueño** (vendedor asignado por la misma regla de zona
  que los clientes) y una **bitácora de interacciones** (ver §4) en lugar de una nota
  única sobreescribible.
- **RN-CRM.04** La analítica del sitio (aperturas, formularios, categorías clickeadas) se
  conserva como tablero de marketing, separada del seguimiento de personas.

## 3. Vendedores, carteras y zonas

- **INV-CRM.01** **Vendedor es UNA identidad** (Spec 12 RN-SEG.01): el usuario interno y
  el trabajador comercial son la misma entidad o están vinculados formalmente — nunca dos
  identificadores que se resuelven distinto según la pantalla.
- **RN-CRM.05** **Una sola regla de asignación** para todos los canales: elección manual
  del cliente si la hay (con la grilla de asesores por foto — se conserva); si no, el
  vendedor de la zona del departamento **con menos clientes activos en cartera**. El alta
  interna usa exactamente la misma regla.
- **RN-CRM.06** Las **Zonas Comerciales** (zona → departamento → localidad) son datos
  maestros administrables desde la consola (Spec 21) — dejan de vivir solo en la base.
  Cambiar la zona de un departamento afecta solo asignaciones futuras.
- **RN-CRM.07** La **Cartera** es consultable: cada vendedor ve la suya (reconocimiento
  automático por la identidad única de INV-CRM.01, no por comparación de nombres); ver
  carteras ajenas es un permiso explícito (Spec 12), no una omisión.
- **RN-CRM.08** La **vista 360 del vendedor sigue siendo solo-lectura por diseño**
  (recursos, telas, pendiente de retirar, precios, deuda) — la operación de dinero vive
  en contabilidad. El vendedor carga pedidos a nombre de cualquier cliente, con registro
  de quién cargó (se conserva, Spec 10 RN-USR.09).
- **RN-CRM.09** Reportes por vendedor (hoy inexistentes): ventas de su cartera por
  período, clientes nuevos, clientes sin compras hace N días — sobre la capa de lectura
  (Spec 16). Comisiones y metas: **DECISIÓN PENDIENTE (negocio)** — el modelo las
  soporta (todo cobro conoce al vendedor del cliente) pero no se implementan hasta que el
  negocio defina el esquema.

## 4. La ficha comercial del cliente

- **RN-CRM.10** Los cambios comerciales sensibles — reasignar vendedor, cambiar tipo,
  bloquear/desbloquear, editar identificadores de vinculación — exigen permiso propio,
  **motivo cuando son punitivos** (bloqueo) y quedan en el libro con antes→después
  (Spec 13). El desbloqueo es una decisión registrada, no un cambio de combo.
- **RN-CRM.11** **Tipos de cliente con guardas**: cambiar el tipo valida las
  consecuencias (pasar a semanal abre ciclo; sacar el tipo semanal exige cerrar el ciclo
  activo; los cambios con deuda viva advierten el impacto). El catálogo de tipos es
  nomenclador con columnas de comportamiento (Spec 11).
- **RN-CRM.12** **Interacción Comercial**: sobre clientes y leads se registran contactos,
  notas y recordatorios con fecha de seguimiento — la bitácora comercial que hoy no
  existe. Visible en el 360 del vendedor.
- **RN-CRM.13** **Duplicados**: la unicidad de correo/teléfono/documento del alta web
  (Spec 10 RN-POR.01) aplica a **todos** los canales de alta; la herramienta de fusión
  del sistema nuevo **reasigna la historia** (pedidos, deudas, movimientos) al
  sobreviviente en una operación transaccional auditada — la fusión manual sin rastro
  desaparece.
- **RN-CRM.14** Defaults del alta (estado activo, tipo común, zona por departamento,
  forma de envío según origen) se conservan como configuración, no como código.

## 5. Sectores comerciales

- **RN-CRM.15** Se conserva el diseño actual completo: el **Sector** es cómo el negocio
  mira sus ventas (agrupación de áreas), reconfigurable, con el histórico reagrupándose
  solo; las áreas sin sector se muestran como "sin sector" para forzar la decisión, nunca
  se esconden.

## 6. Interacciones

| Con | Relación |
|---|---|
| Spec 10 | Registro del portal, elección de asesor, unicidad de datos. |
| Spec 12 | API de clientes bajo permisos (urgente); identidad única vendedor. |
| Spec 13 | Bitácora de cambios comerciales y de interacciones. |
| Spec 05/06 | El tipo de cliente gobierna ciclo y cobertura; la fusión reasigna deudas. |
| Spec 31 | La migración depura los duplicados ANTES de entrar (grupos de hasta 91). |
