import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Toaster, toast } from 'react-hot-toast';
import { Loader2, CheckCircle2, AlertTriangle, Clock, XCircle, Search, HelpCircle, Download, Smartphone, Camera, ScanLine, X } from 'lucide-react';
import ScannerComponent from '../common/ScannerComponent';
import * as XLSX from 'xlsx';
import { socket } from '../../services/socketService';

export default function AuditDepositoView() {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveCodes, setLiveCodes] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [results, setResults] = useState(null);
  const [showCamera, setShowCamera] = useState(false);

  // Para seleccin mltiple en la vista de errores/sobrantes
  const [selectedSobran, setSelectedSobran] = useState(new Set());
  const [selectedFaltan, setSelectedFaltan] = useState(new Set());
  const [selectedOlvidadas, setSelectedOlvidadas] = useState(new Set());

  // Pestaa activa
  const [activeTab, setActiveTab] = useState('escaneo');
  const [dataLoaded, setDataLoaded] = useState(false); // lazy: se carga al entrar a un tab de datos

  // Carga inicial: un solo request que devuelve liveCodes + auditData juntos (elimina round-trip extra en LAN)
  useEffect(() => {
    setLoading(true);
    api.get('/audit-deposito/init')
      .then(({ data }) => {
        if (data.success) {
          setLiveCodes(data.liveCodes || []);
          setResults(data.auditData || null);
        }
      })
      .catch(err => console.error('Error cargando init', err))
      .finally(() => setLoading(false));
    setDataLoaded(true);

    // Conectar a WebSockets para sincronización en tiempo real entre Celular <-> PC
    const handleScanAdded = ({ codigo }) => {
      setLiveCodes(prev => {
        if (!prev.includes(codigo)) {
          const newLive = [...prev, codigo];
          // Refresh background data if active (usamos setDataLoaded state a través de dependencia o asumiendo true)
          fetchAuditData(newLive);
          return newLive;
        }
        return prev;
      });
    };

    const handleScanRemoved = ({ codigo }) => {
      setLiveCodes(prev => {
        const newLive = prev.filter(c => c !== codigo);
        fetchAuditData(newLive);
        return newLive;
      });
    };

    const handleScansCleared = () => {
      setLiveCodes([]);
      fetchAuditData([]);
    };

    socket.on('audit:scan_added', handleScanAdded);
    socket.on('audit:scan_removed', handleScanRemoved);
    socket.on('audit:scans_cleared', handleScansCleared);

    return () => {
      socket.off('audit:scan_added', handleScanAdded);
      socket.off('audit:scan_removed', handleScanRemoved);
      socket.off('audit:scans_cleared', handleScansCleared);
    };
  }, []);

  const handleFinalizarInventario = () => {
    if (!results) return;
    const informe = `INFORME DE INVENTARIO FÍSICO
Fecha: ${new Date().toLocaleString()}
--------------------------------------------------
RESUMEN DE DISCREPANCIAS AL MOMENTO DEL CORTE:
- Faltan por Escanear (No halladas físicamente): ${results.faltaEnDeposito.length}
- Entregadas Erróneas (Físico presente, estado entregado en DB): ${results.sobraEnDeposito.length}
- Faltan por Ingresar (Desconocidas en el sistema): ${results.desconocido.length}
- Total Escaneadas Legítimas (Coincidencias): ${results.ok.length}

>> FALTANTES POR ESCANEAR:
${results.faltaEnDeposito.map(x => x.codigo).join(', ') || 'Ninguna'}

>> ENTREGADAS ERRÓNEAS (A REINGRESAR):
${results.sobraEnDeposito.map(x => x.codigo).join(', ') || 'Ninguna'}

>> DESCONOCIDAS (A INVESTIGAR):
${results.desconocido.map(x => x.code).join(', ') || 'Ninguna'}
--------------------------------------------------
Reporte Generado Automáticamente por USER.
`;

    const blob = new Blob([informe], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Reporte_Inventario_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (confirm('Informe descargado. ¿Deseas limpiar todos los escaneos registrados para iniciar un nuevo inventario limpio?')) {
      setLoading(true);
      api.post('/audit-deposito/live/clear')
        .then(() => {
          setLiveCodes([]);
          fetchAuditData([]);
        })
        .catch(err => toast.error('Error al limpiar DB: ' + err.message))
        .finally(() => setLoading(false));
    }
  };

  const fetchAuditData = async (codesArray) => {
    setLoading(true);
    try {
      const { data } = await api.post('/audit-deposito/check', { scannedCodes: codesArray });
      if (data.success) {
        setResults(data.data);
      } else {
        toast.error('Error al verificar: ' + data.error);
      }
    } catch (err) {
      toast.error('Error de red al comprobar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const processInputCodes = (text) => {
    return text
      .split(/[\n,]+/)
      .map(c => c.trim())
      .filter(c => c.length > 0)
      .map(c => {
        let code = c.split('$*')[0];
        code = code.split('|')[0];
        return code.trim().toUpperCase();
      });
  };

  const refreshData = () => {
    fetchAuditData(liveCodes);
  };

  // Handler de tabs: simplemente cambia el tab activo (los datos ya están cargados desde el mount)
  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
  };

  const processDiscoveredCode = (rawCode, fromCamera = false) => {
    let parsed = processInputCodes(rawCode);
    if (parsed.length > 0) {
      const codeEscaneado = parsed[0];
      if (liveCodes.includes(codeEscaneado)) {
        if (!fromCamera) toast('Código ya escaneado: ' + codeEscaneado, { icon: '⚠️' });
        return;
      }
      const newLive = [...liveCodes, codeEscaneado];
      setLiveCodes(newLive);
      // Solo refrescar datos si el usuario ya entró a algún tab de datos
      if (dataLoaded) fetchAuditData(newLive);
      // Registrar en la base de datos de auditoría
      api.post('/audit-deposito/live', { codigo: codeEscaneado }).catch(e => console.error('Error db temp', e));
    }
  };

  const handleLiveScan = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processDiscoveredCode(scanInput, false);
      setScanInput('');
    }
  };

  const handleCameraScan = (decodedText) => {
    processDiscoveredCode(decodedText, true);
  };

  const handleRemoveLiveCode = (codeToRemove) => {
    const newLive = liveCodes.filter(c => c !== codeToRemove);
    setLiveCodes(newLive);
    fetchAuditData(newLive);
    // Eliminar de base de datos
    api.post('/audit-deposito/live/remove', { codigo: codeToRemove }).catch(e => console.error('Error db temp', e));
  };

  const handleToggleSet = (codigo, setFunc, currentSet) => {
    const newSet = new Set(currentSet);
    if (newSet.has(codigo)) newSet.delete(codigo);
    else newSet.add(codigo);
    setFunc(newSet);
  };

  const [notifyActionType, setNotifyActionType] = useState('ESTADO');
  const [emailTemplate, setEmailTemplate] = useState('Hola,\\n\\nQueremos avisarte que tu orden [CODIGO] sigue disponible para retirar en nuestro depósito.\\n¡Te esperamos pronto!');

  const handleNotify = async () => {
    if (selectedOlvidadas.size === 0) {
      toast.error('Selecciona al menos una orden olvidada.');
      return;
    }
    const codigosArr = Array.from(selectedOlvidadas);
    const mgsConfirm = notifyActionType === 'EMAIL'
      ? `¿Enviar email (sin cambiar estado) a ${codigosArr.length} órdenes?`
      : `¿Cambiar estado a 'Avisar nuevamente' a ${codigosArr.length} órdenes?`;

    if (!confirm(mgsConfirm)) return;

    setLoading(true);
    try {
      const { data } = await api.post('/audit-deposito/notify', {
        codigos: codigosArr,
        accion: notifyActionType,
        mensaje: emailTemplate
      });
      if (data.success) {
        toast.success(data.message);
        setSelectedOlvidadas(new Set());
        // Recargar status
        refreshData();
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error('Error al notificar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (tipo, action) => {
    const isSobra = tipo === 'SOBRA';
    const set = isSobra ? selectedSobran : selectedFaltan;

    if (set.size === 0) {
      toast.error('Selecciona al menos una orden.');
      return;
    }

    const codigosArr = Array.from(set);

    if (!confirm(`¿Seguro de aplicar esta acción a ${codigosArr.length} órdenes?`)) return;

    setLoading(true);
    try {
      const { data } = await api.post('/audit-deposito/actions', {
        codigos: codigosArr,
        accion: action
      });

      if (data.success) {
        toast.success(data.message);
        // Recargar usando los códigos en vivo
        refreshData();
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error('Error al aplicar acción: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = (dataArray, filename) => {
    if (!dataArray || dataArray.length === 0) {
      toast.error('No hay datos para exportar en esta pestaña.');
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(dataArray);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Auditoria");
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };

  // Tabs — el de escaneo siempre visible, los de datos muestran count solo cuando cargaron
  const tabsDef = [
    { id: 'escaneo', label: 'Escaneo Físico', count: liveCodes.length, icon: ScanLine, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    { id: 'totales', label: 'Órdenes Activas', count: results?.totales.length ?? '…', icon: Search, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { id: 'olvidadas', label: 'Caducadas', count: results?.olvidadas.length ?? '…', icon: Clock, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
    { id: 'faltantes', label: 'Extraviadas', count: results?.faltaEnDeposito.length ?? '…', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    { id: 'sobrantes', label: 'Sobrantes', count: results?.sobraEnDeposito.length ?? '…', icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
    { id: 'sinpago', label: 'Entregadas Sin Pago', count: results?.entregadasSinPago.length ?? '…', icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
    { id: 'desconocidas', label: 'Desconocidos', count: results?.desconocido.length ?? '…', icon: HelpCircle, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
  ];

  return (
    <div className="px-0 lg:px-6 py-4 lg:py-6 max-w-7xl mx-auto font-sans text-slate-800">
      <Toaster position="top-right" />
      <div className="flex items-center justify-between mb-6 px-4 lg:px-0">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold">Auditoría de Depósito / Control Físico</h1>
          <p className="text-sm text-slate-500 mt-1">Revisa el estado global del depósito, cruza códigos con escáner, exporta reportes y notifica clientes.</p>
        </div>
      </div>

      {/* PANEL PRINCIPAL — siempre visible */}
      <div className="bg-white lg:rounded-xl shadow-sm border border-slate-200 overflow-hidden">

        {/* BARRA DE TABS — oculta en mobile, solo visible en desktop */}
        <div className="hidden lg:flex overflow-x-auto border-b border-slate-200 bg-slate-50/50">
          {tabsDef.map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all border-b-2 whitespace-nowrap ${isActive
                  ? `border-${tab.color.split('-')[1]}-600 ${tab.color} bg-white`
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <Icon size={18} className={isActive ? tab.color : 'text-slate-400'} />
                {tab.label}
                <span className={`px-2 py-0.5 rounded-full text-xs ${isActive ? `${tab.bg} ${tab.color}` : 'bg-slate-100 text-slate-500'}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-0 lg:p-6">

          {/* Skeleton para data tabs que aún no cargaron */}
          {activeTab !== 'escaneo' && !results && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
              {loading
                ? <><div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /><p className="text-sm font-medium">Cargando datos...</p></>
                : <><Search size={32} className="opacity-40" /><p className="text-sm font-medium">Hacé clic en el tab para cargar los datos</p></>
              }
            </div>
          )}

          {/* ESCANEO FISICO */}
          {activeTab === 'escaneo' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Columna Izquierda: Input y Tarjetas */}
                <div className="w-full lg:w-1/3 bg-slate-50 p-4 lg:rounded-xl border border-slate-200 shadow-inner">
                  <h3 className="font-bold text-slate-800 mb-2 flex justify-between items-center w-full">
                    <span className="flex items-center gap-2"><ScanLine size={18} className="text-indigo-600" /> Pistola Escáner</span>
                    <button onClick={handleFinalizarInventario} className="text-[10px] bg-slate-800 hover:bg-slate-900 text-white px-2 py-1.5 rounded shadow">
                      Finalizar / Reporte
                    </button>
                  </h3>
                  <p className="text-xs text-slate-500 mb-4 block">Tus escaneos se guardan en la DB automáticamente.</p>
                  <div className="flex flex-col gap-3 mb-6">
                    <input
                      type="text"
                      className="w-full xl:w-2/3 mx-auto p-4 text-xl border-2 border-indigo-200 focus:border-indigo-500 rounded-xl shadow-sm text-center font-mono font-bold bg-white outline-none"
                      placeholder="Pistola láser aquí (Enter)"
                      value={scanInput}
                      onChange={e => setScanInput(e.target.value)}
                      onKeyDown={handleLiveScan}
                      autoFocus
                    />
                    <button
                      onClick={() => setShowCamera(true)}
                      className="xl:w-2/3 mx-auto flex items-center justify-center gap-2 bg-slate-800 text-white p-3 rounded-xl shadow hover:bg-slate-700 transition"
                    >
                      <Smartphone size={20} />
                      Usar Cámara del Móvil
                    </button>
                  </div>

                  {showCamera && (
                    <ScannerComponent
                      onScan={handleCameraScan}
                      onClose={() => setShowCamera(false)}
                      scannedCodes={liveCodes}
                    />
                  )}

                  <div className="flex flex-col gap-2 mt-4 max-h-[500px] overflow-y-auto pr-2">
                    {liveCodes.slice().reverse().map(code => (
                      <div key={code} className="bg-white border text-center relative border-indigo-100 shadow-sm p-3 rounded-lg flex justify-between items-center group">
                        <span className="font-mono font-bold text-indigo-900 border-b border-dashed border-indigo-300">{code}</span>
                        <button onClick={() => handleRemoveLiveCode(code)} className="text-red-400 opacity-50 hover:bg-red-50 hover:opacity-100 p-1.5 rounded-full transition-all">
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    {liveCodes.length === 0 && <p className="text-xs text-center text-slate-400 py-4">Aún no has escaneado ninguna orden.</p>}
                  </div>
                </div>

                {/* Columna Derecha: solo visible en desktop y cuando hay datos */}
                {results && <div className="hidden lg:grid lg:w-2/3 grid-cols-1 md:grid-cols-3 gap-4">

                  {/* Faltan en Deposito (NO fueron escaneadas pero estan Activas) */}
                  <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex flex-col shadow-sm">
                    <div className="border-b border-red-200 pb-2 mb-3">
                      <h4 className="font-bold text-red-800 flex items-center gap-1"><XCircle size={14} /> Faltan por Escanear</h4>
                      <p className="text-[10px] text-red-600 leading-tight">Activas pero NO escaneadas. ¿Ya se entregaron Físicamente?</p>
                    </div>
                    <div className="flex flex-col gap-2 flex-grow overflow-y-auto max-h-[500px] pr-1">
                      {results.faltaEnDeposito.map(o => (
                        <div key={o.codigo} className="bg-white p-2 text-xs border border-red-200 rounded text-red-900 shadow-sm">
                          <p className="font-bold">{o.codigo}</p>
                          <p className="text-[9px] truncate text-slate-500">{o.cliente}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Entregada Erroneo (Sobrantes) */}
                  <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 flex flex-col shadow-sm">
                    <div className="border-b border-orange-200 pb-2 mb-3">
                      <h4 className="font-bold text-orange-800 flex items-center gap-1"><AlertTriangle size={14} /> Entregada Errónea</h4>
                      <p className="text-[10px] text-orange-600 leading-tight">Escaneadas, pero figuran Entregadas. Volver a Depósito.</p>
                    </div>
                    <div className="flex flex-col gap-2 flex-grow overflow-y-auto max-h-[500px] pr-1">
                      {results.sobraEnDeposito.filter(o => liveCodes.includes(o.codigo)).map(o => (
                        <div key={o.codigo} className="bg-white p-2 text-xs border border-orange-200 rounded text-orange-900 shadow-sm">
                          <p className="font-bold">{o.codigo}</p>
                          <p className="text-[9px] truncate text-slate-500">{o.cliente}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Falta por Ingresar (Desconocidas) */}
                  <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex flex-col shadow-sm">
                    <div className="border-b border-slate-300 pb-2 mb-3">
                      <h4 className="font-bold text-slate-800 flex items-center gap-1"><HelpCircle size={14} /> Falta Por Ingresar</h4>
                      <p className="text-[10px] text-slate-600 leading-tight">Escaneadas que no están en la Base de Datos.</p>
                    </div>
                    <div className="flex flex-col gap-2 flex-grow overflow-y-auto max-h-[500px] pr-1">
                      {results.desconocido.filter(o => liveCodes.includes(o.codigo)).map(o => (
                        <div key={o.codigo} className="bg-white p-2 text-xs border border-slate-300 rounded text-slate-900 shadow-sm font-mono font-bold">
                          {o.codigo}
                        </div>
                      ))}
                    </div>
                  </div>

                </div>}
              </div>
            </div>
          )}

          {/* TOTALES ACTIVAS */}
          {activeTab === 'totales' && results && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-blue-800">Censo Completo de Órdenes (Según Sistema)</h3>
                <button onClick={() => exportToExcel(results.totales, 'Totales_Deposito')} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700">
                  <Download size={16} /> Exportar Excel
                </button>
              </div>
              {results.totales.length > 0 ? (
                <TableRender
                  data={results.totales}
                  columns={['Código', 'Cliente', 'Tipo Cliente', 'Situación Pago', 'Días en Depósito', 'Forma/Retiro']}
                  rowMap={(o) => [
                    <span className="font-mono font-bold text-blue-900">{o.codigo}</span>,
                    o.cliente,
                    o.clienteTipo,
                    o.pagoEstado,
                    o.diasEnDeposito + ' días',
                    <span className="text-xs font-mono">{o.ordenRetiro}</span>
                  ]}
                />
              ) : <EmptyState text="No hay órdenes en depósito según el sistema." />}
            </div>
          )}

          {/* OLVIDADAS */}
          {activeTab === 'olvidadas' && results && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                <div>
                  <h3 className="text-lg font-bold text-purple-800 flex items-center gap-2">Órdenes Olvidadas / Vencidas</h3>
                  <p className="text-xs text-purple-700 mt-1 font-medium">Llevan más del tiempo configurado ({results.olvidadas[0]?.maxDiasDeposito || 15} días) sin retirarse.</p>
                </div>
                <div className="flex flex-col gap-2 items-end w-full md:w-auto">
                  <div className="flex items-center gap-2">
                    <select
                      className="text-sm border-slate-300 rounded shadow-sm py-1.5 focus:border-purple-500 focus:ring-purple-500"
                      value={notifyActionType}
                      onChange={(e) => setNotifyActionType(e.target.value)}
                    >
                      <option value="ESTADO">Cambiar de Estado (Avisar Nuevamente)</option>
                      <option value="EMAIL">Solo Enviar Email</option>
                    </select>

                    <button
                      onClick={handleNotify}
                      disabled={selectedOlvidadas.size === 0 || loading}
                      className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded text-sm font-bold shadow-sm"
                    >
                      Ejecutar Acción ({selectedOlvidadas.size})
                    </button>
                    <button onClick={() => exportToExcel(results.olvidadas, 'Olvidadas_Deposito')} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700">
                      <Download size={16} /> Excel
                    </button>
                  </div>

                  {notifyActionType === 'EMAIL' && (
                    <div className="w-full mt-2 bg-purple-50 p-3 rounded-lg border border-purple-100">
                      <label className="block text-xs font-bold text-purple-800 mb-1">Plantilla de Email (Usa [CODIGO] para la orden)</label>
                      <textarea
                        className="w-full text-sm p-2 border-slate-300 rounded focus:ring-purple-500 resize-y"
                        rows="3"
                        value={emailTemplate}
                        onChange={(e) => setEmailTemplate(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </div>
              {results.olvidadas.length > 0 ? (
                <TableRender
                  data={results.olvidadas}
                  hasSelection={true}
                  selectedSet={selectedOlvidadas}
                  onToggle={(codigo) => handleToggleSet(codigo, setSelectedOlvidadas, selectedOlvidadas)}
                  columns={['Código', 'Días', 'Cliente (Tipo)', 'Contacto', 'Retiro']}
                  rowMap={(o) => [
                    <span className="font-mono font-bold text-purple-900">{o.codigo}</span>,
                    <span className="font-bold text-purple-700">{o.diasEnDeposito} d</span>,
                    <>{o.cliente} <span className="text-[10px] text-slate-500 bg-slate-100 px-1 rounded uppercase">{o.clienteTipo}</span></>,
                    <div className="text-xs text-slate-600">Tel: {o.clienteTelefono || 'N/D'} <br /> ✉️: {o.clienteEmail || 'N/D'}</div>,
                    <span className="text-xs font-mono">{o.ordenRetiro}</span>
                  ]}
                />
              ) : <EmptyState text="Geniál. No hay órdenes vencidas ni olvidadas." />}
            </div>
          )}

          {/* FALTANTES */}
          {activeTab === 'faltantes' && results && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-red-800">Faltan en Depósito</h3>
                  <p className="text-xs text-red-700 mt-1 font-medium">En el sistema figuran que están en bodega, pero no las has escaneado. ¿Se entregaron sin procesar?</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction('FALTA', 'ENTREGADO')}
                    disabled={selectedFaltan.size === 0 || loading}
                    className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded text-sm font-bold shadow-sm"
                  >
                    Marcar como Entregado ({selectedFaltan.size})
                  </button>
                  <button onClick={() => exportToExcel(results.faltaEnDeposito, 'Faltantes_Deposito')} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700">
                    <Download size={16} /> Excel
                  </button>
                </div>
              </div>
              {results.faltaEnDeposito.length > 0 ? (
                <TableRender
                  data={results.faltaEnDeposito}
                  hasSelection={true}
                  selectedSet={selectedFaltan}
                  onToggle={(codigo) => handleToggleSet(codigo, setSelectedFaltan, selectedFaltan)}
                  columns={['Código', 'Cliente', 'Situación Pago', 'Forma/Retiro']}
                  rowMap={(o) => [
                    <span className="font-mono font-bold text-red-900">{o.codigo}</span>,
                    o.cliente,
                    o.pagoEstado,
                    <span className="text-xs font-mono">{o.ordenRetiro}</span>
                  ]}
                />
              ) : <EmptyState text={inputText.trim() !== '' ? 'No detectamos faltantes de la lista que escaneaste.' : 'Realiza un escaneo para descubrir faltantes.'} />}
            </div>
          )}

          {/* SOBRANTES */}
          {activeTab === 'sobrantes' && results && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-orange-800">Sobran en Depósito</h3>
                  <p className="text-xs text-orange-700 mt-1 font-medium">Estas órdenes se escanearon aquí, pero en el sistema figuran como Entregadas. ¿Se olvidaron de darla a la mensajería?</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction('SOBRA', 'A_DEPOSITO')}
                    disabled={selectedSobran.size === 0 || loading}
                    className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white rounded text-sm font-bold shadow-sm"
                  >
                    Regresar a Depósito ({selectedSobran.size})
                  </button>
                  <button onClick={() => exportToExcel(results.sobraEnDeposito, 'Sobrantes_Deposito')} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700">
                    <Download size={16} /> Excel
                  </button>
                </div>
              </div>
              {results.sobraEnDeposito.length > 0 ? (
                <TableRender
                  data={results.sobraEnDeposito}
                  hasSelection={true}
                  selectedSet={selectedSobran}
                  onToggle={(codigo) => handleToggleSet(codigo, setSelectedSobran, selectedSobran)}
                  columns={['Código', 'Cliente', 'Situación Pago', 'Forma/Retiro']}
                  rowMap={(o) => [
                    <span className="font-mono font-bold text-orange-900">{o.codigo}</span>,
                    o.cliente,
                    o.pagoEstado,
                    <span className="text-xs font-mono">{o.ordenRetiro}</span>
                  ]}
                />
              ) : <EmptyState text={inputText.trim() !== '' ? 'No escaneaste órdenes que sobren/estén como entregadas.' : 'Realiza un escaneo primero.'} />}
            </div>
          )}



          {/* ENTREGADAS SIN PAGO */}
          {activeTab === 'sinpago' && results && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-amber-800">Órdenes Entregadas Sin Pago</h3>
                  <p className="text-xs text-amber-700 mt-1 font-medium">Figuran en estado finalizado o entregado, pero carecen de pago saldado (Fiados, Mayoristas asincrónicos o errores humanos).</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => exportToExcel(results.entregadasSinPago, 'Entregadas_SinPago')} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700">
                    <Download size={16} /> Excel
                  </button>
                </div>
              </div>
              {results.entregadasSinPago.length > 0 ? (
                <TableRender
                  data={results.entregadasSinPago}
                  columns={['Código', 'Cliente', 'Tipo Cliente', 'Situación Pago', 'Días', 'Forma/Retiro']}
                  rowMap={(o) => [
                    <span className="font-mono font-bold text-amber-900">{o.codigo}</span>,
                    o.cliente,
                    o.clienteTipo,
                    o.pagoEstado,
                    o.diasEnDeposito + ' d',
                    <span className="text-xs font-mono">{o.ordenRetiro}</span>
                  ]}
                />
              ) : <EmptyState text="Todo en orden. No figuran comprobantes Entregados sin Pago." />}
            </div>
          )}

          {/* DESCONOCIDOS */}
          {activeTab === 'desconocidas' && results && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-700">Códigos No Reconocidos</h3>
                  <p className="text-xs text-slate-500 mt-1">Se escanearon físicamente pero no existen en el sistema. ¡Debes ingresarlos manualmente utilizando las pantallas regulares de producción o importación!</p>
                </div>
                <button onClick={() => exportToExcel(results.desconocido, 'Desconocidos_Deposito')} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700">
                  <Download size={16} /> Excel
                </button>
              </div>
              {results.desconocido.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-4 bg-slate-50 p-4 rounded-lg border border-slate-100">
                  {results.desconocido.map(x => (
                    <span key={x.codigo} className="bg-white text-slate-700 font-mono text-xs px-3 py-1.5 rounded-md border border-slate-200 shadow-sm">{x.codigo}</span>
                  ))}
                </div>
              ) : <EmptyState text="No hay códigos desconocidos en tu escaneo actual." />}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// Subcomponente reciclable para tablas estandar
function TableRender({ data, columns, rowMap, hasSelection, selectedSet, onToggle }) {
  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
          <tr>
            {hasSelection && <th className="px-4 py-3 w-10 text-center">Sel</th>}
            {columns.map(c => <th key={c} className="px-4 py-3">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((item, idx) => (
            <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
              {hasSelection && (
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 cursor-pointer text-indigo-600 focus:ring-indigo-500 rounded border-slate-300"
                    checked={selectedSet.has(item.codigo)}
                    onChange={() => onToggle(item.codigo)}
                  />
                </td>
              )}
              {rowMap(item).map((cellData, i) => (
                <td key={i} className="px-4 py-3">{cellData}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 mt-2">
      <Search size={32} className="mb-3 opacity-50" />
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}
