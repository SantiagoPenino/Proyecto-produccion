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
  const [otrosRetiros, setOtrosRetiros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRetiro, setSelectedRetiro] = useState(null);
  const [scannedBultos, setScannedBultos] = useState({});
  const [ubicationMode, setUbicationMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEstante, setFilterEstante] = useState('ALL');
  const [filtroOtros, setFiltroOtros] = useState('ALL');
  const [filtroLugarRetiro, setFiltroLugarRetiro] = useState('ALL');
  const [confirmDelivery, setConfirmDelivery] = useState(null);
  const [excepcionDelivery, setExcepcionDelivery] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [excepcionExplicacion, setExcepcionExplicacion] = useState('');
  const [deliveryScannedBultos, setDeliveryScannedBultos] = useState({});
  const [deliveryBarcodeInput, setDeliveryBarcodeInput] = useState('');
  const [deliverySelectedOrders, setDeliverySelectedOrders] = useState({});

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
          pagoHandy: !!r.ReferenciaPago,
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
          if (!estantesMap[item.UbicacionID]) estantesMap[item.UbicacionID] = [];
          estantesMap[item.UbicacionID].push(item);
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

      // 2.5 Traer "Resto de Retiros" (otros retiros)
      try {
        const { data: otrosData } = await api.get('/web-retiros/caja-otros');
        if (Array.isArray(otrosData)) {
          const ocupadasSet = new Set(estantesData.map(e => e.OrdenRetiro));
          const apiOrdersSet = new Set(formattedRetiros.map(o => o.ordenDeRetiro));
          const filtrados = otrosData.filter(o => !ocupadasSet.has(o.ordenDeRetiro) && !apiOrdersSet.has(o.ordenDeRetiro));
          setOtrosRetiros(filtrados);
        }
      } catch (e) { console.error(e) }

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
                pagoHandy: !!r.ReferenciaPago,
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

    // === VALIDACIÓN DE CLIENTE ===
    const dataList = ocupacionEstantes[ubicacionId] || [];
    if (dataList.length > 0) {
      // Tomamos el primer ocupante para chequear
      const primerOcupante = dataList[0];
      const codigoExistente = String(primerOcupante.CodigoCliente || '').trim().toLowerCase();
      const codigoNuevo = String(retiroParaAsignar.idcliente || '').trim().toLowerCase();

      if (codigoExistente !== codigoNuevo && codigoExistente !== 'ecommerce') {
        setError('No puedes guardar órdenes de diferentes clientes en el mismo casillero.');
        return; // Abortamos la asignación
      }
    }

    // === OPTIMISMO UI: Actualizamos visualmente al instante ===
    setOcupacionEstantes(prev => {
      const currentList = prev[ubicacionId] || [];
      return {
        ...prev,
        [ubicacionId]: [...currentList, {
          OrdenRetiro: retiroParaAsignar.ordenDeRetiro,
          CodigoCliente: retiroParaAsignar.idcliente,
          ClientName: retiroParaAsignar.clienteNombre || retiroParaAsignar.ClientName || retiroParaAsignar.idcliente
        }]
      };
    });
    setApiOrders(prev => prev.filter(o => o.ordenDeRetiro !== retiroParaAsignar.ordenDeRetiro));
    setOtrosRetiros(prev => prev.filter(o => o.ordenDeRetiro !== retiroParaAsignar.ordenDeRetiro));

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

  const triggerEntregar = (id, dataOrDataList) => {
    const list = Array.isArray(dataOrDataList) ? dataOrDataList : [dataOrDataList];

    // Find if ANY order in the list is unauthorized
    let exceptionItem = null;
    let exceptionItemRaw = null;

    for (const item of list) {
      const ordenStr = item.OrdenRetiro || item.ordenDeRetiro;
      const retiroFull = apiOrders.find(o => o.ordenDeRetiro === ordenStr) || otrosRetiros.find(o => o.ordenDeRetiro === ordenStr);
      let isAuthorized = false;

      if (retiroFull) {
        const desc = (retiroFull.TClDescripcion || '').toLowerCase();
        const estadoReal = typeof retiroFull.estado === 'string' ? retiroFull.estado.toLowerCase() : '';
        const isPagado = retiroFull.pagorealizado === 1;

        if (isPagado || estadoReal.includes('abonado')) isAuthorized = true;
        if (desc.includes('semanal') || desc.includes('rollo')) isAuthorized = true;
      } else {
        if (item.Pagado) isAuthorized = true;
      }

      if (!isAuthorized) {
        exceptionItem = item;
        exceptionItemRaw = retiroFull;
        break; // Stop at first unauthorized
      }
    }

    if (exceptionItem) {
      // Si hay aunque sea uno sin abonar, pedimos excepcion global
      setExcepcionDelivery({ id, data: exceptionItem, raw: exceptionItemRaw, blockList: list });
      return;
    }

    setConfirmDelivery({ id, dataList: list });
    setDeliveryScannedBultos({});
    setDeliveryBarcodeInput('');

    // Select all orders by default for delivery
    const sel = {};
    list.forEach(o => sel[o.OrdenRetiro || o.ordenDeRetiro] = true);
    setDeliverySelectedOrders(sel);
  };

  const handleExcepcionSubmit = async (e) => {
    e.preventDefault();
    if (!adminPassword || !excepcionExplicacion) return;

    try {
      const retiro = excepcionDelivery.raw || excepcionDelivery.data;
      await api.post('/web-retiros/excepcional', {
        ordenRetiro: retiro.ordenDeRetiro || retiro.OrdenRetiro,
        codigoCliente: retiro.idcliente || retiro.CodigoCliente || retiro.CliCodigoCliente,
        monto: retiro.monto || retiro.Monto || 0,
        password: adminPassword,
        explicacion: excepcionExplicacion
      });

      // Si autoriza, procedemos a abrir el modal de checklist real con el bloque entero
      const block = excepcionDelivery.blockList;
      setExcepcionDelivery(null);
      setAdminPassword('');
      setExcepcionExplicacion('');

      setConfirmDelivery({ id: excepcionDelivery.id, dataList: block });
      setDeliveryScannedBultos({});
      setDeliveryBarcodeInput('');

      const sel = {};
      block.forEach(o => sel[o.OrdenRetiro || o.ordenDeRetiro] = true);
      setDeliverySelectedOrders(sel);

    } catch (err) {
      setError(err.response?.data?.error || 'Falló la autorización excepcional');
    }
  };

  const handleEntregar = async () => {
    if (!confirmDelivery) return;
    const { id: ubicacionId, dataList } = confirmDelivery;

    // Obtener los seleccionados de la lista de confirmDelivery 
    let ordenesSeleccionadas = [];
    if (ubicacionId === 'FUERA DE ESTANTE') {
      ordenesSeleccionadas = [dataList[0].ordenDeRetiro || dataList[0].OrdenRetiro];
    } else {
      ordenesSeleccionadas = dataList
        .map(item => item.OrdenRetiro || item.ordenDeRetiro)
        .filter(ord => deliverySelectedOrders[ord]);
    }

    if (ordenesSeleccionadas.length === 0) return; // Nada seleccionado

    // === OPTIMISMO UI: Liberar el casillero visualmente de inmediato ===
    setOcupacionEstantes(prev => {
      const next = { ...prev };
      // Si seleccionaron TODO, eliminamos la ubicación entera. Si no, sólo retiramos de la UI las seleccionadas
      if (next[ubicacionId]) {
        const remaining = next[ubicacionId].filter(item => !ordenesSeleccionadas.includes(item.OrdenRetiro || item.ordenDeRetiro));
        if (remaining.length === 0) {
          delete next[ubicacionId];
        } else {
          next[ubicacionId] = remaining;
        }
      }
      return next;
    });

    setConfirmDelivery(null);

    try {
      if (ubicacionId === 'FUERA DE ESTANTE') {
        // TODO handle Fuera de estante which needs direct API central contact
        // Normally we just did an api request to our own backend to mark it depending on what we mapped
        // Para fuera de estante, enviemos la info a eliminar si aplica
      }

      await api.post(`/web-retiros/estantes/liberar-multiple`, {
        ubicacionId,
        ordenesParaEntregar: ordenesSeleccionadas
      });
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
            <h2 className="text-3xl font-black text-slate-800 mt-1">{selectedRetiro.pagoHandy ? selectedRetiro.ordenDeRetiro.replace('R-', 'PW-') : selectedRetiro.ordenDeRetiro}</h2>
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
          <p className="text-slate-500 font-medium text-sm mt-1">Haga click en un casillero vacío para ubicar la orden <strong className="text-blue-600">{selectedRetiro.pagoHandy ? selectedRetiro.ordenDeRetiro.replace('R-', 'PW-') : selectedRetiro.ordenDeRetiro}</strong></p>
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
                      const dataList = ocupacionEstantes[id] || [];
                      const isOccupied = dataList.length > 0;

                      let puedeGuardarAca = true;
                      if (isOccupied && selectedRetiro) {
                        const clienteExistente = String(dataList[0].CodigoCliente || '').trim().toLowerCase();
                        const clienteNuevo = String(selectedRetiro.idcliente || '').trim().toLowerCase();
                        if (clienteExistente !== clienteNuevo && clienteExistente !== 'ecommerce') {
                          puedeGuardarAca = false;
                        }
                      }

                      return (
                        <button
                          key={p}
                          title={!puedeGuardarAca ? "No puedes mezclar órdenes de distintos clientes aquí" : ""}
                          onClick={() => {
                            if (!puedeGuardarAca) {
                              setError('No puedes guardar órdenes de diferentes clientes en el mismo casillero.');
                              return;
                            }
                            handleAsignarUbicacion(est.id, s + 1, p + 1);
                          }}
                          className={`relative h-24 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-sm overflow-hidden ${isOccupied ? (puedeGuardarAca ? 'bg-indigo-600 border-indigo-700 hover:bg-indigo-500 opacity-90' : 'bg-rose-950 border-rose-800 opacity-60 cursor-not-allowed') : 'bg-white border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 group'}`}
                        >
                          <div className="absolute top-1 left-2">
                            <span className={`text-[10px] font-bold ${isOccupied ? 'text-indigo-200' : 'text-slate-400 uppercase group-hover:text-blue-600'}`}>{id}</span>
                          </div>
                          {isOccupied && dataList.length > 1 && (
                            <div className="absolute top-1 right-1 bg-rose-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full z-10">
                              {dataList.length}
                            </div>
                          )}

                          {isOccupied ? (
                            <div className="flex flex-col gap-1 w-full max-h-full overflow-y-auto mt-4 px-1" style={{ scrollbarWidth: 'none' }}>
                              {dataList.map((data, idx) => (
                                <div key={idx} className="flex flex-col items-center bg-indigo-500/50 rounded flex-shrink-0 w-full border border-indigo-400/50 py-0.5">
                                  <span className="text-[9px] font-black text-white px-1 truncate max-w-full">{data.PagoHandy ? data.OrdenRetiro.replace('R-', 'PW-') : data.OrdenRetiro}</span>
                                  <span className="text-[7px] font-bold text-indigo-100 px-1 truncate max-w-[90%]">{data.CodigoCliente || data.ClientName || 'Cliente'}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <>
                              <span className="text-[10px] font-bold text-slate-400 uppercase group-hover:text-blue-600 mb-1">{id}</span>
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-200 group-hover:bg-blue-400 transition-colors" />
                            </>
                          )}
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

  const handlePrintLocal = (retiro, copias = 2) => {
    const clienteNombre = retiro.orders && retiro.orders[0] ? retiro.orders[0].cliente?.nombreApellido || retiro.CliCodigoCliente : retiro.CliCodigoCliente;
    let content = '';
    for (let i = 0; i < copias; i++) {
      content += `
              <div style="font-family: Arial, sans-serif; padding: 20px; border: 2px dashed #000; margin-bottom: 20px; width: 300px;">
                  <h2 style="text-align: center; margin: 0 0 10px 0;">ORDEN DE RETIRO</h2>
                  <h3 style="text-align: center; margin: 0 0 20px 0; font-size: 24px;">${retiro.ordenDeRetiro}</h3>
                  <p><strong>Cliente:</strong> ${clienteNombre || 'N/A'}</p>
                  <p><strong>Lugar:</strong> ${retiro.lugarRetiro || '-'}</p>
                  <p><strong>Estado:</strong> ${retiro.estado || retiro.estadoRetiro || '-'}</p>
                  <p><strong>Total:</strong> ${retiro.totalCost && retiro.totalCost !== 'NaN' ? retiro.totalCost : retiro.montopagorealizado || '-'}</p>
                  <hr/>
                  <p style="font-size: 10px; text-align: center;">Copia ${i + 1} de ${copias}</p>
              </div>
          `;
    }

    const win = window.open('', '', 'width=400,height=600');
    win.document.write(`<html><body style="margin: 0;">${content}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 500);
  };

  const determineColorByDescAndStatus = (retiro) => {
    const desc = (retiro.TClDescripcion || '').toLowerCase();
    const pagado = retiro.pagorealizado === 1;

    if (desc.includes('semanal')) {
      return { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-800' };
    }
    if (desc.includes('rollo')) {
      return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' };
    }
    if (pagado) {
      return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800' };
    }
    // Pendiente de pago
    return { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-800' };
  };

  const OtrosRetirosGrid = () => {
    const uniqueLugaresRetiro = React.useMemo(() => {
      const lugares = new Set();
      otrosRetiros.forEach(o => {
        if (o.lugarRetiro) lugares.add(o.lugarRetiro);
      });
      return Array.from(lugares).filter(Boolean).sort();
    }, [otrosRetiros]);

    return (
      <div className="mt-8 pt-8 border-t-2 border-slate-100">
        <h3 className="text-xl font-black text-slate-800 mb-6">Resto de Retiros (No web)</h3>

        {/* Filtros por Categoría */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex flex-wrap gap-4 text-xs font-bold uppercase tracking-wider">
            <button onClick={() => setFiltroOtros('ALL')} className={`px-4 py-2 rounded-xl border flex items-center gap-2 transition-all ${filtroOtros === 'ALL' ? 'bg-slate-800 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Todos</button>
            <button onClick={() => setFiltroOtros('SEMANAL')} className={`px-4 py-2 rounded-xl border flex items-center gap-2 transition-all ${filtroOtros === 'SEMANAL' ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100'}`}><div className={`w-2 h-2 rounded-full ${filtroOtros === 'SEMANAL' ? 'bg-white' : 'bg-indigo-500'}`}></div>Semanales</button>
            <button onClick={() => setFiltroOtros('ROLLO')} className={`px-4 py-2 rounded-xl border flex items-center gap-2 transition-all ${filtroOtros === 'ROLLO' ? 'bg-amber-500 border-amber-500 text-white shadow-md shadow-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'}`}><div className={`w-2 h-2 rounded-full ${filtroOtros === 'ROLLO' ? 'bg-white' : 'bg-amber-500'}`}></div>Rollos por adelantado</button>
            <button onClick={() => setFiltroOtros('PAGADO')} className={`px-4 py-2 rounded-xl border flex items-center gap-2 transition-all ${filtroOtros === 'PAGADO' ? 'bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'}`}><div className={`w-2 h-2 rounded-full ${filtroOtros === 'PAGADO' ? 'bg-white' : 'bg-emerald-500'}`}></div>Pagados</button>
            <button onClick={() => setFiltroOtros('PENDIENTE')} className={`px-4 py-2 rounded-xl border flex items-center gap-2 transition-all ${filtroOtros === 'PENDIENTE' ? 'bg-rose-500 border-rose-500 text-white shadow-md shadow-rose-200' : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'}`}><div className={`w-2 h-2 rounded-full ${filtroOtros === 'PENDIENTE' ? 'bg-white' : 'bg-rose-500'}`}></div>Pendientes de Pago</button>
          </div>

          {/* Filtro por Lugar de Retiro */}
          <div className="flex flex-wrap gap-3 text-xs font-bold uppercase tracking-wider items-center">
            <span className="py-2 text-slate-400">Local de recogida:</span>
            <button onClick={() => setFiltroLugarRetiro('ALL')} className={`px-4 py-2 rounded-xl border transition-all ${filtroLugarRetiro === 'ALL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>Cualquiera</button>
            {uniqueLugaresRetiro.map((lugar, idx) => (
              <button key={idx} onClick={() => setFiltroLugarRetiro(lugar)} className={`px-4 py-2 rounded-xl border transition-all ${filtroLugarRetiro === lugar ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{lugar}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {otrosRetiros.filter(o => {
            const desc = (o.TClDescripcion || '').toLowerCase();
            const pagado = o.pagorealizado === 1;

            if (filtroOtros === 'SEMANAL' && !desc.includes('semanal')) return false;
            if (filtroOtros === 'ROLLO' && !desc.includes('rollo')) return false;
            if (filtroOtros === 'PAGADO' && (desc.includes('semanal') || desc.includes('rollo') || !pagado)) return false;
            if (filtroOtros === 'PENDIENTE' && (desc.includes('semanal') || desc.includes('rollo') || pagado)) return false;

            if (filtroLugarRetiro !== 'ALL' && o.lugarRetiro !== filtroLugarRetiro) return false;

            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            if (o.ordenDeRetiro && o.ordenDeRetiro.toLowerCase().includes(term)) return true;
            if (o.CliCodigoCliente && o.CliCodigoCliente.toLowerCase().includes(term)) return true;
            return false;
          }).map((retiro, idx) => {
            const colorSet = determineColorByDescAndStatus(retiro);

            return (
              <div key={`${retiro.ordenDeRetiro}-${idx}`} className={`p-5 rounded-2xl shadow-sm border ${colorSet.bg} ${colorSet.border} flex flex-col justify-between transition-transform hover:-translate-y-1 hover:shadow-md cursor-pointer`}
                onClick={() => {
                  const convertedRetiro = {
                    ordenDeRetiro: retiro.ordenDeRetiro,
                    idcliente: retiro.CliCodigoCliente,
                    clienteNombre: retiro.TClNombre || retiro.clienteNombre || retiro.CliCodigoCliente,
                    monto: parseFloat(retiro.totalCost) || parseFloat(retiro.montopagorealizado?.replace('$ ', '').replace('USD ', '')) || 0,
                    moneda: 'UYU', // Default
                    pagorealizado: retiro.pagorealizado,
                    orders: (retiro.orders || []).map(sub => ({
                      orderNumber: sub.orderNumber || sub.codigoOrden,
                      orderId: sub.orderId
                    }))
                  };

                  if (view === 'empaque') {
                    handleSelectRetiro(convertedRetiro);
                  } else {
                    triggerEntregar('FUERA DE ESTANTE', convertedRetiro);
                  }
                }}
              >
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <h4 className={`text-xl font-black ${colorSet.text}`}>{retiro.ordenDeRetiro}</h4>
                    <button
                      title="Imprimir Etiquetas (2 copias)"
                      onClick={(e) => { e.stopPropagation(); handlePrintLocal(retiro, 2); }}
                      className="p-2 bg-white/50 rounded-lg hover:bg-white text-slate-700 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1" />
                        <path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2zm7 2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1" />
                      </svg>
                    </button>
                  </div>
                  <p className={`text-xs font-bold ${colorSet.text} opacity-80 mb-3 uppercase tracking-wider`}>
                    {retiro.TClDescripcion || 'SIN DESC'}
                  </p>
                  <p className="text-slate-700 text-sm mb-1 truncate">
                    <span className="font-semibold">Fecha:</span> {retiro.fechaAlta ? new Date(retiro.fechaAlta).toLocaleDateString() : '-'}
                  </p>
                  <p className="text-slate-700 text-sm mb-1 truncate">
                    <span className="font-semibold">Cliente:</span> {retiro.CliCodigoCliente}
                  </p>

                  <p className="text-slate-700 text-sm mb-1 line-clamp-1">
                    <span className="font-semibold">Estado:</span> {retiro.estado}
                  </p>
                  <p className="text-slate-700 text-sm">
                    <span className="font-semibold">Ubicación:</span> {retiro.lugarRetiro}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-black/5">
                  <span className={`text-sm font-black ${colorSet.text}`}>Total: {retiro.totalCost && retiro.totalCost !== 'NaN' ? retiro.totalCost : retiro.montopagorealizado || '-'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

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
                          <div className="text-lg font-black text-slate-800">{o.pagoHandy ? o.ordenDeRetiro.replace('R-', 'PW-') : o.ordenDeRetiro}</div>
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

              <OtrosRetirosGrid />
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
                  <button
                    onClick={() => setFilterEstante('FUERA')}
                    className={`px-6 py-2.5 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all border ${filterEstante === 'FUERA' ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-transparent text-slate-500 border-transparent hover:bg-slate-50'}`}
                  >
                    Fuera de Estante
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
              {filterEstante !== 'FUERA' && (
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
                                const dataList = ocupacionEstantes[id] || [];
                                const isOccupied = dataList.length > 0;
                                const firstData = dataList[0];

                                const term = searchTerm.toLowerCase();
                                const matchesSearch = isOccupied && dataList.some(item => (
                                  (item.OrdenRetiro && item.OrdenRetiro.toLowerCase().includes(term)) ||
                                  (item.CodigoCliente && String(item.CodigoCliente).toLowerCase().includes(term)) ||
                                  (item.ClientName && item.ClientName.toLowerCase().includes(term))
                                ));
                                const isMismatched = searchTerm && isOccupied && !matchesSearch;
                                const isMatched = searchTerm && isOccupied && matchesSearch;

                                return (
                                  <div
                                    id={`box-${id}`}
                                    key={p}
                                    className={`h-28 rounded-[24px] border-2 transition-all flex flex-col items-center justify-center gap-2 relative group overflow-hidden 
                                        ${isOccupied ? 'bg-indigo-600 border-indigo-700 shadow-md shadow-indigo-300' : 'bg-white border-dashed border-slate-200'}
                                        ${isMismatched ? 'opacity-20 grayscale' : ''}
                                        ${isMatched ? 'ring-4 ring-green-400 border-green-500 bg-green-600 scale-[1.02] shadow-lg shadow-green-200/50' : ''}
                                      `}
                                  >
                                    {isOccupied ? (
                                      <>
                                        {dataList.length > 1 && (
                                          <div className="absolute top-2 right-2 bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10 animate-bounce">
                                            {dataList.length} retiros
                                          </div>
                                        )}
                                        <span className={`font-black tracking-widest absolute top-2 left-3 ${isMatched ? 'text-white text-[10px] drop-shadow-md bg-green-700/50 px-2 py-0.5 rounded mb-1' : 'text-indigo-200 text-[10px]'}`}>{id}</span>

                                        <div className="flex flex-col gap-1 w-full max-h-full overflow-y-auto mt-6 px-2" style={{ scrollbarWidth: 'none' }}>
                                          {dataList.map((data, idx) => (
                                            <div key={idx} className={`flex flex-col items-center rounded flex-shrink-0 w-full border py-0.5 ${isMatched ? 'bg-green-700/50 border-green-400' : 'bg-indigo-500/50 border-indigo-400/50'}`}>
                                              <span className={`text-[11px] font-black italic uppercase truncate px-2 ${isMatched ? 'text-white' : 'text-white'}`}>
                                                {data.PagoHandy ? data.OrdenRetiro.replace('R-', 'PW-') : data.OrdenRetiro}
                                              </span>
                                              <span className={`text-[9px] font-bold truncate px-2 max-w-[90%] bg-black/20 rounded-md py-[1px] mt-[1px] ${isMatched ? 'text-green-100' : 'text-indigo-100'}`}>
                                                {data.CodigoCliente || data.ClientName || 'Cliente'}
                                              </span>
                                            </div>
                                          ))}
                                        </div>

                                        {isMatched && (
                                          <div className="absolute inset-0 bg-blue-600/95 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                              onClick={() => triggerEntregar(id, dataList)}
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
              )}

              {(filterEstante === 'ALL' || filterEstante === 'FUERA') && (
                <OtrosRetirosGrid />
              )}
            </div>
          </div>
        )
      ) : null}

      {/* CONFIRMATION MODAL FOR DELIVERY */}
      {confirmDelivery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Confirmar Entrega</h3>
            <p className="text-slate-500 mb-4 font-medium">
              Ubicación a entregar: <strong className="text-blue-600">{confirmDelivery.id}</strong>
            </p>

            {/* SELECCIÓN DE ÓRDENES MULTPLES */}
            {confirmDelivery.dataList.length > 1 && (
              <div className="mb-4 bg-slate-100 p-4 rounded-2xl border border-slate-200">
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Seleccione las órdenes a retirar:</p>
                <div className="flex flex-col gap-2 max-h-32 overflow-y-auto pr-2">
                  {confirmDelivery.dataList.map(item => {
                    const ordStr = item.OrdenRetiro || item.ordenDeRetiro;
                    const isChecked = !!deliverySelectedOrders[ordStr];
                    return (
                      <label key={ordStr} className={`flex items-center gap-3 cursor-pointer p-2 rounded-xl transition-all ${isChecked ? 'bg-blue-50/80 border border-blue-200' : 'hover:bg-slate-200 border border-transparent'}`}>
                        <input type="checkbox" className="w-5 h-5 accent-blue-600 rounded" checked={isChecked} onChange={(e) => setDeliverySelectedOrders(prev => ({ ...prev, [ordStr]: e.target.checked }))} />
                        <span className="font-bold text-slate-700">{item.PagoHandy ? ordStr.replace('R-', 'PW-') : ordStr}</span>
                        <span className="text-xs text-slate-500 truncate">{item.ClientName || item.CodigoCliente || 'Cliente'}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <form onSubmit={(e) => {
              e.preventDefault();
              const code = deliveryBarcodeInput.trim().toUpperCase();
              if (!code) return;
              try {
                let bultosFlat = [];
                confirmDelivery.dataList.forEach(obj => {
                  const ordStr = obj.OrdenRetiro || obj.ordenDeRetiro;
                  if (!deliverySelectedOrders[ordStr]) return;
                  if (obj.BultosJSON) { bultosFlat.push(...JSON.parse(obj.BultosJSON)); }
                  else if (obj.orders) { bultosFlat.push(...obj.orders); }
                });

                const found = bultosFlat.find((o) => (o.orderNumber && o.orderNumber.toUpperCase() === code) || (o.id && o.id.toString().toUpperCase() === code));
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
                    let bultosFlat = [];
                    confirmDelivery.dataList.forEach(obj => {
                      const ordStr = obj.OrdenRetiro || obj.ordenDeRetiro;
                      if (!deliverySelectedOrders[ordStr]) return;
                      if (obj.BultosJSON) { bultosFlat.push(...JSON.parse(obj.BultosJSON)); }
                      else if (obj.orders) { bultosFlat.push(...obj.orders); }
                    });

                    if (bultosFlat.length === 0) return <li className="text-sm font-medium text-slate-600">No hay bultos u órdenes seleccionadas.</li>;
                    return bultosFlat.map((b, i) => {
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
                  let bultosFlat = [];
                  confirmDelivery.dataList.forEach(obj => {
                    const ordStr = obj.OrdenRetiro || obj.ordenDeRetiro;
                    if (!deliverySelectedOrders[ordStr]) return;
                    if (obj.BultosJSON) { bultosFlat.push(...JSON.parse(obj.BultosJSON)); }
                    else if (obj.orders) { bultosFlat.push(...obj.orders); }
                  });

                  // Ensure at least one order is selected
                  const hayOrdenSeleccionada = Object.values(deliverySelectedOrders).some(v => v);

                  if (!hayOrdenSeleccionada) {
                    allChecked = false;
                  } else if (bultosFlat.length > 0) {
                    allChecked = bultosFlat.every(b => !!deliveryScannedBultos[b.orderNumber || b.id || '']);
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

      {/* EXCEPCION MODAL FOR UNPAID DELIVERY */}
      {excepcionDelivery && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 border-2 border-rose-200">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-2xl font-black text-slate-800 text-center mb-2">!ALERTA!</h3>
            <p className="text-slate-600 font-medium text-center mb-6">
              Este retiro <strong>DEBE SER ABONADO</strong>. Por favor verifique que pase por caja y confirme el pago.
              <br /><br />
              <span className="text-xs text-rose-500 font-bold uppercase tracking-wider">Esto es una excepcionalidad</span>
            </p>

            <form onSubmit={handleExcepcionSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-700 mb-2">Contraseña de Autorización</label>
                <input
                  type="password"
                  required
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:outline-none transition-all"
                  placeholder="Ingrese contraseña..."
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-bold text-slate-700 mb-2">Explicación o Detalle (Requerido)</label>
                <textarea
                  required
                  value={excepcionExplicacion}
                  onChange={(e) => setExcepcionExplicacion(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-500 focus:outline-none transition-all resize-none"
                  placeholder="Justifique la excepción de este retiro..."
                ></textarea>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => { setExcepcionDelivery(null); setAdminPassword(''); }}
                  className="flex-[1] py-3 px-4 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-[1] py-3 px-4 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 shadow-md shadow-rose-200 transition-all flex justify-center items-center gap-2"
                >
                  <Check size={18} /> Autorizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default WebRetirosPage;
