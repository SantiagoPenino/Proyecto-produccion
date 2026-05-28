import React, { useState, useEffect, useMemo } from 'react';
import { X, CheckCircle, FileText, User, Plus, Trash2, DollarSign, UserCheck, Loader2 } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';



export default function FacturacionManualModal({ onClose, onSuccess, initialData }) {
  const [clientes, setClientes] = useState([]);
  const [tiposDocs, setTiposDocs] = useState([]);
  const [monedas, setMonedas] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [articulos, setArticulos] = useState([]);
  const [metodosPago, setMetodosPago] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingClient, setUpdatingClient] = useState(false);

  // Nuevos estados para búsqueda de clientes y pagos mixtos
  const [qCliente, setQCliente] = useState('');
  const [cotizacion, setCotizacion] = useState(40);
  const [pagos, setPagos] = useState(() => {
    if (initialData && Array.isArray(initialData.pagos)) {
      return initialData.pagos.map((p, idx) => ({
        id: Date.now() + idx,
        metodoPagoId: String(p.MPaIdMetodoPago || p.metodoPagoId || ''),
        monedaId: p.PagIdMonedaPago || p.monedaId || 1,
        monto: String(p.PagMontoPago || p.monto || '')
      }));
    }
    return [];
  });

  const [formData, setFormData] = useState(() => {
    if (initialData) {
      return {
        DocTipo: initialData.DocTipo || 'FACTURA',
        MonIdMoneda: initialData.MonIdMoneda || 1,
        CliIdCliente: initialData.CliIdCliente || '',
        DocCliNombre: initialData.DocCliNombre || initialData.CliRazonSocial || initialData.CliNombreFantasia || '',
        DocCliDocumento: initialData.DocCliDocumento || initialData.CliRUT || '',
        DocCliDireccion: initialData.DocCliDireccion || initialData.CliDireccion || '',
        DocCliCiudad: initialData.DocCliCiudad || '',
        DocPagado: initialData.DocPagado || false,
        MetodoPagoId: initialData.MetodoPagoId || '',
        Lineas: (initialData.lineas || []).map((l, idx) => {
          const qty = parseFloat(l.DcdCantidad) || 1;
          const sub = parseFloat(l.DcdSubtotal) || 0;
          const imp = parseFloat(l.DcdImpuestos) || 0;
          const total = parseFloat(l.DcdTotal) || (sub + imp);
          const unitPrice = qty > 0 ? (total / qty) : (parseFloat(l.DcdPrecioUnitario) || 0);
          
          let ivaRate = 22;
          if (sub > 0) {
            const ratio = (imp / sub) * 100;
            if (ratio < 2) ivaRate = 0;
            else if (ratio < 15) ivaRate = 10;
            else ivaRate = 22;
          }

          return {
            id: Date.now() + idx,
            concepto: (l.DcdNomItem || '').trim(),
            DcdDscItem: (l.DcdDscItem || '').trim(),
            cantidad: qty,
            precioUnitario: parseFloat(unitPrice.toFixed(4)),
            iva: ivaRate,
            isPreexisting: true,
            precioNote: 'Precio original'
          };
        })
      };
    }
    return {
      DocTipo: 'FACTURA',
      MonIdMoneda: 1, // 1 = UYU, 2 = USD
      CliIdCliente: '',
      DocCliNombre: '',
      DocCliDocumento: '',
      DocCliDireccion: '',
      DocCliCiudad: '',
      DocPagado: false,
      MetodoPagoId: '',
      Lineas: [
        { id: Date.now(), concepto: '', DcdDscItem: '', cantidad: 1, precioUnitario: '', iva: 22 }
      ]
    };
  });

  useEffect(() => {
    fetchData();
  }, []);

  // Calcular totales
  const totales = useMemo(() => {
    let subtotal = 0;
    let total = 0;
    formData.Lineas.forEach(l => {
      const qty = parseFloat(l.cantidad) || 0;
      const price = parseFloat(l.precioUnitario) || 0;
      const ivaRate = (l.iva !== undefined && l.iva !== null) ? parseFloat(l.iva) : 22;
      const lineTotal = qty * price;
      const lineNeto = lineTotal / (1 + ivaRate / 100);
      
      total += lineTotal;
      subtotal += lineNeto;
    });
    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      iva: parseFloat((total - subtotal).toFixed(2)),
      total: parseFloat(total.toFixed(2))
    };
  }, [formData.Lineas]);

  // Rellenar automáticamente monto en pagos si solo hay una línea y cambia el total o la moneda
  useEffect(() => {
    if (formData.DocPagado && pagos.length === 1) {
      setPagos(prev => [
        {
          ...prev[0],
          monto: totales.total.toFixed(2),
          monedaId: formData.MonIdMoneda
        }
      ]);
    }
  }, [totales.total, formData.DocPagado, formData.MonIdMoneda]);

  // Inicializar pagos cuando se marca como pagado
  useEffect(() => {
    if (formData.DocPagado) {
      if (pagos.length === 0 && metodosPago.length > 0) {
        const defaultMetodo = metodosPago.find(mp => /(contado|efectivo)/i.test(mp.MPaDescripcionMetodo))?.MPaIdMetodoPago || metodosPago[0]?.MPaIdMetodoPago;
        setPagos([
          {
            id: Date.now(),
            metodoPagoId: defaultMetodo ? String(defaultMetodo) : '',
            monedaId: formData.MonIdMoneda,
            monto: totales.total.toFixed(2)
          }
        ]);
        if (defaultMetodo) {
          setFormData(prev => ({ ...prev, MetodoPagoId: String(defaultMetodo) }));
        }
      }
    } else {
      setPagos([]);
    }
  }, [formData.DocPagado, metodosPago]);

  const fetchData = async () => {
    try {
      const [resClientes, resNomencladores, resDepartamentos, resArticulos, resMetodosPago, resCotizacion] = await Promise.all([
        api.get('/clients'),
        api.get('/contabilidad/cfe/nomencladores'),
        api.get('/nomenclators/departments').catch(() => ({ data: { success: false, data: [] } })),
        api.get('/contabilidad/articulos').catch(() => ({ data: { success: false, data: [] } })),
        api.get('/apipagos/metodos').catch(() => ({ data: [] })),
        api.get('/contabilidad/cotizacion-hoy').catch(() => null)
      ]);
      setClientes(resClientes.data || []);
      setMetodosPago(Array.isArray(resMetodosPago.data) ? resMetodosPago.data : []);
      
      if (resCotizacion?.data?.success && resCotizacion.data?.data?.CotDolar) {
        setCotizacion(resCotizacion.data.data.CotDolar);
      } else if (resCotizacion?.data?.promedio) {
        setCotizacion(resCotizacion.data.promedio);
      }

      if (resNomencladores.data?.success) {
        const tDocs = resNomencladores.data.tiposDocumentos || [];
        setTiposDocs(tDocs);
        setMonedas(resNomencladores.data.monedas || []);
        if (tDocs.length > 0 && !initialData) {
          setFormData(prev => ({ ...prev, DocTipo: tDocs[0].value }));
        }
      }

      if (resDepartamentos.data?.success && Array.isArray(resDepartamentos.data.data)) {
        setDepartamentos(resDepartamentos.data.data);
      } else if (resDepartamentos.data && Array.isArray(resDepartamentos.data)) {
        setDepartamentos(resDepartamentos.data);
      }

      if (resArticulos.data?.success && Array.isArray(resArticulos.data.data)) {
        setArticulos(resArticulos.data.data);
      } else if (resArticulos.data && Array.isArray(resArticulos.data)) {
        setArticulos(resArticulos.data);
      }
    } catch (e) {
      console.error('Error cargando datos:', e);
    }
  };

  // --- Helpers para Líneas ---
  const addLinea = () => {
    setFormData(prev => ({
      ...prev,
      Lineas: [...prev.Lineas, { id: Date.now(), concepto: '', DcdDscItem: '', cantidad: 1, precioUnitario: '', iva: 22 }]
    }));
  };

  const recalcularPrecioLineaManual = async (lineId, currConcepto, currCantidad, currentClienteId, currentMonedaId) => {
    if (!currConcepto) return;
    const match = articulos.find(a => a.NombreArticulo === currConcepto);
    if (!match) return;
    try {
      const res = await api.post('/prices/calculate', {
        codArticulo: match.CodigoArticulo,
        cantidad: parseFloat(currCantidad) || 1,
        clienteId: currentClienteId ? Number(currentClienteId) : null,
        targetCurrency: currentMonedaId === 2 ? 'USD' : 'UYU'
      });
      if (res.data && res.data.precioUnitario !== undefined) {
        const price = Number(res.data.precioUnitario);
        setFormData(prev => ({
          ...prev,
          Lineas: prev.Lineas.map(l => {
            if (l.id === lineId) {
              return {
                ...l,
                precioUnitario: price,
                precioNote: res.data.perfilesAplicados?.length 
                  ? `Tarifa: ${res.data.perfilesAplicados.join(', ')}` 
                  : 'Precio Base'
              };
            }
            return l;
          })
        }));
        toast.success(`Precio cargado: ${currentMonedaId === 2 ? 'U$S' : '$'} ${price} (Perfil: ${res.data.perfilesAplicados?.join(', ') || 'Precio Base'})`);
      }
    } catch (err) {
      console.error('Error recalculando precio:', err);
    }
  };

  const handleClienteChange = (val) => {
    if (!val) {
      setFormData(prev => {
        setTimeout(() => {
          prev.Lineas.forEach(l => {
            if (!l.isPreexisting) {
              recalcularPrecioLineaManual(l.id, l.concepto, l.cantidad, null, prev.MonIdMoneda);
            }
          });
        }, 100);
        return {
          ...prev,
          CliIdCliente: '',
          DocCliNombre: '',
          DocCliDocumento: '',
          DocCliDireccion: '',
          DocCliCiudad: ''
        };
      });
      return;
    }
    
    const c = clientes.find(item => String(item.CodCliente || item.CliIdCliente) === String(val));
    if (c) {
      let deptoNombre = '';
      if (c.DepartamentoID && departamentos.length > 0) {
        const found = departamentos.find(d => d.ID === c.DepartamentoID || d.id === c.DepartamentoID);
        if (found) deptoNombre = found.Nombre;
      }
      setFormData(prev => {
        setTimeout(() => {
          prev.Lineas.forEach(l => {
            if (!l.isPreexisting) {
              recalcularPrecioLineaManual(l.id, l.concepto, l.cantidad, val, prev.MonIdMoneda);
            }
          });
        }, 100);
        return {
          ...prev,
          CliIdCliente: val,
          DocCliNombre: c.Nombre || c.NombreFantasia || '',
          DocCliDocumento: c.CioRuc || c.IDCliente || '',
          DocCliDireccion: c.DireccionTrabajo || '',
          DocCliCiudad: deptoNombre || ''
        };
      });
    } else {
      setFormData(prev => ({ ...prev, CliIdCliente: val }));
    }
  };

  const handleSetConsumidorFinal = () => {
    setFormData(prev => ({
      ...prev,
      DocCliNombre: 'Consumidor Final',
      DocCliDocumento: '',
      DocCliDireccion: '',
      DocCliCiudad: 'Montevideo'
    }));
    toast.info('Campos DGI cambiados a Consumidor Final');
  };

  const handleRestoreFichaCliente = () => {
    if (!formData.CliIdCliente) {
      toast.error('Debe seleccionar un cliente en la lista primero para restablecer sus datos');
      return;
    }
    const c = clientes.find(item => String(item.CodCliente || item.CliIdCliente) === String(formData.CliIdCliente));
    if (c) {
      let deptoNombre = '';
      if (c.DepartamentoID && departamentos.length > 0) {
        const found = departamentos.find(d => d.ID === c.DepartamentoID || d.id === c.DepartamentoID);
        if (found) deptoNombre = found.Nombre;
      }
      setFormData(prev => ({
        ...prev,
        DocCliNombre: c.Nombre || c.NombreFantasia || '',
        DocCliDocumento: c.CioRuc || c.IDCliente || '',
        DocCliDireccion: c.DireccionTrabajo || '',
        DocCliCiudad: deptoNombre || ''
      }));
      toast.success('Datos DGI restablecidos desde la ficha del cliente');
    } else {
      toast.error('Cliente no encontrado en la lista');
    }
  };

  const handleUpdateClientDGI = async () => {
    if (!formData.CliIdCliente || Number(formData.CliIdCliente) <= 1) {
      toast.error('Debe seleccionar un cliente válido para actualizar su ficha.');
      return;
    }
    if (!formData.DocCliNombre || !formData.DocCliDocumento || !formData.DocCliDireccion || !formData.DocCliCiudad) {
      toast.error('Todos los campos (Nombre, Documento, Dirección, Ciudad/Depto) son obligatorios para actualizar la ficha.');
      return;
    }

    const depObj = departamentos.find(d => d.Nombre === formData.DocCliCiudad);
    const depId = depObj ? depObj.ID || depObj.id : null;
    if (!depId) {
      toast.error('El departamento seleccionado no es válido.');
      return;
    }

    setUpdatingClient(true);
    try {
      await api.patch(`/contabilidad/clientes/${formData.CliIdCliente}/dgi`, {
        Nombre: formData.DocCliNombre,
        Documento: formData.DocCliDocumento,
        Direccion: formData.DocCliDireccion,
        Ciudad: depId
      });
      toast.success('Ficha del cliente actualizada con éxito');
    } catch (err) {
      toast.error('Error al actualizar ficha: ' + (err.response?.data?.error || err.message));
    } finally {
      setUpdatingClient(false);
    }
  };

  const removeLinea = (id) => {
    setFormData(prev => ({
      ...prev,
      Lineas: prev.Lineas.filter(l => l.id !== id)
    }));
  };

  const updateLinea = (id, field, value) => {
    setFormData(prev => {
      const lineToUpdate = prev.Lineas.find(l => l.id === id);
      if (!lineToUpdate) return prev;

      const updatedLine = { ...lineToUpdate, [field]: value };
      
      const conceptoChanged = field === 'concepto' && value !== lineToUpdate.concepto;
      const cantidadChanged = field === 'cantidad' && value !== lineToUpdate.cantidad;

      if ((conceptoChanged || cantidadChanged) && updatedLine.concepto) {
        setTimeout(() => {
          recalcularPrecioLineaManual(id, updatedLine.concepto, updatedLine.cantidad, prev.CliIdCliente, prev.MonIdMoneda);
        }, 50);
      }

      if (field === 'precioUnitario') {
        updatedLine.precioNote = 'Modificado manualmente';
      }

      return {
        ...prev,
        Lineas: prev.Lineas.map(l => l.id === id ? updatedLine : l)
      };
    });
  };

  // --- Helpers de Pagos Mixtos ---
  const addPago = () => {
    const defaultMetodo = metodosPago.find(mp => /(contado|efectivo)/i.test(mp.MPaDescripcionMetodo))?.MPaIdMetodoPago || metodosPago[0]?.MPaIdMetodoPago;
    setPagos(prev => [
      ...prev,
      {
        id: Date.now(),
        metodoPagoId: defaultMetodo ? String(defaultMetodo) : '',
        monedaId: formData.MonIdMoneda,
        monto: ''
      }
    ]);
  };

  const removePago = (id) => {
    setPagos(prev => prev.filter(p => p.id !== id));
  };

  const updatePago = (id, field, value) => {
    setPagos(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const totalPagado = useMemo(() => {
    return pagos.reduce((acc, p) => {
      const amt = parseFloat(p.monto) || 0;
      const isComprobanteUSD = formData.MonIdMoneda === 2;
      const isPagoUSD = String(p.monedaId) === '2';
      
      if (isComprobanteUSD) {
        if (isPagoUSD) return acc + amt;
        return acc + (amt / cotizacion);
      } else {
        if (isPagoUSD) return acc + (amt * cotizacion);
        return acc + amt;
      }
    }, 0);
  }, [pagos, formData.MonIdMoneda, cotizacion]);

  const diferenciaPago = totales.total - totalPagado;
  const balanceOK = Math.abs(diferenciaPago) < 0.05;

  const autoRellenarPago = () => {
    if (diferenciaPago <= 0) return;
    const last = pagos[pagos.length - 1];
    if (!last) {
      addPago();
      return;
    }
    let fill = diferenciaPago;
    const isComprobanteUSD = formData.MonIdMoneda === 2;
    const isLastUSD = String(last.monedaId) === '2';
    
    if (isComprobanteUSD && !isLastUSD) {
      fill = diferenciaPago * cotizacion;
    } else if (!isComprobanteUSD && isLastUSD) {
      fill = diferenciaPago / cotizacion;
    }
    
    setPagos(prev => prev.map((p, i) => 
      i === prev.length - 1 
        ? { ...p, monto: ((parseFloat(p.monto) || 0) + fill).toFixed(2) }
        : p
    ));
  };

  // Filtrado de Clientes
  const filteredClientes = useMemo(() => {
    if (!qCliente.trim()) return [];
    const q = qCliente.toLowerCase();
    return clientes.filter(c => 
      String(c.Nombre || '').toLowerCase().includes(q) ||
      String(c.NombreFantasia || '').toLowerCase().includes(q) ||
      String(c.CioRuc || '').toLowerCase().includes(q) ||
      String(c.CodCliente || '').toLowerCase().includes(q) ||
      String(c.IDCliente || '').toLowerCase().includes(q)
    );
  }, [clientes, qCliente]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.DocTipo.includes('FACTURA') && !formData.CliIdCliente) {
      return toast.error('Las e-Facturas requieren un cliente con RUT seleccionado.');
    }
    if (formData.DocPagado && pagos.length === 0) {
      return toast.error('Debe seleccionar al menos un método de pago si el documento está pagado.');
    }
    if (formData.DocPagado && !balanceOK) {
      return toast.error('La suma de los pagos ingresados debe coincidir con el total de la factura.');
    }
    
    const lineasValidas = formData.Lineas.filter(l => l.concepto.trim() !== '' && parseFloat(l.precioUnitario) >= 0);
    if (lineasValidas.length === 0) {
      return toast.error('Debe agregar al menos una línea con concepto y precio.');
    }

    setLoading(true);
    try {
      await api.post('/contabilidad/cfe/manual', {
        DocTipo: formData.DocTipo,
        MonIdMoneda: formData.MonIdMoneda,
        CliIdCliente: formData.CliIdCliente ? parseInt(formData.CliIdCliente) : null,
        DocCliNombre: formData.DocCliNombre,
        DocCliDocumento: formData.DocCliDocumento,
        DocCliDireccion: formData.DocCliDireccion,
        DocCliCiudad: formData.DocCliCiudad,
        DocPagado: formData.DocPagado,
        MetodoPagoId: formData.DocPagado ? parseInt(pagos[0]?.metodoPagoId) : null,
        Pagos: formData.DocPagado ? pagos.map(p => ({
          metodoPagoId: parseInt(p.metodoPagoId),
          monto: parseFloat(p.monto),
          monedaId: parseInt(p.monedaId)
        })) : null,
        Lineas: lineasValidas.map(l => ({
          concepto: l.concepto,
          DcdDscItem: l.DcdDscItem || '',
          cantidad: parseFloat(l.cantidad),
          precioUnitario: parseFloat(l.precioUnitario),
          iva: parseFloat(l.iva)
        })),
        Totales: totales
      });
      toast.success('Documento generado exitosamente');
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Error al emitir el documento');
    } finally {
      setQCliente('');
      setPagos([]);
      setLoading(false);
    }
  };

  const formatMoney = (val) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2 }).format(val);

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-100 flex flex-col w-screen h-screen overflow-hidden animate-in fade-in select-none">
      {/* HEADER */}
      <div className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-md shadow-indigo-600/10">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-800 tracking-tight leading-none">Nueva Facturación Manual Libre (DGI)</h2>
            <p className="text-xs font-semibold text-zinc-400 mt-1">Emisión directa y arqueo sin pasar por caja de mostrador</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-xl transition-all">
          <X size={20} />
        </button>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex-1 flex flex-col p-4 gap-4 min-h-0 overflow-y-auto">
        
        {/* TARJETA HORIZONTAL SUPERIOR: Pagos, Comprobante, Observaciones, Acción */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 flex gap-6 items-start flex-wrap w-full shrink-0 animate-in fade-in duration-300">
          
          {/* Columna 1: Formas de Pago / Cobro Inmediato */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-[320px]">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Formas de pago recibidas</label>
              
              <div className={`px-2.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5
                ${!formData.DocPagado
                  ? 'bg-zinc-100 border-zinc-200 text-zinc-500'
                  : balanceOK
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : diferenciaPago > 0
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : 'bg-zinc-100 border-zinc-200 text-zinc-500'
                }`}
              >
                <span>
                  {!formData.DocPagado
                    ? '⏳ Factura a Crédito'
                    : balanceOK
                      ? '✅ Caja Balanceada'
                      : diferenciaPago > 0
                        ? `Falta ${formData.MonIdMoneda === 2 ? 'U$S' : '$'} ${formatMoney(Math.abs(diferenciaPago))}`
                        : `Excede ${formData.MonIdMoneda === 2 ? 'U$S' : '$'} ${formatMoney(Math.abs(diferenciaPago))}`}
                </span>
              </div>
            </div>

            <div className="flex gap-3 items-center">
              {/* Selector Contado / Crédito */}
              <select
                value={formData.DocPagado ? "true" : "false"}
                onChange={e => setFormData(prev => ({ ...prev, DocPagado: e.target.value === "true" }))}
                className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 outline-none focus:border-indigo-500 shadow-sm cursor-pointer shrink-0 w-44"
              >
                <option value="false">Crédito (A Deuda)</option>
                <option value="true">Contado (Cobro Inmediato)</option>
              </select>

              {/* Botón rápido si faltan pagos */}
              {formData.DocPagado && diferenciaPago > 0.01 && (
                <button
                  type="button"
                  onClick={autoRellenarPago}
                  className="bg-indigo-50 text-indigo-600 text-[10px] font-black border border-indigo-200 rounded-xl px-3 py-2 hover:bg-indigo-100 transition-all uppercase tracking-wider shadow-sm shrink-0"
                >
                  Completar Saldo
                </button>
              )}
            </div>

            {/* Listado de Pagos Mixtos */}
            {formData.DocPagado && (
              <div className="flex flex-col gap-2 mt-2 max-h-32 overflow-y-auto w-full">
                {pagos.map(p => (
                  <div key={p.id} className="flex gap-2 items-center bg-zinc-50 border border-zinc-200 p-2 rounded-xl">
                    <select
                      value={p.metodoPagoId}
                      onChange={e => updatePago(p.id, 'metodoPagoId', e.target.value)}
                      className="bg-white border border-zinc-200 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-800 outline-none w-32 shrink-0 cursor-pointer"
                    >
                      <option value="">Medio...</option>
                      {metodosPago.map(mp => <option key={mp.MPaIdMetodoPago} value={mp.MPaIdMetodoPago}>{mp.MPaDescripcionMetodo}</option>)}
                    </select>

                    <div className="flex bg-zinc-200 rounded-lg p-0.5 border border-zinc-300 select-none shrink-0 text-[10px]">
                      <button
                        type="button"
                        onClick={() => updatePago(p.id, 'monedaId', 1)}
                        className={`px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all ${
                          String(p.monedaId) === '1' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                      >
                        $ (PESOS)
                      </button>
                      <button
                        type="button"
                        onClick={() => updatePago(p.id, 'monedaId', 2)}
                        className={`px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all ${
                          String(p.monedaId) === '2' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                      >
                        US$ (DÓLARES)
                      </button>
                    </div>

                    <input
                      type="number"
                      placeholder="0.00"
                      value={p.monto}
                      onChange={e => updatePago(p.id, 'monto', e.target.value)}
                      className="w-24 bg-white border border-zinc-200 rounded-xl px-3 py-1.5 text-xs font-black text-zinc-800 text-right outline-none focus:border-indigo-500 shadow-inner"
                    />

                    {pagos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePago(p.id)}
                        className="text-zinc-400 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all shrink-0"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                
                <button
                  type="button"
                  onClick={addPago}
                  className="w-40 text-left bg-zinc-50 text-zinc-500 text-[10px] font-black border border-dashed border-zinc-200 rounded-lg px-3 py-1.5 hover:border-zinc-400 hover:text-zinc-800 transition-all flex items-center gap-1 uppercase tracking-wider mt-1"
                >
                  <Plus size={12} /> Agregar Medio
                </button>
              </div>
            )}
          </div>

          {/* Columna 2: Configuración del Comprobante */}
          <div className="flex flex-col gap-1.5 min-w-[200px] flex-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tipo de Comprobante</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              <div>
                <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">CFE</label>
                <select
                  value={formData.DocTipo}
                  onChange={e => setFormData({ ...formData, DocTipo: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 outline-none focus:border-indigo-500 shadow-sm cursor-pointer mt-0.5"
                >
                  {tiposDocs.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Moneda</label>
                <select
                  value={formData.MonIdMoneda}
                  onChange={e => {
                    const newMonId = parseInt(e.target.value);
                    setFormData(prev => {
                      setTimeout(() => {
                        prev.Lineas.forEach(l => {
                          if (!l.isPreexisting) {
                            recalcularPrecioLineaManual(l.id, l.concepto, l.cantidad, prev.CliIdCliente, newMonId);
                          }
                        });
                      }, 100);
                      return { ...prev, MonIdMoneda: newMonId };
                    });
                  }}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-black text-zinc-800 outline-none focus:border-indigo-500 shadow-sm cursor-pointer mt-0.5"
                >
                  <option value={1}>UYU ($)</option>
                  <option value={2}>USD (U$S)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Columna 3: Observaciones y Procesar Emisión */}
          <div className="flex flex-col gap-1.5 min-w-[280px] flex-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Observaciones Internas</label>
            <input
              type="text"
              placeholder="Añada notas informativas..."
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold text-zinc-800 outline-none focus:border-indigo-500 transition-all shadow-sm placeholder-zinc-300 mt-1"
            />
            
            <button
              type="submit"
              form="factura-form"
              disabled={loading}
              className="w-full bg-[#006097] hover:bg-[#005080] text-white font-black py-3.5 px-6 rounded-2xl border border-transparent shadow-lg shadow-sky-600/10 transition-all hover:scale-[1.01] active:scale-[0.98] text-xs uppercase tracking-wider whitespace-nowrap flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 mt-3"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <><CheckCircle size={16} /> {formData.DocPagado ? 'PROCESAR EMISIÓN (CONTADO)' : 'PROCESAR EMISIÓN (A DEUDA)'}</>
              )}
            </button>
          </div>

        </div>

        {/* ESTRUCTURA INFERIOR: Columnas Divididas */}
        <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 min-w-0">
          
          {/* COLUMNA IZQUIERDA: Clientes y DGI */}
          <div className="w-full lg:w-[360px] bg-white border border-zinc-200 rounded-2xl flex flex-col p-4 shrink-0 gap-4 overflow-y-auto shadow-sm">
            
            {/* 1. Seleccionar Cliente */}
            <div className="flex flex-col gap-3">
              <h3 className="font-black text-zinc-400 text-[10px] uppercase tracking-widest flex items-center justify-between">
                1. Seleccionar Cliente
                {formData.CliIdCliente && (
                  <span className="text-emerald-600 flex items-center gap-1 text-[8px] font-black bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                    Verificado <CheckCircle size={10}/>
                  </span>
                )}
              </h3>

              {!formData.CliIdCliente ? (
                <div className="relative">
                  <input
                    type="text"
                    value={qCliente}
                    onChange={e => setQCliente(e.target.value)}
                    placeholder="Buscar cliente por nombre, RUT, C.I..."
                    className="w-full bg-zinc-50 border border-zinc-200 hover:border-zinc-300 focus:border-indigo-500 focus:bg-white rounded-xl pl-4 pr-4 py-2.5 text-sm font-bold text-zinc-800 placeholder-zinc-400 outline-none transition-all shadow-sm"
                  />

                  {filteredClientes.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1.5 bg-white border border-zinc-200 rounded-xl shadow-xl z-30 max-h-60 overflow-y-auto p-1.5 flex flex-col gap-1">
                      {filteredClientes.slice(0, 10).map(c => (
                        <div
                          key={c.CodCliente || c.CliIdCliente}
                          onClick={() => {
                            handleClienteChange(c.CodCliente || c.CliIdCliente);
                            setQCliente('');
                          }}
                          className="p-2.5 hover:bg-indigo-50/50 border border-transparent hover:border-indigo-100/50 rounded-lg cursor-pointer transition-all flex flex-col"
                        >
                          <span className="text-sm font-extrabold text-zinc-800">{c.Nombre || c.NombreFantasia}</span>
                          <span className="text-[10px] text-zinc-400 font-mono font-bold mt-0.5">
                            {c.CioRuc ? `RUT/CI: ${c.CioRuc}` : `ID: ${c.CodCliente || c.CliIdCliente}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Ficha Cliente Seleccionado (Estilo Caja) */
                <div className="bg-indigo-50/30 border border-indigo-100 rounded-xl p-4 shadow-sm flex flex-col gap-3 relative animate-in fade-in duration-250">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-extrabold text-lg shadow-sm shrink-0">
                        <User size={18} />
                      </div>
                      <div>
                        <p className="text-zinc-800 text-sm font-black leading-tight truncate max-w-[180px]">
                          {formData.DocCliNombre || 'Cliente'}
                        </p>
                        <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider font-mono mt-0.5">
                          ID: {formData.CliIdCliente}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleClienteChange('')}
                      className="bg-white hover:bg-rose-50 text-zinc-400 hover:text-rose-600 p-1.5 rounded-lg transition-all border border-zinc-200 hover:border-rose-200 shadow-sm"
                      title="Quitar Cliente"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Datos DGI */}
            <div className="flex flex-col gap-2.5 bg-zinc-50 border border-zinc-200/60 rounded-xl p-3 mt-1">
              <div className="flex items-center justify-between">
                <h3 className="text-[9px] font-black text-zinc-400 uppercase tracking-widest px-1">Datos DGI Comprobante</h3>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSetConsumidorFinal}
                    className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 cursor-pointer"
                  >
                    Cons. Final
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreFichaCliente}
                    disabled={!formData.CliIdCliente}
                    className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Restaurar
                  </button>
                  {formData.CliIdCliente && Number(formData.CliIdCliente) > 1 && (
                    <button
                      type="button"
                      onClick={handleUpdateClientDGI}
                      disabled={updatingClient}
                      className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 cursor-pointer disabled:opacity-50"
                    >
                      {updatingClient ? '...' : 'Actualizar'}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-1">
                <div>
                  <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Nombre / Razón Social</label>
                  <input
                    type="text"
                    value={formData.DocCliNombre}
                    onChange={e => setFormData({ ...formData, DocCliNombre: e.target.value })}
                    className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Documento (RUT / CI)</label>
                  <input
                    type="text"
                    value={formData.DocCliDocumento}
                    onChange={e => setFormData({ ...formData, DocCliDocumento: e.target.value })}
                    className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Dirección DGI</label>
                  <input
                    type="text"
                    value={formData.DocCliDireccion}
                    onChange={e => setFormData({ ...formData, DocCliDireccion: e.target.value })}
                    className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Ciudad / Depto</label>
                  <select
                    value={formData.DocCliCiudad}
                    onChange={e => setFormData({ ...formData, DocCliCiudad: e.target.value })}
                    className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5 cursor-pointer"
                  >
                    <option value="">— Seleccionar —</option>
                    {departamentos.map(dep => (
                      <option key={dep.ID || dep.id} value={dep.Nombre}>{dep.Nombre}</option>
                    ))}
                    {formData.DocCliCiudad && !departamentos.find(d => d.Nombre === formData.DocCliCiudad) && (
                      <option value={formData.DocCliCiudad}>{formData.DocCliCiudad}</option>
                    )}
                  </select>
                </div>
              </div>
            </div>

          </div>

          {/* COLUMNA DERECHA: Conceptos y Totales */}
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            
            {/* Panel de Conceptos */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm flex flex-col flex-1 gap-3 min-h-0 overflow-y-auto">
              <form id="factura-form" onSubmit={handleSubmit} className="flex flex-col gap-3 flex-1 min-h-0">
                <div className="flex justify-between items-center shrink-0 pb-1.5 border-b border-zinc-100">
                  <h3 className="font-black text-zinc-400 text-[10px] uppercase tracking-widest">2. Conceptos del Comprobante</h3>
                  <button
                    type="button"
                    onClick={addLinea}
                    className="text-[10px] font-black text-indigo-600 bg-white border border-zinc-200 hover:bg-indigo-50 px-3 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1"
                  >
                    <Plus size={12}/> Agregar Concepto
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                  <table className="w-full text-left min-w-[650px] border-collapse">
                    <thead className="bg-zinc-50 border-b border-zinc-200 text-[9px] font-black text-zinc-500 uppercase tracking-widest sticky top-0 z-10">
                      <tr>
                        <th className="p-2.5 pl-4">Concepto o Descripción</th>
                        <th className="p-2.5 w-16 text-right">Cant.</th>
                        <th className="p-2.5 w-24 text-right">Precio Unit.</th>
                        <th className="p-2.5 w-24 text-center">IVA %</th>
                        <th className="p-2.5 w-24 text-right">Subtotal Neto</th>
                        <th className="p-2.5 w-24 text-right">Total con IVA</th>
                        <th className="p-2.5 w-10 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {formData.Lineas.map((line, index) => {
                        const qty = parseFloat(line.cantidad) || 0;
                        const price = parseFloat(line.precioUnitario) || 0;
                        const ivaRate = (line.iva !== undefined && line.iva !== null) ? parseFloat(line.iva) : 22;
                        const subtotalConIva = qty * price;
                        const subtotalNeto = subtotalConIva / (1 + ivaRate / 100);

                        return (
                          <tr key={line.id} className="hover:bg-zinc-50/50">
                            <td className="p-1.5 pl-4">
                              <div className="flex flex-col gap-0.5">
                                <input
                                  type="text"
                                  required
                                  placeholder="Concepto o Descripción"
                                  list="articulos-list"
                                  className="w-full bg-transparent border-none focus:ring-0 text-xs font-bold outline-none text-zinc-800 placeholder-zinc-300"
                                  value={line.concepto}
                                  onChange={e => updateLinea(line.id, 'concepto', e.target.value)}
                                />
                                <input
                                  type="text"
                                  placeholder="Detalle adicional / Sublínea"
                                  className="w-full bg-transparent border-none focus:ring-0 text-[10px] text-zinc-400 placeholder-zinc-300 outline-none"
                                  value={line.DcdDscItem || ''}
                                  onChange={e => updateLinea(line.id, 'DcdDscItem', e.target.value)}
                                />
                              </div>
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                required min="0" step="any"
                                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 text-xs text-right font-bold outline-none focus:border-indigo-500 focus:bg-white"
                                value={line.cantidad}
                                onChange={e => updateLinea(line.id, 'cantidad', e.target.value)}
                              />
                            </td>
                            <td className="p-1.5">
                              <input
                                type="number"
                                required min="0" step="any"
                                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 text-xs text-right font-bold outline-none focus:border-indigo-500 focus:bg-white"
                                value={line.precioUnitario}
                                onChange={e => updateLinea(line.id, 'precioUnitario', e.target.value)}
                              />
                              {line.precioNote && (
                                <span className="text-[8px] text-indigo-500 font-semibold block text-right mt-0.5 italic" title={line.precioNote}>
                                  {line.precioNote}
                                </span>
                              )}
                            </td>
                            <td className="p-1.5">
                              <select
                                className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
                                value={line.iva}
                                onChange={e => updateLinea(line.id, 'iva', e.target.value)}
                              >
                                <option value={22}>Básico 22%</option>
                                <option value={10}>Mínimo 10%</option>
                                <option value={0}>Exento 0%</option>
                              </select>
                            </td>
                            <td className="p-1.5 text-right font-mono text-[11px] text-zinc-500 font-semibold">
                              {formatMoney(subtotalNeto)}
                            </td>
                            <td className="p-1.5 text-right font-mono text-xs font-black text-zinc-800">
                              {formatMoney(subtotalConIva)}
                            </td>
                            <td className="p-1.5 text-center">
                              {formData.Lineas.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeLinea(line.id)}
                                  className="text-zinc-300 hover:text-rose-600 p-1.5 hover:bg-rose-50 rounded-lg transition-all"
                                >
                                  <Trash2 size={13}/>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </form>
            </div>

            {/* TOTAL GLOBAL A FACTURAR (Estilo Caja) */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm flex items-center justify-between shrink-0">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Total Global a Facturar</span>
                <span className="text-[10px] leading-none bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-black uppercase tracking-widest border border-indigo-100 mt-1 w-fit">
                  Emitiendo en {formData.MonIdMoneda === 1 ? 'UYU ($)' : 'USD (U$S)'}
                </span>
              </div>
              <div className="flex items-center gap-6">
                {/* Desglose Neto e IVA pequeños al lado */}
                <div className="flex flex-col text-[10px] text-zinc-400 font-semibold text-right">
                  <div>Neto: <span className="font-mono text-zinc-600">{formData.MonIdMoneda === 1 ? '$' : 'U$S'} {formatMoney(totales.subtotal)}</span></div>
                  <div>IVA: <span className="font-mono text-zinc-600">{formData.MonIdMoneda === 1 ? '$' : 'U$S'} {formatMoney(totales.iva)}</span></div>
                </div>
                {/* Gran Total */}
                <div className="text-3xl font-black text-[#006097] font-mono leading-none tracking-tight">
                  {formData.MonIdMoneda === 1 ? '$' : 'U$S'} {formatMoney(totales.total)}
                </div>
              </div>
            </div>

            {/* BOTÓN CANCELAR EN EL PIE */}
            <div className="flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 border border-zinc-200 hover:border-zinc-300 transition-all text-xs uppercase tracking-wider"
              >
                Cancelar y Cerrar
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* Datalist de Artículos */}
      <datalist id="articulos-list">
        {articulos.map((art, i) => (
          <option key={art.IDArticulo || i} value={art.NombreArticulo}>
            {art.CodigoArticulo ? `[${art.CodigoArticulo}]` : ''}
          </option>
        ))}
      </datalist>
    </div>
  );
}
