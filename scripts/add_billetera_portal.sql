-- ============================================================================
-- BILLETERA VISIBLE EN EL PORTAL - POR CLIENTE (01-09-2026)
-- La seccion "Mi billetera" del portal (Mis Recursos) y sus acciones (recargar,
-- movimientos, PDF, "Cubrir con mi billetera", "Mi saldo") solo aparecen para
-- los clientes que administracion habilite.
--   Clientes.CliBilleteraPortal BIT - 0 = oculta (default para TODOS), 1 = visible.
-- Se habilita desde el 360 -> boton "Cuentas" -> switch "Billetera visible en el portal".
-- OJO: el flag es SOLO de visibilidad en el portal; el descuento automatico del
-- motor sigue funcionando igual (una billetera con saldo descuenta aunque el
-- cliente no la vea en la web).
-- Idempotente. Correr en PROD junto con los demas scripts de billetera (orden 5).
-- ============================================================================
IF COL_LENGTH('dbo.Clientes', 'CliBilleteraPortal') IS NULL
    ALTER TABLE dbo.Clientes
        ADD CliBilleteraPortal BIT NOT NULL CONSTRAINT DF_Clientes_BilleteraPortal DEFAULT (0);
GO

SELECT 'Clientes con billetera visible en el portal' AS Que, COUNT(*) AS N
FROM dbo.Clientes WHERE CliBilleteraPortal = 1;
GO
