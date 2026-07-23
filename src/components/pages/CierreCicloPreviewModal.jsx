import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, RefreshCw, Edit3, DollarSign, Percent, ShoppingBag, Receipt, Building2, Pen } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';
import { useEmpresas } from '../../hooks/useEmpresas';
import { validarDocumentoUY } from '../../utils/documentoUY';

// Input simple para precios — sin flechas, sin formateo automático
const SimpleInput = ({ value, onChange, placeholder = '0' }) => {
  const [local, setLocal] = React.useState(String(value ?? ''));

  React.useEffect(() => {
    // Solo sincronizar si el valor externo cambió significativamente (no durante tipeo)
    const num = parseFloat(local);
    const ext = parseFloat(value);
    if (isNaN(num) || Math.abs(num - ext) > 0.00001) {
      setLocal(value != null && !isNaN(value) ? String(value) : '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      placeholder={placeholder}
      onChange={e => {
        setLocal(e.target.value);
        const n = parseFloat(e.target.value.replace(',', '.'));
        if (!isNaN(n)) onChange(n);
      }}
      onFocus={e => e.target.select()}
      className="w-20 bg-white border border-slate-300 hover:border-indigo-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-300 text-right outline-none font-mono text-slate-800 font-bold rounded px-2 py-0.5"
    />
  );
};

export default function CierreCicloPreviewModal({
  ciclo,
  movsOriginales,
  cuenta,
  cliente,
  onClose,
  onConfirm,
  pageMode = false,   // true → se muestra como página completa sin overlay
}) {
  const [working, setWorking] = useState(false);
  const [movs, setMovs] = useState([]);
  const [excluidos, setExcluidos] = useState(new Set());
  const { empresaSeleccionada } = useEmpresas();

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
  const [docType, setDocType] = useState(tieneRUT ? 'E-FACTURA' : 'E-TICKET');
  const [docCond, setDocCond] = useState(isAnticipo ? 'CONTADO' : 'CREDITO');

  const tipoDocumento = docType === 'FACTURA' 
    ? 'FACTURA' 
    : docType === 'PEDIDO_CAJA' 
      ? 'E-TICKET CONTADO' 
      : `${docType} ${docCond}`;
  
  // Datos DGI Consumidor Final (si supera umbral)
  const [cliDgiNombre, setCliDgiNombre] = useState(cliente?.Nombre || cliente?.NombreFantasia || '');
  const [cliDgiDocumento, setCliDgiDocumento] = useState(cliente?.CioRuc || '');
  const [cliDgiDireccion, setCliDgiDireccion] = useState(cliente?.DireccionTrabajo || '');
  const [cliDgiCiudad, setCliDgiCiudad] = useState(String(cliente?.DepartamentoID || 10));
  
  // Umbral DGI: viene de la config en BD (env queda como fallback mientras carga)
  const [dgiConf, setDgiConf] = useState({
    limiteUI: Number(import.meta.env.VITE_DGI_LIMITE_UI) || 10000,
    valorUI: Number(import.meta.env.VITE_DGI_VALOR_UI) || 6.5321,
  });
  useEffect(() => {
    api.get('/contabilidad/cfe/config-dgi').then(r => {
      if (r.data?.success) {
        setDgiConf({
          limiteUI: Number(r.data.limiteUI) || 10000,
          valorUI: Number(r.data.valorUI) || 6.5321,
        });
      }
    }).catch(() => {});
  }, []);
  const DGI_UMBRAL_UYU = dgiConf.limiteUI * dgiConf.valorUI;

  // Observaciones adicionales
  const [observaciones, setObservaciones] = useState('');

  // Agrupar PDF por Orden
  const [agruparFactura, setAgruparFactura] = useState(false);
  const [valError, setValError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false); // feedback visual tras guardar
  const [confirmGuardar, setConfirmGuardar] = useState(false); // modal de confirmación

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
      // Para movimientos MATERIAL_CUBIERTO_PLAN_X: excluir la línea del material cubierto
      // para que el total y el PDF solo reflejen los servicios pendientes (costura, corte, etc.)
      if (m.ProIdMaterialCubierto && detalles.length > 0) {
        detalles = detalles.filter(d => d.ProIdProducto !== m.ProIdMaterialCubierto);
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
    const c = Number(cant);
    const v = Number(descValor);

    let subt = p * c;
    if (descTipo === '%') {
      subt = subt * (1 - v / 100);
    } else {
      const equivalentPorc = (p * c) > 0 ? (v / (p * c)) : 0;
      subt = subt * (1 - equivalentPorc);
    }

    setDetallesEditados(prev => ({
      ...prev,
      [detalleId]: {
        PrecioUnitario: p,
        Cantidad: c,
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
  // Pedido Caja es borrador interno (no fiscal) → nunca exige datos DGI
  const requiereDatosDGI = docType !== 'PEDIDO_CAJA' && tipoDocumento.includes('TICKET') && totalUYU > DGI_UMBRAL_UYU;

  // Paso 1: abre el modal de confirmación (siempre que haya cambios)
  const handleGuardarPrecios = () => {
    if (Object.keys(detallesEditados).length === 0) {
      alert('No hay cambios de precio para guardar.');
      return;
    }
    setConfirmGuardar(true);
  };

  // Paso 2: ejecuta el guardado real — guarda directo en PedidosCobranzaDetalle sin importar si hay ciclo
  const ejecutarGuardarPrecios = async () => {
    setConfirmGuardar(false);
    const editPayload = Object.keys(detallesEditados).map(id => ({
      DetalleID: Number(id),
      PrecioUnitario: detallesEditados[id].PrecioUnitario,
      Cantidad: detallesEditados[id].Cantidad,
      Subtotal: detallesEditados[id].Subtotal,
    }));
    setGuardando(true);
    try {
      const cicIdCiclo = (ciclo?.CicIdCiclo && !isNaN(Number(ciclo.CicIdCiclo)))
        ? Number(ciclo.CicIdCiclo)
        : null;
      const res = await api.post('/contabilidad/guardar-precios', {
        detallesEditados: editPayload,
        cicIdCiclo,
      });
      setGuardadoOk(true);
      toast.success(`✓ ${res.data?.actualizados ?? editPayload.length} precio(s) guardado(s) correctamente.`);

      // ── Auto-refresh: recargar órdenes desde la BD ──────────────────────
      // Así los valores reflejan exactamente lo que quedó guardado, igual que
      // al hacer refresh manual.
      if (cliente?.CliIdCliente) {
        try {
          const refreshRes = await api.get(
            `/contabilidad/clientes/${cliente.CliIdCliente}/ordenes-anticipo`
          );
          const frescas = (refreshRes.data || []).filter(m => m.MovImporte < 0);
          const listFresca = frescas.map(m => {
            let detalles = [];
            if (m.DetallesJSON) {
              try { detalles = JSON.parse(m.DetallesJSON); } catch(e) {}
            }
            if (m.ProIdMaterialCubierto && detalles.length > 0) {
              detalles = detalles.filter(d => d.ProIdProducto !== m.ProIdMaterialCubierto);
            }
            return { ...m, detalles };
          });
          setMovs(listFresca);
          setDetallesEditados({}); // limpiar ediciones ya persistidas
        } catch (_) { /* silencioso — los datos locales siguen siendo válidos */ }
      }

      setTimeout(() => setGuardadoOk(false), 4000);
    } catch (err) {
      toast.error('Error al guardar precios: ' + (err.response?.data?.error || err.message));
    } finally {
      setGuardando(false);
    }
  };


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

    // Validación estructural del documento (RUT/CI con dígito verificador)
    // Pedido Caja es borrador interno (no fiscal): NO se valida contra reglas DGI
    if (docType !== 'PEDIDO_CAJA') {
      const valDoc = validarDocumentoUY(cliDgiDocumento);

      if (requiereDatosDGI) {
        if (!valDoc.valido) {
          toast.error(`Este e-Ticket supera $ ${DGI_UMBRAL_UYU.toFixed(0)} (${dgiConf.limiteUI.toLocaleString('es-UY')} UI) y DGI exige identificar al comprador. ${valDoc.motivo}. Solución: ingresá la Cédula (6-8 dígitos) o el RUT (12 dígitos) del cliente en los datos DGI.`);
          setWorking(false);
          return;
        }
        if (!cliDgiNombre || !cliDgiNombre.trim()) {
          toast.error('Este e-Ticket supera el umbral de DGI: además del documento, ingresá el nombre del cliente en los datos DGI. Solución: completá "Nombre".');
          setWorking(false);
          return;
        }
      }

      if (tipoDocumento.includes('FACTURA') && !tipoDocumento.includes('NOTA') && !(valDoc.valido && valDoc.tipo === 'RUT')) {
        toast.error(`Las e-Facturas requieren un RUT válido de 12 dígitos. ${valDoc.motivo ? `${valDoc.motivo}. ` : ''}Solución: corregí el documento del cliente o emití un e-Ticket si es consumidor final.`);
        setWorking(false);
        return;
      }

      if (String(cliDgiDocumento || '').trim() && !valDoc.valido) {
        toast.error(`${valDoc.motivo}. Solución: corregí el documento o dejalo vacío si es consumidor final.`);
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

      const ordenesIds = movs
        .filter(m => !excluidos.has(m.MovIdMovimiento))
        .map(m => String(m.OrdIdOrden || m.MovIdMovimiento));

      const payload = {
        ordenesIds,
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

  // Urgencia real de la orden (independiente de si el recargo se aplicó o fue exonerado)
  const esOrdenUrgente = (m) => {
    return typeof m?.OrdPrioridad === 'string' && /urgen/i.test(m.OrdPrioridad);
  };
  const tieneRecargoUrgencia = (logPrecioAplicado) => {
    return typeof logPrecioAplicado === 'string' && /urgen/i.test(logPrecioAplicado);
  };

  const getDetallesParaPDF = () => {
    const detallesParaPDF = [];
    movs.forEach(m => {
      if (excluidos.has(m.MovIdMovimiento)) return;
      if (m.detalles && m.detalles.length > 0) {
        // Para movimientos MATERIAL_CUBIERTO_PLAN_X: omitir la línea del material
        // ya cubierta por el plan — solo facturar los servicios (costura, corte, etc.)
        const proIdMaterialCubierto = m.ProIdMaterialCubierto ?? null;
        const detallesFiltrados = proIdMaterialCubierto
          ? m.detalles.filter(d => d.ProIdProducto !== proIdMaterialCubierto)
          : m.detalles;

        if (agruparFactura) {
          let orderSubtotal = 0;
          // cuentaEsUSD: si la cuenta NO es explícitamente UYU (=1), asumimos USD.
          // Igual que granTotalBase. Aplica solo como fallback cuando OrdMonIdMoneda es null.
          const cuentaEsUSD = Number(cuenta?.MonIdMoneda) !== 1;
          detallesFiltrados.forEach(d => {
            const ed = detallesEditados[d.DetalleID];
            const sub = ed ? ed.Subtotal : d.Subtotal;
            // OrdMonIdMoneda=2: explícitamente USD (OrdenesDeposito). Fiable.
            // null: orden en tabla Ordenes o sin registro → usar d.Moneda o cuenta como fallback.
            // OrdMonIdMoneda=1: explícitamente UYU → NO convertir aunque la cuenta sea USD.
            const esOrdenUSD = Number(m.OrdMonIdMoneda) === 2
                            || d.Moneda === 'USD'
                            || (m.OrdMonIdMoneda == null && cuentaEsUSD);
            const orderCurrency = esOrdenUSD ? 'USD' : 'UYU';
            const rate = (monedaFactura === 'UYU' && orderCurrency === 'USD') ? cotDolar : (monedaFactura === 'USD' && orderCurrency === 'UYU' ? (1/cotDolar) : 1);
            orderSubtotal += sub * rate;
          });
          const urgenciaOrden = esOrdenUrgente(m) || detallesFiltrados.some(d => tieneRecargoUrgencia(d.LogPrecioAplicado));
          detallesParaPDF.push({
            DcdNomItem: `${m.OrdCodigoOrden || m.MovConcepto}`,
            DcdDscItem: `${m.OrdNombreTrabajo ? m.OrdNombreTrabajo : ''}${urgenciaOrden ? ' (Urgencia)' : ''}`,
            DcdCantidad: 1,
            DcdSubtotal: orderSubtotal
          });
        } else {
          let orderSubtotal = 0;
          const cuentaEsUSD = Number(cuenta?.MonIdMoneda) !== 1;

          detallesFiltrados.forEach(d => {
            const ed = detallesEditados[d.DetalleID];
            const sub = ed ? ed.Subtotal : d.Subtotal;

            const esOrdenUSD = Number(m.OrdMonIdMoneda) === 2
                            || d.Moneda === 'USD'
                            || (m.OrdMonIdMoneda == null && cuentaEsUSD);
            const orderCurrency = esOrdenUSD ? 'USD' : 'UYU';
            const rate = (monedaFactura === 'UYU' && orderCurrency === 'USD') ? cotDolar : (monedaFactura === 'USD' && orderCurrency === 'UYU' ? (1/cotDolar) : 1);
            const finalSub = sub * rate;
            // Usar precio y descuento editados (no el precio original de DB)
            const editedPrice = ed ? ed.PrecioUnitario : (d.PrecioUnitario || (d.Subtotal / d.Cantidad));
            const editedCant  = ed?.Cantidad ?? d.Cantidad;
            const editedDescPct = (ed && ed.DescTipo === '%') ? ed.DescValor : 0;
            const unitario = editedPrice * rate;
            const descItem = editedPrice * editedCant * (editedDescPct / 100) * rate;
            orderSubtotal += finalSub;

            const descArticulo = `${d.ArticuloNombre ? d.ArticuloNombre.trim() + ' - ' : ''}${(d.Descripcion || d.LogPrecioAplicado || 'Servicio').trim()}`;
            const descOrden = `${m.OrdCodigoOrden || m.MovConcepto}${m.OrdNombreTrabajo ? ` - ${m.OrdNombreTrabajo}` : ''}${(esOrdenUrgente(m) || tieneRecargoUrgencia(d.LogPrecioAplicado)) ? ' (Urgencia)' : ''}`;

            detallesParaPDF.push({
              DcdNomItem: descArticulo,
              DcdDscItem: descOrden,
              // Cantidad editada (no la original): el importe y el descuento ya se calculan
              // con editedCant, si acá va la original el P. Unitario del PDF sale mal.
              DcdCantidad: editedCant,
              DcdPrecioUnitario: unitario,
              DcdTotalDescuentos: descItem > 0.01 ? descItem : null,
              // El % va explícito: si se deja que el PDF lo recalcule desde los importes
              // (redondeados a 2 decimales al guardar) un 10% sale impreso como 10,03%.
              DcdDescuentoPct: editedDescPct > 0 ? editedDescPct : null,
              DcdSubtotal: finalSub
            });
          });
        }
      } else {
        // Sin detalles de orden: usar MovImporte. Misma lógica de moneda que granTotalBase.
        const importe = Math.abs(Number(m.MovImporte));
        const cuentaEsUSD2 = Number(cuenta?.MonIdMoneda) !== 1;
        const esMovUSD = Number(m.OrdMonIdMoneda) === 2 || (m.OrdMonIdMoneda == null && cuentaEsUSD2);
        const monBase = esMovUSD ? 'USD' : 'UYU';
        const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
        const finalSub = importe * rate;
        
        const sufijoUrgencia = esOrdenUrgente(m) ? ' (Urgencia)' : '';
        detallesParaPDF.push({
          DcdNomItem: agruparFactura ? `${m.OrdCodigoOrden || m.MovConcepto}` : (m.OrdNombreTrabajo || m.MovConcepto || 'Servicio'),
          DcdDscItem: agruparFactura ? `${m.OrdNombreTrabajo || ''}${sufijoUrgencia}` : `${m.OrdCodigoOrden || m.MovConcepto}${sufijoUrgencia}`,
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

  const handleDownloadExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const detalles = getDetallesParaPDF();
      const fmt2 = (val) => Number(val || 0).toFixed(2);
      const simbolo2 = monedaFactura === 'USD' ? 'US$' : '$U';

      const docTotal = granTotalNeto;
      const docSubtotal = docTotal / 1.22;
      const docIva = docTotal - docSubtotal;

      const periodoStr = (ciclo?.CicIdCiclo && !isNaN(Number(ciclo.CicIdCiclo)))
        ? `${new Date(ciclo.CicFechaInicio).toLocaleDateString('es-UY')} al ${new Date(ciclo.CicFechaCierre).toLocaleDateString('es-UY')}`
        : new Date().toLocaleDateString('es-UY');

      const sheetData = [
        ['PRE-FACTURA'],
        [`Cliente: ${cliDgiNombre || cliente?.Nombre || 'Cliente'}`],
        [`Documento: ${cliDgiDocumento || cliente?.CodCliente || '-'}`],
        [`Dirección: ${cliDgiDireccion || ''}${cliDgiCiudad ? ', ' + cliDgiCiudad : ''}`],
        [`Tipo Comprobante: ${tipoDocumento}`],
        [`Moneda: ${monedaFactura}`],
        [`Período: ${periodoStr}`],
        [`Generado: ${new Date().toLocaleDateString('es-UY')} ${new Date().toLocaleTimeString('es-UY')}`],
        [],
        ['Item / Trabajo', 'Descripción / Orden', 'Cantidad', 'Precio Unitario', 'Descuento', 'Subtotal'],
      ];

      detalles.forEach(d => {
        sheetData.push([
          d.DcdNomItem || '',
          d.DcdDscItem || '',
          d.DcdCantidad != null ? Number(d.DcdCantidad) : 1,
          d.DcdPrecioUnitario != null ? fmt2(d.DcdPrecioUnitario) : '',
          d.DcdTotalDescuentos != null ? fmt2(d.DcdTotalDescuentos) : '',
          fmt2(d.DcdSubtotal || 0),
        ]);
      });

      sheetData.push([]);
      sheetData.push(['', '', '', '', 'Subtotal Neto (sin IVA):', fmt2(docSubtotal)]);
      sheetData.push(['', '', '', '', 'IVA 22%:', fmt2(docIva)]);
      sheetData.push(['', '', '', '', `Total ${simbolo2}:`, fmt2(docTotal)]);

      if (observaciones) {
        sheetData.push([]);
        sheetData.push([`Observaciones: ${observaciones}`]);
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      ws['!cols'] = [{ wch: 40 }, { wch: 36 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Pre-Factura');

      const nombreCliente = (cliDgiNombre || cliente?.Nombre || 'Cliente').replace(/\s+/g, '_').slice(0, 30);
      XLSX.writeFile(wb, `PreFactura_${nombreCliente}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Excel descargado correctamente.');
    } catch (err) {
      toast.error('Error al generar Excel: ' + err.message);
    }
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
      // Emisor (multiempresa): usa la empresa por defecto para que el borrador muestre logo/datos correctos
      EmpRuc: empresaSeleccionada?.EmpRuc,
      EmpNombreFantasia: empresaSeleccionada?.EmpNombreFantasia,
      EmpRazonSocial: empresaSeleccionada?.EmpRazonSocial,
      EmpDireccion: empresaSeleccionada?.EmpDireccion,
      EmpCiudad: empresaSeleccionada?.EmpCiudad,
      EmpTelefono: empresaSeleccionada?.EmpTelefono,
      EmpLogoUrl: empresaSeleccionada?.EmpLogoUrl,
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

  // Contenedor exterior: en pageMode = full screen, en modal = overlay oscuro
  const outerClass = pageMode
    ? 'w-full h-full flex items-stretch'
    : 'fixed inset-0 z-[60] flex items-center justify-center bg-slate-800/40 backdrop-blur-sm p-4';
  const innerClass = pageMode
    ? 'w-full flex flex-col bg-white'
    : 'bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh] border border-slate-200';

  const headerClass = pageMode
    ? 'flex items-center justify-between px-8 py-4 bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 border-b border-indigo-800/20'
    : 'flex items-center justify-between px-6 py-5 bg-white border-b border-slate-100';

  const titleClass    = pageMode ? 'text-xl font-black text-white' : 'text-xl font-black text-slate-800';
  const subtitleClass = pageMode ? 'text-sm text-indigo-200 mt-0.5' : 'text-sm text-slate-500 mt-1';
  return (
    <>
    <div className={outerClass}>
      <div className={innerClass}>
        
        {/* Header */}
        <div className={headerClass}>
          <div className="flex items-center gap-4">
            {pageMode && (
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <i className="fa-solid fa-file-invoice-dollar text-white text-lg" />
              </div>
            )}
            <div>
              <h3 className={titleClass}>Vista Previa de Facturación</h3>
              <p className={subtitleClass}>
                {ciclo?.CicIdCiclo && !isNaN(Number(ciclo.CicIdCiclo))
                  ? `Ciclo de ${cliente?.Nombre} — revisá y confirmá antes de cerrar.`
                  : `${cliente?.Nombre || 'Cliente'} — revisá precios antes de facturar.`
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            
            <div className="flex flex-col items-end gap-1.5">
              {/* FILA 1: Tipo de Documento */}
              <div className={`flex rounded-xl p-1 border gap-1 select-none ${pageMode ? 'bg-white/10 border-white/20' : 'bg-slate-100 border-slate-200'}`}>
                {[
                  { val: 'PEDIDO_CAJA', label: 'Pedido Caja', icon: ShoppingBag },
                  { val: 'E-TICKET', label: 'e-Ticket', icon: Receipt },
                  { val: 'E-FACTURA', label: 'e-Factura', icon: Building2 }
                ].map(opt => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.val}
                      onClick={() => setDocType(opt.val)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider font-black rounded-lg transition-all whitespace-nowrap ${
                        docType === opt.val 
                          ? 'bg-purple-600 text-white shadow-md border-transparent'
                          : (pageMode ? 'text-indigo-100 hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50')
                      }`}
                    >
                      <Icon size={12} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* FILA 2: Condición de Venta (Oculto en Manual) */}
              {docType !== 'FACTURA' && (
                <div className={`flex rounded-xl p-1 border gap-1 select-none w-full ${pageMode ? 'bg-white/10 border-white/20' : 'bg-slate-100 border-slate-200'}`}>
                  {[
                    { val: 'CONTADO', label: 'Contado', activeClass: 'bg-emerald-500 text-white shadow-md' },
                    { val: 'CREDITO', label: 'Crédito', activeClass: 'bg-amber-500 text-white shadow-md' }
                  ].map(opt => {
                    const isActive = docCond === opt.val;
                    return (
                      <button
                        key={opt.val}
                        disabled={opt.disabled}
                        onClick={() => !opt.disabled && setDocCond(opt.val)}
                        className={`flex-1 px-4 py-1.5 text-[10px] uppercase tracking-wider font-black rounded-lg transition-all whitespace-nowrap text-center ${
                          isActive 
                            ? opt.activeClass
                            : opt.disabled
                              ? 'opacity-30 cursor-not-allowed text-slate-400'
                              : (pageMode ? 'text-indigo-100 hover:text-white hover:bg-white/10' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50')
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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
            <button onClick={onClose} className={`p-2 rounded-full transition-colors ${pageMode ? 'hover:bg-white/20 text-white/80 hover:text-white' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'}`}>
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
                {/* Feedback en vivo: qué regla cumple/incumple el documento */}
                {docType !== 'PEDIDO_CAJA' && String(cliDgiDocumento || '').trim() !== '' && (() => {
                  const v = validarDocumentoUY(cliDgiDocumento);
                  return v.valido
                    ? <span className="text-[10px] font-bold text-emerald-600">✓ {v.tipo === 'RUT' ? 'RUT válido' : 'Cédula válida'}</span>
                    : <span className="text-[10px] font-bold text-red-600">✗ {v.motivo}</span>;
                })()}
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

          <div className="rounded-xl border border-slate-200 overflow-y-auto bg-white shadow-sm max-h-[45vh] scrollbar-thin scrollbar-thumb-slate-200">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 w-12 text-center">Inc</th>
                  <th className="px-4 py-3">Descripción del Item</th>
                  <th className="px-4 py-3 text-center">Cant.</th>
                  <th className="px-4 py-3 text-right">P. Unitario</th>
                  <th className="px-4 py-3 text-right">% Desc.</th>
                  <th className="px-4 py-3 text-right">P.U. Neto</th>
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
                      
                      {/* Desglose de Servicios o Total Fijo */}
                      {!isExcluido && (!m.detalles || m.detalles.length === 0) && (
                        <tr className="group hover:bg-slate-50 text-[13px]">
                          <td></td>
                          <td className="px-6 py-2.5 text-slate-500 pl-8 flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                            {m.OrdNombreTrabajo || m.MovConcepto || 'Servicio General'}
                          </td>
                          <td className="px-4 py-2.5 text-center">1</td>
                          <td className="px-4 py-2.5 text-right font-mono text-[11px]">
                            {(() => {
                               const importe = Math.abs(Number(m.MovImporte));
                               const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
                               const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
                               const finalSub = importe * rate;
                               return (monedaFactura === 'USD' ? 'US$ ' : '$U ') + finalSub.toFixed(2);
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-center">0</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700">
                            {(() => {
                               const importe = Math.abs(Number(m.MovImporte));
                               const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
                               const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
                               const finalSub = importe * rate;
                               return (monedaFactura === 'USD' ? 'US$ ' : '$U ') + finalSub.toFixed(2);
                            })()}
                          </td>
                        </tr>
                      )}

                      {!isExcluido && m.detalles?.map(d => {
                        const ed = detallesEditados[d.DetalleID];
                        const punit = ed ? ed.PrecioUnitario : d.PrecioUnitario;
                        const cant  = ed?.Cantidad ?? d.Cantidad;
                        // Descuento siempre en % (sin toggle)
                        const descPct = ed ? (ed.DescTipo === '%' ? ed.DescValor : 0) : 0;
                        const subt  = ed ? ed.Subtotal : d.Subtotal;

                        // Conversión visual si se pide en UYU
                        const monBase = Number(cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD';
                        const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
                        const vPunit  = punit * rate;
                        const vSubt   = subt  * rate;
                        const puNeto  = punit * (1 - descPct / 100);
                        const vPuNeto = puNeto * rate;

                        return (
                          <tr key={d.DetalleID} className="group hover:bg-slate-50 text-[13px]">
                            <td></td>
                            <td className="px-6 py-2.5 text-slate-500 pl-8 flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                              {d.ArticuloNombre ? d.ArticuloNombre.trim() + ' - ' : ''}
                              {d.Descripcion || d.LogPrecioAplicado || 'Servicio'}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <SimpleInput
                                value={cant}
                                onChange={val => handleEditDetalle(d.DetalleID, punit, val, descPct, '%')}
                                placeholder={String(d.Cantidad)}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <SimpleInput
                                value={vPunit}
                                onChange={val => {
                                  const rawVal = val / rate;
                                  handleEditDetalle(d.DetalleID, rawVal, cant, descPct, '%');
                                }}
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-0.5">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={descPct || ''}
                                  placeholder="0"
                                  onChange={e => {
                                    const pct = Math.min(100, Math.max(0, Number(e.target.value)));
                                    handleEditDetalle(d.DetalleID, punit, cant, pct, '%');
                                  }}
                                  className="w-16 bg-white border border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-right outline-none font-mono text-slate-700 rounded py-0.5 px-1.5 shadow-sm font-bold"
                                />
                                <span className="text-[10px] font-bold text-slate-400">%</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`font-mono text-sm font-bold ${descPct > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                {simbolo} {fmt(vPuNeto)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`font-mono text-sm font-bold ${descPct > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
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
        <div className="bg-slate-50 px-6 py-4 flex justify-between items-center gap-3 border-t border-slate-200">
          {/* Izquierda: indicador de cambios pendientes */}
          <div className="flex items-center gap-2">
            {Object.keys(detallesEditados).length > 0 && !guardadoOk && (
              <span className="flex items-center gap-1.5 text-amber-600 text-xs font-bold bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                {Object.keys(detallesEditados).length} precio(s) sin guardar
              </span>
            )}
            {guardadoOk && (
              <span className="flex items-center gap-1.5 text-emerald-600 text-xs font-bold bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                ✓ Cambios guardados
              </span>
            )}
          </div>

          {/* Derecha: botones de acción */}
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleGuardarPrecios}
              disabled={guardando || Object.keys(detallesEditados).length === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all shadow-sm"
            >
              {guardando
                ? <RefreshCw size={15} className="animate-spin" />
                : <span className="text-base leading-none">💾</span>
              }
              Guardar Cambios
            </button>
            <button onClick={handleDownloadExcel}
              className="flex items-center gap-2 px-6 py-2.5 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 text-sm font-bold rounded-xl transition-all shadow-sm">
              <i className="fa-regular fa-file-excel text-emerald-600"></i>
              Exportar Excel
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
    </div>

    {/* ── Modal de Confirmación: Guardar Precios ─────────────────────── */}
    {confirmGuardar && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{backgroundColor:'rgba(0,0,0,0.6)'}}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
          {/* Header */}
          <div className="bg-amber-500 px-6 py-4 flex items-center gap-3">
            <span className="text-2xl">💾</span>
            <div>
              <h3 className="text-white font-black text-base">Confirmar Guardado de Precios</h3>
              <p className="text-amber-100 text-xs mt-0.5">Esta acción actualiza los precios en la base de datos</p>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            <p className="text-slate-700 text-sm mb-4">
              Se van a guardar <strong className="text-amber-600">{Object.keys(detallesEditados).length} cambio(s) de precio</strong> en la base de datos para el ciclo <strong>#{ciclo?.CicIdCiclo}</strong>:
            </p>

            {/* Listado de cambios */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto mb-4">
              {Object.entries(detallesEditados).map(([id, val]) => {
                // Buscar el detalle original para mostrar su nombre
                let nombre = `Detalle #${id}`;
                movs.forEach(m => {
                  (m.detalles || []).forEach(d => {
                    if (String(d.DetalleID) === String(id)) {
                      nombre = d.ArticuloNombre
                        ? `${d.ArticuloNombre.trim()} – ${(d.Descripcion || d.LogPrecioAplicado || 'Servicio').trim()}`
                        : (d.Descripcion || d.LogPrecioAplicado || `Detalle #${id}`);
                    }
                  });
                });
                const simbolo2 = monedaFactura === 'USD' ? 'US$' : '$U';
                return (
                  <div key={id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                    <span className="text-slate-600 truncate max-w-[200px]" title={nombre}>{nombre}</span>
                    <span className="font-bold text-amber-700 ml-2 shrink-0">
                      {simbolo2} {Number(val.PrecioUnitario).toFixed(2)} × subtotal {Number(val.Subtotal).toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              ℹ️ Los precios quedarán guardados en la BD. Podés cerrar el modal y volver después — los cambios no se perderán.
            </p>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
            <button
              onClick={() => setConfirmGuardar(false)}
              className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={ejecutarGuardarPrecios}
              className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-black rounded-xl transition-all shadow-md"
            >
              <span>💾</span> Confirmar Guardado
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
