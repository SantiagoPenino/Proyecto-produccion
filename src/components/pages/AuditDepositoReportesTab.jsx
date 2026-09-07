import React, { useEffect, useState } from 'react';
import api from '../../services/apiClient';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { Download, Printer, Loader2 } from 'lucide-react';

const fmtF = (d) => (d ? new Date(d).toLocaleDateString('es-UY') : '');
const fmtFH = (d) => (d ? new Date(d).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const num = (v) => new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0));
const plata = (v) => '$ ' + num(v);
const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error';
const PRIO = { ALTA: 'bg-red-100 text-red-800', MEDIA: 'bg-amber-100 text-amber-800', BAJA: 'bg-slate-100 text-slate-600' };

/**
 * FASE 4 — Reportes: resumen ejecutivo, hallazgos redactados, antigüedad por tramos, sin avisar, duplicadas,
 * valorización, por cliente, registro de casos y censo. Versión ejecutiva (recortada) o completa.
 * PDF vía impresión del navegador (solo se imprime el reporte) y Excel multi-hoja.
 */
export default function AuditDepositoReportesTab({ refreshKey }) {
  const [auditorias, setAuditorias] = useState([]);
  const [audId, setAudId] = useState('');       // '' = foto en vivo
  const [version, setVersion] = useState('EJECUTIVO');
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inicializado, setInicializado] = useState(false);

  useEffect(() => {
    api.get('/audit-deposito/auditorias', { params: { limit: 60 } }).then(({ data }) => {
      if (!data.success) return;
      const l = (data.data || []).filter(a => a.estado !== 'ANULADA');
      setAuditorias(l);
      if (!inicializado) { setInicializado(true); if (l.length) setAudId(String(l[0].audId)); }
    }).catch(() => setInicializado(true));
  }, [refreshKey]);

  useEffect(() => {
    if (!inicializado) return;
    setLoading(true);
    api.get('/audit-deposito/reportes', { params: audId ? { audId } : {} })
      .then(({ data }) => { if (data.success) setRep(data.data); })
      .catch(e => toast.error('No se pudo generar el reporte: ' + errorDe(e)))
      .finally(() => setLoading(false));
  }, [audId, inicializado, refreshKey]);

  const ejecutivo = version === 'EJECUTIVO';
  const lim = ejecutivo ? { sinAvisar: 15, clientes: 15, listas: 20, dup: 10, censo: 0, aging: 10 } : { sinAvisar: Infinity, clientes: 50, listas: Infinity, dup: Infinity, censo: Infinity, aging: Infinity };
  const corte = (arr, n) => (arr || []).slice(0, n === Infinity ? undefined : n);

  const exportarExcel = () => {
    if (!rep) return;
    const wb = XLSX.utils.book_new();
    const hoja = (nombre, rows) => { if (!rows || !rows.length) rows = [{ vacio: 'sin datos' }]; XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), nombre.slice(0, 31)); };
    const r = rep.resumen;
    hoja('Resumen', Object.entries({
      Fuente: r.fuente === 'AUDITORIA' ? `Auditoría ${rep.auditoria.codigo}` : 'Foto en vivo', Generado: fmtFH(rep.generado), 'Cotización US$': r.cotizacion, 'Plazo máximo (días)': r.diasMax,
      'Órdenes activas': r.activas, 'Valor en depósito $': r.valorPesos, 'Antigüedad promedio (días)': r.promedioDias, 'Mediana (días)': r.medianaDias,
      'Caducadas': r.caducadas, '% caducadas': r.pctCaducadas, 'Valor caducadas $': r.valorCaducadas, 'Sin aviso': r.sinAviso, 'Pendientes de cobro': r.pendientesCobro, 'Valor pendiente de cobro $': r.valorPendienteCobro,
      'ERI %': r.eri, 'Verificadas': r.verificadas, 'Faltantes': r.faltantes, 'Valor faltantes $': r.valorFaltantes, 'Sobrantes': r.sobrantes, 'Sin ingreso': r.sinIngreso, 'Desconocidos': r.desconocidos, 'Movidas durante la auditoría': r.movidas,
      'Duplicadas por código': r.duplicadasCodigo, 'Mismo cliente mismo día (grupos)': r.duplicadasClienteDia, 'Lecturas repetidas': r.lecturasRepetidas,
    }).map(([Indicador, Valor]) => ({ Indicador, Valor: Valor == null ? '—' : Valor })));
    hoja('Hallazgos', rep.hallazgos.map((h, i) => ({ '#': i + 1, Hallazgo: h })));
    hoja('Antiguedad', rep.aging.map(t => ({ Tramo: t.tramo, Órdenes: t.n, '%': t.pct, 'Valor $': t.valor, '% valor': t.pctValor, 'Sin aviso': t.sinAviso })));
    hoja('Antiguedad detalle', rep.aging.flatMap(t => t.ordenes.map(o => ({ Tramo: t.tramo, Código: o.codigo, Cliente: o.cliente, Días: o.dias, 'Valor $': o.valor, Avisada: o.avisado ? 'SI' : 'NO', Pago: o.pagoEstado }))));
    hoja('Sin avisar', rep.sinAvisar.map(s => ({ Código: s.codigo, Cliente: s.cliente, Tipo: s.clienteTipo, Días: s.dias, Prioridad: s.prioridad, 'Valor $': s.valor, Teléfono: s.telefono || '', Email: s.email || '', 'Sin teléfono': s.sinTelefono ? 'SI' : '' })));
    hoja('Duplicadas', rep.duplicadas.codigo.map(d => ({ Código: d.codigo, Filas: d.filas, Cliente: d.cliente, 'Valor $': d.valor, Ids: d.ids.join(' ') })));
    hoja('Mismo cliente mismo dia', rep.duplicadas.clienteDia.map(d => ({ Cliente: d.cliente, Fecha: d.fecha, Órdenes: d.n, Códigos: d.codigos.join(' '), 'Valor $': d.valor, 'Mismo trabajo': d.mismoTrabajo ? 'SI' : '' })));
    hoja('Valorizacion', [
      ...rep.valorizacion.porMoneda.map(m => ({ Grupo: 'Moneda', Clave: m.moneda, Órdenes: m.n, 'Monto nativo': m.montoNativo, 'Pesos $': m.pesos })),
      ...rep.valorizacion.porPago.map(p => ({ Grupo: 'Situación de pago', Clave: p.categoria, Órdenes: p.n, 'Monto nativo': '', 'Pesos $': p.pesos })),
      ...rep.valorizacion.porPrefijo.map(p => ({ Grupo: 'Área', Clave: p.prefijo, Órdenes: p.n, 'Monto nativo': '', 'Pesos $': p.pesos })),
    ]);
    hoja('Por cliente', rep.porCliente.map(c => ({ Cliente: c.cliente, Tipo: c.clienteTipo, Órdenes: c.n, '%': c.pct, 'Valor $': c.pesos, 'Más antigua (días)': c.masAntigua, 'Sin aviso': c.sinAviso, 'Pendiente pago': c.pendientePago, Códigos: c.codigos.join(' ') })));
    hoja('Casos', [
      { Indicador: 'Abiertos', Valor: rep.casos.vivos }, { Indicador: 'Crónicos (3+)', Valor: rep.casos.cronicos }, { Indicador: 'Reincidentes', Valor: rep.casos.reincidentes },
      { Indicador: 'Cerrados', Valor: rep.casos.cerrados }, { Indicador: 'Asumidos', Valor: rep.casos.asumidos }, { Indicador: 'Vencidos (fecha límite)', Valor: rep.casos.vencidos },
      { Indicador: 'Edad promedio (días)', Valor: rep.casos.edadPromedio }, { Indicador: 'Edad máxima (días)', Valor: rep.casos.edadMax }, { Indicador: 'Tasa de reincidencia %', Valor: rep.casos.tasaReincidencia },
      ...rep.casos.porTipo.map(t => ({ Indicador: `Abiertos ${t.nombre}`, Valor: t.n, 'Valor $': t.pesos, ALTA: t.ALTA, MEDIA: t.MEDIA, BAJA: t.BAJA })),
    ]);
    if (rep.auditoria) {
      hoja('Faltantes', rep.faltantes.map(f => ({ Código: f.codigo, Cliente: f.cliente, Días: f.dias, 'Valor $': f.valor, Pago: f.pagoEstado, Estante: f.estante || '' })));
      hoja('Sobrantes', rep.sobrantes.map(s => ({ Código: s.codigo, Cliente: s.cliente, Pago: s.pagoEstado, Escaneado: s.codigoEscaneado || '' })));
      hoja('Sin ingreso', rep.sinIngreso.map(s => ({ Escaneado: s.codigo, Orden: s.ordenCodigo, Cliente: s.cliente })));
      hoja('Desconocidos', rep.desconocidos.map(d => ({ Código: d.codigo })));
      hoja('Movidas', (rep.auditoria.movidas || []).map(m => ({ Código: m.codigo, Cliente: m.cliente, Motivo: m.motivo })));
    }
    hoja('Censo completo', rep.censo.map(c => ({ Código: c.codigo, Área: c.prefijo, Cliente: c.cliente, Tipo: c.clienteTipo, Trabajo: c.trabajo, Estado: c.estado, Días: c.dias, Avisada: c.avisado ? 'SI' : 'NO', 'Fecha aviso': fmtF(c.fechaAviso), Moneda: c.moneda, Costo: c.costo, 'Valor $': c.valorPesos, Pago: c.pagoEstado, Estante: c.estante || '', Retiro: c.retiro, Verificada: c.verificada == null ? '' : c.verificada ? 'SI' : 'NO' })));
    XLSX.writeFile(wb, `Reporte_Auditoria_Deposito_${rep.auditoria ? rep.auditoria.codigo : 'en_vivo'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const r = rep && rep.resumen;
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <style>{`@media print { body * { visibility: hidden !important; } #reporte-print, #reporte-print * { visibility: visible !important; } #reporte-print { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 12px; font-size: 11px; } .no-print { display: none !important; } .salto { page-break-before: always; } }`}</style>
      <div className="no-print flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold text-sky-800">Reportes</h3>
          <p className="text-xs text-sky-700/80 mt-1 font-medium">Sobre la fotografía de una auditoría (con ERI, faltantes y sobrantes) o sobre el depósito en vivo. Los hallazgos se redactan solos cruzando los datos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={audId} onChange={e => setAudId(e.target.value)} className="text-xs border-slate-300 rounded py-1.5 max-w-[320px]">
            <option value="">Foto en vivo (sin auditoría: sin ERI ni faltantes)</option>
            {auditorias.map(a => <option key={a.audId} value={String(a.audId)}>{a.codigo} · {fmtF(a.fechaCierre || a.fechaApertura)} · {a.alcanceTexto} · {a.estado}</option>)}
          </select>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs font-bold">
            <button onClick={() => setVersion('EJECUTIVO')} className={`px-3 py-1.5 ${ejecutivo ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'}`}>Ejecutivo</button>
            <button onClick={() => setVersion('COMPLETO')} className={`px-3 py-1.5 ${!ejecutivo ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'}`}>Completo</button>
          </div>
          <button onClick={() => window.print()} disabled={!rep} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-bold rounded shadow-sm hover:bg-slate-900 disabled:bg-slate-400"><Printer size={16} /> Imprimir / PDF</button>
          <button onClick={exportarExcel} disabled={!rep} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700 disabled:bg-green-300"><Download size={16} /> Excel</button>
          {loading && <Loader2 size={16} className="animate-spin text-sky-600" />}
        </div>
      </div>

      {!rep ? <div className="py-12 text-center text-sm text-slate-400">{loading ? 'Generando el reporte…' : 'Sin datos.'}</div> : (
        <div id="reporte-print" className="bg-white rounded-xl border border-slate-200 p-5 text-sm text-slate-800">
          {/* Cabecera */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 border-b border-slate-200 pb-3 mb-4">
            <div>
              <div className="text-xl font-extrabold text-slate-900">Auditoría de Depósito · Reporte {ejecutivo ? 'ejecutivo' : 'completo'}</div>
              <div className="text-xs text-slate-500 mt-1">
                {rep.auditoria ? <>Auditoría <b className="font-mono">{rep.auditoria.codigo}</b> · alcance {rep.auditoria.alcanceTexto}{rep.auditoria.lineaBase ? ' · línea base' : ''} · abierta {fmtFH(rep.auditoria.fechaApertura)} por {rep.auditoria.usuarioApertura}{rep.auditoria.fechaCierre ? <> · cerrada {fmtFH(rep.auditoria.fechaCierre)} por {rep.auditoria.usuarioCierre} · duración {rep.auditoria.duracionMin} min</> : ' · todavía abierta'}</> : <>Foto en vivo del depósito (sin auditoría)</>}
              </div>
            </div>
            <div className="text-[11px] text-slate-500 text-right">Generado {fmtFH(rep.generado)} · cotización US$ {r.cotizacion} · plazo máximo {r.diasMax} días</div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
            {[
              { l: 'Órdenes activas', v: num(r.activas), p: 'en la fotografía' },
              { l: 'Valor en depósito', v: plata(r.valorPesos), p: 'a pesos' },
              { l: 'ERI', v: r.eri == null ? '—' : `${r.eri}%`, p: r.eri == null ? 'requiere auditoría' : `${num(r.verificadas)} verificadas`, c: r.eri == null ? '' : r.eri >= 98 ? 'text-green-700' : r.eri >= 95 ? 'text-amber-700' : 'text-red-700' },
              { l: 'Faltantes', v: r.faltantes == null ? '—' : num(r.faltantes), p: r.faltantes == null ? '' : plata(r.valorFaltantes), c: 'text-red-700' },
              { l: 'Sobrantes', v: r.sobrantes == null ? '—' : num(r.sobrantes), p: 'figuran entregadas', c: 'text-orange-700' },
              { l: 'Caducadas', v: `${num(r.caducadas)}`, p: `${r.pctCaducadas}% · ${plata(r.valorCaducadas)}`, c: 'text-purple-700' },
              { l: 'Sin aviso', v: num(r.sinAviso), p: `${r.pctSinAviso}% de las activas`, c: 'text-violet-700' },
              { l: 'Sin cobrar', v: plata(r.valorPendienteCobro), p: `${num(r.pendientesCobro)} órdenes · ${r.pctValorPendiente}%`, c: 'text-amber-700' },
            ].map(k => (
              <div key={k.l} className="rounded-lg border border-slate-200 p-2.5">
                <div className="text-[10px] font-bold uppercase text-slate-500">{k.l}</div>
                <div className={`text-lg font-extrabold font-mono ${k.c || 'text-slate-800'}`}>{k.v}</div>
                <div className="text-[10px] text-slate-400">{k.p}</div>
              </div>
            ))}
          </div>

          {/* Hallazgos */}
          <Seccion titulo="Hallazgos" color="text-indigo-700">
            <ol className="list-decimal pl-5 space-y-1 text-[13px]">{rep.hallazgos.map((h, i) => <li key={i}>{h}</li>)}</ol>
          </Seccion>

          {/* Antigüedad */}
          <Seccion titulo="Antigüedad en depósito (franja de sedimentación)" color="text-purple-700" sub={`promedio ${r.promedioDias} días · mediana ${r.medianaDias}`}>
            <div className="flex h-5 rounded overflow-hidden border border-slate-200 mb-2">
              {rep.aging.map((t, i) => t.n ? <div key={t.tramo} title={`${t.tramo}: ${t.n} (${t.pct}%)`} style={{ width: `${t.pct}%` }} className={['bg-green-400', 'bg-lime-400', 'bg-amber-400', 'bg-orange-400', 'bg-red-400', 'bg-red-700'][i]} /> : null)}
            </div>
            <Tabla cols={[{ k: 'tramo', l: 'Tramo (días)' }, { k: 'n', l: 'Órdenes', r: true }, { k: 'pct', l: '%', r: true }, { k: 'valor', l: 'Valor $', r: true, f: plata }, { k: 'pctValor', l: '% valor', r: true }, { k: 'sinAviso', l: 'Sin aviso', r: true }]} rows={rep.aging} />
            {!ejecutivo && rep.aging.filter(t => t.n).map(t => (
              <div key={t.tramo} className="mt-2">
                <div className="text-[11px] font-bold text-slate-600 mb-1">Tramo {t.tramo} · {t.n} órdenes</div>
                <Tabla cols={[{ k: 'codigo', l: 'Código', mono: true }, { k: 'cliente', l: 'Cliente' }, { k: 'dias', l: 'Días', r: true }, { k: 'valor', l: 'Valor $', r: true, f: plata }, { k: 'avisado', l: 'Avisada', f: v => (v ? 'sí' : 'NO') }, { k: 'pagoEstado', l: 'Pago' }]} rows={t.ordenes} />
              </div>
            ))}
          </Seccion>

          {/* Sin avisar */}
          <Seccion titulo={`Sin avisar al cliente (${rep.sinAvisar.length})`} color="text-red-700" sub="prioridad por antigüedad">
            <Tabla cols={[{ k: 'codigo', l: 'Código', mono: true }, { k: 'cliente', l: 'Cliente' }, { k: 'dias', l: 'Días', r: true }, { k: 'prioridad', l: 'Prioridad', chip: PRIO }, { k: 'valor', l: 'Valor $', r: true, f: plata }, { k: 'telefono', l: 'Teléfono', f: v => v || 'SIN TELÉFONO' }, { k: 'email', l: 'Email', f: v => v || '' }]} rows={corte(rep.sinAvisar, lim.sinAvisar)} vacio="Todas las órdenes listas fueron avisadas." />
            {ejecutivo && rep.sinAvisar.length > lim.sinAvisar && <Mas n={rep.sinAvisar.length - lim.sinAvisar} />}
          </Seccion>

          {/* Faltantes / sobrantes (solo con auditoría) */}
          {rep.auditoria && (
            <Seccion titulo="Diferencias físicas de la auditoría" color="text-red-700" sub={`faltantes ${rep.faltantes.length} · sobrantes ${rep.sobrantes.length} · sin ingreso ${rep.sinIngreso.length} · desconocidos ${rep.desconocidos.length} · movidas ${(rep.auditoria.movidas || []).length}`}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div><div className="text-[11px] font-bold text-red-700 mb-1">Faltantes (en la fotografía, no escaneadas)</div>
                  <Tabla cols={[{ k: 'codigo', l: 'Código', mono: true }, { k: 'cliente', l: 'Cliente' }, { k: 'dias', l: 'Días', r: true }, { k: 'valor', l: 'Valor $', r: true, f: plata }, { k: 'estante', l: 'Estante', f: v => v || '' }]} rows={corte(rep.faltantes, lim.listas)} vacio="Sin faltantes." />
                  {ejecutivo && rep.faltantes.length > lim.listas && <Mas n={rep.faltantes.length - lim.listas} />}</div>
                <div><div className="text-[11px] font-bold text-orange-700 mb-1">Sobrantes (escaneadas, figuran entregadas)</div>
                  <Tabla cols={[{ k: 'codigo', l: 'Código', mono: true }, { k: 'cliente', l: 'Cliente' }, { k: 'pagoEstado', l: 'Pago' }]} rows={corte(rep.sobrantes, lim.listas)} vacio="Sin sobrantes." />
                  {rep.sinIngreso.length > 0 && <><div className="text-[11px] font-bold text-purple-700 mt-2 mb-1">Sin ingreso a depósito</div><Tabla cols={[{ k: 'codigo', l: 'Escaneado', mono: true }, { k: 'ordenCodigo', l: 'Orden', mono: true }, { k: 'cliente', l: 'Cliente' }]} rows={corte(rep.sinIngreso, lim.listas)} /></>}
                  {rep.desconocidos.length > 0 && <div className="text-[11px] mt-2"><b className="text-slate-600">Desconocidos:</b> <span className="font-mono">{rep.desconocidos.map(d => d.codigo).join(', ')}</span></div>}
                  {(rep.auditoria.movidas || []).length > 0 && <div className="text-[11px] mt-2 text-slate-500"><b>Movidas durante la auditoría (no cuentan):</b> {rep.auditoria.movidas.map(m => m.codigo).join(', ')}</div>}
                </div>
              </div>
            </Seccion>
          )}

          {/* Duplicadas */}
          <Seccion titulo="Duplicadas" color="text-pink-700" sub={`código repetido ${rep.duplicadas.codigo.length} · mismo cliente mismo día ${rep.duplicadas.clienteDia.length} grupos · lecturas repetidas ${rep.duplicadas.lecturasRepetidas.length}`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div><div className="text-[11px] font-bold text-slate-600 mb-1">Mismo código en más de una fila</div>
                <Tabla cols={[{ k: 'codigo', l: 'Código', mono: true }, { k: 'filas', l: 'Filas', r: true }, { k: 'cliente', l: 'Cliente' }, { k: 'valor', l: 'Valor $', r: true, f: plata }]} rows={corte(rep.duplicadas.codigo, lim.dup)} vacio="Ningún código repetido." /></div>
              <div><div className="text-[11px] font-bold text-slate-600 mb-1">Mismo cliente ingresado el mismo día (posible ingreso doble)</div>
                <Tabla cols={[{ k: 'cliente', l: 'Cliente' }, { k: 'fecha', l: 'Fecha' }, { k: 'n', l: 'Órdenes', r: true }, { k: 'codigos', l: 'Códigos', mono: true, f: v => v.join(' ') }, { k: 'mismoTrabajo', l: 'Mismo trabajo', f: v => (v ? 'SÍ' : '') }]} rows={corte(rep.duplicadas.clienteDia, lim.dup)} vacio="Sin grupos." />
                {ejecutivo && rep.duplicadas.clienteDia.length > lim.dup && <Mas n={rep.duplicadas.clienteDia.length - lim.dup} />}</div>
            </div>
            {rep.duplicadas.lecturasRepetidas.length > 0 && <div className="text-[11px] mt-2 text-slate-500"><b>Lecturas repetidas en la sesión:</b> {rep.duplicadas.lecturasRepetidas.map(l => `${l.codigo} ×${l.vecesRepetida}`).join(', ')}</div>}
          </Seccion>

          {/* Valorización */}
          <Seccion titulo="Valorización del depósito" color="text-emerald-700" sub={`total ${plata(rep.valorizacion.total)} · mercadería en custodia, no es deuda`}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Tabla cols={[{ k: 'moneda', l: 'Moneda' }, { k: 'n', l: 'Órdenes', r: true }, { k: 'montoNativo', l: 'Monto', r: true, f: num }, { k: 'pesos', l: 'En $', r: true, f: plata }]} rows={rep.valorizacion.porMoneda} />
              <Tabla cols={[{ k: 'categoria', l: 'Situación de pago' }, { k: 'n', l: 'Órdenes', r: true }, { k: 'pesos', l: 'En $', r: true, f: plata }]} rows={rep.valorizacion.porPago} />
              <Tabla cols={[{ k: 'prefijo', l: 'Área' }, { k: 'n', l: 'Órdenes', r: true }, { k: 'pesos', l: 'En $', r: true, f: plata }, { k: 'pctValor', l: '% valor', r: true }, { k: 'masAntigua', l: 'Más antigua', r: true }]} rows={rep.valorizacion.porPrefijo} />
            </div>
            <div className="text-[11px] font-bold text-slate-600 mt-3 mb-1">Clientes con más valor en depósito</div>
            <Tabla cols={[{ k: 'cliente', l: 'Cliente' }, { k: 'n', l: 'Órdenes', r: true }, { k: 'pesos', l: 'Valor $', r: true, f: plata }, { k: 'pctValor', l: '% valor', r: true }, { k: 'masAntigua', l: 'Más antigua (d)', r: true }, { k: 'sinAviso', l: 'Sin aviso', r: true }, { k: 'pendientePago', l: 'Sin cobrar', r: true }]} rows={corte(rep.valorizacion.topClientes, ejecutivo ? 10 : 20)} />
          </Seccion>

          {/* Por cliente */}
          <Seccion titulo="Por cliente (más órdenes en depósito)" color="text-sky-700">
            <Tabla cols={[{ k: 'cliente', l: 'Cliente' }, { k: 'clienteTipo', l: 'Tipo' }, { k: 'n', l: 'Órdenes', r: true }, { k: 'pct', l: '%', r: true }, { k: 'pesos', l: 'Valor $', r: true, f: plata }, { k: 'masAntigua', l: 'Más antigua (d)', r: true }, { k: 'sinAviso', l: 'Sin aviso', r: true }, { k: 'pendientePago', l: 'Sin cobrar', r: true }]} rows={corte(rep.porCliente, lim.clientes)} />
          </Seccion>

          {/* Registro de casos */}
          <Seccion titulo="Registro de casos" color="text-indigo-700" sub={`${rep.casos.auditoriasCerradas} auditorías cerradas`}>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-3">
              {[['Abiertos', rep.casos.vivos], ['Crónicos (3+)', rep.casos.cronicos], ['Reincidentes', rep.casos.reincidentes], ['Cerrados', rep.casos.cerrados], ['Asumidos', rep.casos.asumidos], ['Vencidos', rep.casos.vencidos], ['Edad prom. (d)', rep.casos.edadPromedio], ['Tasa reincidencia', `${rep.casos.tasaReincidencia}%`]].map(([l, v]) => (
                <div key={l} className="rounded-lg border border-slate-200 p-2"><div className="text-[10px] font-bold uppercase text-slate-500">{l}</div><div className="text-base font-extrabold font-mono">{v}</div></div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Tabla cols={[{ k: 'nombre', l: 'Tipo (abiertos)' }, { k: 'n', l: 'Casos', r: true }, { k: 'pesos', l: 'Valor $', r: true, f: plata }, { k: 'ALTA', l: 'Alta', r: true }, { k: 'MEDIA', l: 'Media', r: true }, { k: 'BAJA', l: 'Baja', r: true }]} rows={rep.casos.porTipo} vacio="Sin casos abiertos." />
              <Tabla cols={[{ k: 'codigo', l: 'Auditoría', mono: true }, { k: 'fechaCierre', l: 'Cierre', f: fmtF }, { k: 'alcance', l: 'Alcance' }, { k: 'fotografia', l: 'Foto', r: true }, { k: 'nuevos', l: 'Nuevos', r: true }, { k: 'existentes', l: 'Ya estaban', r: true }, { k: 'reincidentes', l: 'Reinc.', r: true }, { k: 'resueltos', l: 'Resueltos', r: true }, { k: 'abiertos', l: 'Abiertos', r: true }]} rows={rep.casos.ultimasAuditorias} vacio="Todavía no hay auditorías cerradas." />
            </div>
          </Seccion>

          {/* Censo (solo completo) */}
          {!ejecutivo && (
            <Seccion titulo={`Censo completo (${rep.censo.length})`} color="text-slate-700" salto>
              <Tabla cols={[{ k: 'codigo', l: 'Código', mono: true }, { k: 'cliente', l: 'Cliente' }, { k: 'dias', l: 'Días', r: true }, { k: 'avisado', l: 'Avisada', f: v => (v ? 'sí' : 'NO') }, { k: 'valorPesos', l: 'Valor $', r: true, f: plata }, { k: 'pagoEstado', l: 'Pago' }, { k: 'estante', l: 'Estante', f: v => v || '' }, { k: 'verificada', l: 'Verificada', f: v => (v == null ? '' : v ? 'sí' : 'NO') }]} rows={rep.censo} />
            </Seccion>
          )}

          {/* Firmas */}
          <div className="mt-8 grid grid-cols-2 gap-10 text-[11px] text-slate-500">
            <div className="border-t border-slate-400 pt-1">Responsable de depósito · firma y aclaración</div>
            <div className="border-t border-slate-400 pt-1">Auditor · firma y aclaración</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Seccion({ titulo, sub, color, children, salto }) {
  return (
    <div className={`mb-5 ${salto ? 'salto' : ''}`}>
      <div className="flex items-baseline gap-2 mb-2">
        <h4 className={`text-sm font-extrabold ${color || 'text-slate-800'}`}>{titulo}</h4>
        {sub && <span className="text-[11px] text-slate-500">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Mas({ n }) { return <div className="text-[11px] text-slate-400 mt-1">… y {n} más en la versión completa / Excel.</div>; }

function Tabla({ cols, rows, vacio }) {
  if (!rows || !rows.length) return <div className="text-[11px] text-slate-400 italic">{vacio || 'Sin datos.'}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-[11px] whitespace-nowrap">
        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200"><tr>{cols.map(c => <th key={c.k} className={`px-2 py-1 ${c.r ? 'text-right' : ''}`}>{c.l}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i}>{cols.map(c => {
              const v = row[c.k];
              const txt = c.f ? c.f(v) : (v == null ? '' : String(v));
              return <td key={c.k} className={`px-2 py-1 ${c.r ? 'text-right font-mono' : ''} ${c.mono ? 'font-mono font-bold text-indigo-800' : ''}`}>{c.chip ? <span className={`px-1.5 py-0.5 rounded font-bold ${c.chip[v] || ''}`}>{txt}</span> : txt}</td>;
            })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
