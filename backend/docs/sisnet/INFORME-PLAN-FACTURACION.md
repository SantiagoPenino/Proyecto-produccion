# INFORME: Estado de la integración SISNET y plan para iniciar a facturar

*Elaborado: 03/07/2026 — basado en la documentación de `backend/docs/sisnet/` (Guía Rápida de Numeradores + spec `recepcionCFE` + ejemplos oficiales) contrastada contra el código actual.*

---

## 1. Resumen ejecutivo

**El sistema está técnicamente LISTO para facturar (≈90%).** La integración con SISNET (obtenerCAE + recepcionCFE) está implementada correctamente según su documentación y **ya funciona probada en el ambiente de test** (documentos "Aceptado DGI" con CAE, QR y verificación DGI reales).

**Lo que falta para producción NO es código: es administrativo/configuración**, y se hace POR EMPRESA (RUC):
1. Habilitación como emisor electrónico ante DGI (trámite con SISNET como proveedor).
2. Solicitar CAEs (numeradores) en la web de DGI y cargarlos en el panel de SISNET.
3. Credenciales/URL/caja de **producción** de SISNET → cargarlas en el ABM de Empresas.

Hay **3 brechas menores de código** detectadas al contrastar con la documentación (sección 5): IVA 10% no soportado en el envío, líneas con precio 0 (ya conocida), y receptor en e-Tickets de monto alto (a confirmar con SISNET). Ninguna bloquea el arranque si se opera con cuidado, pero conviene resolverlas.

---

## 2. Qué dice la documentación de SISNET (síntesis)

### 2.1 Flujo de numeradores (Guía Rápida — el documento clave operativo)
El modelo de SISNET es: **los CAEs viven en el sistema de SISNET**, no en el nuestro.
1. **En la web de DGI** (`servicios.dgi.gub.uy`, login con RUT+clave): menú *"eFactura – Constancia Comprobante Fiscal Electrónico – Solicitud"* → confirmar datos → elegir **tipo de comprobante** → **cantidad** de números → Confirmar → **descargar el XML** del CAE (vigencia ~2 años).
2. **En el panel web de SISNET**: *Mantenimientos Generales → Carga de Numeradores* → **seleccionar la Empresa** → Subir XML → Agregar.
3. Con los CAEs cargados, nuestro sistema pide números vía `obtenerCAE` y SISNET los va consumiendo del rango.

> Consecuencia: hay que solicitar y cargar CAEs **por tipo de comprobante** y **por empresa**, y **monitorear el stock** (columna "Disponibles" / "Asig. no Consumidos" en el panel) y su vencimiento.

### 2.2 API SOAP (spec + ejemplos)
- **`obtenerCAE`**: entrada `tipoCFE` (numérico, ej. 111) + `claveUnicaCaja` (ej. `1/TEST`) → devuelve `numero`, `numeroAutorizacion`, `serie`, `idInterno`. **Coincide 1:1 con nuestra implementación.**
- **`recepcionCFE`**: cuerpo con `wsCAE` (lo devuelto por obtenerCAE), `wsVarios`, `wsReceptor`, `wsTotales`, `listaWsItems`, `listaWsReferencias` (NC/ND). **Nuestra implementación cubre todo lo obligatorio.**
- Campos **opcionales que la spec ofrece y NO usamos** (oportunidades, no errores):
  - `listaWsAdendas` (etiquetas TIPOYNUMERO / OBSERVACION impresas en la representación del CFE — los ejemplos siempre las mandan).
  - `listaWsMediosPagos` (detalle de medios de pago).
  - `emailEnvioPdf` / `emailCuerpo` (**SISNET puede enviar el PDF por email al cliente**).
  - `simular` (bandera de simulación para pruebas).
  - `fdesdeServicio` / `fhastaServicio` (período del servicio — útil para facturas de cierre de ciclo; tenemos `DocFechaDesde/Hasta` en el documento).
  - `listaWsDescuentos`, retenciones/percepciones, `wsComplFiscal`.
