const { sql, getPool } = require('../config/db');
const PricingService = require('./pricingService');

class LabelGenerationService {

    /**
     * Valida y regenera etiquetas para una orden.
     * Centraliza:
     * 1. Validaciones (Magnitud > 0, datos completos).
     * 2. Recálculo de Precio (Con PricingService, Perfiles Extra).
     * 3. Búsqueda inteligente de datos (Articulos, Clientes).
     * 4. Formato QR ($*).
     * 5. Transacción DB (Delete + Insert).
     */
    static async regenerateLabelsForOrder(ordenId, userId, userName, cantidadManual = null) {
        let transaction;
        try {
            const pool = await getPool();

            // 1. Obtener Info Orden Actual
            const orderRes = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query("SELECT * FROM Ordenes WHERE OrdenID = @OID");

            if (orderRes.recordset.length === 0) {
                return { success: false, error: 'Orden no encontrada' };
            }
            const o = orderRes.recordset[0];

            // --- VALIDACIONES DE NEGOCIO ---

            // Validar Magnitud
            const magnitudStr = o.Magnitud || '';
            let magnitudValor = 0;
            if (typeof magnitudStr === 'number') magnitudValor = magnitudStr;
            else if (magnitudStr) {
                const match = magnitudStr.toString().match(/[\d\.]+/);
                if (match) magnitudValor = parseFloat(match[0]);
            }

            if (magnitudValor <= 0) {
                return { success: false, error: `No se pueden generar etiquetas: La magnitud es 0 o inválida (${magnitudStr}).` };
            }

            // --- PREPARACIÓN DE DATOS INTELIGENTE ---

            // A. Identificar Pedido Base (ej: "69" de "69 (1/1)")
            const baseOrderMatch = o.CodigoOrden ? o.CodigoOrden.match(/^(\d+)/) : null;
            const baseOrderNum = baseOrderMatch ? baseOrderMatch[1] : o.CodigoOrden;

            // B. Recuperar/Validar ID Producto React
            let finalIdProdReact = o.IdProductoReact || 0;
            if ((!finalIdProdReact || finalIdProdReact == 0) && o.CodArticulo) {
                try {
                    const safeCod = o.CodArticulo.toString().trim();
                    const artRes = await pool.request()
                        .input('Cod', sql.VarChar, safeCod)
                        .query("SELECT TOP 1 IDProdReact FROM Articulos WHERE LTRIM(RTRIM(CodArticulo)) = LTRIM(RTRIM(@Cod))");

                    if (artRes.recordset.length > 0 && artRes.recordset[0].IDProdReact) {
                        finalIdProdReact = artRes.recordset[0].IDProdReact;
                        // Auto-fix DB
                        await pool.request()
                            .input('IDP', sql.Int, finalIdProdReact)
                            .input('OID', sql.Int, ordenId)
                            .query("UPDATE Ordenes SET IdProductoReact = @IDP WHERE OrdenID = @OID");
                        console.log(`[LabelService] IDProdReact recuperado: ${finalIdProdReact}`);
                    }
                } catch (e) { console.error("[LabelService] Error looking up Article:", e.message); }
            }

            // C. CALCULO DE PRECIO (Consolidado)
            // Buscar todas las órdenes del mismo pedido para sumar precio
            const siblingsRes = await pool.request()
                .input('BasePattern', sql.VarChar, `${baseOrderNum} (%`)
                .input('BaseExact', sql.VarChar, baseOrderNum)
                .query("SELECT * FROM Ordenes WHERE CodigoOrden = @BaseExact OR CodigoOrden LIKE @BasePattern");

            const siblings = siblingsRes.recordset;
            let totalPriceSum = 0;

            for (const sib of siblings) {
                try {
                    // Resolver ID Cliente
                    let internalClientId = null;
                    if (sib.Cliente) {
                        const clientRes = await pool.request()
                            .input('NombreCliente', sql.NVarChar, sib.Cliente)
                            .query("SELECT TOP 1 CodCliente FROM Clientes WHERE LTRIM(RTRIM(Nombre)) = LTRIM(RTRIM(@NombreCliente))");
                        if (clientRes.recordset.length > 0) internalClientId = clientRes.recordset[0].CodCliente;
                    }

                    // Perfiles Extra
                    const extraProfiles = [];
                    // Urgencia -> ID 2
                    if (sib.Prioridad && sib.Prioridad.toLowerCase().includes('urgente')) {
                        extraProfiles.push(2);
                    }
                    // Tinta -> ID 3 (Solo si explicitamente hay tinta especial, asumimos UV/Latex por ahora, logic ajustable)
                    if (sib.Tinta && (sib.Tinta.toUpperCase().includes('UV') || sib.Tinta.toUpperCase().includes('LATEX'))) {
                        extraProfiles.push(3);
                    }

                    // Calcular
                    const priceResult = await PricingService.calculatePrice(
                        sib.CodArticulo || '',
                        sib.Magnitud || 1,
                        internalClientId,
                        extraProfiles
                    );

                    const costoCalculado = priceResult.precioTotal || 0;

                    // Update DB (Side effect OK)
                    // Hacemos update por querier directo
                    await pool.request()
                        .input('Cost', sql.Decimal(18, 2), costoCalculado)
                        .input('SibID', sql.Int, sib.OrdenID)
                        .query("UPDATE Ordenes SET CostoTotal = @Cost WHERE OrdenID = @SibID");

                    totalPriceSum += costoCalculado;

                } catch (errCalc) {
                    console.error(`[LabelService] Error precio Orden ${sib.OrdenID}:`, errCalc.message);
                    totalPriceSum += (sib.CostoTotal || 0); // Fallback
                }
            }

            // --- GENERACIÓN DEL STRING QR ($*) ---
            // PEDIDO$*IDCLIENTEREACT$*TRABAJO$*URGENCIA$*IDPRODUCTOREACT$*CANTIDAD$*IMPORTE
            const qrPedido = baseOrderNum;
            const qrCliente = o.IdClienteReact || '0';
            const qrTrabajo = (o.DescripcionTrabajo || '').replace(/\$\*/g, ' ').trim();
            const isUrgent = (o.Prioridad && (o.Prioridad.toLowerCase().includes('urgente') || o.Prioridad.toLowerCase().includes('alta')));
            const qrUrgencia = isUrgent ? '2' : '1';
            const qrProducto = finalIdProdReact || '0';
            const qrCantidad = o.Magnitud || '1';
            const qrImporte = totalPriceSum.toFixed(2);

            const SEP = '$*';
            const qrString = `${qrPedido}${SEP}${qrCliente}${SEP}${qrTrabajo}${SEP}${qrUrgencia}${SEP}${qrProducto}${SEP}${qrCantidad}${SEP}${qrImporte}`;

            // Validar integridad basica del QR antes de guardar
            if (!qrPedido || qrPedido === '0') console.warn("[LabelService] Advertencia: Pedido es 0");

            // --- CALCULO CANTIDAD ETIQUETAS ---
            let cantidad = cantidadManual;

            if (!cantidad || cantidad < 1) {
                // Lógica Metros/Bulto
                try {
                    const configRes = await pool.request()
                        .input('Clave', sql.VarChar(50), 'METROSBULTOS')
                        .input('AreaID', sql.VarChar(20), o.AreaID || 'GEN')
                        .query(`SELECT TOP 1 Valor FROM ConfiguracionGlobal WHERE Clave = @Clave AND (AreaID = @AreaID OR AreaID = 'ADMIN') ORDER BY CASE WHEN AreaID = @AreaID THEN 1 ELSE 2 END ASC`);

                    let metrosPorBulto = 60;
                    if (configRes.recordset.length > 0) metrosPorBulto = parseFloat(configRes.recordset[0].Valor) || 60;

                    // Sumar metros archivos OK
                    const metrosRes = await pool.request()
                        .input('OID', sql.Int, ordenId)
                        .query(`SELECT SUM(ISNULL(Copias, 1) * ISNULL(Metros, 0)) as TotalMetos FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo IN ('OK', 'Finalizado')`);

                    const totalMetros = metrosRes.recordset[0].TotalMetos || 0;
                    if (totalMetros > 0) cantidad = Math.ceil(totalMetros / metrosPorBulto);
                    else cantidad = 1;
                } catch (e) {
                    cantidad = 1; // Fallback seguro
                }
            }

            const totalBultos = parseInt(cantidad);

            // --- TRANSACCION DB ---
            transaction = new sql.Transaction(pool);
            await transaction.begin();

            // 1. Borrar Viejas
            await new sql.Request(transaction).input('OID', sql.Int, ordenId).query("DELETE FROM Etiquetas WHERE OrdenID = @OID");

            // 2. Insertar Nuevas
            const proximoServicio = (o.ProximoServicio || 'DEPOSITO').trim().toUpperCase();
            const esUltimoServicio = proximoServicio.includes('DEPOSITO') || proximoServicio === '';
            const tipoBulto = esUltimoServicio ? 'PROD_TERMINADO' : 'EN_PROCESO';

            for (let i = 1; i <= totalBultos; i++) {
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .input('Num', sql.Int, i)
                    .input('Tot', sql.Int, totalBultos)
                    .input('QR', sql.NVarChar(sql.MAX), qrString) // v3 String
                    .input('User', sql.VarChar(100), userName)
                    .input('Area', sql.VarChar(20), o.AreaID || 'GEN')
                    .input('UID', sql.Int, userId)
                    .input('Job', sql.NVarChar(255), qrTrabajo)
                    .input('Tipo', sql.VarChar(50), tipoBulto)
                    .query(`
                        INSERT INTO Etiquetas(OrdenID, NumeroBulto, TotalBultos, CodigoQR, FechaGeneracion, Usuario)
                        VALUES(@OID, @Num, @Tot, @QR, GETDATE(), @User);

                        DECLARE @NewID INT = SCOPE_IDENTITY();
                        DECLARE @Code NVARCHAR(50) = @Area + FORMAT(GETDATE(), 'MMdd') + '-' + CAST(@NewID AS NVARCHAR);
                        
                        -- Update cod visual
                        UPDATE Etiquetas SET CodigoEtiqueta = @Code WHERE EtiquetaID = @NewID;

                        -- Validar que Logistica_Bultos se mantenga sincronizado
                        IF NOT EXISTS (SELECT 1 FROM Logistica_Bultos WHERE CodigoEtiqueta = @Code)
                            BEGIN
                                 INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                                 VALUES (@Code, @Tipo, @OID, @Job, @Area, 'EN_STOCK', @UID);
                            END
                            ELSE
                            BEGIN
                                -- Si por alguna razón reusamos codigo (raro con identidad), aseguramos tipo actualizado
                                UPDATE Logistica_Bultos SET Tipocontenido = @Tipo, Descripcion = @Job WHERE CodigoEtiqueta = @Code;
                            END
                    `);
            }

            await transaction.commit();

            console.log(`[LabelService] Exito. ${totalBultos} etiquetas generadas para Orden ${ordenId}. QR: ${qrString}`);

            return { success: true, totalBultos, qrString };

        } catch (err) {
            if (transaction) await transaction.rollback();
            throw err;
        }
    }
}

module.exports = LabelGenerationService;
