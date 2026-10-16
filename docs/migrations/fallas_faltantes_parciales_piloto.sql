/* =====================================================================
   FALLAS, FALTANTES Y ENTREGAS PARCIALES — Activación por piloto (Spec 39)
   ---------------------------------------------------------------------
   Corré esto DESPUÉS de fallas_faltantes_parciales.sql (modelo de datos) y
   fallas_faltantes_parciales_menu.sql (menú), y solo cuando ya se probó en el
   área piloto. Los switches nacen apagados (vacíos); este script los prende
   SOLO para las áreas que se pasen en @AreasParcial / @AreasCadena.

   AREAS_DESPACHO_PARCIAL: áreas donde la bandeja ofrece "enviar parcial" (con o
                            sin falla) en vez de exigir todo junto. NUNCA agrega
                            DEPOSITO (invariante dura: depósito solo recibe pedidos
                            completos — ver validarLibroParaDeposito).
   AREAS_CADENA_REPOSICION: áreas donde reportar un FALTANTE ofrece la cadena hacia
                             atrás (creación de -F en las áreas previas del pedido).

   Ejemplo (piloto sugerido: Corte Láser y Taller Costura):
     EXEC este script con @AreasParcial = 'TWC,TWT', @AreasCadena = 'TWC,TWT'
   Ejemplo para desactivar todo (volver al comportamiento de hoy):
     @AreasParcial = '', @AreasCadena = ''
   ===================================================================== */
SET NOCOUNT ON;

-- ─── EDITAR ANTES DE CORRER ───────────────────────────────────────────
-- 17-sep-2026: mismos valores que la base LOCAL donde se hicieron las 46 pruebas.
-- DIRECTA ya lo tenía en prod: el UPDATE pisa el valor entero, así que hay que repetirla acá o la pierde.
DECLARE @AreasParcial NVARCHAR(200) = 'DIRECTA,SB,TWC,TWT,EMB';   -- despacho parcial: Directa, Sublimación, Corte, Costura, Bordado
DECLARE @AreasCadena  NVARCHAR(200) = 'TWC,TWT,EMB,EST,PRO';      -- cadena de faltante: Corte, Costura, Bordado, Estampado, Producción (incluye el PRO de areas_cadena_reposicion_agregar_pro.sql)
-- ───────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AREAS_DESPACHO_PARCIAL')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AREAS_DESPACHO_PARCIAL', 'ADMIN', @AreasParcial);
ELSE
    UPDATE dbo.ConfiguracionGlobal SET Valor = @AreasParcial WHERE Clave = 'AREAS_DESPACHO_PARCIAL';

UPDATE dbo.ConfiguracionGlobal SET Valor = @AreasCadena WHERE Clave = 'AREAS_CADENA_REPOSICION';

SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WHERE Clave IN ('AREAS_DESPACHO_PARCIAL', 'AREAS_CADENA_REPOSICION', 'PLAZO_SOLICITUD_INSUMO_DIAS', 'AREAS_FALLA_BANDEJA');
