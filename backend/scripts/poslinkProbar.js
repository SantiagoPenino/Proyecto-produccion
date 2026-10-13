/**
 * poslinkProbar.js — consola para POSLink mientras no hay pantallas (F1 del plan,
 * docs/poslink-implementacion-plan.md). Corre contra el servidor que diga POSLINK_URL
 * en el .env: en esta PC es el de HOMOLOGACIÓN.
 *
 * Uso (desde la carpeta del backend):
 *   node scripts/poslinkProbar.js terminales
 *   node scripts/poslinkProbar.js alta <ETIQUETA> <POSID> <TOTEM|CAJA> ["descripción"]
 *   node scripts/poslinkProbar.js prueba <ETIQUETA> <monto> [USD]
 *        Venta de prueba (la terminal puede estar inactiva). Polea cada 2,5 s y muestra el
 *        estado hasta que termine. Ctrl+C la cancela si el POS todavía no la tomó.
 *   node scripts/poslinkProbar.js activar <ETIQUETA>      (después de ver el importe en SU pantalla)
 *   node scripts/poslinkProbar.js desactivar <ETIQUETA>
 *   node scripts/poslinkProbar.js estado <uuid>
 *   node scripts/poslinkProbar.js cancelar <uuid>
 *   node scripts/poslinkProbar.js resolver <uuid> <CANCELADA|REGISTRADA|APROBADA|REVERSADA> ["nota"]
 *        (REVERSADA solo para una reversa pendiente que no se confirma sola)
 *   node scripts/poslinkProbar.js barrido
 *   node scripts/poslinkProbar.js tipo <ETIQUETA> <TOTEM|CAJA> [NUEVA_ETIQUETA]
 *   node scripts/poslinkProbar.js clave <ETIQUETA>      (tótem: genera la clave del POS → /totem?pos=CLAVE)
 *   node scripts/poslinkProbar.js ventas [dias]          (ventas con tarjeta que se pueden anular)
 *   node scripts/poslinkProbar.js anular <uuidVenta> [monto] ["motivo"]
 *        Anulación si la venta sigue en el lote abierto del POS; si no, devolución (total o parcial).
 *
 * Una terminal se ACTIVA solo después de una venta de prueba que aparezca en su propia pantalla:
 * un PosID mal cargado no da "pinpad inválido": la venta queda esperando sin que nadie la tome
 * (pasó con 99999999) o vuelve 999 (99999998, 12345678). Probado en homologación el 12/10.
 */
const { getPool, sql } = require('../config/db');
const svc = require('../services/poslink/poslinkService');
const { FINALES, E } = require('../services/poslink/poslinkEstados');

const [, , cmd, ...args] = process.argv;
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

function mostrar(f) {
    if (!f) { console.log('No existe.'); return; }
    const monto = `${f.PtxMonedaId === 2 ? 'US$' : '$'} ${(Number(f.PtxMontoCentesimos) / 100).toFixed(2)}`;
    console.log(`${f.PtxUuid}  #${f.PtxId}  ${f.PteEtiqueta}  ${monto}  → ${f.PtxEstado}`
        + `${f.PtxResponseCode != null ? `  rc=${f.PtxResponseCode}` : ''}`
        + `${f.PtxPosResponseCode ? `  pos=${f.PtxPosResponseCode}` : ''}`
        + `${f.PtxRemainingExpTime != null ? `  quedan=${f.PtxRemainingExpTime}s` : ''}`
        + `${f.PtxRequiereRevision ? '  [REVISAR]' : ''}`);
    if (f.PtxObservaciones) console.log(`   ${f.PtxObservaciones}`);
}

async function terminal(etiqueta) {
    const pool = await getPool();
    const r = await pool.request().input('Et', sql.VarChar(50), String(etiqueta || '').toUpperCase())
        .query('SELECT * FROM dbo.PosTerminales WHERE PteEtiqueta = @Et');
    if (!r.recordset.length) throw new Error(`No existe la terminal ${etiqueta}.`);
    return r.recordset[0];
}

