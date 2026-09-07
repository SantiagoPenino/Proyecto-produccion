/**
 * Auditoría de Depósito — FASE 4 (reportes) y FASE 5 (conteo cíclico).
 *
 * Reportes: resumen ejecutivo, antigüedad por tramos, sin avisar (con prioridad), duplicadas (código repetido /
 * mismo cliente mismo día / lecturas repetidas), valorización, por cliente, indicadores del registro de casos y
 * "hallazgos" redactados automáticamente. Se calculan sobre la FOTOGRAFÍA de una auditoría (audId) o, si no se
 * indica ninguna, sobre las órdenes activas EN VIVO (sin ERI ni faltantes: para eso hace falta una auditoría).
 *
 * Conteo cíclico: clasifica las áreas (prefijos) por valor en depósito (ABC), mira cuándo se auditó cada una por
 * última vez y dice cuáles están vencidas según la frecuencia configurada. Así se cuenta por partes en vez de
 * parar el depósito una vez al año.
 */
const { getPool, sql } = require('../config/db');
const { SQL_COLS_PAGO_DOC, SQL_JOIN_PAGO_DOC, resolverSituacionPago, prefijoDe } = require('./auditDepositoSql');
const svc = require('./auditoriaDepositoService');

const TRAMOS = [
    { k: '0-15', min: 0, max: 15 }, { k: '16-30', min: 16, max: 30 }, { k: '31-60', min: 31, max: 60 },
    { k: '61-90', min: 61, max: 90 }, { k: '91-180', min: 91, max: 180 }, { k: '+180', min: 181, max: Infinity },
];
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const diasEntre = (desde, hasta) => Math.floor((new Date(hasta) - new Date(desde)) / 86400000);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const categoriaPago = (pagoEstado) => {
    const p = String(pagoEstado || 'Pendiente');
    if (p.startsWith('Pagado')) return 'Pagado';
    if (p.startsWith('Facturado')) return 'Facturado sin cobrar';
    if (p.startsWith('En cta')) return 'En cuenta corriente (sin facturar)';
    return 'Pendiente de cobro';
};

/* ═══════════════════════════ FILAS EN VIVO (sin auditoría) ═══════════════════════════ */

async function itemsEnVivo(pool, cfg) {
    const r = await pool.request().input('Cot', sql.Decimal(18, 4), cfg.cotDolar).query(`
        SELECT o.OrdIdOrden, UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) AS OrdCodigoOrden, o.OrdNombreTrabajo, o.OrdEstadoActual, o.OrdFechaIngresoOrden,
               o.OrdAvisoWsp, o.OrdFechaAvisoWsp, o.OrdCostoFinal, o.MonIdMoneda, o.PagIdPago, o.OReIdOrdenRetiro, o.BultosEsperados,
               o.CliIdCliente, c.Nombre AS ClienteNombre, c.TelefonoTrabajo AS ClienteTelefono, c.Email AS ClienteEmail,
               tc.TClDescripcion AS ClienteTipo, r.FormaRetiro, est.Estante,
               CASE WHEN o.MonIdMoneda = 2 THEN ROUND(ISNULL(o.OrdCostoFinal, 0) * @Cot, 2) ELSE ROUND(ISNULL(o.OrdCostoFinal, 0), 2) END AS ValorPesos,
               CASE WHEN o.OrdFechaIngresoOrden IS NULL THEN 0 ELSE DATEDIFF(day, o.OrdFechaIngresoOrden, GETDATE()) END AS DiasEnDeposito${SQL_COLS_PAGO_DOC}
        FROM dbo.OrdenesDeposito o WITH(NOLOCK)
        LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
        LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
        LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = o.OReIdOrdenRetiro
        OUTER APPLY (
            SELECT TOP 1 RTRIM(e.EstanteID) + '-' + CAST(e.Seccion AS VARCHAR(10)) + '-' + CAST(e.Posicion AS VARCHAR(10)) AS Estante
            FROM dbo.OcupacionEstantes e WITH(NOLOCK)
            WHERE r.OReIdOrdenRetiro IS NOT NULL AND e.OrdenRetiro = COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR(20))
        ) est${SQL_JOIN_PAGO_DOC}
        WHERE (o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL)`);
    return r.recordset.map(s => {
        const { pagoEstado } = resolverSituacionPago(s);
        return {
            ordIdOrden: s.OrdIdOrden, codigo: s.OrdCodigoOrden, prefijo: prefijoDe(s.OrdCodigoOrden), trabajo: s.OrdNombreTrabajo,
            cliIdCliente: s.CliIdCliente, cliente: s.ClienteNombre, clienteTipo: s.ClienteTipo || 'Desconocido', clienteTelefono: s.ClienteTelefono, clienteEmail: s.ClienteEmail,
            pagoEstado, ordenRetiro: s.OReIdOrdenRetiro ? `ID: ${s.OReIdOrdenRetiro} - ${s.FormaRetiro || 'S/D'}` : 'Sin Asignar',
            estadoActualId: s.OrdEstadoActual, fechaIngreso: s.OrdFechaIngresoOrden, diasEnDeposito: s.DiasEnDeposito || 0, maxDiasDeposito: cfg.diasMax,
            valorPesos: Number(s.ValorPesos || 0), costo: Number(s.OrdCostoFinal || 0), moneda: s.MonIdMoneda, estante: s.Estante || null,
            avisado: !!s.OrdAvisoWsp, fechaAviso: s.OrdFechaAvisoWsp, bultosEsperados: s.BultosEsperados,
        };
    });
}

