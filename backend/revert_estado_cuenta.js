require('dotenv').config();
const { getPool, sql } = require('./config/db');

async function revertirEstadoCuenta() {
    try {
        const pool = await getPool();
        
        await pool.request().query(`
            DECLARE @CueUSD INT;
            SELECT @CueUSD = CueIdCuenta FROM dbo.MovimientosCuenta WHERE MovConcepto = 'Ajuste interno por Factura Web UYU ET-4';
            
            IF @CueUSD IS NOT NULL
            BEGIN
                -- Restar el saldo que habíamos sumado
                UPDATE dbo.CuentasCliente
                SET CueSaldoActual = CueSaldoActual - 19.14
                WHERE CueIdCuenta = @CueUSD;
                
                -- Borrar el movimiento incorrecto
                DELETE FROM dbo.MovimientosCuenta
                WHERE MovConcepto = 'Ajuste interno por Factura Web UYU ET-4';
            END
        `);
        
        console.log("Cambio en estado de cuenta USD revertido exitosamente.");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

revertirEstadoCuenta();
