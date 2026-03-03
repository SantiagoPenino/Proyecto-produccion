import React, { useState, useEffect, useCallback } from 'react';
import {
  Package, Search, Check, AlertCircle, ArrowLeft, CheckCircle,
  Truck, Loader2, LayoutGrid, MapPin, Clock
} from 'lucide-react';
import api from '../../services/api'; // Axios instance base
import { io } from 'socket.io-client';

// La configuración visual de los estantes ahora se trae de la BDD dinámicamente.

const WebRetirosPage = () => {
  const [view, setView] = useState('empaque');
  const [apiOrders, setApiOrders] = useState([]);
  const [estantesConfigArr, setEstantesConfigArr] = useState([]); // Array extraido del server
  const [ocupacionEstantes, setOcupacionEstantes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRetiro, setSelectedRetiro] = useState(null);
  const [scannedBultos, setScannedBultos] = useState({});
  const [ubicationMode, setUbicationMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEstante, setFilterEstante] = useState('ALL');
  const [confirmDelivery, setConfirmDelivery] = useState(null);
  const [deliveryScannedBultos, setDeliveryScannedBultos] = useState({});
  const [deliveryBarcodeInput, setDeliveryBarcodeInput] = useState('');

  // 1. Conexión WebSocket para Tiempo Real
  useEffect(() => {
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000', {
      transports: ['websocket', 'polling']
    });

    socket.on('retiros:update', () => {
      console.log("♻️ [WebSocket] Actualización de Retiros detectada");
      fetchAllData(); // Refrescar cuando alguien entrega o desde la web entra pago
    });

    return () => socket.disconnect();
  }, []);

  // 2. Traer toda la información combinada
  const fetchAllData = useCallback(async (backgroundSync = true) => {
    setLoading(true);
    setError(null);
    try {
      // 1. Obtener Lista de Retiros Locales actualizados RAUDAMENTE
      const { data: retirosData } = await api.get('/web-retiros/locales');

      const formattedRetiros = retirosData
        .filter(r => r.Estado === 1 || r.Estado === 3)
        .map(r => ({
          ordenDeRetiro: r.OrdIdRetiro,
          idcliente: r.NombreCliente || r.CodCliente || 'Ecommerce',
          monto: r.Monto || 0,
          moneda: r.Moneda || 'UYU',
          pagorealizado: r.Estado === 3 || r.Estado === 8 ? 1 : 0,
          orders: r.BultosJSON ? JSON.parse(r.BultosJSON) : [
            { orderNumber: `P-${r.OrdIdRetiro.split('-')[1] || '0'}`, orderId: r.IdRetWeb }
          ]
        }));

      setApiOrders(formattedRetiros);

      // 2. Obtener el Mapa de Estantes Rapido
      const { data: estantesData } = await api.get('/web-retiros/estantes');
      const estantesMap = {};
      const configMap = {};

      estantesData.forEach(item => {
        if (item.OrdenRetiro) {
          estantesMap[item.UbicacionID] = item;
        }

        if (!configMap[item.EstanteID]) {
          configMap[item.EstanteID] = { id: item.EstanteID, secciones: 0, posiciones: 0 };
        }

        if (item.Seccion > configMap[item.EstanteID].secciones) {
          configMap[item.EstanteID].secciones = item.Seccion;
        }

        if (item.Posicion > configMap[item.EstanteID].posiciones) {
          configMap[item.EstanteID].posiciones = item.Posicion;
        }
      });

      const confArr = Object.values(configMap).sort((a, b) => a.id.localeCompare(b.id));

      setEstantesConfigArr(confArr);
      setOcupacionEstantes(estantesMap);

      // 3. Lanzar sincronización pesada en segundo plano si aplica (sin bloquear UI)
      if (backgroundSync) {
        api.post('/web-retiros/sincronizar').then(() => {
          // Solo refrescamos la lista de retiros izquierda en background, no bloqueamos
          api.get('/web-retiros/locales').then(res => {
            const refreshed = res.data
              .filter(r => r.Estado === 1 || r.Estado === 3)
              .map(r => ({
                ordenDeRetiro: r.OrdIdRetiro,
                idcliente: r.NombreCliente || r.CodCliente || 'Ecommerce',
                monto: r.Monto || 0,
                moneda: r.Moneda || 'UYU',
                pagorealizado: r.Estado === 3 || r.Estado === 8 ? 1 : 0,
                orders: r.BultosJSON ? JSON.parse(r.BultosJSON) : [
                  { orderNumber: `P-${r.OrdIdRetiro.split('-')[1] || '0'}`, orderId: r.IdRetWeb }
                ]
              }));
            setApiOrders(refreshed);
          });
        }).catch(e => console.error('Fallo en sync de fondo:', e));
      }

    } catch (err) {
      console.error("Error fetching data:", err);
      setError('Problema al cargar la base de datos de retiros.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // 3. Acciones del Operario
  const handleSelectRetiro = (o) => {
    setSelectedRetiro(o);
    setScannedBultos({});
    setUbicationMode(false);
  };

  const handleAsignarUbicacion = async (estanteId, sec, pos) => {
    if (!selectedRetiro) return;

    const ubicacionId = `${estanteId}-${sec}-${pos}`;
    const retiroParaAsignar = selectedRetiro; // Capturamos para optimismo

    // === OPTIMISMO UI: Actualizamos visualmente al instante ===
    setOcupacionEstantes(prev => ({
      ...prev,
      [ubicacionId]: {
        OrdenRetiro: retiroParaAsignar.ordenDeRetiro,
        CodigoCliente: retiroParaAsignar.idcliente,
        ClientName: retiroParaAsignar.idcliente
      }
    }));
    setApiOrders(prev => prev.filter(o => o.ordenDeRetiro !== retiroParaAsignar.ordenDeRetiro));

    setSelectedRetiro(null);
    setScannedBultos({});
    setUbicationMode(false);

    try {
      const scannedArray = [];
      retiroParaAsignar.orders?.forEach((o) => {
        if (scannedBultos[o.orderNumber]) {
          scannedArray.push(o.orderNumber);
        }
      });

      const payload = {
        estanteId,
        seccion: sec,
        posicion: pos,
        ordenRetiro: retiroParaAsignar.ordenDeRetiro,
        codigoCliente: retiroParaAsignar.idcliente,
        bultos: retiroParaAsignar.orders,
        pagado: retiroParaAsignar.pagorealizado === 1,
        scannedValues: scannedArray
      };

      await api.post('/web-retiros/estantes/asignar', payload);
      // Data se refresca por Socket o en background
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al asignar');
      // Revertir en caso de que ocurra al estallar
      fetchAllData(false);
    }
  };

  const triggerEntregar = (id, data) => {
    setConfirmDelivery({ id, data });
    setDeliveryScannedBultos({});
    setDeliveryBarcodeInput('');
  };

  const handleEntregar = async () => {
    if (!confirmDelivery) return;
    const { id: ubicacionId } = confirmDelivery;

    // === OPTIMISMO UI: Liberar el casillero visualmente de inmediato ===
    setOcupacionEstantes(prev => {
      const next = { ...prev };
      delete next[ubicacionId];
      return next;
    });

    setConfirmDelivery(null);

    try {
      await api.delete(`/web-retiros/estantes/liberar/${ubicacionId}`);
      // El fetch vendrá por socket 
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al liberar el estante');
      // Revertimos la UI si falla
      fetchAllData(false);
    }
  };

  // Scroll a la estantería encontrada al buscar
  useEffect(() => {
    if (!searchTerm || searchTerm.length < 3) return;
    const term = searchTerm.toLowerCase();

    for (const id in ocupacionEstantes) {
      const data = ocupacionEstantes[id];
      if ((data.OrdenRetiro && data.OrdenRetiro.toLowerCase().includes(term)) ||
        (data.ClientName && data.ClientName.toLowerCase().includes(term)) ||
        (data.CodigoCliente && data.CodigoCliente.toLowerCase().includes(term))) {

        const el = document.getElementById(`box-${id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        break; // Al primer hallazgo soltamos y saltamos allí
      }
    }
  }, [searchTerm, ocupacionEstantes]);

  // --- COMPONENTES VISUALES INTERNOS ---
  const OrderDetail = () => {
    const [barcodeInput, setBarcodeInput] = useState('');
    const inputRef = React.useRef(null);

    const toggle = (id) => setScannedBultos(prev => ({ ...prev, [id]: !prev[id] }));
    const allChecked = selectedRetiro.orders?.every(o => scannedBultos[o.orderNumber]);

    const handleScanSubmit = (e) => {
      e.preventDefault();
      const code = barcodeInput.trim().toUpperCase();
      if (!code) return;

      // Find if code exists in order
      const found = selectedRetiro.orders?.find(o => o.orderNumber.toUpperCase() === code);
      if (found) {
        setScannedBultos(prev => ({ ...prev, [found.orderNumber]: true }));
      }
      setBarcodeInput('');
    };

    return (
      <div className="bg-white rounded-[24px] shadow-sm p-8 max-w-2xl mx-auto border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-start mb-6">
          <button onClick={() => setSelectedRetiro(null)} className="p-3 bg-slate-100 rounded-xl text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div className="text-right">
            <span className="text-[10px] font-bold text-blue-500 tracking-wider uppercase">Detalle Envio Web</span>
            <h2 className="text-3xl font-black text-slate-800 mt-1">{selectedRetiro.pagorealizado === 1 ? selectedRetiro.ordenDeRetiro.replace('R-', 'PW-') : selectedRetiro.ordenDeRetiro}</h2>
            <p className="text-slate-400 font-medium uppercase text-sm mt-1">{selectedRetiro.idcliente}</p>
          </div>
        </div>

        <form onSubmit={handleScanSubmit} className="mb-6 relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-blue-400" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            className="block w-full pl-12 pr-16 py-4 border-2 border-slate-200 rounded-xl bg-slate-50 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white text-lg font-bold transition-all text-slate-700"
            placeholder="Escanee el bulto aquí..."
            autoFocus
          />
          <button type="submit" className="absolute inset-y-2 right-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700">OK</button>
        </form>

        <div className="grid gap-3 mb-8 bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Checklist de Bultos</p>
          {selectedRetiro.orders?.map(o => (
            <div key={o.orderNumber}
              onClick={() => toggle(o.orderNumber)}
              className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${scannedBultos[o.orderNumber] ? 'bg-green-50 border-green-500 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${scannedBultos[o.orderNumber] ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  <Package size={20} />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-700">{o.orderNumber}</div>
                  <div className="text-[10px] font-medium text-slate-400 uppercase">Verificado automáticamente</div>
                </div>
              </div>
              {scannedBultos[o.orderNumber] ? <CheckCircle className="text-green-500" size={24} /> : <div className="w-6 h-6 rounded-full border-2 border-slate-300" />}
            </div>
          ))}
        </div>

        <div className="flex gap-4">
          <button onClick={() => setSelectedRetiro(null)} className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-xl font-bold hover:bg-slate-200 transition-all">Cancelar</button>
          <button
            disabled={!allChecked}
            onClick={() => setUbicationMode(true)}
            className="flex-[2] py-4 bg-blue-600 text-white rounded-xl font-bold text-lg shadow-md shadow-blue-200 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Asignar a Estante
          </button>
        </div>
      </div>
    );
  };

  const UbicationGrid = () => (
    <div className="max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-black text-slate-800">Mapa del Depósito</h2>
          <p className="text-slate-500 font-medium text-sm mt-1">Haga click en un casillero vacío para ubicar la orden <strong className="text-blue-600">{selectedRetiro.pagorealizado === 1 ? selectedRetiro.ordenDeRetiro.replace('R-', 'PW-') : selectedRetiro.ordenDeRetiro}</strong></p>
        </div>
        <button onClick={() => setUbicationMode(false)} className="px-6 py-2.5 bg-white border border-slate-200 rounded-lg font-bold text-slate-500 shadow-sm hover:bg-slate-50 text-sm">Atrás</button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {estantesConfigArr.map(est => (
          <div key={est.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center text-white font-black text-lg">{est.id}</div>
              <span className="text-lg font-bold text-slate-700">Módulo de Estantería</span>
            </div>

            <div className="space-y-4">
              {[...Array(est.secciones)].map((_, s) => (
                <div key={s} className="flex gap-4 items-stretch">
                  <div className="w-12 bg-slate-50 rounded-lg flex flex-col items-center justify-center border border-slate-200 p-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Sec</span>
                    <span className="text-lg font-black text-slate-700">{s + 1}</span>
                  </div>
                  <div className="grid grid-cols-4 flex-1 gap-2">
                    {[...Array(est.posiciones)].map((_, p) => {
                      const id = `${est.id}-${s + 1}-${p + 1}`;
                      const data = ocupacionEstantes[id];
                      return (
                        <button
                          key={p}
                          disabled={!!data}
                          onClick={() => handleAsignarUbicacion(est.id, s + 1, p + 1)}
                          className={`h-24 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1.5 ${data ? 'bg-indigo-600 border-indigo-700 cursor-not-allowed opacity-90' : 'bg-white border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 group shadow-sm'}`}
                        >
                          <span className={`text-[10px] font-bold ${data ? 'text-indigo-200' : 'text-slate-400 uppercase group-hover:text-blue-600'}`}>{id}</span>
                          {data && <span className="text-[11px] font-black text-white px-2 py-0.5 rounded border border-indigo-500 truncate max-w-[90%]">{data.Pagado ? data.OrdenRetiro.replace('R-', 'PW-') : data.OrdenRetiro}</span>}
                          {data && <span className="text-[9px] font-bold text-indigo-100 px-1 truncate max-w-[90%]">{data.CodigoCliente || 'Cliente'}</span>}
                          {!data && <div className="w-1.5 h-1.5 rounded-full bg-slate-200 group-hover:bg-blue-400 mt-1 transition-colors" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Navbar Interno */}
      <div className="flex items-center justify-between mb-8 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-200">
            <LayoutGrid size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">Logística eCommerce</h1>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> App Activa
            </p>
          </div>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button onClick={() => setView('empaque')} className={`px-6 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2 transition-all ${view === 'empaque' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>
            <Truck size={18} /> Empaque
          </button>
          <button onClick={() => setView('entrega')} className={`px-6 py-2.5 rounded-lg font-bold text-sm flex items-center gap-2 transition-all ${view === 'entrega' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>
            <MapPin size={18} /> Entregas a Mostrar
          </button>
        </div>
      </div>

      {loading && !selectedRetiro && apiOrders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="animate-spin text-blue-600 mb-4" size={40} />
          <p className="text-slate-500 font-medium">Sincronizando con Servidor Web...</p>
        </div>
      )}

      {/* VISTA PRINCIPAL */}
      {!loading || apiOrders.length > 0 ? (
        view === 'empaque' ? (
          !selectedRetiro ? (
            <div className="animate-in fade-in duration-300">
              <div className="relative mb-6">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input
                  type="text"
                  placeholder="Buscar orden web o cliente..."
                  className="w-full pl-14 pr-6 py-4 bg-white rounded-xl shadow-sm border border-slate-200 focus:border-blue-500 outline-none text-base font-medium transition-all"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="text-xs font-bold text-green-600 mb-4 uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle size={16} /> Listos para Estantería (Abonados)
                  </h3>
                  <div className="space-y-3">
                    {apiOrders.filter(o => o.pagorealizado === 1 && (String(o.ordenDeRetiro).toLowerCase().includes(searchTerm.toLowerCase()) || String(o.idcliente || '').toLowerCase().includes(searchTerm.toLowerCase()))).length === 0 ? (
                      <div className="p-4 text-center text-sm text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">No hay retiros pagos pendientes.</div>
                    ) : apiOrders.filter(o => o.pagorealizado === 1 && (String(o.ordenDeRetiro).toLowerCase().includes(searchTerm.toLowerCase()) || String(o.idcliente || '').toLowerCase().includes(searchTerm.toLowerCase()))).map(o => (
                      <button key={o.ordenDeRetiro} onClick={() => handleSelectRetiro(o)} className="w-full p-4 bg-slate-50 rounded-xl border border-slate-200 text-left hover:border-blue-400 hover:bg-white hover:shadow-md transition-all flex items-center justify-between group">
                        <div className="flex-1">
                          <div className="text-lg font-black text-slate-800">{o.ordenDeRetiro.replace('R-', 'PW-')}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-xs font-bold uppercase">{o.idcliente}</span>
                            <span className="text-sm font-black text-emerald-600">{o.moneda} {o.monto.toFixed(2)}</span>
                          </div>
                        </div>
                        <ArrowLeft size={18} className="text-slate-300 rotate-180 group-hover:text-blue-500 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="text-xs font-bold text-orange-500 mb-4 uppercase tracking-wider flex items-center gap-2">
                    <Clock size={16} /> Pendientes de Pago
                  </h3>
                  <div className="space-y-3 opacity-70">
                    {apiOrders.filter(o => o.pagorealizado === 0 && (String(o.ordenDeRetiro).toLowerCase().includes(searchTerm.toLowerCase()) || String(o.idcliente || '').toLowerCase().includes(searchTerm.toLowerCase()))).length === 0 ? (
                      <div className="p-4 text-center text-sm text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">No hay retiros impagos en cola.</div>
                    ) : apiOrders.filter(o => o.pagorealizado === 0 && (String(o.ordenDeRetiro).toLowerCase().includes(searchTerm.toLowerCase()) || String(o.idcliente || '').toLowerCase().includes(searchTerm.toLowerCase()))).map(o => (
                      <button key={o.ordenDeRetiro} onClick={() => handleSelectRetiro(o)} className="w-full p-4 bg-slate-50 rounded-xl border border-slate-200 text-left hover:border-orange-400 hover:bg-white hover:shadow-md transition-all flex items-center justify-between opacity-80 hover:opacity-100 group">
                        <div className="flex-1">
                          <div className="text-lg font-bold text-slate-600 group-hover:text-orange-600 transition-colors">{o.ordenDeRetiro}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 bg-slate-200 text-slate-500 rounded text-xs font-bold uppercase">{o.idcliente}</span>
                            <span className="text-sm font-black text-slate-500">{o.moneda} {o.monto ? o.monto.toFixed(2) : '0.00'}</span>
                          </div>
                          <div className="text-[9px] font-black text-orange-400 uppercase tracking-widest mt-2 flex items-center gap-1">
                            <AlertCircle size={10} /> Esperando Aprobación de Pago
                          </div>
                        </div>
                        <ArrowLeft size={18} className="text-slate-300 rotate-180 group-hover:text-orange-500 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            ubicationMode ? <UbicationGrid /> : <OrderDetail />
          )
        ) : (
          /* VISTA MOSTRADOR - MATRIZ DE ESTANTERÍA */
          <div className="animate-in fade-in duration-300">
            <div className="mt-4">

              {/* FILTROS DE ESTANTES Y BUSCADOR */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8 bg-white p-3 rounded-3xl border border-slate-100 shadow-sm">
                {/* Buscador Integrado */}
                <div className="relative w-full md:w-96 flex-shrink-0">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    placeholder="Buscar por orden o cliente..."
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-blue-500 outline-none text-sm font-medium transition-all"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

                {/* Filtros de Pestañas */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setFilterEstante('ALL')}
                    className={`px-6 py-2.5 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all border ${filterEstante === 'ALL' ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-transparent text-slate-500 border-transparent hover:bg-slate-50'}`}
                  >
                    Ver Todo
                  </button>
                  {estantesConfigArr.map(est => (
                    <button
                      key={est.id}
                      onClick={() => setFilterEstante(est.id)}
                      className={`px-6 py-2.5 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all border ${filterEstante === est.id ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-transparent text-slate-500 border-transparent hover:bg-slate-50'}`}
                    >
                      Estante {est.id}
                    </button>
                  ))}
                </div>
              </div>

              {/* MAPA VISUAL DE ESTANTES */}
              <div className="grid gap-8">
                {estantesConfigArr.filter(est => filterEstante === 'ALL' || filterEstante === est.id).map(est => (
                  <div key={est.id} className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-xl italic shadow-md shadow-blue-200">{est.id}</div>
                      <span className="text-xl font-black text-slate-800 uppercase italic tracking-tighter">Bloque {est.id}</span>
                    </div>

                    <div className="space-y-6">
                      {[...Array(est.secciones)].map((_, s) => (
                        <div key={s} className="flex gap-6 items-center">
                          <div className="w-16 h-16 flex flex-col items-center justify-center bg-slate-50/50 rounded-[20px] border border-slate-100">
                            <span className="text-[10px] font-black text-slate-400 uppercase">Sec</span>
                            <span className="text-xl font-black text-blue-600">{s + 1}</span>
                          </div>
                          <div className="grid grid-cols-4 flex-1 gap-4">
                            {[...Array(est.posiciones)].map((_, p) => {
                              const id = `${est.id}-${s + 1}-${p + 1}`;
                              const data = ocupacionEstantes[id];

                              const term = searchTerm.toLowerCase();
                              const matchesSearch = data && (
                                (data.OrdenRetiro && data.OrdenRetiro.toLowerCase().includes(term)) ||
                                (data.CodigoCliente && data.CodigoCliente.toLowerCase().includes(term)) ||
                                (data.ClientName && data.ClientName.toLowerCase().includes(term))
                              );
                              const isMismatched = searchTerm && data && !matchesSearch;
                              const isMatched = searchTerm && data && matchesSearch;

                              return (
                                <div
                                  id={`box-${id}`}
                                  key={p}
                                  className={`h-28 rounded-[24px] border-2 transition-all flex flex-col items-center justify-center gap-2 relative group overflow-hidden 
                                        ${data ? 'bg-indigo-600 border-indigo-700 shadow-md shadow-indigo-300' : 'bg-white border-dashed border-slate-200'}
                                        ${isMismatched ? 'opacity-20 grayscale' : ''}
                                        ${isMatched ? 'ring-4 ring-green-400 border-green-500 bg-green-600 scale-[1.02] shadow-lg shadow-green-200/50' : ''}
                                      `}
                                >
                                  {data ? (
                                    <>
                                      <span className={`font-black tracking-widest ${isMatched ? 'text-white text-xl drop-shadow-md bg-green-700/50 px-3 py-1 rounded-lg mb-1' : 'text-indigo-200 text-[10px]'}`}>{id}</span>
                                      <span className={`text-sm font-black italic uppercase truncate px-2 ${isMatched ? 'text-white' : 'text-white'}`}>{data.Pagado ? data.OrdenRetiro.replace('R-', 'PW-') : data.OrdenRetiro}</span>
                                      <span className={`text-[10px] font-bold truncate px-2 max-w-[90%] bg-black/20 rounded-md py-0.5 mt-0.5 ${isMatched ? 'text-green-100' : 'text-indigo-100'}`}>
                                        {data.ClientName || data.CodigoCliente || 'Cliente'}
                                      </span>

                                      {isMatched && (
                                        <div className="absolute inset-0 bg-blue-600/95 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button
                                            onClick={() => triggerEntregar(id, data)}
                                            className="px-6 py-2 bg-white text-blue-600 rounded-xl font-black text-xs uppercase shadow-xl hover:scale-105 transition-transform flex items-center gap-2"
                                          >
                                            <Check size={16} /> ENTREGAR
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-[12px] font-black text-slate-300">P{p + 1}</span>
                                      <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      ) : null}

      {/* CONFIRMATION MODAL FOR DELIVERY */}
      {confirmDelivery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Confirmar Entrega</h3>
            <p className="text-slate-500 mb-6 font-medium">
              Vas a entregar la orden <strong className="text-blue-600">{confirmDelivery.data.Pagado ? confirmDelivery.data.OrdenRetiro.replace('R-', 'PW-') : confirmDelivery.data.OrdenRetiro}</strong> del estante <strong className="text-blue-600">{confirmDelivery.id}</strong>.
            </p>

            <form onSubmit={(e) => {
              e.preventDefault();
              const code = deliveryBarcodeInput.trim().toUpperCase();
              if (!code) return;
              try {
                const bultos = JSON.parse(confirmDelivery.data.BultosJSON || "[]");
                const found = bultos.find((o) => (o.orderNumber && o.orderNumber.toUpperCase() === code) || (o.id && o.id.toString().toUpperCase() === code));
                if (found) {
                  setDeliveryScannedBultos(prev => ({ ...prev, [found.orderNumber || found.id]: true }));
                }
                setDeliveryBarcodeInput('');
              } catch (e) { }
            }} className="mb-6 relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-blue-400" />
              </div>
              <input
                type="text"
                value={deliveryBarcodeInput}
                onChange={(e) => setDeliveryBarcodeInput(e.target.value)}
                className="block w-full pl-12 pr-16 py-3 border-2 border-slate-200 rounded-xl bg-slate-50 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white font-medium transition-all text-slate-700"
                placeholder="Escanee el bulto aquí (opcional manual)..."
                autoFocus
              />
              <button type="submit" className="absolute inset-y-1.5 right-1.5 px-4 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700">OK</button>
            </form>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-6 max-h-48 overflow-y-auto">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Checklist Bultos a Entregar</p>
              <ul className="space-y-2">
                {(() => {
                  try {
                    const bultos = JSON.parse(confirmDelivery.data.BultosJSON || "[]");
                    if (bultos.length === 0) return <li className="text-sm font-medium text-slate-600">Sin órdenes detalladas. (Continúe)</li>;
                    return bultos.map((b, i) => {
                      const identifier = b.orderNumber || b.id || `Desconocido_${i}`;
                      const isScanned = !!deliveryScannedBultos[identifier];
                      return (
                        <li
                          key={i}
                          onClick={() => setDeliveryScannedBultos(prev => ({ ...prev, [identifier]: !isScanned }))}
                          className={`flex items-center gap-3 text-sm font-bold cursor-pointer transition-all p-3 rounded-xl border-2 shadow-sm ${isScanned ? 'bg-green-50/80 border-green-400 text-green-800' : 'bg-white border-slate-200 text-slate-700'}`}
                        >
                          <div className={`p-1.5 rounded-md ${isScanned ? 'bg-green-500/10' : 'bg-slate-100'}`}>
                            <Package size={16} className={isScanned ? 'text-green-600' : 'text-blue-500'} />
                          </div>
                          {identifier}
                          <span className="text-[11px] font-normal opacity-60 ml-auto mr-2 truncate max-w-[120px]">{b.ordNombreTrabajo || ''}</span>
                          {isScanned ? <CheckCircle className="text-green-500" size={20} /> : <div className="w-5 h-5 rounded-full border-2 border-slate-300" />}
                        </li>
                      );
                    });
                  } catch (e) {
                    return <li className="text-sm font-medium text-slate-600">Error al leer bultos.</li>;
                  }
                })()}
              </ul>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setConfirmDelivery(null)}
                className="flex-[0.8] py-3 px-4 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              {(() => {
                let allChecked = true;
                try {
                  const bultos = JSON.parse(confirmDelivery.data.BultosJSON || "[]");
                  if (bultos.length > 0) {
                    allChecked = bultos.every(b => !!deliveryScannedBultos[b.orderNumber || b.id || '']);
                  }
                } catch (e) { }

                return (
                  <button
                    disabled={!allChecked}
                    onClick={handleEntregar}
                    className="flex-[1.2] py-3 px-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:bg-slate-300 disabled:text-white disabled:shadow-none disabled:cursor-not-allowed transition-all shadow-md shadow-blue-200 flex items-center justify-center gap-2"
                  >
                    <Check size={20} /> Entregar Ahora
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WebRetirosPage;