async function main() {
    if (!svc.estaConfigurado()) throw new Error('Falta POSLINK_URL / POSLINK_SYSTEM_ID en el .env.');
    console.log(`Servidor: ${process.env.POSLINK_URL}`);

    switch (cmd) {
        case 'terminales': {
            await svc.obtenerCobro({ id: -1 }); // asegura el esquema
            const r = await (await getPool()).request().query('SELECT * FROM dbo.PosTerminales ORDER BY PteIdTerminal');
            if (!r.recordset.length) console.log('No hay terminales dadas de alta.');
            for (const t of r.recordset) {
                console.log(`${t.PteEtiqueta}  PosID ${t.PtePosID}  ${t.PteTipo}  ${t.PteActivo ? 'ACTIVA' : 'inactiva'}  ${t.PteDescripcion || ''}`);
            }
            break;
        }
        case 'alta': {
            const [etiqueta, posId, tipo, descripcion] = args;
            const t = await svc.altaTerminal({ etiqueta, posId, tipo: String(tipo || '').toUpperCase(), descripcion });
            console.log(`Alta: ${t.PteEtiqueta} (PosID ${t.PtePosID}), INACTIVA. Siguiente paso: venta de prueba.`);
            break;
        }
        case 'activar':
        case 'desactivar': {
            const t = await terminal(args[0]);
            await svc.activarTerminal(t.PteIdTerminal, cmd === 'activar');
            console.log(`${t.PteEtiqueta} ${cmd === 'activar' ? 'ACTIVA' : 'inactiva'}.`);
            break;
        }
        case 'prueba': {
            // prueba <ETIQUETA> <monto> [USD] [--factura <nro> --gravado <monto sin IVA>]
            //   con --factura se pide la devolución de IVA de la Ley 19.210 (TaxRefund 1).
            const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
            const sueltos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
            const [etiqueta, montoTxt, mon] = sueltos;
            const t = await terminal(etiqueta);
            const cent = (txt) => Math.round(parseFloat(String(txt).replace(',', '.')) * 100);
            const monto = cent(montoTxt);
            const factura = opt('--factura')
                ? { numero: opt('--factura'), montoCentesimos: monto, gravadoCentesimos: cent(opt('--gravado') || montoTxt), taxRefund: 1 }
                : null;
            if (factura) console.log(`Con devolución Ley 19.210: factura ${factura.numero}, total ${monto / 100}, gravado ${factura.gravadoCentesimos / 100}`);
            const r = await svc.iniciarVenta({
                terminal: t.PteIdTerminal, montoCentesimos: monto, monedaId: String(mon).toUpperCase() === 'USD' ? 2 : 1,
                referencias: [], prueba: true, factura,
            });
            console.log(`Venta ${r.uuid}: ${r.estado}${r.motivo ? ` — ${r.motivo}` : ''}`);
            if (FINALES.has(r.estado) || r.estado === E.INDETERMINADA) break;
            let cortar = false;
            process.on('SIGINT', () => { cortar = true; });
            const hasta = Date.now() + 10 * 60 * 1000;
            let ultimo = '';
            while (Date.now() < hasta) {
                if (cortar) {
                    console.log('Cancelando…');
                    const c = await svc.cancelar({ uuid: r.uuid });
                    mostrar(c?.fila);
                    break;
                }
                await esperar(2500); // entre consultas: 2 a 3 s [SPEC p.29]
                const f = await svc.polear({ uuid: r.uuid });
                const linea = `${f.PtxEstado}|${f.PtxResponseCode}|${f.PtxPosResponseCode}|${f.PtxRemainingExpTime}`;
                if (linea !== ultimo) { mostrar(f); ultimo = linea; }
                if (FINALES.has(f.PtxEstado) || [E.INDETERMINADA, E.REVERSA_PENDIENTE, E.PEDIR_AUTORIZACION].includes(f.PtxEstado)) break;
            }
            break;
        }
        case 'tipo': {
            // tipo <ETIQUETA> <TOTEM|CAJA> [NUEVA_ETIQUETA] — p. ej. para probar el tótem con la terminal de la caja.
            const [etiqueta, tipo, nueva] = args;
            const t = await terminal(etiqueta);
            const T = String(tipo || '').toUpperCase();
            if (!['TOTEM', 'CAJA'].includes(T)) throw new Error("Tipo: TOTEM o CAJA.");
            await (await getPool()).request()
                .input('Id', sql.Int, t.PteIdTerminal).input('T', sql.VarChar(20), T)
                .input('E', sql.VarChar(50), (nueva || t.PteEtiqueta).toUpperCase())
                .query('UPDATE dbo.PosTerminales SET PteTipo = @T, PteEtiqueta = @E, PteTokenHash = CASE WHEN @T = \'TOTEM\' THEN PteTokenHash ELSE NULL END WHERE PteIdTerminal = @Id');
            console.log(`${t.PteEtiqueta} → ${T}${nueva ? ` (ahora ${nueva.toUpperCase()})` : ''}.${T === 'TOTEM' ? ' Siguiente paso: clave.' : ''}`);
            break;
        }
        case 'clave': {
            // clave <ETIQUETA> — clave del POS de un tótem. Se muestra UNA vez: solo se guarda su hash.
            const t = await terminal(args[0]);
            const clave = await require('../services/poslink/poslinkTotemService').generarClave(t.PteIdTerminal);
            console.log(`Clave del POS de ${t.PteEtiqueta} (no se vuelve a mostrar):\n  ${clave}`);
            console.log(`En ese tótem, abrir una vez:  /totem?pos=${clave}`);
            break;
        }
        case 'ventas': {
            // ventas [dias] — ventas con tarjeta registradas que se pueden anular o devolver
            const vs = await svc.ventasAnulables({ dias: parseInt(args[0], 10) || 7 });
            if (!vs.length) console.log('No hay ventas con tarjeta registradas en esos días.');
            for (const x of vs) {
                console.log(`${x.uuid}  ${x.fecha}  ${x.terminal}  ${x.moneda} ${x.monto.toFixed(2)}${x.devuelto ? ` (devuelto ${x.devuelto.toFixed(2)})` : ''}  ${x.referencia || ''}  ${x.cliente || ''}${x.enCurso ? '  [EN CURSO]' : ''}`);
            }
            break;
        }
        case 'anular': {
            // anular <uuidVenta> [monto] ["motivo"] — anulación si la venta sigue en el lote abierto, si no devolución
            const [uuidVenta, montoTxt, motivo] = args;
            const montoCentesimos = montoTxt ? Math.round(parseFloat(String(montoTxt).replace(',', '.')) * 100) : null;
            const r = await svc.iniciarReversion({ uuidVenta, montoCentesimos, usuarioId: null, motivo: motivo || 'Prueba desde consola' });
            console.log(`${r.tipo} ${r.uuid}: ${r.estado}`);
            let ultimo = '';
            const hasta = Date.now() + 10 * 60 * 1000;
            while (Date.now() < hasta) {
                await esperar(2500);
                const f = await svc.polear({ uuid: r.uuid });
                const linea = `${f.PtxEstado}|${f.PtxResponseCode}|${f.PtxPosResponseCode}`;
                if (linea !== ultimo) { mostrar(f); ultimo = linea; }
                if (FINALES.has(f.PtxEstado) || [E.INDETERMINADA, E.REVERSA_PENDIENTE].includes(f.PtxEstado)) break;
            }
            break;
        }
        case 'estado': mostrar(await svc.obtenerCobro({ uuid: args[0] })); break;
        case 'cancelar': { const c = await svc.cancelar({ uuid: args[0] }); mostrar(c?.fila); if (c?.motivo) console.log(c.motivo); break; }
        case 'resolver': mostrar(await svc.resolverManual({ uuid: args[0], estadoFinal: String(args[1] || '').toUpperCase(), nota: args[2] })); break;
        case 'barrido': console.log(await svc.barrido()); break;
        default:
            console.log('Comandos: terminales | alta | prueba | activar | desactivar | estado | cancelar | resolver | barrido | tipo | clave | ventas | anular');
            console.log('Ver el encabezado de este archivo.');
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(`ERROR${e.codigo ? ` [${e.codigo}]` : ''}: ${e.message}`); process.exit(1); });