- **Tipos de CFE en los ejemplos**: eTicket, eFactura, NC eFactura, **eRemito, eResguardo, eFactura/eRemito de Exportación**. Los últimos 4 NO están implementados (solo se necesitan si el negocio los requiere: remitos de traslado, resguardos de retenciones, exportación).

---

## 3. Estado de implementación (contraste doc ↔ código)

### ✅ Implementado y verificado (funciona en test)
| Área | Detalle |
|---|---|
| Conexión SOAP | `soap` + BasicAuth contra WSDL; test OK |
| obtenerCAE | `tipoCFE` + `claveUnicaCaja` — idéntico a la spec |
| recepcionCFE | wsCAE, wsVarios, wsReceptor (solo B2B), wsTotales, listaWsItems, listaWsReferencias |
| Tipos | e-Ticket (101), e-Factura (111), NC (102/112), ND (103/113) con referencia al doc original |
| Matemática DGI | neto/IVA 22% a 2 decimales, `montoItem = cantidad × precioUnitario`, `mntTotal = neto+IVA+noGrv` |
| Moneda | UYU/USD + `tpoCambio` (cotización BCU del sistema) |
| Resultado | CAE, serie/número real, vencimiento, hash, QR y `urlQR` guardados en el documento (`CfeNumeroOficial`, `CfeCAE`, `CfeUrlImpresion`) |
| Representación impresa | PDF con QR, URL de verificación DGI, "IVA al día", Nro. CAE, rango autorizado, vencimiento, código de seguridad |
| **Multiempresa** | Config SISNET por empresa (WSDL/user/pass cifrado/caja/tasas), selector de empresa en la factura, emisor y logo por empresa en el PDF, validación de empresa activa+caja antes de emitir, filtro por empresa en la bandeja |
| Flujo operativo | Bandeja CFE (pendientes→enviar→aceptado), edición de borradores, conversión Pedido Caja→CFE, NC/ND, anulación; pagos online generan Pedido Caja para revisión previa |

### ❌ No implementado (de la documentación)
| Qué | ¿Necesario para arrancar? |
|---|---|
| e-Remito / e-Resguardo / CFE de exportación | **No**, salvo que el negocio lo requiera |
| Adendas (TIPOYNUMERO/OBSERVACION) | No — hoy las observaciones van por `textoObservacion` y SISNET las acepta (probado) |
| Envío del PDF por email vía SISNET (`emailEnvioPdf`) | No — mejora de servicio al cliente |
| `fdesdeServicio/fhastaServicio` en facturas de ciclo | No — mejora de calidad del CFE |
| Medios de pago (`listaWsMediosPagos`) | No — opcional |
| Contingencia (CFC, si SISNET/DGI está caído) | No para arrancar — definir procedimiento manual |

---

## 4. PLAN PASO A PASO para iniciar a facturar

### FASE A — Trámites (una vez por EMPRESA/RUC) → *responsable: VOS + SISNET*
1. **Confirmar con SISNET la habilitación de cada RUC como emisor electrónico** ante DGI (postulación/homologación la gestiona SISNET como proveedor). Preguntar estado de: Empresa 1 (RUC 218973270018) y Empresa 2.
2. **Definir con SISNET la estructura de cuentas** (pregunta que quedó abierta): ¿una cuenta con una caja por RUC, o cuenta separada por RUC? → De ahí salen: URL WSDL de producción, usuario, contraseña y `claveUnicaCaja` **de cada empresa**.
3. **Acceso al panel web de SISNET de producción** (para cargar numeradores, ver Estado de CAEs, Reporte Diario, reimpresión).

### FASE B — Numeradores (por EMPRESA y por TIPO de comprobante) → *responsable: VOS*
4. En `servicios.dgi.gub.uy` (con RUT+clave de cada empresa): solicitar CAEs para **cada tipo** que vas a emitir:
   - e-Ticket, e-Factura, NC de e-Ticket, NC de e-Factura, ND de e-Ticket, ND de e-Factura.
   - Cantidad: estimá el volumen de ~1-2 años (la vigencia es ~2 años). Ej.: e-Ticket 5000, e-Factura 1000, NC/ND 500 c/u.
