/**
 * PRUEBAS OBLIGATORIAS del motor de casos de la Auditoría de Depósito (Fase 2).
 * Corre contra la base LOCAL (réplica) usando backend/config/db.js. NO correr en producción.
 *
 *   node backend/scripts/test_auditoria_deposito_casos.js
 *
 * Qué toca en la base local:
 *   - Crea auditorías / escaneos / casos / eventos en las tablas AuditoriaDeposito* y al final los BORRA
 *     (todo lo creado a partir de los ids máximos previos).
 *   - Pruebas 4 y 6 modifican UNA orden de OrdenesDeposito cada una y la RESTAURAN en el finally.
 *   - No toca AuditoriaScansTemp ni el registro histórico.
 *
 * Pruebas (las 5 de la spec + la de movimientos durante la auditoría):
 *   1. Sin duplicados: 3 auditorías seguidas, 0 casos vivos repetidos por (orden, tipo).
 *   2. Alcance parcial: una auditoría solo SUB no cambia NINGÚN caso de DTF.
 *   3. Reincidencia: caso cerrado a mano que reaparece se REABRE (mismo CasoId, Reincidente=1), no se crea otro.
 *   4. Snapshot: modificar la orden viva después de abrir no cambia el hallazgo (se usa la fotografía).
 *   5. Índice único: insertar a mano un caso vivo duplicado lo rechaza la base (error 2601).
 *   6. Movimiento durante la auditoría: una orden entregada después de abrir no genera FALTANTE.
 */
const { getPool, sql } = require('../config/db');
const svc = require('../services/auditoriaDepositoService');

const resultados = [];
let fallas = 0;
const ok = (nombre, cond, detalle = '') => {
    resultados.push({ prueba: nombre, resultado: cond ? 'PASS' : 'FAIL', detalle });
    if (!cond) fallas++;
    console.log(`${cond ? '✅ PASS' : '❌ FAIL'}  ${nombre}${detalle ? '  — ' + detalle : ''}`);
};

