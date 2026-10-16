/* =====================================================================
   NOMENCLADOR DE FALLAS — completar motivos reales por área (Spec 39)
   ---------------------------------------------------------------------
   La tabla TiposFallas es EL nomenclador que ya lee el formulario de "Reportar
   falla o faltante" (fileControlService.getTiposFalla(area)). Hoy EMB/EST/TWC/TWT
   solo tienen 4 motivos genéricos de placeholder (puestos al armar Spec 39, sin
   historial previo de fallas en esas áreas para copiar de ahí).

   CÓMO USAR: completá la lista de @Motivos de cada área con los motivos reales
   (uno por línea, separados por '|') y corré el bloque de esa área. Es aditivo
   e idempotente: no duplica si el título ya existe, y NO borra los 4 genéricos
   actuales (podés borrarlos vos a mano después si ya no hacen falta, con
   DELETE FROM TiposFallas WHERE FallaID IN (47,48,49,50) — revisá antes que no
   se hayan usado en ninguna FallasProduccion.TipoFalla real).
   ===================================================================== */
SET NOCOUNT ON;

-- ─── BORDADO (EMB) — completar y descomentar ────────────────────────────
-- Sugerencia mía (NO confirmada por el usuario, reemplazar por la lista real del
-- taller antes de correr): Hilo cortado o roto, Bordado corrido o descuadrado,
-- Puntada floja o saltada, Bastidor mal puesto, Diseño o color de hilo incorrecto,
-- Tela perforada o rota por la aguja, Mancha de aceite o grasa de máquina.
/*
DECLARE @MotivosEMB NVARCHAR(MAX) = 'Motivo real 1|Motivo real 2';
INSERT INTO TiposFallas (AreaID, Titulo)
SELECT 'EMB', TRIM(value) FROM STRING_SPLIT(@MotivosEMB, '|')
WHERE NOT EXISTS (SELECT 1 FROM TiposFallas t WHERE t.AreaID = 'EMB' AND t.Titulo = TRIM(value));
*/

-- ─── ESTAMPADO (EST) — completar y descomentar ──────────────────────────
/*
DECLARE @MotivosEST NVARCHAR(MAX) = 'Motivo real 1|Motivo real 2';
INSERT INTO TiposFallas (AreaID, Titulo)
SELECT 'EST', TRIM(value) FROM STRING_SPLIT(@MotivosEST, '|')
WHERE NOT EXISTS (SELECT 1 FROM TiposFallas t WHERE t.AreaID = 'EST' AND t.Titulo = TRIM(value));
*/

-- ─── CORTE LÁSER (TWC) — completar y descomentar ────────────────────────
/*
DECLARE @MotivosTWC NVARCHAR(MAX) = 'Motivo real 1|Motivo real 2';
INSERT INTO TiposFallas (AreaID, Titulo)
SELECT 'TWC', TRIM(value) FROM STRING_SPLIT(@MotivosTWC, '|')
WHERE NOT EXISTS (SELECT 1 FROM TiposFallas t WHERE t.AreaID = 'TWC' AND t.Titulo = TRIM(value));
*/

-- ─── TALLER COSTURA (TWT) — completar y descomentar ─────────────────────
/*
DECLARE @MotivosTWT NVARCHAR(MAX) = 'Motivo real 1|Motivo real 2';
INSERT INTO TiposFallas (AreaID, Titulo)
SELECT 'TWT', TRIM(value) FROM STRING_SPLIT(@MotivosTWT, '|')
WHERE NOT EXISTS (SELECT 1 FROM TiposFallas t WHERE t.AreaID = 'TWT' AND t.Titulo = TRIM(value));
*/

-- Verificación: motivos actuales por área
SELECT AreaID, FallaID, Titulo FROM TiposFallas WHERE AreaID IN ('EMB','EST','TWC','TWT') ORDER BY AreaID, FallaID;