5. Descargar los **XML** de cada CAE.
6. En el **panel SISNET**: *Carga de Numeradores* → seleccionar la **empresa correcta** → subir cada XML → Agregar. Verificar en "Detalle de CAE Activos".

### FASE C — Configuración del sistema → *responsable: VOS (con mi ayuda si querés)*
7. Correr la migración multiempresa en producción (si aún no está): `add_Empresas_Multiempresa.sql` + `SISNET_ENC_KEY` en `.env`.
8. En **Configuración → Empresas**: cargar por empresa el **WSDL de producción**, usuario, contraseña (se cifra) y **caja de producción**. Completar RUC/razón social/dirección/logo (PNG).
9. Dejar la Empresa correcta como **"Por defecto"** y **activa** (la 2ª solo activarla cuando tenga sus CAEs cargados).

### FASE D — Prueba final en TEST (ya casi la tenés hecha) → *VOS*
10. Ciclo completo en test: factura manual → enviar → Aceptado DGI → verificar QR/URL en la web de DGI → NC de esa factura → PDF correcto (emisor/logo por empresa). *(Esto ya lo venís haciendo ✔)*

### FASE E — Switch a producción → *VOS*
11. Cambiar en el ABM de cada empresa la URL WSDL de test → **producción** (y credenciales/caja de producción). No hay que tocar código.
12. **Primer día controlado**: emitir 1 e-Ticket real de monto chico → verificar en DGI (QR) → recién después liberar el volumen.
13. Emitir los primeros comprobantes de cada tipo (e-Factura, NC) y verificarlos.

### FASE F — Operación diaria (rutina) → *VOS*
14. Bandeja CFE: enviar los PENDIENTES; **convertir los Pedidos Caja** de pagos online a CFE (¡no olvidarlos: sin conversión no hay comprobante fiscal!).
15. Vigilar **stock y vencimiento de CAEs** en el panel SISNET (y repetir FASE B cuando queden pocos).
16. Verificar el **Reporte Diario** a DGI (lo gestiona SISNET — confirmar, ver sección 6).
17. Ante rechazos: leer el mensaje de SISNET en el toast, corregir el documento (editar/NC) y reenviar.

---

## 5. Brechas de código detectadas (recomendadas antes de producción)

| # | Brecha | Riesgo | Esfuerzo |
|---|---|---|---|
| 1 | **IVA 10% (tasa mínima) NO soportado en el envío**: el modal de factura permite elegir "Mínimo 10%" en una línea, pero `sisnetService` manda todo lo gravado como **tasa básica 22%** (`indFact` solo 3 o 1; `mntNetoIvaTasaMin` siempre 0). Una línea al 10% saldría con IVA incorrecto ante DGI. | Alto si vendés algo al 10%; nulo si todo es 22% | Medio (mapear indFact=2 + totales de tasa mínima) — o **bloquear el 10% en la UI** (bajo) |
| 2 | **Líneas con precio 0**: DGI las rechaza (solo válidas con indicador 5 = entrega gratuita). Ya lo sufriste (ET-42). | Medio (rechazo con mensaje críptico) | Bajo (validación previa con mensaje claro) |
| 3 | **e-Ticket B2C sin receptor**: hoy nunca se manda `wsReceptor` en e-Tickets. La normativa DGI exige identificar al receptor en e-Tickets que superan cierto umbral en UI (el ejemplo de SISNET manda receptor con `tipoDocRecep=4` incluso en tickets). **Confirmar umbral y manejo con SISNET.** | Medio en ventas B2C de monto alto | Bajo-medio |
| 4 | `fchVenc` en crédito = hoy (no la fecha real de vencimiento) | Bajo | Bajo |
| 5 | Adendas / email del PDF / período de servicio en ciclos | Cosmético / mejora | Bajo c/u |

