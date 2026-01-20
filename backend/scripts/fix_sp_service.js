const { getPool } = require('../config/db');

async function updateSP() {
    try {
        const pool = await getPool();
        console.log("🛠️ Actualizando sp_PredecirProximoServicio...");

        await pool.request().query(`
            CREATE OR ALTER PROCEDURE [dbo].[sp_PredecirProximoServicio]
                @OrdenID INT
            AS
            BEGIN
                SET NOCOUNT ON;

                DECLARE @NoDocERP VARCHAR(50);
                DECLARE @CodigoOrden VARCHAR(100);
                DECLARE @SecuenciaActual INT;
                DECLARE @TotalPasos INT;
                DECLARE @ProximoServicio VARCHAR(100);

                -- 1. Obtener datos de la orden actual
                SELECT 
                    @NoDocERP = NoDocERP, 
                    @CodigoOrden = CodigoOrden
                FROM dbo.Ordenes 
                WHERE OrdenID = @OrdenID;

                -- 2. Parsear la secuencia (X/Y) del CodigoOrden
                -- Ejemplo: "48 (1/4)" -> SecuenciaActual=1, TotalPasos=4
                BEGIN TRY
                    IF CHARINDEX('(', @CodigoOrden) > 0 AND CHARINDEX(')', @CodigoOrden) > 0
                    BEGIN
                        DECLARE @ParentesisContent VARCHAR(20);
                        SET @ParentesisContent = SUBSTRING(
                            @CodigoOrden, 
                            CHARINDEX('(', @CodigoOrden) + 1, 
                            CHARINDEX(')', @CodigoOrden) - CHARINDEX('(', @CodigoOrden) - 1
                        );
                        
                        -- @ParentesisContent es "1/4"
                        SET @SecuenciaActual = CAST(LEFT(@ParentesisContent, CHARINDEX('/', @ParentesisContent) - 1) AS INT);
                        SET @TotalPasos = CAST(SUBSTRING(@ParentesisContent, CHARINDEX('/', @ParentesisContent) + 1, LEN(@ParentesisContent)) AS INT);
                    END
                END TRY
                BEGIN CATCH
                    -- Si falla el parseo, asumimos que es paso único
                    SET @SecuenciaActual = 1;
                    SET @TotalPasos = 1;
                END CATCH

                -- 3. Determinar Próximo Servicio
                IF @SecuenciaActual < @TotalPasos
                BEGIN
                    -- Buscar la orden que tenga el paso siguiente (SecuenciaActual + 1)
                    DECLARE @SiguienteSecuencia INT = @SecuenciaActual + 1;
                    DECLARE @SufijoBuscado VARCHAR(20) = '(' + CAST(@SiguienteSecuencia AS VARCHAR) + '/' + CAST(@TotalPasos AS VARCHAR) + ')';
                    
                    SELECT TOP 1 @ProximoServicio = AreaID
                    FROM dbo.Ordenes
                    WHERE NoDocERP = @NoDocERP
                      AND CodigoOrden LIKE '%' + @SufijoBuscado
                      AND OrdenID <> @OrdenID; -- Por seguridad
                END

                -- 4. Si no hay siguiente paso o no se encontró la orden, es DEPOSITO
                IF @ProximoServicio IS NULL OR @ProximoServicio = ''
                BEGIN
                    SET @ProximoServicio = 'DEPOSITO';
                END

                -- 5. Actualizar la orden
                UPDATE dbo.Ordenes 
                SET ProximoServicio = @ProximoServicio 
                WHERE OrdenID = @OrdenID;

                SELECT @ProximoServicio AS Prediccion;
            END
        `);

        console.log("✅ SP Actualizado con lógica basada en secuencia (X/Y).");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error actualizando SP:", error);
        process.exit(1);
    }
}

updateSP();
