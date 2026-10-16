# Beneficios pactados sobre la billetera — plan de implementación

> Escrito el 3-set-2026. Spec de negocio: [specs/40-beneficios-pactados.md](../specs/40-beneficios-pactados.md).
> Mockup aprobado en revisión con Administración (lienzo "Beneficios de la Billetera",
> pantallas 0 a 7). Documento formal para Dirección: `docs/Beneficios_Billetera_Propuesta.docx`.
>
> Todo lo de acá se apoya en la billetera PREPAGO+auto ya construida (ver
> `scripts/DEPLOY_BILLETERA_PREPAGO.md`): **no se arranca de cero**.

---

## 1. Qué se quiere

Que un vendedor pueda pactar con un cliente "estos productos a este precio si cargás $X en
tu billetera", que ese pacto pase por aprobación, y que se habilite **solo cuando el cliente
carga la plata con factura**. Mientras el beneficio tenga saldo y esté vigente, el motor de
precios aplica lo pactado; al agotarse o vencer, el cliente vuelve solo a su tarifa.

Las reglas están cerradas en la Spec 40. Las que más condicionan el diseño técnico:

- Aprobado ≠ habilitado: ningún precio cambia hasta que la carga se acredita (RN-BEN.13).
- La activación es siempre una carga facturada; a la bolsa no entra nada más (RN-BEN.15).
- La cotización decide el beneficio y el consumo obedece (RN-BEN.23).
- Cascada de la última orden: bolsa → billetera común → pendiente; tarifa intacta (RN-BEN.24).
- Alcance más específico gana; el % siempre sobre lista (RN-BEN.03, RN-BEN.20).
- Precio peor que el actual del cliente ⇒ alerta en las tres puntas, no bloqueo (RN-BEN.10).
- Predefinidos: catálogo propio; en el cliente solo se muestran (RN-BEN.05, RN-BEN.08).

## 2. Qué ya existe y se reutiliza (no reinventar)

| Pieza existente | Dónde | Cómo se usa |
|---|---|---|
| Cuenta restringida "rollo en plata" (lista blanca de artículos, prepago facturado, auto-consumo al ingreso, libro, 🔄 devolver consumo, re-cuadre al editar precio) | `CuentasCliente` + `CuentasClienteArticulosPermitidos`, motor en `contabilidadService.buscarCuentaAutoConsumoParaOrden` y `procesarEventoContable` | **La bolsa del beneficio ES una cuenta de este tipo**, con dos columnas más (beneficio y vencimiento). |
| Consumo repartido entre billeteras (`planPartesConsumoBilletera` + `consumirOrdenDesdeSaldoEnPartes`) | `contabilidadService` / `contabilidadController` | La cascada bolsa → común reusa este mecanismo con la lista de fuentes acotada. |
| Perfiles de precios (`PerfilesPrecios` + `PerfilesItems`: fixed / percentage / monto, alcance artículo / grupo / TOTAL+categoría) | `pricingService.calculatePrice` | Las reglas de cada beneficio se guardan como un perfil marcado como beneficio; el motor las lee por una fuente nueva. |
| Venta de saldo (factura + `CARGA_PREPAGO`) en caja/360 y recarga web prepago (Handy/MP + e-Ticket/e-Factura, webhook `wallet-topup`) | `contabilidadController.cargaPrepago`, `webOrdersController._acreditarRecargaBilletera`, `ModalVentaSaldo` | La activación es exactamente este flujo, con el beneficio como parámetro. |
| Guard de roles internos `soloInternoConRol([...])` | `authMiddleware` | Aprobar, pausar y cerrar. |
| Vista 360 de vendedores (`/vendedores/cliente-360`, pestañas) | `src/components/pages/VendedorCliente360.jsx` | Pestaña nueva "Beneficios". |
| 360 de Administración: gestor Cuentas (`ModalCuentasCliente`), `ClienteBilletera` agrupado | `ContabilidadCuentasView.jsx`, `ClienteVista360.jsx`, `ClienteBilletera.jsx` | Interruptor pausa/reanuda, cierre con transferencia, total común vs beneficios. |
| Portal "Mi billetera" (`RecursosView.jsx`, endpoints `mis-cuentas`, `mi-billetera`) | `webOrdersController` | Tarjetas de beneficio, "Beneficios para vos", recarga con beneficio. |

## 3. Modelo de datos (propuesta física)