---

## 6. Qué pedirle a SISNET (lista concreta)

1. **Estado de habilitación DGI** de cada RUC (Empresa 1: 218973270018 y Empresa 2) como emisor electrónico. ¿Qué falta para cada uno?
2. **Estructura para 2 empresas**: ¿misma cuenta con 2 cajas, o 2 cuentas? Entregables por empresa: **URL WSDL de producción + usuario + contraseña + claveUnicaCaja**.
3. **Acceso al panel web** de SISNET (test y producción) para: Carga de Numeradores, Estado de CAEs, Estado Reporte Diario, Reimpresión de CFE.
4. **Confirmar que SISNET gestiona**: firma electrónica/certificado, envío a DGI, **Reporte Diario**, y la representación gráfica oficial ante contingencias.
5. **Umbral e identificación del receptor en e-Tickets** (¿desde qué monto exige DGI identificar al comprador y cómo lo espera SISNET — `tipoDocRecep` 3/4?).
6. **Procedimiento de contingencia** (si el WS de SISNET está caído: ¿CFC manual desde el panel?).
7. ¿El `textoObservacion` que enviamos en `wsVarios` se imprime en la representación del CFE, o conviene pasarlo a `listaWsAdendas` (OBSERVACION)?
8. Vigencia y renovación de CAEs: ¿avisan ellos cuando quedan pocos números o hay que monitorear el panel?

---

## 7. Checklist de lo que debés hacer VOS

- [ ] Llamar/escribir a SISNET con la lista de la sección 6.
- [ ] Por cada empresa: solicitar CAEs en la web DGI (6 tipos) y cargarlos en el panel SISNET (FASE B).
- [ ] Migración multiempresa + `SISNET_ENC_KEY` en producción (FASE C.7).
- [ ] Cargar credenciales/caja de producción por empresa en el ABM (FASE C.8).
- [ ] Decidir sobre las brechas: bloquear o soportar IVA 10% (recomiendo decidirlo antes del switch), validación precio 0, receptor e-Ticket.
- [ ] Prueba final en test + switch de URLs + primer comprobante real controlado (FASES D-E).
- [ ] Instalar la rutina diaria: enviar pendientes, convertir Pedidos Caja online, vigilar CAEs (FASE F).

---

## 8. PLAN: Umbral del receptor en e-Tickets + validación de RUC/Cédula

### 8.1 Estado actual (auditado)
- El umbral **ya existe pero solo en el cierre de ciclo** (`CierreCicloPreviewModal`): 10.000 UI × valor UI, configurable por `.env` del frontend (`VITE_DGI_LIMITE_UI`, `VITE_DGI_VALOR_UI`), convierte USD→UYU antes de comparar. ✔ bien hecho pero aislado.
- `CfeEditModal.jsx` tiene otra copia (hardcodeada, valor UI distinto, solo UYU) pero **es código muerto** (no se importa en ningún lado) → eliminar.
- `FacturacionManualModal` (el modal real de nueva/edición) **no valida umbral** y solo valida longitud del documento en algunos flujos (`FacturarAnticipoModal`: 8 dígitos ticket / 12 factura — sin dígito verificador).
- **Hueco crítico**: `sisnetService.emitirCFE` **nunca** envía `wsReceptor` en e-Tickets (tipos 101/102/103), sin importar el monto → aunque el cajero cargue la CI, **el dato no llega a DGI**. La validación actual es cosmética.

### 8.2 Algoritmos de validación (verificados)
- **RUT (12 dígitos), dígito verificador módulo 11**: pesos `[4,3,2,9,8,7,6,5,4,3,2]` sobre los primeros 11 dígitos; `DV = 11 − (suma mod 11)`; si da 11 → 0; si da 10 → RUT inválido. **Verificado contra 3 RUCs reales**: 218973270018 (empresa, DV 8 ✓), 215939820014 (test SISNET, DV 4 ✓), 210958750017 (doc SISNET, DV 7 ✓).
- **Cédula uruguaya (6-8 dígitos), DV módulo 10**: pad a 7 dígitos con ceros a la izquierda; pesos `[2,9,8,7,6,3,4]`; `DV = (10 − (suma mod 10)) mod 10`. (Algoritmo estándar publicado; validar en pruebas con 2-3 cédulas reales conocidas.)
- Normalización previa: quitar puntos, guiones y espacios; solo dígitos.

