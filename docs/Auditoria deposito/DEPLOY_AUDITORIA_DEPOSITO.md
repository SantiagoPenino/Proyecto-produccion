# DEPLOY — Auditoría de Depósito: sesión + fotografía + registro de casos

Estado al 2026-09-06: **Fases 0 a 5 hechas y probadas en local (47 comprobaciones), nada en producción, nada commiteado.**

## 1. Qué cambia

| Capa | Archivo | Qué hace |
|---|---|---|
| SQL (prod, una vez) | `scripts/add_auditoria_deposito.sql` | 5 tablas `AuditoriaDeposito*`, 3 índices únicos filtrados, 8 claves de `ConfiguracionGlobal`. Idempotente. No toca `OrdenesDeposito`. |
| Backend nuevo | `backend/services/auditoriaDepositoService.js` | abrir (fotografía), escanear (resuelve la orden), cerrar (detección + fusión + auto-cierre en una transacción), anular, casos (responsable, fecha límite, filtros), historial |
| Backend nuevo | `backend/services/auditoriaDepositoReportesService.js` | Fase 4 reportes (`GET /reportes?audId=`), Fase 5 conteo cíclico (`GET /ciclico`), usuarios internos (`GET /usuarios`) |
| Frontend nuevo | `src/components/pages/AuditDepositoReportesTab.jsx` | pestaña Reportes: ejecutivo / completo, Imprimir-PDF, Excel multi-hoja |
| Frontend nuevo | `src/components/pages/AuditDepositoCiclicoTab.jsx` | pestaña Conteo cíclico: ABC por área, vencimientos, "Auditar solo X" |
| Backend nuevo | `backend/services/auditDepositoSql.js` | `clavesDeCodigo` + lógica de pago vía documento, movidas tal cual desde el controller |
| Backend nuevo | `backend/controllers/auditDepositoCasosController.js` | endpoints `/sesion*`, `/auditorias*`, `/casos*`, `/prefijos` |
| Backend editado | `backend/controllers/auditDepositoController.js` | `/init` `/check` `/live` `/live/remove` `/live/clear` pasan a modo sesión cuando hay una auditoría abierta; sin fallback a usuario 1; IN escapado |
| Backend editado | `backend/routes/auditDepositoRoutes.js` | bloquea tokens de cliente; rutas nuevas |
| Frontend nuevo | `src/components/pages/AuditDepositoSesionBar.jsx` | barra abrir / cerrar / anular + resumen del cierre |
| Frontend nuevo | `src/components/pages/AuditDepositoCasosTab.jsx` | pestaña Registro de Casos: KPIs, filtros, lote, línea de tiempo, historial, Excel |
| Frontend editado | `src/components/pages/AuditDepositoView.jsx` | barra de sesión, pestaña nueva, "Sin escanear" en vez de "Extraviadas", aviso por cada escaneo |
| Pruebas | `backend/scripts/test_auditoria_deposito_casos.js` | 36 comprobaciones contra la base LOCAL. **No correr en producción** |

## 2. Pasos en producción (en este orden)

1. **Correr el SQL** en `SecureAppDB` (SSMS, con el usuario de siempre):
   ```
   scripts/add_auditoria_deposito.sql
   ```
   Tiene que imprimir `Creada dbo.AuditoriaDeposito … add_auditoria_deposito.sql: OK`. Si se corre dos veces no pasa nada.
   Verificación rápida:
   ```sql
   SELECT name, has_filter, filter_definition FROM sys.indexes
   WHERE OBJECT_NAME(object_id) LIKE 'AuditoriaDeposito%' AND is_unique = 1;
   SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WHERE Clave LIKE 'AUDIT_DEP%' OR Clave = 'DIAS_MAX_DEPOSITO';
   ```
   Si `DIAS_MAX_DEPOSITO` ya existía con otro valor, se respeta.

