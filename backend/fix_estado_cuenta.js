require('dotenv').config();
const { getPool, sql } = require('./config/db');

async function fixEstadoCuenta() {
    try {
        const pool = await getPool();
        
        await pool.request().query(`
            DECLARE @CueUSD INT;
            SELECT @CueUSD = CueIdCuenta FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = 67;
            
            IF @CueUSD IS NOT NULL
            BEGIN
                UPDATE dbo.CuentasCliente
                SET CueSaldoActual = CueSaldoActual + 19.14
                WHERE CueIdCuenta = @CueUSD;
                
                DECLARE @NuevoSaldo DECIMAL(18,2);
                SELECT @NuevoSaldo = CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUSD;
                
                INSERT INTO dbo.MovimientosCuenta (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado)
                VALUES (@CueUSD, 'PAGO', 'Ajuste interno por Factura Web UYU ET-4', 19.14, @NuevoSaldo, 6, GETDATE(), 1, 0);
            END
        `);
        
        console.log("Estado de cuenta en USD arreglado.");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

fixEstadoCuenta();