Todo idempotente, en un script `scripts/add_beneficios.sql`:

- **`Beneficios`** (plantillas y pactos comparten la definición):
  `BenIdBeneficio` PK, `BenTipo` ('PLANTILLA' | 'PACTO'), `BenNombre`, `BenDescripcion`,
  `PerfilID` (FK a `PerfilesPrecios`: las reglas), `MonIdMoneda`, `BenCargaImporte`,
  `BenCargaEsMinimo` bit, `BenVigenciaDias` int null, `BenVigenciaHasta` date null
  (ambos null = hasta agotar), `BenPublico` bit (solo plantillas: activable desde el portal),
  `BenEstado` ('BORRADOR','PENDIENTE','PUBLICADA','PAUSADA' para plantillas;
  'PROPUESTO','PENDIENTE','APROBADO','RECHAZADO','CANCELADO' para pactos),
  `CliIdCliente` null (solo pactos), `BenIdPlantillaBase` null, `BenVendedorId`
  (usuario proponente), `BenNota`, `BenAprobadorId`, `BenFechaAprobacion`,
  `BenNotaAprobador`, `BenMotivoRechazo`, `BenFechaAlta`, `BenUsuarioAlta`.
- **`BeneficiosCliente`** (un beneficio ACTIVADO = una bolsa):
  `BclIdBeneficioCliente` PK, `BenIdBeneficio` FK, `CliIdCliente`, `CueIdCuenta` (la bolsa),
  `DocIdDocumento` (factura de la carga), `BclFechaActivacion`, `BclFechaVencimiento` null,
  `BclEstado` ('ACTIVO','PAUSADO','AGOTADO','VENCIDO','CERRADO'), `BclPausadoPor`,
  `BclFechaPausa`, `BclCerradoPor`, `BclFechaCierre`, `MovIdTransferenciaCierre` null.
- **`PerfilesPrecios`**: columna `EsBeneficio` bit (default 0). Los perfiles de beneficio
  **no** se listan como asignables en la página Perfiles de Precios ni en
  `PreciosEspeciales.PerfilesIDs`; solo se ven etiquetados.
- **`CuentasCliente`**: `BclIdBeneficioCliente` null (bolsa ↔ activación) y
  `CueFechaVencimiento` null. La restricción de alcance se deriva del perfil (no de la lista
  blanca): ver §5.
- **Línea cotizada y ORDEN de cuenta corriente**: columna `BclIdBeneficioCliente` null en
  la tabla donde `erpSyncService` sella el perfil aplicado a la línea, y en el movimiento
  ORDEN que crea el motor contable. Es la marca "esta orden se cotizó con el beneficio N".
- `TiposMovimiento`: no hace falta uno nuevo (la carga es `CARGA_PREPAGO`, el consumo
  `CONSUMO_CUENTA`, el cierre `TRANSFERENCIA_*`).
- `ConfiguracionGlobal.BENEFICIOS_ACTIVOS` (interruptor general para el despliegue).

## 4. Backend, por pieza

### 4.1 Catálogo de plantillas (`/api/beneficios/plantillas`)
- `GET` lista (filtros estado/público), `POST` crea (nace BORRADOR o PENDIENTE), `PUT`
  edita (si estaba PUBLICADA vuelve a PENDIENTE), `POST /:id/pausar|reanudar`.
- Al guardar se crea/actualiza el `PerfilesPrecios` (EsBeneficio=1, EsGlobal=0) y sus
  `PerfilesItems` a partir de las reglas del formulario.

### 4.2 Pactos (`/api/beneficios/pactos`)
- `POST` propone (vendedor interno): valida cliente, moneda única, reglas ≥ 1, carga > 0;
  calcula por artículo lista / especial / beneficios activos / pactado y **devuelve las
  alertas de precio peor** (mismo helper que usa el front para mostrarlas).
- `GET` lista con filtros (cliente, vendedor, estado, fechas); el vendedor ve los suyos,
  Administración todos.
- `POST /:id/aprobar` (rol Administración, proponente ≠ aprobador, nota obligatoria si hay
  precios peores), `POST /:id/rechazar` (motivo obligatorio), `POST /:id/cancelar`
  (solo APROBADO sin activar).
- `GET /cliente/:cliId` → lo que muestra la pestaña del 360: beneficios activados del
  cliente (con saldo real de la bolsa, vencimiento, estado), pactos en curso, plantillas
  publicadas con "hoy paga X / le sale peor".

