-- =====================================================================
-- TIEMPO DE ENTREGA DE IMPRESIÓN DIRECTA (SOLO NORMAL, 96 HORAS)
-- =====================================================================
-- El form del portal muestra "Tiempo estimado de entrega normal: 96 horas"
-- debajo de la prioridad. Directa NO lleva fila 'Urgente': el área no tiene
-- urgencia activa (el perfil "Recargo por Urgencias" solo incluye
-- DTF/Sublimacion/ECOUV) y el portal ahora oculta el botón Urgente para
-- las áreas fuera de ese perfil (cambio de código, va con el deploy).
--
-- Idempotente: si la fila ya existe, no hace nada.

IF NOT EXISTS (
    SELECT 1 FROM ConfiguracionTiemposEntrega
    WHERE AreaID = 'DIRECTA' AND Prioridad = 'Normal'
)
INSERT INTO ConfiguracionTiemposEntrega (AreaID, Prioridad, Horas, Dias, Texto)
VALUES ('DIRECTA', 'Normal', 96, 0, NULL);

-- Verificación
SELECT * FROM ConfiguracionTiemposEntrega WHERE AreaID = 'DIRECTA';

-- Verificación de la config de urgencia (NO cambiar acá, es solo control):
-- la Categoria del perfil de urgencia define qué áreas ofrecen/cobran urgente.
SELECT pp.ID, pp.Nombre, pp.Categoria
FROM PerfilesPrecios pp
WHERE pp.ID = (SELECT CAST(Valor AS INT) FROM ConfiguracionGlobal WHERE Clave = 'ID_PERFIL_URGENCIA');
