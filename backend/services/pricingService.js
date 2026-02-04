const { sql, getPool } = require('../config/db');

class PricingService {

    /**
     * Calcula el precio final de un artículo para un cliente dado.
     * @param {string} codArticulo - Código del artículo
     * @param {number} cantidad - Cantidad solicitada (default 1)
     * @param {number} clienteId - ID del cliente (opcional)
     * @param {Array} extraProfileIds - IDs de perfiles adicionales (ej: Urgencia)
     * @returns {Promise<object>} - { precioUnitario, precioTotal, desglose: [] }
     */
    static async calculatePrice(codArticulo, cantidad = 1, clienteId = null, extraProfileIds = []) {
        const pool = await getPool();
        const breakdown = [];

        // 1. Obtener Precio Base
        const baseRes = await pool.request()
            .input('Cod', sql.NVarChar, codArticulo)
            .query("SELECT Precio, Moneda FROM PreciosBase WHERE CodArticulo = @Cod");

        let precioBase = 0;
        let moneda = 'UYU';

        if (baseRes.recordset.length > 0) {
            precioBase = baseRes.recordset[0].Precio;
            moneda = baseRes.recordset[0].Moneda;
            breakdown.push({ tipo: 'BASE', valor: precioBase, desc: 'Precio de Lista' });
        } else {
            breakdown.push({ tipo: 'WARN', valor: 0, desc: 'Producto sin precio base definido' });
        }

        let nuevoPrecioBase = precioBase;
        let acumuladoDescuentos = 0;
        let acumuladoRecargos = 0;

        // 2. Obtener IDs de Perfiles
        let perfilesIds = [];

        // Del Cliente
        if (clienteId) {
            const clientConfig = await pool.request()
                .input('CID', sql.Int, clienteId)
                .query("SELECT PerfilID, PerfilesIDs FROM PreciosEspeciales WHERE ClienteID = @CID");

            if (clientConfig.recordset.length > 0) {
                const row = clientConfig.recordset[0];
                if (row.PerfilesIDs) {
                    perfilesIds = String(row.PerfilesIDs).split(',').map(Number).filter(n => !isNaN(n));
                } else if (row.PerfilID) {
                    perfilesIds = [row.PerfilID];
                }
            }
        }

        // Obtener Perfiles Globales (Por defecto para todos)
        const globalProfilesRes = await pool.request().query("SELECT ID FROM PerfilesPrecios WHERE EsGlobal = 1");
        const globalIds = globalProfilesRes.recordset.map(r => r.ID);

        // Combinar: Cliente + Globales + Extra (Flags)
        const todosLosPerfiles = [...new Set([...perfilesIds, ...globalIds, ...extraProfileIds.map(Number)])];


        // 3. Buscar Reglas (AdHoc + Perfiles)

        // Ad-Hoc (Solo si hay cliente)
        let adHocRes = { recordset: [] };
        if (clienteId) {
            adHocRes = await pool.request()
                .input('CID', sql.Int, clienteId)
                .input('Cod', sql.NVarChar, codArticulo)
                .query(`SELECT TipoRegla, Valor, CodArticulo FROM PreciosEspecialesItems WHERE ClienteID = @CID AND (CodArticulo = @Cod OR CodArticulo = 'TOTAL')`);
        }

        // Perfiles (Si hay IDs)
        let profileRules = [];
        if (todosLosPerfiles.length > 0) {
            const idsStr = todosLosPerfiles.join(',');
            const perfilesRes = await pool.request()
                .input('Cod', sql.NVarChar, codArticulo)
                .input('Qty', sql.Decimal(18, 2), cantidad)
                .query(`
                    SELECT TipoRegla, Valor, CodArticulo, CantidadMinima, PerfilID,
                           (SELECT Nombre FROM PerfilesPrecios WHERE ID = PerfilesItems.PerfilID) as NombrePerfil
                    FROM PerfilesItems
                    WHERE PerfilID IN (${idsStr})
                      AND (CodArticulo = @Cod OR CodArticulo = 'TOTAL')
                      AND (CantidadMinima IS NULL OR CantidadMinima <= @Qty)
                `);
            profileRules = perfilesRes.recordset;
        }

        // 4. Seleccionar MEJOR regla de CADA perfil
        const reglasFinales = [];

        const procesarReglas = (lista, nombreDefault = 'Regla') => {
            const grouped = {};
            lista.forEach(r => {
                const pid = r.PerfilID || 'ADHOC';
                if (!grouped[pid]) grouped[pid] = [];
                grouped[pid].push(r);
            });

            Object.values(grouped).forEach(rules => {
                // Prioridad: 1. Producto Exacto, 2. Mayor Cantidad Minima (Tramo superior)
                rules.sort((a, b) => {
                    const aExact = a.CodArticulo === codArticulo ? 1 : 0;
                    const bExact = b.CodArticulo === codArticulo ? 1 : 0;
                    if (aExact !== bExact) return bExact - aExact;
                    return (b.CantidadMinima || 0) - (a.CantidadMinima || 0);
                });
                if (rules.length > 0) reglasFinales.push({ ...rules[0], NombrePerfil: rules[0].NombrePerfil || nombreDefault });
            });
        };

        const adHocMapped = adHocRes.recordset.map(r => ({ ...r, PerfilID: 'ADHOC' }));
        procesarReglas(adHocMapped, 'Excepción Cliente');
        procesarReglas(profileRules, 'Perfil');


        // 5. Aplicar Matemáticas: Competencia entre (Lista - Descuento) vs (Precio Fijo)

        // Opción A: Precio de Lista con Mejor Descuento
        const discountRules = reglasFinales.filter(r => r.TipoRegla.includes('discount') || r.TipoRegla === 'percentage' || r.TipoRegla === 'percentage_discount' || r.TipoRegla === 'subtract');
        let optionA_Price = precioBase;
        let optionA_DiscountVal = 0;
        let bestDiscountRule = null;

        if (discountRules.length > 0) {
            // Buscamos el mejor descuento aplicable al precio LISTA
            let maxMonto = 0;
            discountRules.forEach(r => {
                let monto = 0;
                const val = parseFloat(r.Valor);
                if (r.TipoRegla.includes('percentage') || r.TipoRegla === 'percentage') {
                    monto = precioBase * (val / 100);
                } else {
                    monto = val;
                }
                if (monto > maxMonto) {
                    maxMonto = monto;
                    bestDiscountRule = r;
                }
            });
            optionA_DiscountVal = maxMonto;
            optionA_Price = Math.max(0, precioBase - maxMonto);
        }

        // Opción B: Mejor Precio Fijo
        const fixedRules = reglasFinales.filter(r => r.TipoRegla === 'fixed' || r.TipoRegla === 'fixed_price');
        let optionB_Price = Infinity;
        let bestFixedRule = null;

        if (fixedRules.length > 0) {
            fixedRules.sort((a, b) => parseFloat(a.Valor) - parseFloat(b.Valor));
            bestFixedRule = fixedRules[0];
            optionB_Price = parseFloat(bestFixedRule.Valor);
        }

        // Decisión: ¿Quién gana? (Menor precio para el cliente)
        // Por defecto gana A (Lista + Descuentos). Si B existe y es menor, gana B.
        if (bestFixedRule && optionB_Price < optionA_Price) {
            // GANA PRECIO FIJO
            nuevoPrecioBase = optionB_Price;
            breakdown.push({
                tipo: 'OVERRIDE',
                valor: nuevoPrecioBase,
                desc: `Precio Fijo [${bestFixedRule.NombrePerfil}] (Mejor que lista con desc.)`,
                profileId: bestFixedRule.PerfilID
            });
            // No aplicamos descuentos porcentuales extras a la base fija
            acumuladoDescuentos = 0;

            // Info opcional: Avisar que ganó al descuento
            if (bestDiscountRule) {
                breakdown.push({ tipo: 'INFO', valor: 0, desc: `(Se ignoró descuento por ser mayor el precio resultante)` });
            }

        } else {
            // GANA LISTA + DESCUENTO
            nuevoPrecioBase = precioBase; // Mantenemos base original para recargos
            // Solo logueamos el descuento si existió
            if (bestDiscountRule) {
                const r = bestDiscountRule;
                const val = parseFloat(r.Valor);
                const isPerc = r.TipoRegla.includes('percentage') || r.TipoRegla === 'percentage';
                breakdown.push({
                    tipo: 'DISCOUNT',
                    valor: -optionA_DiscountVal,
                    desc: `Mejor Desc. ${Math.round(val)}${isPerc ? '%' : ''} [${r.NombrePerfil || 'Regla'}]`,
                    profileId: r.PerfilID
                });
                acumuladoDescuentos = optionA_DiscountVal;

                if (discountRules.length > 1) {
                    breakdown.push({ tipo: 'INFO', valor: 0, desc: `(Se ignoraron ${discountRules.length - 1} descuentos menores)` });
                }
            }
        }

        // C. Recargos: Estos SÍ se acumulan (Urgencia + Zona, etc.)
        const surchargeRules = reglasFinales.filter(r => r.TipoRegla.includes('surcharge'));
        surchargeRules.forEach(r => {
            const val = parseFloat(r.Valor);
            const src = `[${r.NombrePerfil || 'Regla'}]`;
            let monto = 0;

            if (r.TipoRegla.includes('percentage')) {
                monto = nuevoPrecioBase * (val / 100);
                breakdown.push({ tipo: 'SURCHARGE', valor: monto, desc: `Recargo ${val}% ${src}`, profileId: r.PerfilID });
            } else {
                monto = val;
                breakdown.push({ tipo: 'SURCHARGE', valor: monto, desc: `Recargo $${val} ${src}`, profileId: r.PerfilID });
            }
            acumuladoRecargos += monto;
        });

        let precioFinal = nuevoPrecioBase + acumuladoRecargos - acumuladoDescuentos;
        if (precioFinal < 0) precioFinal = 0;

        // Generar TXT para Observaciones (Simil Simulador)
        let txtParts = [];

        // 1. Base
        const override = breakdown.find(b => b.tipo === 'OVERRIDE');
        if (override) {
            txtParts.push(`Base: $${override.valor.toFixed(2)} (${override.desc})`);
        } else {
            txtParts.push(`Base: $${precioBase.toFixed(2)}`);
        }

        // 2. Descuentos
        breakdown.filter(b => b.tipo === 'DISCOUNT').forEach(d => {
            txtParts.push(`${d.desc}: -$${Math.abs(d.valor).toFixed(2)}`);
        });

        // 3. Recargos
        breakdown.filter(b => b.tipo === 'SURCHARGE').forEach(s => {
            txtParts.push(`${s.desc}: +$${s.valor.toFixed(2)}`);
        });

        // 4. Final
        txtParts.push(`Total Unit.: $${precioFinal.toFixed(2)}`);

        const txt = txtParts.join('\n');


        return {
            codArticulo,
            cantidad,
            precioUnitario: precioFinal,
            precioTotal: precioFinal * cantidad,
            moneda, // Asegurar que moneda existe en scope o usar 'UYU'
            breakdown,
            txt // El texto para observaciones
        };
    }

    /**
     * Endpoint Debug actualizado
     */
    static async debugPrice(req, res) {
        try {
            const { cod, qty, cid, extra } = req.query; // extra: "1,4" ids
            const extraIds = extra ? extra.split(',').map(Number) : [];
            const result = await PricingService.calculatePrice(cod, qty || 1, cid, extraIds);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
}

module.exports = PricingService;