/* ═══════════════════════════ REPORTE ═══════════════════════════ */

async function construirReporte({ audId = null } = {}) {
    const pool = await getPool();
    const cfg = await svc.leerConfig(pool);
    const ahora = new Date();
    let items, auditoria = null, auditData = null, liveScans = [];

    if (audId) {
        const a = await pool.request().input('A', sql.Int, parseInt(audId, 10)).query(`SELECT * FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudId = @A`);
        if (!a.recordset.length) throw httpError(404, 'Auditoría no encontrada.');
        const row = a.recordset[0];
        const cl = await svc.clasificarSesion(pool, row);
        auditData = cl.auditData; liveScans = cl.liveScans; items = auditData.totales;
        const resumenCierre = row.AudResumenJson ? (() => { try { return JSON.parse(row.AudResumenJson); } catch (e) { return null; } })() : null;
        auditoria = {
            audId: row.AudId, codigo: row.AudCodigo, estado: row.AudEstado, alcanceTipo: row.AudAlcanceTipo, alcanceValor: row.AudAlcanceValor,
            alcanceTexto: row.AudAlcanceTipo === 'TOTAL' ? 'depósito completo' : `solo ${row.AudAlcanceValor}`, lineaBase: !!row.AudEsLineaBase,
            fechaApertura: row.AudFechaApertura, fechaCierre: row.AudFechaCierre, usuarioApertura: row.AudUsuarioAperturaNombre, usuarioCierre: row.AudUsuarioCierreNombre,
            duracionMin: row.AudFechaCierre ? Math.round((new Date(row.AudFechaCierre) - new Date(row.AudFechaApertura)) / 60000) : null,
            cotizacion: Number(row.AudCotizacionDolar) || cfg.cotDolar, diasMax: row.AudDiasMaxDeposito || cfg.diasMax,
            nuevos: row.AudNuevos, existentes: row.AudExistentes, reincidentes: row.AudReincidentes, resueltos: row.AudResueltos, abiertosTotal: row.AudAbiertosTotal,
            movidas: resumenCierre ? resumenCierre.movidas || [] : [], duplicadosFoto: resumenCierre ? resumenCierre.duplicados || [] : [],
        };
    } else {
        items = await itemsEnVivo(pool, cfg);
    }
    const diasMax = auditoria ? auditoria.diasMax : cfg.diasMax;
    const cot = auditoria ? auditoria.cotizacion : cfg.cotDolar;
    const activas = items.length;
    const suma = (arr, f) => r2(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
    const valorTotal = suma(items, i => i.valorPesos);

    /* ── Antigüedad por tramos ── */
    const aging = TRAMOS.map(t => {
        const del = items.filter(i => i.diasEnDeposito >= t.min && i.diasEnDeposito <= t.max).sort((a, b) => b.diasEnDeposito - a.diasEnDeposito);
        return { tramo: t.k, n: del.length, pct: pct(del.length, activas), valor: suma(del, i => i.valorPesos), pctValor: pct(suma(del, i => i.valorPesos), valorTotal),
            sinAviso: del.filter(i => !i.avisado).length, ordenes: del.map(i => ({ codigo: i.codigo, cliente: i.cliente, dias: i.diasEnDeposito, valor: i.valorPesos, avisado: i.avisado, pagoEstado: i.pagoEstado })) };
    });
    const diasOrdenados = items.map(i => i.diasEnDeposito).sort((a, b) => a - b);
    const promedioDias = activas ? r2(diasOrdenados.reduce((a, b) => a + b, 0) / activas) : 0;
    const medianaDias = activas ? diasOrdenados[Math.floor(activas / 2)] : 0;
    const caducadas = items.filter(i => i.diasEnDeposito > diasMax);

    /* ── Sin avisar (con prioridad por antigüedad) ── */
    const sinAvisar = items
        .filter(i => !i.avisado && svc.ESTADOS_AVISABLES.includes(i.estadoActualId))
        .sort((a, b) => b.diasEnDeposito - a.diasEnDeposito)
        .map(i => ({ codigo: i.codigo, cliente: i.cliente, clienteTipo: i.clienteTipo, telefono: i.clienteTelefono, email: i.clienteEmail, dias: i.diasEnDeposito, valor: i.valorPesos,
            estado: i.estadoActualId, prioridad: i.diasEnDeposito > 30 ? 'ALTA' : i.diasEnDeposito > diasMax ? 'MEDIA' : 'BAJA', sinTelefono: !i.clienteTelefono }));

    /* ── Duplicadas ── */
    const porCodigo = new Map();
    items.forEach(i => { const k = i.codigo; if (!porCodigo.has(k)) porCodigo.set(k, []); porCodigo.get(k).push(i); });
    const dupCodigo = [...porCodigo.entries()].filter(([, l]) => l.length > 1).map(([codigo, l]) => ({ codigo, filas: l.length, ids: l.map(x => x.ordIdOrden), cliente: l[0].cliente, valor: suma(l, x => x.valorPesos) }));
    const porClienteDia = new Map();
    items.forEach(i => {
        if (!i.cliIdCliente || !i.fechaIngreso) return;
        const k = `${i.cliIdCliente}|${new Date(i.fechaIngreso).toISOString().slice(0, 10)}`;
        if (!porClienteDia.has(k)) porClienteDia.set(k, []);
        porClienteDia.get(k).push(i);
    });
    const dupClienteDia = [...porClienteDia.values()].filter(l => l.length > 1).map(l => ({
        cliente: l[0].cliente, fecha: new Date(l[0].fechaIngreso).toISOString().slice(0, 10), n: l.length, codigos: l.map(x => x.codigo), valor: suma(l, x => x.valorPesos),
        mismoTrabajo: new Set(l.map(x => String(x.trabajo || '').trim().toUpperCase())).size < l.length,
    })).sort((a, b) => b.n - a.n);
    const lecturasRepetidas = (() => {
        const m = new Map();
        liveScans.filter(s => s.duplicado).forEach(s => m.set(s.codigo, (m.get(s.codigo) || 0) + 1));
        return [...m.entries()].map(([codigo, veces]) => ({ codigo, vecesRepetida: veces })).sort((a, b) => b.vecesRepetida - a.vecesRepetida);
    })();

    /* ── Valorización ── */
    const porMoneda = [1, 2].map(m => { const del = items.filter(i => i.moneda === m); return { moneda: m === 2 ? 'US$' : '$', n: del.length, montoNativo: suma(del, i => i.costo), pesos: suma(del, i => i.valorPesos) }; });
    const catPago = {};
    items.forEach(i => { const c = categoriaPago(i.pagoEstado); catPago[c] = catPago[c] || { categoria: c, n: 0, pesos: 0 }; catPago[c].n++; catPago[c].pesos = r2(catPago[c].pesos + i.valorPesos); });
    const porPago = Object.values(catPago).sort((a, b) => b.pesos - a.pesos);
    const pendientesCobro = items.filter(i => categoriaPago(i.pagoEstado) !== 'Pagado');
    const prefMap = {};
    items.forEach(i => { const p = i.prefijo || '(sin prefijo)'; prefMap[p] = prefMap[p] || { prefijo: p, n: 0, pesos: 0, masAntigua: 0 }; prefMap[p].n++; prefMap[p].pesos = r2(prefMap[p].pesos + i.valorPesos); prefMap[p].masAntigua = Math.max(prefMap[p].masAntigua, i.diasEnDeposito); });
    const porPrefijo = Object.values(prefMap).map(p => ({ ...p, pct: pct(p.n, activas), pctValor: pct(p.pesos, valorTotal) })).sort((a, b) => b.pesos - a.pesos);
    const cliMap = {};
    items.forEach(i => {
        const k = i.cliIdCliente || i.cliente || 'S/D';
        cliMap[k] = cliMap[k] || { cliente: i.cliente || 'Sin cliente', clienteTipo: i.clienteTipo, n: 0, pesos: 0, masAntigua: 0, sinAviso: 0, pendientePago: 0, codigos: [] };
        const c = cliMap[k]; c.n++; c.pesos = r2(c.pesos + i.valorPesos); c.masAntigua = Math.max(c.masAntigua, i.diasEnDeposito);
        if (!i.avisado) c.sinAviso++; if (categoriaPago(i.pagoEstado) !== 'Pagado') c.pendientePago++; c.codigos.push(i.codigo);
    });
    const clientes = Object.values(cliMap);
    const topClientesValor = clientes.slice().sort((a, b) => b.pesos - a.pesos).slice(0, 20).map(c => ({ ...c, pctValor: pct(c.pesos, valorTotal) }));
    const porCliente = clientes.slice().sort((a, b) => b.n - a.n || b.pesos - a.pesos).slice(0, 50).map(c => ({ ...c, pct: pct(c.n, activas) }));

    /* ── Registro de casos ── */
    const cs = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')) AS vivos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND VecesDetectado >= 3) AS cronicos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Reincidente = 1) AS reincidentes,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('RESUELTO','ASUMIDO')) AS cerrados,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado = 'ASUMIDO') AS asumidos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK)) AS total,
          (SELECT AVG(CAST(DATEDIFF(day, PrimeraDeteccion, GETDATE()) AS FLOAT)) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')) AS edadPromedio,
          (SELECT MAX(DATEDIFF(day, PrimeraDeteccion, GETDATE())) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')) AS edadMax,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND FechaLimite IS NOT NULL AND FechaLimite < CAST(GETDATE() AS DATE)) AS vencidos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado = 'CERRADA') AS auditoriasCerradas`);
    const porTipoCaso = (await pool.request().query(`SELECT Tipo, Severidad, COUNT(*) AS n, SUM(ISNULL(ValorPesos, 0)) AS pesos FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') GROUP BY Tipo, Severidad`)).recordset;
    const ultimasAud = (await pool.request().query(`SELECT TOP 6 AudId, AudCodigo, AudFechaCierre, AudAlcanceTipo, AudAlcanceValor, AudEsLineaBase, AudSnapshotCant, AudEscaneosCant, AudNuevos, AudExistentes, AudReincidentes, AudResueltos, AudAbiertosTotal, AudMovidas FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado = 'CERRADA' ORDER BY AudFechaCierre DESC`)).recordset;
    const k = cs.recordset[0];
    const tipos = {};
    Object.keys(svc.TIPOS).forEach(t => { tipos[t] = { tipo: t, nombre: svc.TIPOS[t].nombre, n: 0, pesos: 0, ALTA: 0, MEDIA: 0, BAJA: 0 }; });
    porTipoCaso.forEach(r => { const t = tipos[r.Tipo]; if (!t) return; t.n += r.n; t.pesos = r2(t.pesos + Number(r.pesos || 0)); t[r.Severidad] = (t[r.Severidad] || 0) + r.n; });
    const casos = {
        vivos: k.vivos, cronicos: k.cronicos, reincidentes: k.reincidentes, cerrados: k.cerrados, asumidos: k.asumidos, total: k.total, vencidos: k.vencidos,
        edadPromedio: r2(k.edadPromedio || 0), edadMax: k.edadMax || 0,
        tasaReincidencia: pct(k.reincidentes, (k.cerrados || 0) + (k.reincidentes || 0)),
        auditoriasCerradas: k.auditoriasCerradas, porTipo: Object.values(tipos).filter(t => t.n > 0),
        ultimasAuditorias: ultimasAud.map(a => ({ codigo: a.AudCodigo, fechaCierre: a.AudFechaCierre, alcance: a.AudAlcanceTipo === 'TOTAL' ? 'completo' : a.AudAlcanceValor, lineaBase: !!a.AudEsLineaBase,
            fotografia: a.AudSnapshotCant, escaneos: a.AudEscaneosCant, nuevos: a.AudNuevos, existentes: a.AudExistentes, reincidentes: a.AudReincidentes, resueltos: a.AudResueltos, abiertos: a.AudAbiertosTotal, movidas: a.AudMovidas })),
    };

    /* ── Resumen ejecutivo ── */
    const verificadas = auditData ? auditData.ok.length : null;
    const faltantes = auditData ? auditData.faltaEnDeposito.filter(f => !(auditoria.movidas || []).some(m => m.codigo === f.codigo)) : [];
    const sobrantes = auditData ? auditData.sobraEnDeposito : [];
    const resumen = {
        fuente: auditoria ? 'AUDITORIA' : 'EN_VIVO',
        generado: ahora, cotizacion: cot, diasMax,
        activas, valorPesos: valorTotal, promedioDias, medianaDias,
        caducadas: caducadas.length, pctCaducadas: pct(caducadas.length, activas), valorCaducadas: suma(caducadas, i => i.valorPesos),
        sinAviso: sinAvisar.length, pctSinAviso: pct(sinAvisar.length, activas),
        pendientesCobro: pendientesCobro.length, valorPendienteCobro: suma(pendientesCobro, i => i.valorPesos), pctValorPendiente: pct(suma(pendientesCobro, i => i.valorPesos), valorTotal),
        eri: auditData ? pct(verificadas, activas) : null, verificadas,
        faltantes: auditData ? faltantes.length : null, valorFaltantes: auditData ? suma(faltantes, i => i.valorPesos) : null,
        sobrantes: auditData ? sobrantes.length : null, valorSobrantes: auditData ? suma(sobrantes, i => i.valorPesos || 0) : null,
        sinIngreso: auditData ? auditData.sinIngreso.length : null, desconocidos: auditData ? auditData.desconocido.length : null,
        movidas: auditoria ? (auditoria.movidas || []).length : null, escaneos: auditData ? liveScans.filter(s => !s.duplicado).length : null, lecturasRepetidas: lecturasRepetidas.reduce((a, x) => a + x.vecesRepetida, 0),
        duplicadasCodigo: dupCodigo.length, duplicadasClienteDia: dupClienteDia.length,
    };

    /* ── Hallazgos redactados ── */
    const fm = (v) => '$ ' + new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 }).format(Math.round(v || 0));
    const hallazgos = [];
    if (auditoria) {
        hallazgos.push(`${auditoria.codigo} (${auditoria.alcanceTexto}${auditoria.lineaBase ? ', línea base' : ''}): se verificaron ${verificadas} de ${activas} órdenes de la fotografía (ERI ${resumen.eri}%). Faltantes: ${faltantes.length} por ${fm(resumen.valorFaltantes)}. Sobrantes que figuran entregadas: ${sobrantes.length}.` +
            (resumen.movidas ? ` ${resumen.movidas} órdenes se movieron durante la auditoría y no cuentan como diferencia.` : '') +
            (auditoria.fechaCierre ? ` Resultado en el registro: ${auditoria.nuevos} casos nuevos, ${auditoria.existentes} ya existentes, ${auditoria.reincidentes} reincidentes, ${auditoria.resueltos} resueltos.` : ' La auditoría sigue abierta.'));
    } else {
        hallazgos.push(`Foto en vivo del depósito: ${activas} órdenes activas por ${fm(valorTotal)}. Para medir faltantes y sobrantes hace falta cerrar una auditoría.`);
    }
    if (caducadas.length) {
        const cadSinAviso = caducadas.filter(i => !i.avisado).length;
        hallazgos.push(`${caducadas.length} órdenes (${resumen.pctCaducadas}%) superan los ${diasMax} días en depósito, por ${fm(resumen.valorCaducadas)}. ` +
            (cadSinAviso / caducadas.length > 0.2
                ? `${cadSinAviso} de ellas nunca fueron avisadas: la permanencia se explica en buena parte por falta de aviso.`
                : `Casi todas (${caducadas.length - cadSinAviso}) fueron avisadas: el estancamiento no es por falta de aviso, es el cliente que no retira.`));
    }
    const tramoTop = aging.slice().sort((a, b) => b.valor - a.valor)[0];
    if (tramoTop && tramoTop.n) hallazgos.push(`El tramo de ${tramoTop.tramo} días concentra el ${tramoTop.pctValor}% del valor en depósito (${tramoTop.n} órdenes, ${fm(tramoTop.valor)}). Antigüedad promedio ${promedioDias} días, mediana ${medianaDias}.`);
    if (sinAvisar.length) hallazgos.push(`${sinAvisar.length} órdenes listas siguen sin aviso al cliente; ${sinAvisar.filter(s => s.prioridad === 'ALTA').length} llevan más de 30 días y ${sinAvisar.filter(s => s.sinTelefono).length} no tienen teléfono cargado (el aviso automático no puede salir).`);
    if (topClientesValor[0]) hallazgos.push(`${topClientesValor[0].cliente} concentra ${topClientesValor[0].n} órdenes por ${fm(topClientesValor[0].pesos)} (${topClientesValor[0].pctValor}% del valor en depósito); la más antigua lleva ${topClientesValor[0].masAntigua} días.`);
    if (pendientesCobro.length) hallazgos.push(`${pendientesCobro.length} órdenes por ${fm(resumen.valorPendienteCobro)} (${resumen.pctValorPendiente}% del valor) están en depósito sin cobrar.`);
    if (dupClienteDia.length) hallazgos.push(`${dupClienteDia.length} grupos de órdenes del mismo cliente ingresadas el mismo día (${dupClienteDia.reduce((a, d) => a + d.n, 0)} órdenes): revisar posibles ingresos dobles.`);
    if (dupCodigo.length) hallazgos.push(`${dupCodigo.length} códigos aparecen más de una vez entre las activas: depurar antes de la próxima auditoría.`);
    if (casos.total) hallazgos.push(`Registro de casos: ${casos.vivos} abiertos (${casos.cronicos} crónicos con 3+ detecciones, ${casos.vencidos} con fecha límite vencida), edad promedio ${casos.edadPromedio} días. Tasa de reincidencia ${casos.tasaReincidencia}% sobre ${casos.cerrados + casos.reincidentes} casos cerrados alguna vez.`);

    const censo = items.slice().sort((a, b) => b.diasEnDeposito - a.diasEnDeposito).map(i => ({
        codigo: i.codigo, prefijo: i.prefijo, cliente: i.cliente, clienteTipo: i.clienteTipo, trabajo: i.trabajo, estado: i.estadoActualId, dias: i.diasEnDeposito,
        avisado: i.avisado, fechaAviso: i.fechaAviso, moneda: i.moneda === 2 ? 'US$' : '$', costo: i.costo, valorPesos: i.valorPesos, pagoEstado: i.pagoEstado, estante: i.estante, retiro: i.ordenRetiro,
        verificada: auditData ? auditData.ok.some(o => o.ordIdOrden === i.ordIdOrden) : null,
    }));

    return {
        generado: ahora, auditoria, resumen, hallazgos, aging, sinAvisar,
        duplicadas: { codigo: dupCodigo, clienteDia: dupClienteDia, lecturasRepetidas },
        valorizacion: { total: valorTotal, porMoneda, porPago, porPrefijo, topClientes: topClientesValor },
        porCliente, casos, censo,
        faltantes: faltantes.map(i => ({ codigo: i.codigo, cliente: i.cliente, dias: i.diasEnDeposito, valor: i.valorPesos, pagoEstado: i.pagoEstado, estante: i.estante })),
        sobrantes: sobrantes.map(i => ({ codigo: i.codigo, cliente: i.cliente, pagoEstado: i.pagoEstado, codigoEscaneado: i.codigoEscaneado })),
        sinIngreso: auditData ? auditData.sinIngreso : [], desconocidos: auditData ? auditData.desconocido : [],
    };
}

/* ═══════════════════════════ CONTEO CÍCLICO (Fase 5) ═══════════════════════════ */

async function leerConfigCiclico(pool) {
    const r = await pool.request().query(`SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave IN ('AUDIT_DEP_CICLICO_DIAS_A','AUDIT_DEP_CICLICO_DIAS_B','AUDIT_DEP_CICLICO_DIAS_C','AUDIT_DEP_ABC_CORTES')`);
    const m = {}; r.recordset.forEach(x => { m[String(x.Clave).trim()] = x.Valor; });
    const cortes = String(m.AUDIT_DEP_ABC_CORTES || '80,95').split(',').map(Number);
    return {
        diasA: parseInt(m.AUDIT_DEP_CICLICO_DIAS_A, 10) || 7,
        diasB: parseInt(m.AUDIT_DEP_CICLICO_DIAS_B, 10) || 14,
        diasC: parseInt(m.AUDIT_DEP_CICLICO_DIAS_C, 10) || 30,
        corteA: Number.isFinite(cortes[0]) ? cortes[0] : 80,
        corteB: Number.isFinite(cortes[1]) ? cortes[1] : 95,
    };
}

/**
 * Plan de conteo cíclico por área (prefijo): clase ABC por valor acumulado en depósito, última auditoría que
 * cubrió el área, días transcurridos, frecuencia según la clase y estado (NUNCA / VENCIDO / PROXIMO / AL_DIA).
 */
async function planCiclico() {
    const pool = await getPool();
    const cfg = await svc.leerConfig(pool);
    const cic = await leerConfigCiclico(pool);
    const areas = (await pool.request().input('Cot', sql.Decimal(18, 4), cfg.cotDolar).query(`
        SELECT UPPER(LEFT(o.OrdCodigoOrden, CHARINDEX('-', o.OrdCodigoOrden + '-') - 1)) AS prefijo, COUNT(*) AS n,
               SUM(CASE WHEN o.MonIdMoneda = 2 THEN ROUND(ISNULL(o.OrdCostoFinal, 0) * @Cot, 2) ELSE ROUND(ISNULL(o.OrdCostoFinal, 0), 2) END) AS pesos,
               MAX(DATEDIFF(day, o.OrdFechaIngresoOrden, GETDATE())) AS masAntigua,
               SUM(CASE WHEN DATEDIFF(day, o.OrdFechaIngresoOrden, GETDATE()) > ${parseInt(cfg.diasMax, 10) || 15} THEN 1 ELSE 0 END) AS caducadas,
               SUM(CASE WHEN ISNULL(o.OrdAvisoWsp, 0) = 0 THEN 1 ELSE 0 END) AS sinAviso
        FROM dbo.OrdenesDeposito o WITH(NOLOCK)
        WHERE (o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL) AND o.OrdCodigoOrden LIKE '%-%'
        GROUP BY UPPER(LEFT(o.OrdCodigoOrden, CHARINDEX('-', o.OrdCodigoOrden + '-') - 1))`)).recordset;
    const auds = (await pool.request().query(`SELECT AudId, AudCodigo, AudFechaCierre, AudAlcanceTipo, AudAlcanceValor, AudEstado FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado IN ('CERRADA','ABIERTA') ORDER BY AudFechaCierre DESC, AudId DESC`)).recordset;
    const abierta = auds.find(a => a.AudEstado === 'ABIERTA') || null;
    const cerradas = auds.filter(a => a.AudEstado === 'CERRADA');
    const cubre = (a, pref) => a.AudAlcanceTipo === 'TOTAL' || String(a.AudAlcanceValor || '').toUpperCase().split(',').map(s => s.trim()).includes(pref);
    const casosVivos = (await pool.request().query(`SELECT Prefijo, COUNT(*) AS n FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') GROUP BY Prefijo`)).recordset;
    const casosPorPref = {}; casosVivos.forEach(c => { casosPorPref[String(c.Prefijo || '').toUpperCase()] = c.n; });

    const totalPesos = areas.reduce((a, x) => a + Number(x.pesos || 0), 0);
    const totalN = areas.reduce((a, x) => a + x.n, 0);
    const ordenadas = areas.slice().sort((a, b) => Number(b.pesos) - Number(a.pesos));
    let acumulado = 0;
    const hoy = new Date();
    const plan = ordenadas.map(a => {
        acumulado += Number(a.pesos || 0);
        const pctAcum = pct(acumulado, totalPesos);
        const clase = pctAcum <= cic.corteA ? 'A' : pctAcum <= cic.corteB ? 'B' : 'C';
        const frecuencia = clase === 'A' ? cic.diasA : clase === 'B' ? cic.diasB : cic.diasC;
        const ultima = cerradas.find(x => cubre(x, a.prefijo)) || null;
        const diasDesde = ultima ? diasEntre(ultima.AudFechaCierre, hoy) : null;
        let estado = 'NUNCA';
        if (ultima) estado = diasDesde > frecuencia ? 'VENCIDO' : diasDesde >= frecuencia - 2 ? 'PROXIMO' : 'AL_DIA';
        const proxima = ultima ? new Date(new Date(ultima.AudFechaCierre).getTime() + frecuencia * 86400000) : hoy;
        return {
            prefijo: a.prefijo, n: a.n, pct: pct(a.n, totalN), pesos: r2(a.pesos), pctValor: pct(Number(a.pesos), totalPesos), pctAcumulado: pctAcum,
            masAntigua: a.masAntigua || 0, caducadas: a.caducadas || 0, sinAviso: a.sinAviso || 0, casosAbiertos: casosPorPref[a.prefijo] || 0,
            clase, frecuenciaDias: frecuencia,
            ultimaAuditoria: ultima ? { codigo: ultima.AudCodigo, fecha: ultima.AudFechaCierre, alcance: ultima.AudAlcanceTipo === 'TOTAL' ? 'completo' : ultima.AudAlcanceValor } : null,
            diasDesde, estado, atraso: ultima ? Math.max(0, diasDesde - frecuencia) : null, proximaFecha: proxima,
            enAuditoriaAbierta: !!(abierta && cubre(abierta, a.prefijo)),
        };
    });
    const peso = { NUNCA: 0, VENCIDO: 1, PROXIMO: 2, AL_DIA: 3 };
    plan.sort((a, b) => peso[a.estado] - peso[b.estado] || (b.atraso || 0) - (a.atraso || 0) || b.pesos - a.pesos);
    const alDia = plan.filter(p => p.estado === 'AL_DIA' || p.estado === 'PROXIMO');
    const cobertura = pct(alDia.reduce((a, p) => a + p.n, 0), totalN);
    return {
        generado: hoy, parametros: { ...cic, cotizacion: cfg.cotDolar, diasMax: cfg.diasMax },
        areas: plan,
        totales: { areas: plan.length, ordenes: totalN, pesos: r2(totalPesos), nunca: plan.filter(p => p.estado === 'NUNCA').length, vencidas: plan.filter(p => p.estado === 'VENCIDO').length,
            proximas: plan.filter(p => p.estado === 'PROXIMO').length, alDia: plan.filter(p => p.estado === 'AL_DIA').length, coberturaOrdenes: cobertura,
            clases: { A: plan.filter(p => p.clase === 'A').length, B: plan.filter(p => p.clase === 'B').length, C: plan.filter(p => p.clase === 'C').length } },
        sugeridas: plan.filter(p => p.estado === 'NUNCA' || p.estado === 'VENCIDO' || p.estado === 'PROXIMO').slice(0, 3).map(p => p.prefijo),
        auditoriaAbierta: abierta ? { codigo: abierta.AudCodigo, alcance: abierta.AudAlcanceTipo === 'TOTAL' ? 'completo' : abierta.AudAlcanceValor } : null,
    };
}

/** Usuarios internos activos (para asignar responsable de un caso). */
async function listarUsuariosInternos() {
    const pool = await getPool();
    const r = await pool.request().query(`SELECT IdUsuario, Nombre, Usuario FROM dbo.Usuarios WITH(NOLOCK) WHERE ISNULL(Activo, 1) = 1 ORDER BY Nombre, Usuario`);
    return r.recordset.map(u => ({ id: u.IdUsuario, nombre: String(u.Nombre || u.Usuario || `usuario ${u.IdUsuario}`).trim() }));
}

module.exports = { construirReporte, planCiclico, listarUsuariosInternos, TRAMOS };