### 4.3 Activación
- Caja/360: `cargaPrepago` acepta `BenIdBeneficio`: crea la bolsa (cuenta restringida
  prepago auto, nombre "Beneficio: <nombre>", `CueFechaVencimiento`), registra
  `CARGA_PREPAGO` contra la factura y crea `BeneficiosCliente` ACTIVO. Valida importe =
  pactado (o ≥ mínimo) y moneda.
- Portal: `iniciarRecargaCuenta` acepta `beneficioId` (sin `cueIdCuenta`), guarda
  `ordersData.beneficioId`; `_acreditarRecargaBilletera` rama `wallet-topup` con beneficio
  ⇒ misma rutina que caja tras emitir la factura. Guard anti-duplicado por Tx.
- Helper único `activarBeneficio({benId, cliId, docId, importe, transaction})` usado por
  los dos caminos.

### 4.4 Motor de precios (`pricingService.calculatePrice`)
- Fuente nueva en la consulta de reglas: perfiles de `BeneficiosCliente` del cliente con
  `BclEstado='ACTIVO'`, vigencia no vencida y **saldo real de la bolsa > 0** (fórmula
  canónica `getSaldoRealCuenta`). Prioridad por encima de las excepciones del cliente.
- Para reglas TOTAL de un beneficio se filtra por la categoría/área del perfil (hoy un
  perfil asignado a cliente no filtra categoría: hay que agregar ese filtro para la fuente
  de beneficios).
- Selección entre beneficios: mayor especificidad (artículo > grupo > TOTAL); empate ⇒ menor
  `BclFechaVencimiento` (null al final) ⇒ menor `BclFechaActivacion`.
- Reglas `percentage` de beneficio: base = **precio de lista** (PreciosBase), ignorando la
  excepción del cliente.
- Salida: `beneficioAplicado {bclId, nombre}` en el resultado y en la traza
  ("BENEFICIO #id"). `erpSyncService` sella `BclIdBeneficioCliente` en la línea/orden.

### 4.5 Motor contable (consumo)
- `buscarCuentaAutoConsumoParaOrden`: si la orden trae `BclIdBeneficioCliente` ⇒ la bolsa
  de ese beneficio es la única fuente candidata (aunque esté restringida y sea de otra
  moneda: cross @ cotización del día, como hoy). Si no trae marca ⇒ **se excluyen** todas
  las bolsas de beneficio de la selección actual.
- Cascada: si la bolsa no alcanza, `planPartesConsumoBilletera` con fuentes
  `[bolsa, billetera común de la moneda de la orden]` (nunca otra bolsa, nunca la
  principal); el resto queda ORDEN en la principal (`CUBIERTO_PARCIAL_CUENTA_`). Un
  `CONSUMO_CUENTA` por cuenta con "parte i de n". Semanales: la común no entra al ingreso.
- Al quedar la bolsa en 0 ⇒ `BeneficiosCliente` AGOTADO y `CueActiva=0` (cierre automático).
- Reversa (🔄 devolver consumo): devuelve a la bolsa; si estaba AGOTADO y sigue vigente ⇒
  vuelve a ACTIVO y reabre la cuenta (decisión pendiente en la spec: dejarlo así salvo
  indicación).

### 4.6 Pausa y cierre (360 de Administración)
- `POST /api/beneficios/activos/:bclId/pausar|reanudar` ⇒ `BclEstado` PAUSADO/ACTIVO y
  `CueAutoConsumo` 0/1; en pausa el motor de precios no ve el beneficio.
- `POST /api/beneficios/activos/:bclId/cerrar` ⇒ `transferirEntreCuentas` bolsa → billetera
  común de la misma moneda (crear la común si no existe), `BclEstado` CERRADO, cuenta
  cerrada, `MovIdTransferenciaCierre`.

### 4.7 Candados (todos en backend, con mensaje claro)
- `transferirEntreCuentas`: rechaza origen o destino con `BclIdBeneficioCliente` salvo la
  rutina de cierre.
- Medio "Saldo de cuenta" (3 débitos): ya excluye PREPAGO; además excluir bolsas de
  beneficio explícitamente.
- `consumirDesdeSaldo` / `consumoManual`: la bolsa solo acepta órdenes con su
  `BclIdBeneficioCliente`.