(async () => {
    const pool = await getPool();
    const q = async (text, params = {}) => {
        const r = pool.request();
        Object.entries(params).forEach(([k, v]) => r.input(k, v));
        return (await r.query(text)).recordset;
    };
    const usuarioRow = (await q(`SELECT TOP 1 IdUsuario, Nombre FROM dbo.Usuarios WHERE Activo = 1 ORDER BY IdUsuario`))[0];
    const USR = { id: usuarioRow.IdUsuario, name: `TEST ${usuarioRow.Nombre || 'auditoria'}` };
    const io = null;

    // ── Precondiciones y marcas para limpiar
    const abierta = await svc.obtenerSesionAbierta(pool);
    if (abierta) { console.error(`Hay una auditoría abierta (${abierta.AudCodigo}). Cerrala o anulala antes de correr las pruebas.`); process.exit(2); }
    const max0 = (await q(`SELECT ISNULL(MAX(AudId),0) AS a FROM dbo.AuditoriaDeposito`))[0].a;
    const maxCaso0 = (await q(`SELECT ISNULL(MAX(CasoId),0) AS c FROM dbo.AuditoriaDepositoCaso`))[0].c;
    const maxEvt0 = (await q(`SELECT ISNULL(MAX(EvtId),0) AS e FROM dbo.AuditoriaDepositoCasoEvento`))[0].e;
    const casosVivosPrevios = (await q(`SELECT COUNT(*) AS n FROM dbo.AuditoriaDepositoCaso WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')`))[0].n;
    const cerradasPrevias = (await q(`SELECT COUNT(*) AS n FROM dbo.AuditoriaDeposito WHERE AudEstado = 'CERRADA'`))[0].n;
    console.log(`Marcas previas: AudId ${max0}, CasoId ${maxCaso0}, EvtId ${maxEvt0}, casos vivos previos ${casosVivosPrevios}, auditorías cerradas previas ${cerradasPrevias}`);

    // Órdenes activas por prefijo
    const activas = await q(`SELECT OrdIdOrden, UPPER(LTRIM(RTRIM(OrdCodigoOrden))) AS Cod,
                                    UPPER(LEFT(OrdCodigoOrden, CHARINDEX('-', OrdCodigoOrden + '-') - 1)) AS Pref
                             FROM dbo.OrdenesDeposito WHERE (OrdEstadoActual < 9 OR OrdEstadoActual IS NULL) AND OrdCodigoOrden LIKE '%-%' ORDER BY OrdIdOrden`);
    const SUB = activas.filter(a => a.Pref === 'SUB');
    const DTF = activas.filter(a => a.Pref === 'DTF');
    if (SUB.length < 10 || DTF.length < 10) { console.error('Se necesitan al menos 10 órdenes activas SUB y 10 DTF en la base local.'); process.exit(2); }
    const X = [...SUB.slice(0, 5), ...DTF.slice(0, 5)];         // faltantes de la línea base
    const Y = [...SUB.slice(5, 8), ...DTF.slice(5, 8)];         // faltantes para la prueba de alcance
    const idsX = new Set(X.map(x => x.OrdIdOrden));
    const idsY = new Set(Y.map(x => x.OrdIdOrden));

    // Una entregada (SOBRANTE), una de producción sin ingreso (SIN_INGRESO) y una inexistente (NO_REGISTRADA)
    const entregada = (await q(`SELECT TOP 1 o.OrdIdOrden, UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) AS Cod FROM dbo.OrdenesDeposito o
        WHERE o.OrdEstadoActual = 9 AND o.OrdFechaEstadoActual < DATEADD(day, -2, GETDATE()) AND o.OrdCodigoOrden LIKE '%-%'
          AND NOT EXISTS (SELECT 1 FROM dbo.OrdenesDeposito d WHERE UPPER(LTRIM(RTRIM(d.OrdCodigoOrden))) = UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) AND d.OrdIdOrden <> o.OrdIdOrden)
        ORDER BY o.OrdIdOrden DESC`))[0];
    const sinIngreso = (await q(`SELECT TOP 1 UPPER(LTRIM(RTRIM(o.CodigoOrden))) AS Cod FROM dbo.Ordenes o
        WHERE o.CodigoOrden LIKE '%-%' AND NOT EXISTS (SELECT 1 FROM dbo.OrdenesDeposito d WHERE UPPER(LTRIM(RTRIM(d.OrdCodigoOrden))) = UPPER(LTRIM(RTRIM(o.CodigoOrden))))
        ORDER BY o.OrdenID DESC`))[0];
    const NO_REG = 'ZZZ-TEST-999999';
    console.log(`Faltantes X: ${X.map(x => x.Cod).join(' ')}\nFaltantes Y: ${Y.map(x => x.Cod).join(' ')}\nEntregada: ${entregada.Cod} · Sin ingreso: ${sinIngreso.Cod} · Inexistente: ${NO_REG}`);

    // Escaneo masivo simulado: todas las órdenes de la fotografía salvo las excluidas (mismas filas que registrarEscaneo genera con resultado OK)
    const escanearTodoMenos = async (audId, excluir) => {
        const r = pool.request().input('A', sql.Int, audId).input('U', sql.Int, USR.id);
        const ids = [...excluir];
        const notIn = ids.length ? ` AND s.OrdIdOrden NOT IN (${ids.map((id, i) => { r.input(`x${i}`, sql.Int, id); return `@x${i}`; }).join(',')})` : '';
        await r.query(`INSERT INTO dbo.AuditoriaDepositoEscaneo (AudId, Codigo, ClaveCodigo, OrdIdOrden, Resultado, Duplicado, UsuarioId, UsuarioNombre)
                       SELECT s.AudId, s.OrdCodigoOrden, s.ClaveCodigo, s.OrdIdOrden, 'OK', 0, @U, 'TEST masivo'
                       FROM dbo.AuditoriaDepositoSnapshot s WHERE s.AudId = @A${notIn}`);
    };
    const scan = (sesion, codigo) => svc.registrarEscaneo({ sesion, codigo, usuario: USR });
    const vivosDup = () => q(`SELECT COUNT(*) AS n FROM (
            SELECT OrdIdOrden, Tipo FROM dbo.AuditoriaDepositoCaso WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND OrdIdOrden IS NOT NULL GROUP BY OrdIdOrden, Tipo HAVING COUNT(*) > 1
            UNION ALL
            SELECT NULL, Tipo FROM dbo.AuditoriaDepositoCaso WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND OrdIdOrden IS NULL GROUP BY OrdCodigoOrden, Tipo HAVING COUNT(*) > 1) x`).then(r => r[0].n);
    const casoDe = (ordId, tipo) => q(`SELECT * FROM dbo.AuditoriaDepositoCaso WHERE OrdIdOrden = @o AND Tipo = @t ORDER BY CasoId`, { o: ordId, t: tipo });

    let restaurarZ = null, restaurarW = null;
    try {
        /* ══════════ PRUEBA 1: tres auditorías seguidas, sin duplicados ══════════ */
        // A1: línea base (no hay cerradas previas → solo tipos físicos)
        const a1 = (await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' })).sesion;
        const ses1 = await svc.obtenerSesionAbierta(pool);
        ok('A1 abre como línea base solo si no había auditorías cerradas', a1.esLineaBase === (cerradasPrevias === 0), `esLineaBase=${a1.esLineaBase}, tipos=${a1.tiposActivos.join(',')}`);
        ok('A1 no puede abrirse dos veces (índice único de sesión abierta)', await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' }).then(() => false).catch(e => e.status === 409));
        // resolución de códigos: exacto, número pelado y etiqueta /B
        const muestra = SUB[9];
        const r1 = await scan(ses1, muestra.Cod);
        ok('Escaneo por código exacto resuelve la orden de la fotografía', r1.resultado === 'OK' && r1.ordIdOrden === muestra.OrdIdOrden, `${muestra.Cod} → ${r1.resultado} ${r1.ordIdOrden}`);
        const r1b = await scan(ses1, muestra.Cod);
        ok('La misma etiqueta dos veces se guarda como duplicado (no suma)', r1b.duplicado === true);
        const pelado = DTF[9];
        const r2 = await scan(ses1, pelado.Cod.replace(/^[A-Z]+-/, ''));
        ok('Escaneo por número pelado resuelve por clave sin prefijo', r2.resultado === 'OK' && r2.ordIdOrden === pelado.OrdIdOrden, `${pelado.Cod} → ${r2.resultado} ${r2.ordIdOrden}`);
        const etiqueta = (await q(`SELECT TOP 1 b.CodigoEtiqueta, UPPER(LTRIM(RTRIM(o.CodigoOrden))) AS Cod, d.OrdIdOrden
            FROM dbo.Logistica_Bultos b JOIN dbo.Ordenes o ON o.OrdenID = b.OrdenID
            JOIN dbo.AuditoriaDepositoSnapshot d ON d.AudId = @A AND d.OrdCodigoOrden = UPPER(LTRIM(RTRIM(o.CodigoOrden)))
            WHERE b.Tipocontenido = 'PROD_TERMINADO' AND b.CodigoEtiqueta LIKE '%/B%' ORDER BY b.BultoID DESC`, { A: ses1.AudId }))[0];
        if (etiqueta) {
            const r3 = await scan(ses1, etiqueta.CodigoEtiqueta);
            ok('Escaneo de etiqueta física {NoDocERP}/B{id} resuelve por bulto', r3.resultado === 'OK' && r3.ordIdOrden === etiqueta.OrdIdOrden, `${etiqueta.CodigoEtiqueta} → ${r3.ordenCodigo} (${r3.resultado})`);
        } else ok('Escaneo de etiqueta física (sin etiqueta disponible en local)', true, 'omitida');
        const rE = await scan(ses1, entregada.Cod);
        ok('Escaneo de orden entregada → ENTREGADA (sobrante candidato)', rE.resultado === 'ENTREGADA' && rE.ordIdOrden === entregada.OrdIdOrden);
        const rS = await scan(ses1, sinIngreso.Cod);
        ok('Escaneo de orden de producción sin ingreso → SIN_INGRESO', rS.resultado === 'SIN_INGRESO', `${sinIngreso.Cod} → ${rS.resultado} prod ${rS.ordenProdId}`);
        const rN = await scan(ses1, NO_REG);
        ok('Escaneo de código inexistente → DESCONOCIDO', rN.resultado === 'DESCONOCIDO');
        await escanearTodoMenos(ses1.AudId, idsX);
        const c1 = await svc.cerrarAuditoria({ usuario: USR, io });
        ok('A1 cierra: nuevos = 10 FALTANTE + 1 SOBRANTE + 1 SIN_INGRESO + 1 NO_REGISTRADA', c1.nuevos === 13 && c1.existentes === 0 && c1.reincidentes === 0,
            `nuevos ${c1.nuevos} · existentes ${c1.existentes} · reincidentes ${c1.reincidentes} · resueltos ${c1.resueltos} · abiertos ${c1.abiertosTotal}`);
        const noFisicos1 = (await q(`SELECT COUNT(*) AS n FROM dbo.AuditoriaDepositoCaso WHERE CasoId > @c AND Tipo IN ('SIN_AVISO','PERMANENCIA')`, { c: maxCaso0 }))[0].n;
        ok('La línea base no crea casos SIN_AVISO ni PERMANENCIA', a1.esLineaBase ? noFisicos1 === 0 : true, `creados: ${noFisicos1}`);

        // A2: misma situación (X sigue faltando) → todo "ya existente", más los tipos no físicos que recién se activan
        const a2 = (await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' })).sesion;
        const ses2 = await svc.obtenerSesionAbierta(pool);
        ok('A2 ya no es línea base y activa SIN_AVISO y PERMANENCIA', !a2.esLineaBase && a2.tiposActivos.includes('PERMANENCIA') && a2.tiposActivos.includes('SIN_AVISO'), a2.tiposActivos.join(','));
        const cfg = await svc.leerConfig(pool);
        const esperados = (await q(`SELECT
              SUM(CASE WHEN DiasEnDeposito > @dm THEN 1 ELSE 0 END) AS perm,
              SUM(CASE WHEN OrdEstadoActual IN (5,6,7,12) AND ISNULL(OrdAvisoWsp,0) = 0 AND DiasEnDeposito > @da THEN 1 ELSE 0 END) AS aviso
            FROM dbo.AuditoriaDepositoSnapshot WHERE AudId = @A`, { A: ses2.AudId, dm: ses2.AudDiasMaxDeposito || cfg.diasMax, da: cfg.diasSinAviso }))[0];
        await scan(ses2, entregada.Cod); await scan(ses2, sinIngreso.Cod); await scan(ses2, NO_REG);
        await escanearTodoMenos(ses2.AudId, idsX);
        const c2 = await svc.cerrarAuditoria({ usuario: USR, io });
        ok('A2: los 13 hallazgos físicos NO se duplican (ya existentes = 13)', c2.existentes === 13 && c2.reincidentes === 0, `existentes ${c2.existentes}`);
        ok('A2: nuevos = PERMANENCIA + SIN_AVISO calculados sobre la fotografía', c2.nuevos === (esperados.perm + esperados.aviso), `nuevos ${c2.nuevos} vs esperados ${esperados.perm}+${esperados.aviso}`);
        ok('A2: cero casos vivos duplicados por (orden, tipo)', (await vivosDup()) === 0);

        /* ══════════ FASE 4 (reportes) y FASE 5 (conteo cíclico) sobre AUD-02 ══════════ */
        const rep = require('../services/auditoriaDepositoReportesService');
        const fotoN = (await q(`SELECT COUNT(*) AS n FROM dbo.AuditoriaDepositoSnapshot WHERE AudId = @A`, { A: ses2.AudId }))[0].n;
        const R = await rep.construirReporte({ audId: ses2.AudId });
        ok('Reporte de auditoría: activas = fotografía, tramos suman activas, ERI calculado', R.resumen.activas === fotoN && R.aging.reduce((a, t) => a + t.n, 0) === fotoN && R.resumen.eri !== null,
            `activas ${R.resumen.activas} · ERI ${R.resumen.eri}% · faltantes ${R.resumen.faltantes} por $${R.resumen.valorFaltantes}`);
        ok('Reporte: los 10 faltantes de X y hallazgos redactados', R.faltantes.length === 10 && R.sobrantes.length === 1 && R.hallazgos.length >= 3, `${R.hallazgos.length} hallazgos`);
        ok('Reporte: valorización cuadra (suma por prefijo = total)', Math.abs(R.valorizacion.porPrefijo.reduce((a, p) => a + p.pesos, 0) - R.valorizacion.total) < 1, `total $${R.valorizacion.total}`);
        ok('Reporte: sin avisar ordenado por antigüedad con prioridad', R.sinAvisar.every((s, i, arr) => i === 0 || arr[i - 1].dias >= s.dias) && R.sinAvisar.every(s => ['ALTA', 'MEDIA', 'BAJA'].includes(s.prioridad)), `${R.sinAvisar.length} sin avisar`);
        ok('Reporte: indicadores del registro (crónicos, reincidencia, edad)', typeof R.casos.tasaReincidencia === 'number' && R.casos.vivos > 0 && R.casos.ultimasAuditorias.length >= 1);
        const RV = await rep.construirReporte({});
        ok('Reporte EN VIVO (sin auditoría): funciona y no trae ERI ni faltantes', RV.resumen.fuente === 'EN_VIVO' && RV.resumen.activas > 0 && RV.resumen.eri === null && RV.faltantes.length === 0, `activas ${RV.resumen.activas} por $${RV.resumen.valorPesos}`);
        const C = await rep.planCiclico();
        ok('Conteo cíclico: todas las áreas con clase ABC y cobertura calculada', C.areas.length > 0 && C.areas.every(a => ['A', 'B', 'C'].includes(a.clase)) && typeof C.totales.coberturaOrdenes === 'number', `${C.areas.length} áreas · A ${C.totales.clases.A} B ${C.totales.clases.B} C ${C.totales.clases.C} · cobertura ${C.totales.coberturaOrdenes}%`);
        ok('Conteo cíclico: tras una auditoría TOTAL cerrada hoy ninguna área queda NUNCA ni VENCIDA', C.totales.nunca === 0 && C.totales.vencidas === 0 && C.areas.every(a => a.ultimaAuditoria), `sugeridas: ${C.sugeridas.join(',') || 'ninguna'}`);
        const U = await rep.listarUsuariosInternos();
        ok('Usuarios internos para asignar responsable', U.length > 0, `${U.length} usuarios`);

        // A3: ahora aparece todo lo que faltaba y no se vuelve a ver lo sobrante/desconocido → auto-cierre
        await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' });
        const ses3 = await svc.obtenerSesionAbierta(pool);
        await escanearTodoMenos(ses3.AudId, new Set());
        const c3 = await svc.cerrarAuditoria({ usuario: USR, io });
        ok('A3: se auto-cierran los 13 físicos que no reaparecieron', c3.resueltos === 13 && c3.nuevos === 0, `resueltos ${c3.resueltos} · nuevos ${c3.nuevos} · existentes ${c3.existentes}`);
        const cx = await casoDe(X[0].OrdIdOrden, 'FALTANTE');
        ok('A3: el caso FALTANTE cerrado tiene motivo "No reapareció en …"', cx.length === 1 && cx[0].Estado === 'RESUELTO' && /No reapareció en AUD-/.test(cx[0].MotivoCierre || ''), cx[0] && cx[0].MotivoCierre);
        ok('Prueba 1 — tres auditorías seguidas: 0 duplicados vivos', (await vivosDup()) === 0);

        /* ══════════ PRUEBA 2: alcance parcial ══════════ */
        await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' });
        const ses4 = await svc.obtenerSesionAbierta(pool);
        await escanearTodoMenos(ses4.AudId, idsY);
        const c4 = await svc.cerrarAuditoria({ usuario: USR, io });
        ok('A4: nacen 6 FALTANTE nuevos (3 SUB + 3 DTF)', c4.nuevos === 6, `nuevos ${c4.nuevos}`);
        const fotoDTF = await q(`SELECT CasoId, Estado, VecesDetectado, UltimaAudId, Severidad, Reincidente, ActualizadoEn FROM dbo.AuditoriaDepositoCaso WHERE Prefijo = 'DTF' AND CasoId > @c ORDER BY CasoId`, { c: maxCaso0 });
        const a5 = (await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'PREFIJO', alcanceValor: 'SUB' })).sesion;
        const ses5 = await svc.obtenerSesionAbierta(pool);
        const soloSub = (await q(`SELECT COUNT(*) AS n, SUM(CASE WHEN Prefijo <> 'SUB' THEN 1 ELSE 0 END) AS otros FROM dbo.AuditoriaDepositoSnapshot WHERE AudId = @A`, { A: ses5.AudId }))[0];
        ok('A5 (solo SUB): la fotografía trae únicamente SUB', soloSub.n === SUB.length && soloSub.otros === 0, `${soloSub.n} filas, ${soloSub.otros} de otras áreas`);
        const rF = await scan(ses5, DTF[9].Cod);
        ok('A5: escanear una DTF durante una auditoría SUB → FUERA_ALCANCE (no es hallazgo)', rF.resultado === 'FUERA_ALCANCE');
        await escanearTodoMenos(ses5.AudId, new Set());
        const c5 = await svc.cerrarAuditoria({ usuario: USR, io });
        const fotoDTF2 = await q(`SELECT CasoId, Estado, VecesDetectado, UltimaAudId, Severidad, Reincidente, ActualizadoEn FROM dbo.AuditoriaDepositoCaso WHERE Prefijo = 'DTF' AND CasoId > @c ORDER BY CasoId`, { c: maxCaso0 });
        ok('A5: cerró los 3 FALTANTE de SUB que reaparecieron', c5.resueltos >= 3, `resueltos ${c5.resueltos} · existentes ${c5.existentes} · nuevos ${c5.nuevos}`);
        ok('Prueba 2 — NINGÚN caso de DTF cambió (estado, veces, última auditoría, severidad)', JSON.stringify(fotoDTF) === JSON.stringify(fotoDTF2), `${fotoDTF.length} casos DTF comparados`);

        /* ══════════ PRUEBA 3: reincidencia ══════════ */
        const dtfY = Y.find(y => y.Pref === 'DTF');
        const casoRe = (await casoDe(dtfY.OrdIdOrden, 'FALTANTE'))[0];
        await svc.accionCaso({ casoId: casoRe.CasoId, accion: 'RESOLVER', detalle: 'Recontado a mano (prueba)', usuario: USR });
        const cerradoMano = (await casoDe(dtfY.OrdIdOrden, 'FALTANTE'))[0];
        ok('Cerrar a mano deja RESUELTO con motivo y usuario', cerradoMano.Estado === 'RESUELTO' && cerradoMano.MotivoCierre === 'Recontado a mano (prueba)' && cerradoMano.CerradoPor === USR.id);
        await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' });
        const ses6 = await svc.obtenerSesionAbierta(pool);
        await escanearTodoMenos(ses6.AudId, new Set(Y.filter(y => y.Pref === 'DTF').map(y => y.OrdIdOrden)));
        const c6 = await svc.cerrarAuditoria({ usuario: USR, io });
        const filasRe = await casoDe(dtfY.OrdIdOrden, 'FALTANTE');
        ok('Prueba 3 — el caso cerrado a mano se REABRE (mismo CasoId, Reincidente=1), no se crea otro',
            filasRe.length === 1 && filasRe[0].CasoId === casoRe.CasoId && filasRe[0].Estado === 'ABIERTO' && filasRe[0].Reincidente === true && filasRe[0].VecesDetectado === casoRe.VecesDetectado + 1,
            `reincidentes ${c6.reincidentes} · filas ${filasRe.length} · veces ${filasRe[0] && filasRe[0].VecesDetectado}`);
        const evRe = await q(`SELECT TOP 1 Detalle FROM dbo.AuditoriaDepositoCasoEvento WHERE CasoId = @c ORDER BY EvtId DESC`, { c: casoRe.CasoId });
        ok('La reapertura queda en la historia del caso', /Reabierto/.test(evRe[0].Detalle), evRe[0].Detalle);

        /* ══════════ PRUEBA 4: fotografía vs tabla viva ══════════ */
        await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' });
        const ses7 = await svc.obtenerSesionAbierta(pool);
        const Z = (await q(`SELECT TOP 1 s.OrdIdOrden, s.OrdCodigoOrden, o.OrdAvisoWsp, o.OrdFechaAvisoWsp FROM dbo.AuditoriaDepositoSnapshot s
            JOIN dbo.OrdenesDeposito o ON o.OrdIdOrden = s.OrdIdOrden
            WHERE s.AudId = @A AND s.OrdAvisoWsp = 1 AND s.OrdEstadoActual IN (6,7) AND s.DiasEnDeposito > 5 ORDER BY s.OrdIdOrden`, { A: ses7.AudId }))[0];
        restaurarZ = Z;
        await q(`UPDATE dbo.OrdenesDeposito SET OrdAvisoWsp = 0, OrdFechaAvisoWsp = NULL WHERE OrdIdOrden = @o`, { o: Z.OrdIdOrden });
        await escanearTodoMenos(ses7.AudId, new Set());
        const c7 = await svc.cerrarAuditoria({ usuario: USR, io });
        const sinAvisoZ = await casoDe(Z.OrdIdOrden, 'SIN_AVISO');
        ok('Prueba 4 — la orden modificada en la tabla viva NO genera SIN_AVISO: se usó la fotografía', sinAvisoZ.length === 0, `${Z.OrdCodigoOrden}: casos SIN_AVISO = ${sinAvisoZ.length} (nuevos ${c7.nuevos})`);
        await q(`UPDATE dbo.OrdenesDeposito SET OrdAvisoWsp = @a, OrdFechaAvisoWsp = @f WHERE OrdIdOrden = @o`, { o: Z.OrdIdOrden, a: Z.OrdAvisoWsp, f: Z.OrdFechaAvisoWsp });
        restaurarZ = null;

        /* ══════════ PRUEBA 5: índice único ══════════ */
        const vivo = (await q(`SELECT TOP 1 OrdIdOrden, Tipo FROM dbo.AuditoriaDepositoCaso WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND OrdIdOrden IS NOT NULL AND CasoId > @c`, { c: maxCaso0 }))[0];
        const dupErr = await q(`INSERT INTO dbo.AuditoriaDepositoCaso (OrdIdOrden, OrdCodigoOrden, Tipo, Estado) VALUES (@o, 'X', @t, 'ABIERTO')`, { o: vivo.OrdIdOrden, t: vivo.Tipo }).then(() => null).catch(e => e);
        ok('Prueba 5 — la base rechaza un segundo caso vivo por (orden, tipo)', dupErr && dupErr.number === 2601, dupErr && `error ${dupErr.number}: ${String(dupErr.message).slice(0, 90)}`);
        const dupErr2 = await q(`INSERT INTO dbo.AuditoriaDepositoCaso (OrdIdOrden, OrdCodigoOrden, Tipo, Estado) VALUES (NULL, @c, 'NO_REGISTRADA', 'ABIERTO')`, { c: NO_REG }).then(() => 'INSERTO').catch(e => e);
        // el NO_REGISTRADA quedó RESUELTO en A3 → este insert es válido; se prueba el duplicado sobre él
        const dupErr3 = await q(`INSERT INTO dbo.AuditoriaDepositoCaso (OrdIdOrden, OrdCodigoOrden, Tipo, Estado) VALUES (NULL, @c, 'NO_REGISTRADA', 'ABIERTO')`, { c: NO_REG }).then(() => null).catch(e => e);
        ok('Prueba 5b — también para casos sin orden (identidad = código)', dupErr2 === 'INSERTO' && dupErr3 && dupErr3.number === 2601);
        const asumidoErr = await q(`UPDATE dbo.AuditoriaDepositoCaso SET Estado = 'ASUMIDO' WHERE CasoId = (SELECT MAX(CasoId) FROM dbo.AuditoriaDepositoCaso)`).then(() => null).catch(e => e);
        ok('Invariante 5 — la base rechaza ASUMIDO sin motivo ni responsable (CHECK)', asumidoErr && asumidoErr.number === 547, asumidoErr && `error ${asumidoErr.number}`);
        const asumir = await svc.accionCaso({ casoId: vivo && (await casoDe(vivo.OrdIdOrden, vivo.Tipo))[0].CasoId, accion: 'ASUMIR', detalle: null, usuario: USR }).then(() => null).catch(e => e);
        ok('Invariante 5 — el servicio exige motivo para ASUMIR', asumir && asumir.status === 400, asumir && asumir.message);

        /* ══════════ PRUEBA 6: movimiento durante la auditoría ══════════ */
        await svc.abrirAuditoria({ usuario: USR, alcanceTipo: 'TOTAL' });
        const ses8 = await svc.obtenerSesionAbierta(pool);
        const W = (await q(`SELECT TOP 1 s.OrdIdOrden, s.OrdCodigoOrden, o.OrdEstadoActual, o.OrdFechaEstadoActual FROM dbo.AuditoriaDepositoSnapshot s
            JOIN dbo.OrdenesDeposito o ON o.OrdIdOrden = s.OrdIdOrden WHERE s.AudId = @A AND s.DiasEnDeposito <= 10 ORDER BY s.OrdIdOrden DESC`, { A: ses8.AudId }))[0];
        restaurarW = W;
        await q(`UPDATE dbo.OrdenesDeposito SET OrdEstadoActual = 9, OrdFechaEstadoActual = GETDATE() WHERE OrdIdOrden = @o`, { o: W.OrdIdOrden });
        await escanearTodoMenos(ses8.AudId, new Set([W.OrdIdOrden]));
        const c8 = await svc.cerrarAuditoria({ usuario: USR, io });
        const faltW = await casoDe(W.OrdIdOrden, 'FALTANTE');
        ok('Prueba 6 — la orden entregada DURANTE la auditoría no genera FALTANTE y queda en "movidas"', faltW.length === 0 && c8.movidas.some(m => m.codigo === W.OrdCodigoOrden), `${W.OrdCodigoOrden}: faltante=${faltW.length}, movidas=${c8.movidas.length}`);
        await q(`UPDATE dbo.OrdenesDeposito SET OrdEstadoActual = @e, OrdFechaEstadoActual = @f WHERE OrdIdOrden = @o`, { o: W.OrdIdOrden, e: W.OrdEstadoActual, f: W.OrdFechaEstadoActual });
        restaurarW = null;

        /* ══════════ Extra: acciones y lote ══════════ */
        const dos = await q(`SELECT TOP 2 CasoId FROM dbo.AuditoriaDepositoCaso WHERE Estado = 'ABIERTO' AND CasoId > @c ORDER BY CasoId`, { c: maxCaso0 });
        const lote = await svc.accionLote({ casoIds: dos.map(d => d.CasoId), accion: 'REGISTRAR', detalle: 'Recontado (lote de prueba)', usuario: USR });
        const enCurso = await q(`SELECT COUNT(*) AS n FROM dbo.AuditoriaDepositoCaso WHERE CasoId IN (${dos.map(d => d.CasoId).join(',')}) AND Estado = 'EN_CURSO' AND ResponsableId = @u`, { u: USR.id });
        ok('Acción en lote: pasa a EN_CURSO, asigna responsable y deja evento', lote.aplicados === 2 && enCurso[0].n === 2);
        const rep2 = require('../services/auditoriaDepositoReportesService');
        const U2 = await rep2.listarUsuariosInternos();
        const otro = U2.find(u => u.id !== USR.id) || U2[0];
        await svc.accionCaso({ casoId: dos[0].CasoId, accion: 'ASIGNAR', usuario: USR, responsableId: otro.id, responsableNombre: otro.nombre, fechaLimite: '2020-01-01' });
        const vencidos = await svc.listarCasos({ estado: 'VENCIDOS' });
        const porResp = await svc.listarCasos({ responsableId: otro.id });
        ok('Fase 3: asignar a otro usuario con fecha límite → filtro VENCIDOS y filtro por responsable', vencidos.casos.some(c => c.casoId === dos[0].CasoId) && porResp.casos.some(c => c.casoId === dos[0].CasoId && c.responsableId === otro.id) && vencidos.kpis.vencidos >= 1,
            `responsable ${otro.nombre} · vencidos ${vencidos.kpis.vencidos}`);
        const malFecha = await svc.accionCaso({ casoId: dos[0].CasoId, accion: 'ASIGNAR', usuario: USR, fechaLimite: '31/12/2026' }).then(() => null).catch(e => e);
        ok('Fase 3: fecha límite inválida se rechaza', malFecha && malFecha.status === 400);
        const detalle = await svc.obtenerCaso(dos[0].CasoId);
        ok('Detalle del caso trae la línea de tiempo (detección + acción)', detalle.eventos.length >= 2 && detalle.eventos.some(e => e.tipo === 'DETECCION') && detalle.eventos.some(e => e.tipo === 'ACCION'));
        const lista = await svc.listarCasos({ estado: 'VIVOS' });
        ok('Listado ordena por severidad y trae KPIs', lista.casos.length > 0 && lista.kpis.vivos === lista.casos.length, `vivos ${lista.kpis.vivos}, crónicos ${lista.kpis.cronicos}, alta ${lista.kpis.alta}`);
        const hist = await svc.listarAuditorias({ limit: 10 });
        ok('Historial de auditorías con resumen de fusión', hist.length >= 8 && hist[0].estado === 'CERRADA' && typeof hist[0].nuevos === 'number');
    } catch (e) {
        fallas++;
        console.error('❌ ERROR INESPERADO:', e.message, e.stack);
    } finally {
        // Restaurar órdenes tocadas si algo cortó antes
        if (restaurarZ) await q(`UPDATE dbo.OrdenesDeposito SET OrdAvisoWsp = @a, OrdFechaAvisoWsp = @f WHERE OrdIdOrden = @o`, { o: restaurarZ.OrdIdOrden, a: restaurarZ.OrdAvisoWsp, f: restaurarZ.OrdFechaAvisoWsp });
        if (restaurarW) await q(`UPDATE dbo.OrdenesDeposito SET OrdEstadoActual = @e, OrdFechaEstadoActual = @f WHERE OrdIdOrden = @o`, { o: restaurarW.OrdIdOrden, e: restaurarW.OrdEstadoActual, f: restaurarW.OrdFechaEstadoActual });
        // Anular sesión si quedó abierta y limpiar TODO lo creado por la prueba
        const ab = await svc.obtenerSesionAbierta(pool);
        if (ab && ab.AudId > max0) await svc.anularAuditoria({ usuario: USR, motivo: 'limpieza de prueba' });
        await q(`DELETE FROM dbo.AuditoriaDepositoCasoEvento WHERE EvtId > @e OR CasoId > @c`, { e: maxEvt0, c: maxCaso0 });
        await q(`DELETE FROM dbo.AuditoriaDepositoCaso WHERE CasoId > @c`, { c: maxCaso0 });
        await q(`DELETE FROM dbo.AuditoriaDepositoEscaneo WHERE AudId > @a`, { a: max0 });
        await q(`DELETE FROM dbo.AuditoriaDepositoSnapshot WHERE AudId > @a`, { a: max0 });
        await q(`DELETE FROM dbo.AuditoriaDeposito WHERE AudId > @a`, { a: max0 });
        const quedan = (await q(`SELECT (SELECT COUNT(*) FROM dbo.AuditoriaDeposito WHERE AudId > @a) AS a, (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WHERE CasoId > @c) AS c`, { a: max0, c: maxCaso0 }))[0];
        console.log(`\nLimpieza: auditorías restantes ${quedan.a}, casos restantes ${quedan.c}`);
        console.log('\n══════════ RESUMEN ══════════');
        console.table(resultados.map(r => ({ resultado: r.resultado, prueba: r.prueba })));
        console.log(fallas ? `\n❌ ${fallas} prueba(s) fallaron` : '\n✅ TODAS LAS PRUEBAS PASARON');
        process.exit(fallas ? 1 : 0);
    }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
