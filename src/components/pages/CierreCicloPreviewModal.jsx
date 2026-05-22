import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, RefreshCw, Edit3, DollarSign, Percent } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';

export default function CierreCicloPreviewModal({
  ciclo,
  movsOriginales,
  cuenta,
  cliente,
  onClose,
  onConfirm
}) {
  const [working, setWorking] = useState(false);
  const [movs, setMovs] = useState([]);
  const [excluidos, setExcluidos] = useState(new Set());
  
  // Edición manual de detalles
  const [detallesEditados, setDetallesEditados] = useState({}); // { [DetalleID]: { PrecioUnitario, Subtotal, Editado: true } }
  
  // Moneda
  const [monedaFactura, setMonedaFactura] = useState(cuenta.MonIdMoneda === 2 ? 'USD' : 'UYU');
  const [cotDolar, setCotDolar] = useState(40);
  
  // Descuento Global
  const [descTipo, setDescTipo] = useState('%'); // '%' o '$'
  const [descValor, setDescValor] = useState(0);

  // Tipo Documento
  const tieneRUT = cliente?.CioRuc && String(cliente.CioRuc).replace(/\D/g, '').length === 12;
  const isAnticipo = ciclo?.CicIdCiclo === 'ANTICIPO';
  const [tipoDocumento, setTipoDocumento] = useState(
    isAnticipo
      ? (tieneRUT ? 'E-FACTURA CONTADO' : 'E-TICKET CONTADO')
      : (tieneRUT ? 'E-FACTURA CREDITO' : 'E-TICKET CREDITO')
  );
  
  // Datos DGI Consumidor Final (si supera umbral)
  const [cliDgiNombre, setCliDgiNombre] = useState(cliente?.Nombre || cliente?.NombreFantasia || '');
  const [cliDgiDocumento, setCliDgiDocumento] = useState(cliente?.CioRuc || '');
  const [cliDgiDireccion, setCliDgiDireccion] = useState(cliente?.DireccionTrabajo || '');
  const [cliDgiCiudad, setCliDgiCiudad] = useState(String(cliente?.DepartamentoID || 10));
  
  const UI_LIMITE = Number(import.meta.env.VITE_DGI_LIMITE_UI) || 10000;
  const UI_VALOR = Number(import.meta.env.VITE_DGI_VALOR_UI) || 6.5321;
  const DGI_UMBRAL_UYU = UI_LIMITE * UI_VALOR;

  // Observaciones adicionales
  const [observaciones, setObservaciones] = useState('');

  // Agrupar PDF por Orden
  const [agruparFactura, setAgruparFactura] = useState(false);
  const [valError, setValError] = useState('');

  useEffect(() => {
    let primeraMoneda = null;
    const list = movsOriginales.filter(m => m.MovImporte < 0).map(m => {
      let detalles = [];
      if (m.DetallesJSON) {
        try { 
          detalles = JSON.parse(m.DetallesJSON); 
          if (!primeraMoneda && detalles.length > 0 && detalles[0].Moneda) {
            primeraMoneda = detalles[0].Moneda;
          }
        } catch(e) {}
      }
      return { ...m, detalles };
    });
    setMovs(list);

    if (primeraMoneda) {
      setMonedaFactura(primeraMoneda);
    }

    // Obtener cotización
    api.get('/contabilidad/cotizacion-hoy').then(res => {
      if (res.data && res.data.success && res.data.data) setCotDolar(res.data.data.CotDolar || 40);
    }).catch(() => {});
  }, [movsOriginales]);

  const toggleExcluido = (movId) => {
    setExcluidos(prev => {
      const next = new Set(prev);
      if (next.has(movId)) next.delete(movId);
      else next.add(movId);
      return next;
    });
  };

  const handleEditDetalle = (detalleId, nuevoPrecio, cant, descValor = 0, descTipo = '%') => {
    const p = Number(nuevoPrecio);
    const v = Number(descValor);
    
    let subt = p * cant;
    if (descTipo === '%') {
      subt = subt * (1 - v / 100);
    } else {
      // Calculamos el equivalente en porcentaje por trasfondo y se lo restamos al total de la línea
      const equivalentPorc = (p * cant) > 0 ? (v / (p * cant)) : 0;
      subt = subt * (1 - equivalentPorc);
    }

    setDetallesEditados(prev => ({
      ...prev,
      [detalleId]: {
        PrecioUnitario: p,
        DescValor: v,
        DescTipo: descTipo,
        Subtotal: subt,
        Editado: true
      }
    }));
  };

  // Cálculo de totales
  let granTotalBase = 0;
  
  movs.forEach(m => {
    if (excluidos.has(m.MovIdMovimiento)) return;
    
    // Si la orden tiene detalles, calculamos por detalles
    if (m.detalles && m.detalles.length > 0) {
      m.detalles.forEach(d => {
        const ed = detallesEditados[d.DetalleID];
        const sub = ed ? ed.Subtotal : d.Subtotal;
        
        const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
        const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
        
        granTotalBase += (sub * rate);
      });
    } else {
      // Si no hay detalle, usamos el movimiento total
      let imp = Math.abs(m.MovImporte);
      const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
      const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
      granTotalBase += (imp * rate);
    }
  });

  // Aplicar descuento global
  let montoDescuento = 0;
  if (descValor > 0) {
    if (descTipo === '%') montoDescuento = granTotalBase * (Number(descValor) / 100);
    else montoDescuento = Number(descValor);
  }
  
  const granTotalNeto = Math.max(0, granTotalBase - montoDescuento);
  const simbolo = monedaFactura === 'USD' ? 'US$' : '$U';

  const fmt = (val) => Number(val).toFixed(2);

  const totalUYU = monedaFactura === 'UYU' ? granTotalNeto : granTotalNeto * cotDolar;
  const requiereDatosDGI = tipoDocumento.includes('TICKET') && totalUYU > DGI_UMBRAL_UYU;

  const handleFacturar = async () => {
    setWorking(true);
    setValError('');
    
    // Validación de obligatoriedad de campos siempre activa (Requerimiento interno del cliente)
    if (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion || !cliDgiCiudad) {
      setValError('Todos los datos del comprobante (Nombre, Documento, Dirección y Ciudad) son obligatorios para continuar.');
      setWorking(false);
      return;
    }

    // Validación de longitud y formato numérico
    const docLimpio = String(cliDgiDocumento).replace(/\s/g, '');
    if (!/^\d+$/.test(docLimpio)) {
      setValError('El documento debe contener únicamente números.');
      setWorking(false);
      return;
    }

    if (tipoDocumento.includes('TICKET')) {
      if (docLimpio.length !== 8) {
        setValError('Para emitir un e-Ticket, la Cédula (CI) debe tener exactamente 8 dígitos.');
        setWorking(false);
        return;
      }
    } else if (tipoDocumento.includes('FACTURA')) {
      if (docLimpio.length !== 12) {
        setValError('Para emitir una e-Factura, el RUT debe tener exactamente 12 dígitos.');
        setWorking(false);
        return;
      }
    }

    const editPayload = Object.keys(detallesEditados).map(id => ({
      DetalleID: id,
      PrecioUnitario: detallesEditados[id].PrecioUnitario,
      Subtotal: detallesEditados[id].Subtotal,
      DescValor: detallesEditados[id].DescValor || 0,
      DescTipo: detallesEditados[id].DescTipo || '%'
    }));

    // El backend espera el descuento global en la moneda base de la cuenta
    let baseMontoDescuento = montoDescuento;
    if (monedaFactura === 'UYU' && Number(cuenta?.MonIdMoneda) === 2) baseMontoDescuento = montoDescuento / cotDolar;
    if (monedaFactura === 'USD' && Number(cuenta?.MonIdMoneda) === 1) baseMontoDescuento = montoDescuento * cotDolar;

    try {
      const esCicloReal = ciclo?.CicIdCiclo && !isNaN(Number(ciclo.CicIdCiclo));
      const obsConPeriodo = esCicloReal
        ? `Período: ${new Date(ciclo.CicFechaInicio).toLocaleDateString('es-UY')} al ${new Date(ciclo.CicFechaCierre).toLocaleDateString('es-UY')}${observaciones ? '\n\n' + observaciones : ''}`
        : (observaciones || '');

      const detallesParaPDF = getDetallesParaPDF();

      const payload = {
        excluidos: Array.from(excluidos),
        monedaFactura: monedaFactura,
        cotDolar: cotDolar,
        descuentoTipo: descTipo,
        descuentoValorBase: Number(descValor),
        montoDescuentoCalculado: baseMontoDescuento,
        detallesEditados: editPayload,
        detallesParaPDF: detallesParaPDF,
        tipoDocumento: tipoDocumento,
        observaciones: obsConPeriodo,
        cliDgiNombre: cliDgiNombre,
        cliDgiDocumento: cliDgiDocumento,
        cliDgiDireccion: cliDgiDireccion,
        cliDgiCiudad: cliDgiCiudad,
        actualizarCliente: true
      };

      await onConfirm(ciclo.CicIdCiclo, payload);
      onClose();
    } catch (err) {
      toast.error('Error al facturar: ' + err.message);
    } finally {
      setWorking(false);
    }
  };

  const handleUpdateClient = async () => {
    setWorking(true);
    setValError('');
    try {
      if (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion || !cliDgiCiudad) {
        setValError('Todos los datos del comprobante son obligatorios para actualizar el cliente.');
        setWorking(false);
        return;
      }
      
      const docLimpio = String(cliDgiDocumento).replace(/\s/g, '');
      if (!/^\d+$/.test(docLimpio)) {
        setValError('El documento debe contener únicamente números.');
        setWorking(false);
        return;
      }

      if (tipoDocumento.includes('TICKET')) {
        if (docLimpio.length !== 8) {
          setValError('Para emitir un e-Ticket, la Cédula (CI) debe tener exactamente 8 dígitos.');
          setWorking(false);
          return;
        }
      } else if (tipoDocumento.includes('FACTURA')) {
        if (docLimpio.length !== 12) {
          setValError('Para emitir una e-Factura, el RUT debe tener exactamente 12 dígitos.');
          setWorking(false);
          return;
        }
      }

      await api.patch(`/contabilidad/clientes/${cliente.CliIdCliente}/dgi`, {
        Nombre: cliDgiNombre,
        Documento: cliDgiDocumento,
        Direccion: cliDgiDireccion,
        Ciudad: cliDgiCiudad
      });
      
      toast.success('Datos del cliente actualizados en la base de datos.');
    } catch (err) {
      toast.error('Error al actualizar cliente: ' + err.message);
    } finally {
      setWorking(false);
    }
  };

  const getDetallesParaPDF = () => {
    const detallesParaPDF = [];
    movs.forEach(m => {
      if (excluidos.has(m.MovIdMovimiento)) return;
      if (m.detalles && m.detalles.length > 0) {
        if (agruparFactura) {
          let orderSubtotal = 0;
          m.detalles.forEach(d => {
            const ed = detallesEditados[d.DetalleID];
            const sub = ed ? ed.Subtotal : d.Subtotal;
            const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
            const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
            orderSubtotal += sub * rate;
          });
          detallesParaPDF.push({
            DcdNomItem: `${m.OrdCodigoOrden || m.MovConcepto}`,
            DcdDscItem: m.OrdNombreTrabajo ? m.OrdNombreTrabajo : '',
            DcdCantidad: 1,
            DcdSubtotal: orderSubtotal
          });
        } else {
          let orderSubtotal = 0;
          
          m.detalles.forEach(d => {
            const ed = detallesEditados[d.DetalleID];
            const sub = ed ? ed.Subtotal : d.Subtotal;
            
            const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
            const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
            const finalSub = sub * rate;
            const unitario = (d.PrecioUnitario || (d.Subtotal / d.Cantidad)) * rate;
            const originalSub = (d.Subtotal) * rate;
            const descItem = originalSub - finalSub;
            orderSubtotal += finalSub;
            
            const descArticulo = `${d.ArticuloNombre ? d.ArticuloNombre.trim() + ' - ' : ''}${(d.Descripcion || d.LogPrecioAplicado || 'Servicio').trim()}`;
            const descOrden = `${m.OrdCodigoOrden || m.MovConcepto}${m.OrdNombreTrabajo ? ` - ${m.OrdNombreTrabajo}` : ''}`;
            
            detallesParaPDF.push({
              DcdNomItem: descArticulo,
              DcdDscItem: descOrden,
              DcdCantidad: d.Cantidad,
              DcdPrecioUnitario: unitario,
              DcdTotalDescuentos: descItem > 0.01 ? descItem : null,
              DcdSubtotal: finalSub
            });
          });
        }
      } else {
        const importe = Math.abs(Number(m.MovImporte));
        const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
        const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
        const finalSub = importe * rate;
        
        detallesParaPDF.push({
          DcdNomItem: agruparFactura ? `${m.OrdCodigoOrden || m.MovConcepto}` : (m.OrdNombreTrabajo || m.MovConcepto || 'Servicio'),
          DcdDscItem: agruparFactura ? (m.OrdNombreTrabajo || '') : `${m.OrdCodigoOrden || m.MovConcepto}`,
          DcdCantidad: 1,
          DcdSubtotal: finalSub
        });
      }
    });

    if (montoDescuento > 0) {
      const pctGlobal = (montoDescuento / granTotalBase) * 100;
      detallesParaPDF.push({
        DcdNomItem: 'Descuento Global',
        DcdDscItem: 'Aplicado sobre el total del ciclo',
        DcdDescuentoStr: `(${pctGlobal.toFixed(2)}%)`,
        DcdCantidad: 1,
        DcdSubtotal: -montoDescuento
      });
    }
    return detallesParaPDF;
  };

  const handlePreviewPDF = () => {
    setValError('');
    // Validación de obligatoriedad de campos siempre activa (Requerimiento interno del cliente)
    if (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion || !cliDgiCiudad) {
      setValError('Todos los datos del comprobante (Nombre, Documento, Dirección y Ciudad) son obligatorios para continuar.');
      return;
    }

    // Validación de longitud y formato numérico
    const docLimpio = String(cliDgiDocumento).replace(/\s/g, '');
    if (!/^\d+$/.test(docLimpio)) {
      setValError('El documento debe contener únicamente números.');
      return;
    }

    if (tipoDocumento.includes('TICKET')) {
      if (docLimpio.length !== 8) {
        setValError('Para emitir un e-Ticket, la Cédula (CI) debe tener exactamente 8 dígitos.');
        return;
      }
    } else if (tipoDocumento.includes('FACTURA')) {
      if (docLimpio.length !== 12) {
        setValError('Para emitir una e-Factura, el RUT debe tener exactamente 12 dígitos.');
        return;
      }
    }

    // 1. Armar detalles a partir de la tabla actual y estado
    const detallesParaPDF = getDetallesParaPDF();

    // 2. Simular documento de cabecera (precios ya incluyen IVA)
    const docTotal = granTotalNeto;
    const docSubtotal = granTotalNeto / 1.22;
    const docImpuestos = docTotal - docSubtotal;
    
    const fakeDoc = {
      MonIdMoneda: monedaFactura === 'UYU' ? 1 : 2,
      DocTipo: tipoDocumento,
      DocSerie: 'A',
      DocNumero: 'BORRADOR',
      DocFechaEmision: new Date().toISOString(),
      DocPagado: false,
      CliRazonSocial: cliDgiNombre || cliente?.Nombre || cliente?.NombreFantasia || 'Cliente',
      StringIDCliente: cliDgiDocumento || cliente?.CodCliente || String(cliente?.CliIdCliente || ''),
      CliRUT: cliDgiDocumento || cliente?.CioRuc || '',
      CliDireccion: cliDgiDireccion || cliente?.Direccion || 'Montevideo',
      DocCliCiudad: cliDgiCiudad || cliente?.Ciudad || 'Montevideo',
      DocSubtotal: docSubtotal,
      DocImpuestos: docImpuestos,
      DocTotal: docTotal,
      CfeEstado: 'PENDIENTE',
      DocCliNombre: cliDgiNombre,
      DocCliDocumento: cliDgiDocumento,
      DocCliDireccion: cliDgiDireccion,
      DocObservaciones: (ciclo?.CicIdCiclo && !isNaN(Number(ciclo.CicIdCiclo)))
        ? `Período: ${new Date(ciclo.CicFechaInicio).toLocaleDateString('es-UY')} al ${new Date(ciclo.CicFechaCierre).toLocaleDateString('es-UY')}${observaciones ? '\n\n' + observaciones : ''}`
        : (observaciones || '')
    };

    generarPdfFacturaDGI(fakeDoc, detallesParaPDF);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-800/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh] border border-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 bg-white border-b border-slate-100">
          <div>
            <h3 className="text-xl font-black text-slate-800">Vista Previa de Facturación</h3>
            <p className="text-sm text-slate-500 mt-1">
              {ciclo?.CicIdCiclo && !isNaN(Number(ciclo.CicIdCiclo))
                ? `Revisa, edita precios y aplica descuentos antes de cerrar el ciclo de ${cliente?.Nombre}.`
                : `Revisa, edita precios y aplica descuentos antes de facturar las órdenes de ${cliente?.Nombre}.`
              }
            </p>
          </div>
          <div className="flex items-center gap-4">
            
            <select 
              value={tipoDocumento} 
              onChange={e => setTipoDocumento(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow"
            >
              {isAnticipo ? (
                <>
                  <option value="E-FACTURA CONTADO">e-Factura Contado</option>
                  <option value="E-TICKET CONTADO">e-Ticket Contado</option>
                  <option value="FACTURA">Factura Manual</option>
                </>
              ) : (
                <>
                  <option value="E-FACTURA CREDITO">e-Factura Crédito</option>
                  <option value="E-TICKET CREDITO">e-Ticket CREDITO</option>
                  <option value="FACTURA">Factura Manual</option>
                </>
              )}
            </select>

            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={agruparFactura} 
                  onChange={e => setAgruparFactura(e.target.checked)} 
                  className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
                />
                Agrupar por Orden
              </label>
            </div>

            <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
              <button onClick={() => setMonedaFactura('USD')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${monedaFactura==='USD' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}>USD</button>
              <button onClick={() => setMonedaFactura('UYU')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${monedaFactura==='UYU' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}>UYU</button>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>
        </div>
        
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 flex flex-col gap-4">
          
          {/* Error de validación DGI */}
          {valError && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl shadow-sm text-sm font-medium flex items-center gap-2">
              <i className="fa-solid fa-triangle-exclamation"></i>
              {valError}
            </div>
          )}

          {/* Requerimientos DGI */}
          <div className={`rounded-xl border p-4 shadow-sm transition-colors ${requiereDatosDGI ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
            <div className="flex justify-between items-center mb-3">
              <h4 className={`text-xs font-black uppercase tracking-widest ${requiereDatosDGI ? 'text-rose-600' : 'text-slate-500'}`}>
                {requiereDatosDGI ? `Datos Obligatorios DGI (E-Ticket > $${fmt(DGI_UMBRAL_UYU)} UYU)` : 'Datos DGI del Comprobante'}
              </h4>
              <button onClick={handleUpdateClient} disabled={working} 
                className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md transition-colors border border-indigo-200 disabled:opacity-50 shadow-sm">
                <i className="fa-solid fa-cloud-arrow-up"></i>
                Actualizar Ficha
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Nombre / Razón Social</label>
                <input type="text" value={cliDgiNombre} onChange={e => setCliDgiNombre(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Documento (RUT / CI)</label>
                <input type="text" value={cliDgiDocumento} onChange={e => setCliDgiDocumento(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Dirección</label>
                <input type="text" value={cliDgiDireccion} onChange={e => setCliDgiDireccion(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Ciudad / Depto</label>
                <select value={cliDgiCiudad} onChange={e => setCliDgiCiudad(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium">
                  <option value="1">Artigas</option>
                  <option value="2">Canelones</option>
                  <option value="3">Cerro Largo</option>
                  <option value="4">Colonia</option>
                  <option value="5">Durazno</option>
                  <option value="6">Flores</option>
                  <option value="7">Florida</option>
                  <option value="8">Lavalleja</option>
                  <option value="9">Maldonado</option>
                  <option value="10">Montevideo</option>
                  <option value="11">Paysandú</option>
                  <option value="12">Río Negro</option>
                  <option value="13">Rivera</option>
                  <option value="14">Rocha</option>
                  <option value="15">Salto</option>
                  <option value="16">San José</option>
                  <option value="17">Soriano</option>
                  <option value="18">Tacuarembó</option>
                  <option value="19">Treinta y Tres</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 w-12 text-center">Inc</th>
                  <th className="px-4 py-3">Descripción del Item</th>
                  <th className="px-4 py-3 text-center">Cant.</th>
                  <th className="px-4 py-3 text-right">P. Unitario</th>
                  <th className="px-4 py-3 text-center">Desc.</th>
                  <th className="px-4 py-3 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {movs.map(m => {
                  const isExcluido = excluidos.has(m.MovIdMovimiento);
                  
                  return (
                    <React.Fragment key={m.MovIdMovimiento}>
                      {/* Fila principal (Orden) */}
                      <tr className={`transition-colors ${isExcluido ? 'opacity-40 bg-slate-50' : 'hover:bg-slate-50/80'}`}>
                        <td className="px-4 py-3 text-center align-top pt-4">
                          <input type="checkbox" checked={!isExcluido} onChange={() => toggleExcluido(m.MovIdMovimiento)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500 cursor-pointer" />
                        </td>
                        <td colSpan={5} className="px-4 py-3 pb-2">
                          <span className="font-black text-indigo-600 block text-[13px]">{m.OrdCodigoOrden || m.MovConcepto}</span>
                          <span className="text-[11px] text-slate-500 font-medium">{m.OrdNombreTrabajo || 'Sin descripción'}</span>
                        </td>
                      </tr>
                      
                      {/* Desglose de Servicios */}
                      {!isExcluido && m.detalles?.map(d => {
                        const ed = detallesEditados[d.DetalleID];
                        const punit = ed ? ed.PrecioUnitario : d.PrecioUnitario;
                        const descValor = ed ? ed.DescValor : 0;
                        const descTipo  = ed ? ed.DescTipo : '%';
                        const subt  = ed ? ed.Subtotal : d.Subtotal;
                        
                        // Conversión visual si se pide en UYU
                        const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
                        const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
                        const vPunit = punit * rate;
                        const vSubt  = subt * rate;
                        const vDescValor = descTipo === '$' ? descValor * rate : descValor;

                        return (
                          <tr key={d.DetalleID} className="group hover:bg-slate-50 text-[13px]">
                            <td></td>
                            <td className="px-6 py-2.5 text-slate-500 pl-8 flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                              {d.ArticuloNombre ? d.ArticuloNombre.trim() + ' - ' : ''}
                              {d.Descripcion || d.LogPrecioAplicado || 'Servicio'}
                            </td>
                            <td className="px-4 py-2.5 text-center font-mono font-medium">{d.Cantidad}</td>
                            <td className="px-4 py-2.5 text-right relative">
                              <div className="flex items-center justify-end gap-2">
                                <Edit3 size={12} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <input 
                                  type="number" 
                                  value={vPunit ? fmt(vPunit) : ''}
                                  onChange={(e) => {
                                    const val = Number(e.target.value) / rate;
                                    handleEditDetalle(d.DetalleID, val, d.Cantidad, descValor, descTipo);
                                  }}
                                  className="w-20 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 text-right outline-none font-mono text-slate-700 font-medium"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-center relative">
                              <div className="flex items-center justify-center gap-1">
                                <button 
                                  onClick={() => {
                                    const nextTipo = descTipo === '%' ? '$' : '%';
                                    handleEditDetalle(d.DetalleID, punit, d.Cantidad, 0, nextTipo);
                                  }}
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${descTipo === '%' ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'}`}
                                >
                                  {descTipo}
                                </button>
                                <input 
                                  type="number" 
                                  value={vDescValor || ''}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    const baseVal = descTipo === '$' ? val / rate : val;
                                    handleEditDetalle(d.DetalleID, punit, d.Cantidad, baseVal, descTipo);
                                  }}
                                  className="w-16 bg-white border border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-center outline-none font-mono text-slate-700 rounded py-0.5 shadow-sm font-bold"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`font-mono text-sm font-bold ${descValor > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                                {simbolo} {fmt(vSubt)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      

                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Footer */}
        <div className="bg-white px-6 py-5 border-t border-slate-100 flex items-start justify-between">
          {/* Bloque Descuento */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Aplicar Descuento Global</label>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                <button onClick={() => setDescTipo('%')} className={`px-2.5 py-1.5 rounded-md text-xs font-black transition-colors ${descTipo === '%' ? 'bg-indigo-50 text-indigo-600 shadow-sm border border-indigo-100' : 'text-slate-500'}`}><Percent size={12}/></button>
                <button onClick={() => setDescTipo('$')} className={`px-2.5 py-1.5 rounded-md text-xs font-black transition-colors ${descTipo === '$' ? 'bg-indigo-50 text-indigo-600 shadow-sm border border-indigo-100' : 'text-slate-500'}`}><DollarSign size={12}/></button>
              </div>
              <input 
                type="number" 
                min="0"
                value={descValor || ''}
                onChange={e => setDescValor(e.target.value)}
                placeholder="0.00"
                className="w-24 bg-white border border-slate-200 text-slate-800 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono shadow-sm"
              />
            </div>
            {montoDescuento > 0 && (
              <span className="text-xs font-black text-rose-500">- {simbolo} {fmt(montoDescuento)}</span>
            )}
          </div>

          {/* Bloque Observaciones */}
          <div className="flex-1 px-8 flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Observaciones Adicionales</label>
            <textarea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              placeholder="Notas para la factura..."
              className="w-full bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm resize-none h-12"
            />
          </div>

          {/* Totales */}
          <div className="flex items-center gap-10">
            <div className="text-right">
              <p className="text-slate-400 uppercase tracking-widest font-bold text-[10px]">Subtotal</p>
              <p className="font-mono font-medium text-slate-600 text-lg">
                {simbolo} {fmt(granTotalBase)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-indigo-500 uppercase tracking-widest font-black text-[11px] mb-1">Factura Final</p>
              <p className="font-mono font-black text-indigo-600 text-4xl tracking-tight">
                {simbolo} {fmt(granTotalNeto)}
              </p>
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-200">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">
            Cancelar
          </button>
          <button onClick={handlePreviewPDF}
            className="flex items-center gap-2 px-6 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl transition-all shadow-sm">
            <i className="fa-regular fa-file-pdf text-red-500"></i>
            Ver Pre-factura
          </button>
          <button onClick={handleFacturar} disabled={working}
            className="flex items-center gap-2 px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50">
            {working ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
            Generar Factura y Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