2. **Deploy del backend** (los archivos de la tabla) y reinicio del servicio.
   Chequeo: `GET /api/audit-deposito/sesion` con un token interno devuelve `{ success: true, sesion: null, … }`.

3. **Deploy del frontend** (build normal).
   Chequeo: en *Logística → Auditoría de Depósito* aparece la barra "No hay ninguna auditoría abierta" con el botón
   "Abrir auditoría (tomar fotografía)" y las pestañas "Registro de Casos", "Reportes" y "Conteo cíclico".

## 2b. Cómo probarlo en LOCAL antes de producción

1. El SQL ya está aplicado en la base local (se puede volver a correr, no pasa nada).
2. Reiniciar el backend local (`node server.js` en `backend/`; el que está corriendo no tiene el código nuevo).
3. Entrar a *Logística → Auditoría de Depósito*:
   - **Abrir auditoría** (depósito completo) → la barra muestra la fotografía y los contadores.
   - Escanear con la pistola o escribir códigos (`SUB-1234`, `1234`, `1234/B5678`): cada lectura avisa qué es
     (OK / figura entregada / sin ingreso / desconocido / repetida).
   - Pestaña **Sin escanear**: lo que falta leer. No son extraviadas.
   - **Cerrar auditoría y generar casos** → resumen: nuevos / ya estaban / reincidentes / resueltos / abiertos.
   - Pestaña **Registro de Casos**: KPIs, filtros, desplegar un caso (historia), acciones, lote, asignar responsable y fecha límite.
   - Pestaña **Reportes**: elegir la auditoría o "foto en vivo", ejecutivo / completo, Imprimir-PDF, Excel.
   - Pestaña **Conteo cíclico**: clase ABC por área, vencimientos, "Auditar solo X".
   - Abrir otra auditoría y volver a cerrar: los casos que siguen igual **no se duplican** (suben "veces").
4. Prueba automática del motor (solo local, deja la base limpia):
   ```
   node backend/scripts/test_auditoria_deposito_casos.js
   ```

4. **Primera auditoría real** (línea base): abrir con alcance "Depósito completo", escanear TODO, cerrar.
   Va a crear de golpe los faltantes/sobrantes/sin ingreso reales. Es lo esperado. Desde la segunda auditoría
   se activan solos "Sin aviso" y "Excede plazo".

## 3. Orden inverso (si hay que volver atrás)
- El frontend viejo y el backend viejo siguen funcionando con las tablas nuevas presentes (no las usan).
- Si hay una auditoría ABIERTA y se vuelve al backend viejo, los escaneos de esa sesión no se ven en la pantalla vieja
  (quedan guardados en `AuditoriaDepositoEscaneo`). Antes de volver atrás: cerrarla o anularla.
- Para borrar las tablas (solo si se descarta todo): `DROP TABLE` en orden Evento → Caso → Escaneo → Snapshot → AuditoriaDeposito.

## 4. Parámetros ajustables (ConfiguracionGlobal)
| Clave | Default | Para qué |
|---|---|---|
| `DIAS_MAX_DEPOSITO` | 15 | Caducadas y casos PERMANENCIA |
| `AUDIT_DEP_UMBRAL_VALOR_ALTA` | 5000 ($) | FALTANTE con valor mayor → severidad ALTA |
| `AUDIT_DEP_DIAS_SIN_AVISO` | 3 | días en depósito sin aviso WSP para abrir SIN_AVISO |
| `AUDIT_DEP_TIPOS_ACTIVOS` | los 6 | qué tipos generan caso (la línea base ignora SIN_AVISO y PERMANENCIA) |
| `AUDIT_DEP_CICLICO_DIAS_A` / `_B` / `_C` | 7 / 14 / 30 | conteo cíclico: cada cuántos días auditar un área según su clase |
| `AUDIT_DEP_ABC_CORTES` | 80,95 | % acumulado del valor en depósito: hasta 80 = clase A, hasta 95 = B, resto = C |

Los cambios de configuración se leen al abrir cada auditoría (quedan guardados en la sesión).