- `registrarPagoAnticipo`, `cargaPrepago` sin beneficio, ajustes: rechazan bolsas de
  beneficio.
- Portal `getMiBilletera` (Mi saldo / cubrir): ya excluye restringidas; mantener.

## 5. Alcance de la bolsa: derivar del perfil, no de la lista blanca

Hoy la restricción de una cuenta es una lista de `ProIdProducto`. Un beneficio "servicio
completo" tendría decenas de artículos y se desincroniza al crear artículos nuevos. Como la
orden ya llega marcada con el beneficio (RN-BEN.23), **el consumo no necesita comprobar el
alcance**: obedece la marca. La lista blanca se puede materializar igual al activar (para
que el gestor de cuentas y el portal muestren "solo X") con una función
`materializarAlcance(perfilId)`, sin que el motor dependa de ella.

## 6. Pantallas

| # mockup | Pantalla | Archivo(s) | Trabajo |
|---|---|---|---|
| 0 | 360 vendedores · pestaña Beneficios | `VendedorCliente360.jsx` (TABS + `TabBeneficios` nuevo) | Lista de beneficios del cliente, predefinidos disponibles (consulta), botones Pactar / Mis pactos. Única pestaña que escribe: revisar el cartel "Solo lectura". |
| 1 | Beneficios predefinidos | página nueva `BeneficiosPredefinidos.jsx`, ruta `/beneficios/predefinidos`, entrada de menú | Tabla + formulario (quién activa, moneda, carga fija/mínima, vigencia, reglas con tipo fijo / % / monto). |
| 2 | Pactar beneficio | `ModalPactarBeneficio.jsx` (abre desde 0) | Base (plantilla / a medida), tabla lista / especial / beneficio activo / pactado / dif., alertas de precio peor, nota. |
| 3 | Mis pactos / lista de aprobación | `BeneficiosPactados.jsx`, ruta `/beneficios/pactos` | KPI por estado, filtros, tabla, panel de revisión (aprobar con nota / rechazar con motivo), "Cargar en caja", "Cerrar · pasar saldo". Plantillas pendientes en la misma lista. |
| 4 | Venta de saldo con "¿Qué cargás?" | `ModalVentaSaldo` en `ContabilidadCuentasView.jsx` | Radio saldo común / beneficio; lista de aprobados y públicos; importe fijado. |
| 4b | Gestor Cuentas: bloque Beneficios | `ModalCuentasCliente` + `ClienteBilletera` (agrupado) | Interruptor "Aplicando precios pactados", "Cerrar · pasar saldo a BILLETERA"; total común separado de beneficios. |
| 5–7 | Portal | `RecursosView.jsx` (archivo compartido con otra sesión: cambios aditivos), `PickupView.jsx` sin cambios | "Beneficios para vos" con alertas, recarga con beneficio (importe fijo, comprobante), tarjeta del beneficio activo con "te quedan ≈ N m", aviso de cascada. |

## 7. Fases y entregables

| Fase | Contenido | Entregable verificable | Estimación |
|---|---|---|---|
| F0 Modelo | `add_beneficios.sql` (tablas, columnas, flag, índices), helpers de saldo/vigencia | Script idempotente corrido en local; consultas de control | 2–3 días |
| F1 Catálogo + pacto + aprobación | Endpoints 4.1/4.2, páginas 1, 2, 3 y pestaña 0 | Un pacto recorre Propuesto → Aprobado con alertas de precio peor visibles | 8–10 días |
| F2 Activación | Helper `activarBeneficio`, caja "¿Qué cargás?", portal recarga con beneficio + webhook | Un aprobado se activa por caja y por portal; nace la bolsa con su factura | 4–5 días |
| F3 Motor de precios | Fuente nueva, especificidad, % sobre lista, marca en la línea | Orden cotizada con precio pactado y traza "BENEFICIO"; sin beneficio ⇒ precio de siempre | 4–5 días |
| F4 Consumo | Selector por marca, cascada bolsa → común → pendiente, agotado automático, reversa | Última orden repartida en partes; bolsa en 0 ⇒ Agotado y tarifa normal | 5–6 días |
| F5 Administración y candados | Pausa/reanuda, cierre con transferencia, 360 total separado, candados 4.7 | Cada candado con su prueba de rechazo | 3–4 días |
| F6 Portal y cierre | Tarjetas, alertas, "te quedan ≈", reportes básicos (RN-BEN.33) | Recorrido completo desde el portal | 4–5 días |
| Pruebas E2E + deploy | Guía de pruebas, scripts prod, interruptor global | `GUIA_PRUEBAS_BENEFICIOS.md` + `DEPLOY_BENEFICIOS.md` | 4–5 días |