### 8.3 Fases

**FASE 1 — Config unificada (BD, sin rebuild):**
Claves nuevas en `ConfiguracionGlobal`: `DGI_LIMITE_UI` (=10000) y `DGI_VALOR_UI` (valor vigente de la UI, se actualiza a mano cuando cambia). Exponerlas por un endpoint liviano. El `.env` del frontend queda como fallback. *(La UI la publica el INE; opcional a futuro: job que la actualice.)*

**FASE 2 — Utilidad compartida `documentoUY`:**
`validarDocumentoUY(str) → { valido, tipo: 'RUT'|'CI', normalizado, motivo }` con los algoritmos de 8.2. Dos copias espejo: `src/utils/documentoUY.js` (frontend) y `backend/utils/documentoUY.js` (backend), con casos de prueba.

**FASE 3 — Frontend (FacturacionManualModal + flujos existentes):**
- Al guardar: si es **e-Factura** → RUT obligatorio y **con DV válido** (hoy solo se chequea que haya cliente).
- Si es **e-Ticket** y el total convertido a UYU supera el umbral → exigir documento del receptor (CI o RUT **válido**) con mensaje claro: *"E-Ticket mayor a $X (10.000 UI): ingresá C.I. o RUT del cliente"*.
- Si hay documento cargado (aunque no supere el umbral) → validar DV y avisar si es inválido.
- Repuntar el cierre de ciclo a la config de BD (fallback `.env`). Actualizar `FacturarAnticipoModal` a la utilidad. **Eliminar `CfeEditModal.jsx`** (muerto).

**FASE 4 — Backend (autoritativo + el fix que importa ante DGI):**
- `cfeController.enviarADGI`: validar ANTES de llamar a SISNET → e-Factura: RUT con DV válido; e-Ticket sobre umbral: documento válido presente. Mensajes claros (no el error críptico de SISNET).
- `sisnetService.emitirCFE`: **enviar `wsReceptor` también en e-Tickets** cuando exista documento válido del receptor → `tipoDocRecep = 2` (RUT) o `3` (CI). ⚠️ Confirmar con SISNET el código esperado para CI en tickets (su ejemplo usa `4`=Otros con `docRecep=0`); hasta esa respuesta, implementar detrás de una condición conservadora (enviar receptor solo si hay documento válido).
- Umbral en backend con la misma config de BD + cotización del día para USD.

**FASE 5 — Verificación (en SISNET test):**
1. e-Ticket chico sin receptor → pasa (como hoy). 2. e-Ticket sobre umbral sin documento → **bloqueado por nosotros** con mensaje claro. 3. e-Ticket sobre umbral con CI válida → pasa **y el CFE lleva wsReceptor**. 4. CI con DV incorrecto → bloqueado. 5. e-Factura con RUT con DV malo → bloqueado. 6. Documento USD equivalente sobre umbral → bloqueado sin doc (confirma conversión). 7. La prueba empírica del umbral del lado SISNET (subir montos sin receptor hasta que rechacen) para saber si ellos también validan.

**Dependencia externa (no bloquea Fases 1-3):** respuesta de SISNET sobre `tipoDocRecep` para CI en e-Ticket y si validan el umbral de su lado.

*Notas técnicas para el desarrollador (referencias): `backend/services/sisnetService.js` (SOAP), `backend/controllers/cfeController.js` (`enviarADGI`, guarda CAE/QR vía `actualizarFirmaCFE`), ABM empresas en `/admin/database` → Configuración → Empresas, bandeja en `/contabilidad/bandeja-cfe`.*
