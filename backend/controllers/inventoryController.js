const { getPool, sql } = require('../config/db');

// ==========================================
// 1. OBTENER INVENTARIO (POR AREA)
// ==========================================
exports.getInventoryByArea = async (req, res) => {
    const { areaId } = req.query; // Puede llegar como 'DTF' o 'DTF,ECOUV'

    // VALIDACIÓN CRITICA
    if (!areaId) {
        return res.status(400).json({ error: "Falta el parámetro areaId en la consulta." });
    }

    try {
        const pool = await getPool();

        // Manejo de Múltiples Áreas
        const areas = areaId.split(',').map(a => a.trim()).filter(a => a);

        // Construcción dinámica de parámetros para IN clause
        const areaParams = areas.map((_, i) => `@A${i}`).join(',');
        // Genera: @A0, @A1, ...

        const query = `
            SELECT 
                i.InsumoID, 
                i.Nombre, 
                i.CodigoReferencia as CodArt,
                i.UnidadDefault,
                
                -- Totales Calculados (Globales para las áreas seleccionadas)
                (SELECT COUNT(*) FROM InventarioBobinas WHERE InsumoID = i.InsumoID AND Estado = 'Disponible' AND AreaID IN (${areaParams})) as BobinasDisponibles,
                (SELECT ISNULL(SUM(MetrosRestantes),0) FROM InventarioBobinas WHERE InsumoID = i.InsumoID AND Estado = 'Disponible' AND AreaID IN (${areaParams})) as MetrosTotales,
                
                -- Detalle de Bobinas Activas
                (
                    SELECT BobinaID, CodigoEtiqueta, MetrosIniciales, MetrosRestantes, Estado, FechaIngreso, AreaID, LoteProveedor
                    FROM InventarioBobinas 
                    WHERE InsumoID = i.InsumoID AND AreaID IN (${areaParams}) AND Estado IN ('Disponible', 'En Uso')
                    ORDER BY FechaIngreso ASC
                    FOR JSON PATH
                ) as ActiveBatches
                
            FROM Insumos i
            WHERE 
                -- Insumo asignado a ALGUNA de las áreas
                EXISTS (SELECT 1 FROM InsumosPorArea ipa WHERE ipa.InsumoID = i.InsumoID AND ipa.AreaID IN (${areaParams}))
                -- O tiene stock en ALGUNA de las áreas
                OR EXISTS (SELECT 1 FROM InventarioBobinas ib WHERE ib.InsumoID = i.InsumoID AND ib.AreaID IN (${areaParams}))
                -- O mapeado
                OR i.Categoria IN (SELECT CodigoERP FROM ConfigMapeoERP WHERE AreaID_Interno IN (${areaParams}))
        `;

        const request = pool.request();
        areas.forEach((a, i) => request.input(`A${i}`, sql.VarChar(20), a));

        const result = await request.query(query);

        // Parsear el JSON de lotes
        const inventory = result.recordset.map(item => ({
            ...item,
            ActiveBatches: item.ActiveBatches ? JSON.parse(item.ActiveBatches) : []
        }));

        res.json(inventory);
    } catch (err) {
        console.error("Error getInventoryByArea:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 2. RECEPCIÓN DE MATERIAL (ADD STOCK)
// ==========================================
exports.addStock = async (req, res) => {
    const { insumoId, areaId, metros, cantidadBobinas, loteProv, codigoBarraBase } = req.body;
    const userId = req.user ? req.user.id : 1;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Insertar N bobinas
            for (let i = 0; i < (cantidadBobinas || 1); i++) {
                const uniqueCode = codigoBarraBase ? `${codigoBarraBase}-${i + 1}` : `BOB-${Date.now()}-${i}`;

                const result = await new sql.Request(transaction)
                    .input('IID', sql.Int, insumoId)
                    .input('Area', sql.VarChar(20), areaId)
                    .input('Met', sql.Decimal(10, 2), metros)
                    .input('Lote', sql.NVarChar(100), loteProv || 'S/L')
                    .input('Code', sql.NVarChar(100), uniqueCode)
                    .query(`
                        INSERT INTO InventarioBobinas (InsumoID, AreaID, MetrosIniciales, MetrosRestantes, Estado, LoteProveedor, CodigoEtiqueta)
                        OUTPUT INSERTED.BobinaID
                        VALUES (@IID, @Area, @Met, @Met, 'Disponible', @Lote, @Code)
                    `);

                const newBobinaId = result.recordset[0].BobinaID;

                // Registrar Movimiento de Entrada
                await new sql.Request(transaction)
                    .input('IID', sql.Int, insumoId)
                    .input('BID', sql.Int, newBobinaId)
                    .input('Cant', sql.Decimal(10, 2), metros)
                    .input('Ref', sql.NVarChar(200), `Ingreso Bobina ${uniqueCode}`)
                    .input('UID', sql.Int, userId)
                    .query(`
                        INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                        VALUES (@IID, @BID, 'INGRESO', @Cant, @Ref, @UID)
                    `);
            }

            await transaction.commit();
            res.json({ success: true, message: `${cantidadBobinas} bobinas ingresadas exitosamente.` });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        console.error("Error addStock:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. ACTUALIZAR USO DE BOBINA (AUTOMATICO)
// ==========================================
// Esta función se llama internamente cuando MagicSort crea un rollo
exports.registerConsumption = async (poolInstance, bobinaId, metrosUsados, loteProdId) => {
    // Nota: poolInstance debe ser una Transacción activa si viene de MagicSort
    try {
        const result = await new sql.Request(poolInstance)
            .input('BID', sql.Int, bobinaId)
            .input('Met', sql.Decimal(10, 2), metrosUsados)
            .query(`
                UPDATE InventarioBobinas 
                SET MetrosRestantes = MetrosRestantes - @Met,
                    Estado = CASE WHEN (MetrosRestantes - @Met) <= 0.5 THEN 'Agotado' ELSE 'En Uso' END
                OUTPUT INSERTED.InsumoID, INSERTED.CodigoEtiqueta
                WHERE BobinaID = @BID
            `);

        if (result.recordset.length > 0) {
            const { InsumoID, CodigoEtiqueta } = result.recordset[0];

            // Log Movimiento Automático
            await new sql.Request(poolInstance)
                .input('IID', sql.Int, InsumoID)
                .input('BID', sql.Int, bobinaId)
                .input('Cant', sql.Decimal(10, 2), -metrosUsados) // Consumo es negativo en movimientos? Depende convencion. 
                // En reportes, consumo se calcula diferencia de stocks o suma de movimientos.
                // Usualmente en reporte veo: SUM(ISNULL(ib.MetrosIniciales,0) - ISNULL(ib.MetrosRestantes,0)) as ConsumoBruto
                // Pero si quiero registrar el movimiento, lo haré negativo para indicar salida.
                .input('Ref', sql.NVarChar(200), `Consumo Orden/Lote: ${loteProdId || 'Auto'} (${CodigoEtiqueta})`)
                .input('UID', sql.Int, 1) // Usuario Sistema
                .query(`
                    INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                    VALUES (@IID, @BID, 'CONSUMO_PRODUCCION', @Cant, @Ref, @UID)
                `);
        }
    } catch (e) {
        console.error("Error registrando consumo:", e);
    }
};

// ==========================================
// 4. CIERRE Y CÁLCULO DE DESECHO (MANUAL)
// ==========================================
exports.closeBobina = async (req, res) => {
    const { bobinaId, metrosRemanentesReal, motivo, finish } = req.body;
    // metrosRemanentesReal: Lo que el operario MIDE que sobró en el rollo de cartón.
    const userId = req.user ? req.user.id : 1;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener estado actual del sistema
            const current = await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .query("SELECT MetrosRestantes, InsumoID, CodigoEtiqueta FROM InventarioBobinas WHERE BobinaID = @BID");

            if (current.recordset.length === 0) throw new Error("Bobina no encontrada");

            const sistemaRestante = current.recordset[0].MetrosRestantes;
            const insumoId = current.recordset[0].InsumoID;
            const etiqueta = current.recordset[0].CodigoEtiqueta;

            // 2. Calcular Diferencia (Desecho o Ajuste)
            // Si el sistema dice que quedan 5m, y el real es 2m -> Perdimos 3m (Desecho)
            const diferencia = metrosRemanentesReal - sistemaRestante; // Ej: 2 - 5 = -3

            // 3. Actualizar a lo real y marcar Agotado o Disponible según valor o flag finish
            // Si finish es true, se marca Agotado aunque queden metros (se asume merma final)
            const nuevoEstado = (finish || metrosRemanentesReal < 0.5) ? 'Agotado' : 'Disponible';

            await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .input('Real', sql.Decimal(10, 2), metrosRemanentesReal)
                .input('St', sql.VarChar(20), nuevoEstado)
                .query(`
                    UPDATE InventarioBobinas 
                    SET MetrosRestantes = @Real, 
                        Estado = @St,
                        FechaAgotado = CASE WHEN @St = 'Agotado' THEN GETDATE() ELSE NULL END
                    WHERE BobinaID = @BID
                `);

            // 4. Registrar la pérdida / ajuste
            if (Math.abs(diferencia) > 0.01) {
                await new sql.Request(transaction)
                    .input('IID', sql.Int, insumoId)
                    .input('BID', sql.Int, bobinaId)
                    .input('Diff', sql.Decimal(10, 2), diferencia)
                    .input('Ref', sql.NVarChar(200), `Ajuste Cierre ${etiqueta}: ${motivo || 'Desecho Producción'}`)
                    .input('UID', sql.Int, userId)
                    .query(`
                        INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                        VALUES (@IID, @BID, 'AJUSTE_DESECHO', @Diff, @Ref, @UID)
                    `);
            }

            await transaction.commit();

            res.json({
                success: true,
                calculo: {
                    sistema: sistemaRestante,
                    real: metrosRemanentesReal,
                    desperdicio: Math.abs(diferencia).toFixed(2),
                    esPerdida: diferencia < 0
                }
            });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        console.error("Error closeBobina:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4.1 AJUSTE MANUAL (REBAJA SIN CIERRE)
// ==========================================
exports.adjustBobina = async (req, res) => {
    const { bobinaId, cantidad, motivo } = req.body; // Cantidad negativa = resta, positiva = suma
    const userId = req.user ? req.user.id : 1;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const current = await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .query("SELECT MetrosRestantes, InsumoID, CodigoEtiqueta FROM InventarioBobinas WHERE BobinaID = @BID");

            if (current.recordset.length === 0) throw new Error("Bobina no encontrada");

            const { MetrosRestantes, InsumoID, CodigoEtiqueta } = current.recordset[0];
            const nuevoMetraje = MetrosRestantes + parseFloat(cantidad);

            if (nuevoMetraje < 0) throw new Error("El stock no puede quedar negativo");

            // Update Bobina
            await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .input('Nuevo', sql.Decimal(10, 2), nuevoMetraje)
                .query("UPDATE InventarioBobinas SET MetrosRestantes = @Nuevo WHERE BobinaID = @BID");

            // Log Movement
            await new sql.Request(transaction)
                .input('IID', sql.Int, InsumoID)
                .input('BID', sql.Int, bobinaId)
                .input('Cant', sql.Decimal(10, 2), cantidad) // Save the delta
                .input('Ref', sql.NVarChar(200), `Ajuste ${CodigoEtiqueta}: ${motivo}`)
                .input('UID', sql.Int, userId)
                .query("INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID) VALUES (@IID, @BID, 'AJUSTE_MANUAL', @Cant, @Ref, @UID)");

            await transaction.commit();
            res.json({ success: true, message: 'Stock ajustado correctamente' });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        console.error("Error adjustBobina:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4.2 HISTORIAL DE BOBINA
// ==========================================
exports.getBobinaHistory = async (req, res) => {
    const { code } = req.query; // CodigoEtiqueta

    try {
        const pool = await getPool();
        const request = pool.request();
        request.input('Code', sql.NVarChar(50), `%${code}%`);

        const result = await request.query(`
            SELECT m.Fecha, m.TipoMovimiento, m.Cantidad, m.Referencia, u.Nombre as Usuario
            FROM MovimientosInsumos m
            LEFT JOIN Usuarios u ON m.UsuarioID = u.UsuarioID
            WHERE m.Referencia LIKE @Code
            ORDER BY m.Fecha DESC
        `);

        res.json(result.recordset);
    } catch (err) {
        console.error("Error history:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 5. LISTAR INSUMOS (CRUD)
// ==========================================
exports.getInsumos = async (req, res) => {
    const { q, areaId } = req.query;
    try {
        const pool = await getPool();
        const request = pool.request();

        let query = `
            SELECT 
                i.*,
                (
                    SELECT STRING_AGG(AreaID, ',') 
                    FROM InsumosPorArea 
                    WHERE InsumoID = i.InsumoID
                ) as AreaIDs
            FROM Insumos i 
            WHERE 1=1
        `;

        if (q) {
            request.input('Q', sql.NVarChar(100), `%${q}%`);
            query += " AND i.Nombre LIKE @Q";
        }

        if (areaId) {
            const areas = areaId.split(',').map(a => a.trim()).filter(a => a);
            if (areas.length > 0) {
                const areaParams = areas.map((_, i) => `@A${i}`).join(',');
                areas.forEach((a, i) => request.input(`A${i}`, sql.VarChar(20), a));

                query += ` AND (
                    EXISTS (SELECT 1 FROM InsumosPorArea ipa WHERE ipa.InsumoID = i.InsumoID AND ipa.AreaID IN (${areaParams}))
                    OR EXISTS (SELECT 1 FROM InventarioBobinas ib WHERE ib.InsumoID = i.InsumoID AND ib.AreaID IN (${areaParams}))
                    OR i.Categoria IN (SELECT CodigoERP FROM ConfigMapeoERP WHERE AreaID_Interno IN (${areaParams}))
                )`;
            }
        }

        query += " ORDER BY i.Nombre";

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.createInsumo = async (req, res) => {
    const { nombre, codProd, unidad, categoria, stockMinimo, esProductivo, areas } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const insertResult = await new sql.Request(transaction)
                .input('Nom', sql.NVarChar(100), nombre)
                .input('Ref', sql.NVarChar(50), codProd)
                .input('Uni', sql.VarChar(20), unidad || 'M')
                .input('Cat', sql.NVarChar(50), categoria || null)
                .input('Min', sql.Decimal(10, 2), stockMinimo || 0)
                .input('Prod', sql.Bit, esProductivo ? 1 : 0)
                .query("INSERT INTO Insumos (Nombre, CodigoReferencia, UnidadDefault, Categoria, StockMinimo, EsProductivo) OUTPUT INSERTED.InsumoID VALUES (@Nom, @Ref, @Uni, @Cat, @Min, @Prod)");

            const newInsumoId = insertResult.recordset[0].InsumoID;

            if (areas && Array.isArray(areas) && areas.length > 0) {
                for (const areaId of areas) {
                    await new sql.Request(transaction)
                        .input('AreaID', sql.VarChar(20), areaId)
                        .input('InsumoID', sql.Int, newInsumoId)
                        .query("INSERT INTO InsumosPorArea (InsumoID, AreaID) VALUES (@InsumoID, @AreaID)");
                }
            }

            await transaction.commit();
            res.json({ success: true, id: newInsumoId });
        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateInsumo = async (req, res) => {
    const { id } = req.params;
    const { nombre, codProd, unidad, categoria, stockMinimo, esProductivo, areas } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await new sql.Request(transaction)
                .input('ID', sql.Int, id)
                .input('Nom', sql.NVarChar(100), nombre)
                .input('Ref', sql.NVarChar(50), codProd)
                .input('Uni', sql.VarChar(20), unidad || 'M')
                .input('Cat', sql.NVarChar(50), categoria || null)
                .input('Min', sql.Decimal(10, 2), stockMinimo || 0)
                .input('Prod', sql.Bit, esProductivo ? 1 : 0)
                .query(`
                    UPDATE Insumos 
                    SET Nombre=@Nom, CodigoReferencia=@Ref, UnidadDefault=@Uni, Categoria=@Cat, StockMinimo=@Min, EsProductivo=@Prod 
                    WHERE InsumoID=@ID
                `);

            if (areas && Array.isArray(areas)) {
                // Sincronizar Áreas
                await new sql.Request(transaction)
                    .input('ID', sql.Int, id)
                    .query("DELETE FROM InsumosPorArea WHERE InsumoID = @ID");

                for (const areaId of areas) {
                    await new sql.Request(transaction)
                        .input('AreaID', sql.VarChar(20), areaId)
                        .input('InsumoID', sql.Int, id)
                        .query("INSERT INTO InsumosPorArea (InsumoID, AreaID) VALUES (@InsumoID, @AreaID)");
                }
            }

            await transaction.commit();
            res.json({ success: true });
        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getInventoryReport = async (req, res) => {
    const { startDate, endDate, areaId } = req.query;

    try {
        const pool = await getPool();
        const request = pool.request();

        // Config fechas
        if (startDate && endDate) {
            request.input('Start', sql.DateTime, startDate + ' 00:00:00');
            request.input('End', sql.DateTime, endDate + ' 23:59:59');
        } else {
            const d = new Date(); d.setDate(d.getDate() - 30);
            request.input('Start', sql.DateTime, d);
            request.input('End', sql.DateTime, new Date());
        }

        let dateFilter = '';
        if (startDate && endDate) {
            dateFilter = `AND ib.FechaAgotado BETWEEN @Start AND @End`;
        }

        // Config Areas Multiples
        let areaFilter = '';
        let areaSubQueryFilter = ''; // Para subqueries de Ordenes
        let areas = [];
        let areaIdsParam = '';

        if (areaId) {
            areas = areaId.split(',').map(a => a.trim()).filter(a => a);
            areaIdsParam = areas.map((_, i) => `@R${i}`).join(',');
            areas.forEach((a, i) => request.input(`R${i}`, sql.VarChar(20), a));

            areaFilter = `AND (ib.AreaID IN (${areaIdsParam}) OR ib.AreaID IS NULL)`;
            areaSubQueryFilter = `AND o.AreaID IN (${areaIdsParam})`;
        }

        const reportQuery = `
            SELECT 
                i.Nombre as Insumo,
                i.UnidadDefault,
                
                -- Cantidad de Bobinas terminadas
                COUNT(ib.BobinaID) as BobinasCerradas,
                
                -- Metros Brutos Consumidos (Salida de Inventario)
                SUM(ISNULL(ib.MetrosIniciales,0) - ISNULL(ib.MetrosRestantes,0)) as ConsumoBruto,
                
                -- Desperdicio 1: Sobrantes al cerrar bobina
                (
                    SELECT ISNULL(ABS(SUM(mi.Cantidad)), 0)
                    FROM MovimientosInsumos mi
                    WHERE mi.InsumoID = i.InsumoID
                    AND mi.TipoMovimiento = 'AJUSTE_DESECHO'
                    AND mi.FechaMovimiento BETWEEN @Start AND @End
                ) as DesperdicioCierre,

                -- Desperdicio 2: Órdenes Fallidas (Producción Defectuosa - Ordenes 'F')
                (
                    SELECT ISNULL(SUM(ao.Metros * ISNULL(ao.Copias,1)), 0)
                    FROM dbo.ArchivosOrden ao
                    INNER JOIN dbo.Ordenes o ON ao.OrdenID = o.OrdenID
                    WHERE o.Material LIKE '%' + i.Nombre + '%' 
                    AND (
                        o.CodigoOrden LIKE 'F%'       -- Empieza con F (ej: FX123)
                        OR o.CodigoOrden LIKE '%-F%'  -- Contiene -F (ej: 44-F123)
                        OR o.CodigoOrden LIKE '% F%'  -- Contiene espacio F (ej: 44 F123)
                        OR o.Estado IN ('Falla', 'FALLA') 
                        OR ao.EstadoArchivo IN ('Falla', 'FALLA')
                        OR o.falla = 1 
                    )
                    AND o.FechaIngreso BETWEEN @Start AND @End
                    ${areaId ? areaSubQueryFilter : ""}
                ) as DesperdicioProduccion,

                -- Desperdicio 3: Mermas declaradas en cambios de bobina (Reimpresiones)
                (
                    SELECT ISNULL(ABS(SUM(mi.Cantidad)), 0)
                    FROM MovimientosInsumos mi
                    WHERE mi.InsumoID = i.InsumoID
                    AND mi.TipoMovimiento = 'MERMA_REIMPRESION'
                    AND mi.FechaMovimiento BETWEEN @Start AND @End
                ) as DesperdicioReimpresion,

                -- Ingresos
                (
                    SELECT ISNULL(SUM(Cantidad), 0)
                    FROM MovimientosInsumos mi
                    WHERE mi.InsumoID = i.InsumoID
                    AND mi.TipoMovimiento = 'INGRESO'
                    AND mi.FechaMovimiento BETWEEN @Start AND @End
                ) as Ingresos

            FROM Insumos i
            LEFT JOIN InventarioBobinas ib ON i.InsumoID = ib.InsumoID AND ib.Estado IN ('Agotado', 'Cerrado') ${dateFilter.replace('ib.', 'ib.')}
            WHERE 1=1
            ${areaId ? `AND i.InsumoID IN (SELECT InsumoID FROM InventarioBobinas WHERE AreaID IN (${areaIdsParam}) UNION SELECT InsumoID FROM InsumosPorArea WHERE AreaID IN (${areaIdsParam}))` : ""}
            GROUP BY i.InsumoID, i.Nombre, i.UnidadDefault
            HAVING (SUM(ISNULL(ib.MetrosIniciales,0)) > 0 OR (SELECT COUNT(*) FROM MovimientosInsumos WHERE InsumoID=i.InsumoID) > 0)
        `;

        const result = await request.query(reportQuery);

        const data = result.recordset.map(row => {
            const bruto = row.ConsumoBruto || 0;
            const wasteCierre = row.DesperdicioCierre || 0;
            const wasteProd = row.DesperdicioProduccion || 0;
            const wasteReimp = row.DesperdicioReimpresion || 0;

            const totalWaste = wasteCierre + wasteProd + wasteReimp;
            const neto = bruto - totalWaste;

            return {
                ...row,
                DesperdicioReimpresion: wasteReimp,
                DesperdicioTotal: totalWaste,
                ConsumoNeto: neto > 0 ? neto : 0,
                PorcentajeDesperdicio: bruto > 0 ? ((totalWaste / bruto) * 100).toFixed(1) : (totalWaste > 0 ? '100.0' : '0.0')
            };
        });

        res.json(data);

    } catch (err) {
        console.error("Error getInventoryReport:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.deleteInsumo = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .query("DELETE FROM Insumos WHERE InsumoID = @ID");
        res.json({ success: true });
    } catch (err) {
        if (err.number === 547) {
            return res.status(400).json({ error: "No se puede eliminar: El insumo tiene historial de movimientos." });
        }
        res.status(500).json({ error: err.message });
    }
};