Total estimado: **34 a 43 días hábiles** de una persona (7 a 9 semanas), sujeto a revisión
al cerrar cada fase. F1 y F2 dan valor visible temprano (pactar, aprobar y cargar) aunque
F3/F4 sigan en curso, siempre que el interruptor global mantenga apagada la aplicación de
precios hasta que F3 y F4 estén probadas.

## 8. Pruebas (escenarios E2E mínimos, contra la base local)

1. Pacto a medida con un precio peor ⇒ alerta en el formulario, en la lista y en el detalle;
   aprobar exige nota.
2. Aprobado sin cargar ⇒ el precio de una orden nueva no cambia.
3. Carga en caja ⇒ bolsa creada con la factura; orden nueva del alcance sale a precio
   pactado y consume la bolsa; orden fuera del alcance no la toca.
4. Recarga desde el portal (Handy sandbox) ⇒ mismo resultado; webhook duplicado ignorado.
5. Dos beneficios sobre el mismo artículo ⇒ gana el específico; agotado ⇒ pasa al otro.
6. Última orden que supera la bolsa ⇒ partes bolsa + común + pendiente; tarifa intacta.
7. Especial 10 % y beneficio 8 % ⇒ el beneficio aplica lista −8 % y la alerta lo avisó.
8. Pausa ⇒ tarifa normal y saldo intacto; reanudar ⇒ vuelve.
9. Cierre con saldo ⇒ transferencia a la común; intentar activar con ese saldo ⇒ rechazo.
10. Candados: transferencia a bolsa, medio de pago con bolsa, consumo manual ajeno ⇒ rechazo.

## 9. Deploy (orden)

1. `add_beneficios.sql` en producción **antes** del deploy del código (el código referencia
   las columnas). `ConfiguracionGlobal.BENEFICIOS_ACTIVOS = 0`.
2. Deploy backend + frontend. Con el interruptor en 0: catálogo y pactos operan, el motor de
   precios y el consumo ignoran beneficios.
3. Piloto con 1–2 clientes y un beneficio predefinido interno; encender el interruptor.
4. Menú y permisos: entrada "Beneficios predefinidos" y "Beneficios pactados"; roles que
   aprueban.

Como siempre: los scripts SQL de producción los corre el usuario; nada se commitea ni migra
desde la sesión.

## 10. Riesgos

- **Cross-moneda** entre bolsa y orden (bolsa en US$, orden en $): usar la cotización del
  día y registrarla, como el resto de la billetera; validar redondeos con casos reales.
- **Órdenes editadas después** (`editarCostoOrden`, resync de precios): el re-cuadre del
  consumo ya existe para cuentas restringidas; probarlo con la marca de beneficio.
- **Semanales**: la común no descuenta al ingreso; el resto de la cascada va al ciclo. Hay
  que verificar que el cierre no re-facture la parte cubierta por la bolsa (usa la marca
  `CUBIERTO_CUENTA_`, ya excluida).
- **Archivo compartido** `RecursosView.jsx` con otra sesión: cambios aditivos, releer antes
  de editar.
- **Perfiles de beneficio visibles** en Perfiles de Precios: etiquetarlos y bloquear su
  asignación manual, o se podrían asignar sin bolsa.

## 11. Qué NO tocar

- Mensajes de WhatsApp (contenido y formato): no hay avisos nuevos en esta etapa.
- El rollo en metros (`PlanesMetros`) y su cascada: no cambia.
- La billetera común y el medio "Saldo de cuenta": solo se agregan exclusiones.

## 12. Estado de la implementación (9-set-2026)

Implementado completo en un worktree aparte (`C:/Integracion/User-Macrosoft/Proyecto-produccion-beneficios`,
rama `feature/beneficios`, base `main` en `53fdc9a`), **nada commiteado**. Todas las fases
F0–F6 de la §7 están hechas y probadas contra la base local; falta únicamente lo que le toca
al usuario: revisar el diff, mergear y desplegar (`scripts/DEPLOY_BENEFICIOS.md`).

- **F0 Modelo**: `scripts/add_beneficios.sql` (idempotente) corrido en local sin errores.
  Tablas `Beneficios`/`BeneficiosCliente`, `PerfilesPrecios.EsBeneficio`,
  `Ordenes.BclIdBeneficioCliente`, `PedidosCobranzaDetalle.BclIdBeneficioCliente`,
  `ConfiguracionGlobal.BENEFICIOS_ACTIVOS='0'`, menú `/beneficios/predefinidos` y
  `/beneficios/pactos` con permisos para roles 1/7/8/12.
- **F1 Catálogo + pacto + aprobación**: `beneficiosService.js` + `beneficiosController.js` +
  `beneficiosRoutes.js` (montadas en `/api/beneficios`); páginas `BeneficiosPredefinidos.jsx`,
  `BeneficiosPactados.jsx`, pestaña "Beneficios" en `VendedorCliente360.jsx`
  (`TabBeneficiosCliente.jsx`, `ModalPactarBeneficio.jsx`, `EditorReglasBeneficio.jsx`).
- **F2 Activación**: helper único `activarBeneficio()`; "¿Qué cargás?" en `ModalVentaSaldo`
  (`ContabilidadCuentasView.jsx`); portal `getMisBeneficios` / `iniciarRecargaBeneficio`
  (`webOrdersController.js`) + rama `beneficioId` en `_acreditarRecargaBilletera` + sección
  "Mis beneficios" en `RecursosView.jsx` del portal.
- **F3 Motor de precios**: fuente de beneficios en `pricingService.calculatePrice` antes de
  recargos, con `beneficioAplicado` en el resultado; `erpSyncService` sella
  `Ordenes.BclIdBeneficioCliente` y `PedidosCobranzaDetalle.BclIdBeneficioCliente`.
- **F4 Consumo**: `buscarCuentaAutoConsumoParaOrden` reconoce la bolsa por la marca de la
  orden; cascada bolsa → billetera común vía `planPartesParcialBeneficio`; agotado automático
  (`refrescarEstadoBolsa`); exclusión de bolsas en los caminos genéricos de consumo/transferencia.
- **F5 Administración y candados**: pausar/reanudar y cerrar (con transferencia a la común)
  desde el bloque "Beneficios" en `ContabilidadCuentasView.jsx`; candados en
  `transferirEntreCuentas`, `contabilidadController` (carga/consumo manual/retiro) y
  `webOrdersController` (cubrir con billetera); `ClienteBilletera.jsx` separa el chip de
  beneficios del saldo común.
- **F6 Portal**: sección "Mis beneficios" con comparación de precios y alertas, activación
  con Handy/MercadoPago + e-Ticket/e-Factura, badge de beneficio en las cuentas de "Mi
  billetera".
- **Perfiles de Precios**: los perfiles `EsBeneficio=1` se ocultan del listado/asignación
  (`profilesController.getAllProfiles`).
- **Pruebas E2E**: `node scripts/e2e` ad-hoc contra la base local (Pablo Celedon, CliIdCliente
  58) — 25/25 verificaciones OK: plantilla y pacto, aprobación (vendedor no aprueba lo suyo),
  dos beneficios superpuestos con especificidad correcta, consumo real vía
  `procesarEventoContable('ORDEN', …)`, cascada bolsa→común, resto pendiente en la principal
  sin mover el saldo real, agotado automático, caída al siguiente beneficio, pausa/reanudación,
  cierre con transferencia, vuelta a tarifa normal. Sin dejar datos de prueba: verificado que
  `Beneficios`, `BeneficiosCliente` y las cuentas `Beneficio:%` quedan en 0, y que las cuentas
  reales del cliente de prueba (principal y billetera común) terminan con el mismo saldo que
  al empezar. Detalle de qué recorrer a mano en la UI: `scripts/GUIA_PRUEBAS_BENEFICIOS.md`.
- **Build**: `npx vite build` del frontend del worktree, sin errores; todos los módulos de
  backend tocados cargan (`node --check` + `require()`) sin excepciones.
- **Pendiente (le toca al usuario)**: revisar el diff de `feature/beneficios` contra `main`,
  decidir los `IdRol` de aprobadores para su producción (el script trae 1/7/8/12 a modo de
  ejemplo), mergear, correr `add_beneficios.sql` en producción, desplegar con el interruptor
  en `'0'`, y el piloto de la §9 siguiendo `scripts/DEPLOY_BENEFICIOS.md`.
