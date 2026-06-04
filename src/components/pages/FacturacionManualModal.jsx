import React, { useState, useEffect, useMemo } from 'react';
import { X, CheckCircle, FileText, User, Plus, Trash2, DollarSign, UserCheck, Loader2 } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ClienteBilletera from '../common/ClienteBilletera';
import CajaPanelPago from './CajaPanelPago';


// ID del Consumidor Final genérico (sin cuenta corriente)
const CONSUMIDOR_FINAL_ID = 2089;

// Mapea (tipoCliente, formaPago) => valor de CodDocumento en tiposDocs
function resolverDocTipo(tiposDocs, tipoCliente, formaPago) {
  if (!tiposDocs || tiposDocs.length === 0) return '';
  if (tipoCliente === 'PEDIDO_CAJA') {
    const pedido = tiposDocs.find(t => t.value === '40' || (t.label || '').toUpperCase().includes('PEDIDO'));
    return pedido?.value || '';
  }
  const esFactura = tipoCliente === 'RUT';
  const esContado = formaPago === 'CONTADO';
  const candidatos = tiposDocs.filter(t => {
    const lbl = (t.label || '').toUpperCase();
    if (lbl.includes('NOTA') || lbl.includes('ANULAC') || lbl.includes('RECIBO') || lbl.includes('PEDIDO')) return false;
    const esDocFactura = lbl.includes('FACTURA') || t.RutObligatorio === true || t.RutObligatorio === 1;
    const esDocContado = lbl.includes('CONTADO');
    if (esFactura && !esDocFactura) return false;
    if (!esFactura && esDocFactura) return false;
    if (esContado && !esDocContado) return false;
    if (!esContado && esDocContado) return false;
    return true;
  });
  return candidatos[0]?.value || '';
}

export default function FacturacionManualModal({ onClose, onSuccess, initialData, mode = 'nuevo', editDocId = null }) {
  const [clientes, setClientes] = useState([]);
  const [tiposDocs, setTiposDocs] = useState([]);
  const [monedas, setMonedas] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [articulos, setArticulos] = useState([]);
  const [metodosPago, setMetodosPago] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(mode === 'editar');
  const [updatingClient, setUpdatingClient] = useState(false);
  const [editDocInfo, setEditDocInfo] = useState(null);
  const esEditar = mode === 'editar' && !!editDocId;

  // Selectores simplificados
  const [tipoCliente, setTipoCliente] = useState('CONSUMIDOR_FINAL'); // 'CONSUMIDOR_FINAL' | 'RUT' | 'PEDIDO_CAJA'
  const [formaPago, setFormaPago] = useState('CONTADO'); // 'CONTADO' | 'CREDITO'

  // Panel de pago
  const [serieDoc, setSerieDoc] = useState('');
  // ID numérico real del cliente (para ClienteBilletera)
  const [clienteIdNumerico, setClienteIdNumerico] = useState(null);
  const [notas, setNotas] = useState('');
  const [monedaOp, setMonedaOp] = useState('UYU'); // moneda de la operación
  const [articuloSearch, setArticuloSearch] = useState({}); // { [lineId]: string } búsqueda por línea
  const [articuloOpen, setArticuloOpen] = useState({}); // { [lineId]: bool }

  // Búsqueda de clientes y pagos mixtos
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

  // Si mode === 'editar': cargar datos del documento existente
  useEffect(() => {
    if (mode !== 'editar' || !editDocId) return;
    const cargarDocParaEditar = async () => {
      setLoadingEdit(true);
      try {
        const res = await api.get(`/contabilidad/cfe/documentos/${editDocId}/detalle`);
        const d = res.data?.doc;
        const lineas = res.data?.detalles || [];
        if (!d) throw new Error('Sin datos del documento');
        setEditDocInfo({ DocSerie: d.DocSerie, DocNumero: d.DocNumero, DocTipo: d.DocTipo });
        const lbl = (d.DocTipo || '').toUpperCase();
        if (lbl.includes('PEDIDO')) setTipoCliente('PEDIDO_CAJA');
        else if (d.RutObligatorio || lbl.includes('FACTURA')) setTipoCliente('RUT');
        else setTipoCliente('CONSUMIDOR_FINAL');
        const isContado = lbl.includes('CONTADO') || d.DocPagado === true || d.DocPagado === 1;
        setFormaPago(isContado ? 'CONTADO' : 'CREDITO');
        setNotas(d.DocObservaciones || '');
        if (res.data?.pagos && res.data.pagos.length > 0) {
          setPagos(res.data.pagos.map((p, idx) => ({
            id: Date.now() + idx,
            metodoPagoId: String(p.MPaIdMetodoPago || p.metodoPagoId || ''),
            monedaId: p.PagIdMonedaPago || p.monedaId || 1,
            monto: String(p.PagMontoPago || p.monto || '')
          })));
        }
        const lineasMapeadas = lineas.map((l, idx) => {
          const qty = parseFloat(l.DcdCantidad) || 1;
          const sub = parseFloat(l.DcdSubtotal) || 0;   // neto sin IVA (si está bien guardado)
          const imp = parseFloat(l.DcdImpuestos) || 0;  // IVA
          const total = parseFloat(l.DcdTotal) || (sub + imp);
          const unitPrice = qty > 0 ? (total / qty) : (parseFloat(l.DcdPrecioUnitario) || 0);
          let ivaRate = 22; // default
          if (imp > 0 && sub > 0) {
            // Caso normal: IVA y neto correctamente guardados
            const ratio = (imp / sub) * 100;
            if (ratio < 2) ivaRate = 0;
            else if (ratio < 15) ivaRate = 10;
            else ivaRate = 22;
          } else if (imp === 0 && sub > 0 && total > sub) {
            // DcdImpuestos=0 pero DcdTotal > DcdSubtotal → sub es el bruto, calcular con total
            // Esto ocurre en cierres de ciclo guardados con el bug anterior
            const ratio = ((total - sub) / sub) * 100;
            if (ratio < 2) ivaRate = 0;
            else if (ratio < 15) ivaRate = 10;
            else ivaRate = 22;
          } else if (imp === 0 && sub > 0 && Math.abs(total - sub) < 0.01) {
            // DcdSubtotal ≈ DcdTotal y DcdImpuestos = 0 → fue guardado como bruto en DcdSubtotal
            // Asumimos IVA 22% (valor por defecto para cierres de ciclo)
            ivaRate = 22;
          }
          return { id: Date.now() + idx, concepto: (l.DcdNomItem || '').trim(), DcdDscItem: (l.DcdDscItem || '').trim(), cantidad: qty, precioUnitario: parseFloat(unitPrice.toFixed(4)), iva: ivaRate, isPreexisting: true, precioNote: 'Precio original' };
        });
        // Sincronizar monedaOp ANTES de setFormData para que el useEffect no lo sobreescriba
        setMonedaOp(d.MonIdMoneda === 2 ? 'USD' : 'UYU');
        setFormData(prev => ({
          ...prev,
          DocTipo: d.DocTipo || '',
          MonIdMoneda: d.MonIdMoneda || 1,
          CliIdCliente: d.CliIdCliente ? String(d.CliIdCliente) : '',
          DocCliNombre: d.DocCliNombre || d.CliRazonSocial || d.CliNombreFantasia || 'Consumidor Final',
          DocCliDocumento: d.DocCliDocumento || d.CliRUT || '',
          DocCliDireccion: d.DocCliDireccion || d.CliDireccion || '',
          DocCliCiudad: d.DocCliCiudad || '',
          DocPagado: isContado,
          Lineas: lineasMapeadas.length > 0 ? lineasMapeadas : prev.Lineas
        }));
      } catch (err) {
        toast.error('Error cargando documento: ' + (err.response?.data?.error || err.message));
      } finally {
        setLoadingEdit(false);
      }
    };
    cargarDocParaEditar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDocId, mode]);

  // Derivar DocTipo cuando cambian tiposDocs, tipoCliente o formaPago
  useEffect(() => {
    if (tiposDocs.length === 0) return;
    const docTipo = resolverDocTipo(tiposDocs, tipoCliente, formaPago);
    const esContado = formaPago === 'CONTADO';
    setFormData(prev => ({ ...prev, DocTipo: docTipo, DocPagado: esContado }));
  }, [tiposDocs, tipoCliente, formaPago]);

  // Cuando cambia el tipoCliente, forzar contado en Pedido Caja
  useEffect(() => {
    if (tipoCliente === 'PEDIDO_CAJA') setFormaPago('CONTADO');
  }, [tipoCliente]);

  // Sincronizar monedaOp con formData.MonIdMoneda
  useEffect(() => {
    const monId = monedaOp === 'USD' ? 2 : 1;
    setFormData(prev => ({ ...prev, MonIdMoneda: monId }));
  }, [monedaOp]);

  // Sincronizar info del cliente seleccionado al iniciar (por ej. al copiar o editar)
  useEffect(() => {
    if (clientes.length === 0 || !formData.CliIdCliente) return;
    const c = clientes.find(item => String(item.CodCliente || item.CliIdCliente) === String(formData.CliIdCliente));
    if (c) {
      const idNumerico = c.CliIdCliente ? parseInt(c.CliIdCliente) : null;
      setClienteIdNumerico(idNumerico);
      
      setFormData(prev => {
        let deptoNombre = '';
        if (c.DepartamentoID && departamentos.length > 0) {
          const found = departamentos.find(d => d.ID === c.DepartamentoID || d.id === c.DepartamentoID);
          if (found) deptoNombre = found.Nombre;
        }
        return {
          ...prev,
          DocCliNombre: prev.DocCliNombre || c.Nombre || c.NombreFantasia || '',
          DocCliDocumento: prev.DocCliDocumento || c.CioRuc || c.IDCliente || '',
          DocCliDireccion: prev.DocCliDireccion || c.DireccionTrabajo || '',
          DocCliCiudad: prev.DocCliCiudad || deptoNombre || ''
        };
      });
    }
  }, [clientes, formData.CliIdCliente, departamentos]);

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
        api.get('/apicotizaciones/hoy').catch(() => null)
      ]);
      setClientes(resClientes.data || []);
      setMetodosPago(Array.isArray(resMetodosPago.data) ? resMetodosPago.data : []);

      if (resCotizacion?.data?.cotizaciones?.[0]?.CotDolar) {
        setCotizacion(resCotizacion.data.cotizaciones[0].CotDolar);
      } else if (resCotizacion?.data?.data?.promedio) {
        setCotizacion(resCotizacion.data.data.promedio);
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
      // Guardar el ID numérico real (CliIdCliente entero) para endpoints de cuentas
      const idNumerico = c.CliIdCliente ? parseInt(c.CliIdCliente) : null;
      setClienteIdNumerico(idNumerico);

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
          CliIdCliente: idNumerico || val,
          DocCliNombre: c.Nombre || c.NombreFantasia || '',
          DocCliDocumento: c.CioRuc || c.IDCliente || '',
          DocCliDireccion: c.DireccionTrabajo || '',
          DocCliCiudad: deptoNombre || ''
        };
      });
    } else {
      setClienteIdNumerico(null);
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
    let shouldRecalc = false;
    let recalcConcepto = '';
    let recalcCantidad = 1;
    let recalcClienteId = null;
    let recalcMonedaId = 1;

    setFormData(prev => {
      const lineToUpdate = prev.Lineas.find(l => l.id === id);
      if (!lineToUpdate) return prev;

      const updatedLine = { ...lineToUpdate, [field]: value };

      const conceptoChanged = field === 'concepto' && value !== lineToUpdate.concepto;
      const cantidadChanged = field === 'cantidad' && value !== lineToUpdate.cantidad;

      if ((conceptoChanged || cantidadChanged) && updatedLine.concepto) {
        shouldRecalc = true;
        recalcConcepto = updatedLine.concepto;
        recalcCantidad = updatedLine.cantidad;
        recalcClienteId = prev.CliIdCliente;
        recalcMonedaId = prev.MonIdMoneda;
      }

      if (field === 'precioUnitario') {
        updatedLine.precioNote = 'Modificado manualmente';
      }

      return {
        ...prev,
        Lineas: prev.Lineas.map(l => l.id === id ? updatedLine : l)
      };
    });

    // Efecto secundario FUERA del updater para evitar doble ejecución en Strict Mode
    if (shouldRecalc) {
      setTimeout(() => {
        recalcularPrecioLineaManual(id, recalcConcepto, recalcCantidad, recalcClienteId, recalcMonedaId);
      }, 50);
    }
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
      if (esEditar) {
        await api.put(`/contabilidad/cfe/documentos/${editDocId}`, {
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
          lineas: lineasValidas.map(l => {
            const qty = parseFloat(l.cantidad) || 1;
            const price = parseFloat(l.precioUnitario) || 0;
            const ivaRate = (l.iva !== undefined && l.iva !== null) ? parseFloat(l.iva) : 22;
            const lineTotal = qty * price;
            const lineNeto = lineTotal / (1 + ivaRate / 100);
            const lineIva = lineTotal - lineNeto;
            return {
              DcdNomItem: l.concepto,
              DcdDscItem: l.DcdDscItem || '',
              DcdCantidad: qty,
              DcdPrecioUnitario: price,
              DcdSubtotal: parseFloat(lineNeto.toFixed(2)),
              DcdImpuestos: parseFloat(lineIva.toFixed(2)),
              DcdTotal: parseFloat(lineTotal.toFixed(2))
            };
          }),
          DocSubtotal: totales.subtotal,
          DocImpuestos: totales.iva,
          DocTotal: totales.total,
          DocObservaciones: notas
        });
        toast.success('Documento actualizado exitosamente');
      } else {
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
      }
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
        
        {/* PANEL SUPERIOR: CajaPanelPago idéntico a Caja */}
        <CajaPanelPago
          layout="horizontal"
          mode="COBRO"
          totalACubrir={totales.total}
          moneda={monedaOp}
          onMonedaChange={setMonedaOp}
          cotizacion={cotizacion}
          metodosPago={metodosPago}
          pagos={pagos}
          onPagosChange={setPagos}
          tipoDoc={formData.DocTipo}
          onTipoDoc={(v) => {
            setFormData(prev => ({ ...prev, DocTipo: v }));
            // Sincronizar flags internos
            const esContado = v === '07' || v === '01' || v === '40';
            setFormData(prev => ({ ...prev, DocTipo: v, DocPagado: esContado }));
            const esCF = v === '07' || v === '08';
            const esRut = v === '01' || v === '02';
            if (v === '40') setTipoCliente('PEDIDO_CAJA');
            else if (esCF) setTipoCliente('CONSUMIDOR_FINAL');
            else if (esRut) setTipoCliente('RUT');
            setFormaPago(esContado ? 'CONTADO' : 'CREDITO');
          }}
          serieDoc={serieDoc}
          onSerieDoc={setSerieDoc}
          notas={notas}
          onNotas={setNotas}
          onConfirmar={() => { document.getElementById('factura-form')?.requestSubmit?.() || document.getElementById('factura-submit-btn')?.click(); }}
          procesando={loading}
          tiposDocDisponibles={tiposDocs}
          labelBoton={esEditar ? 'GUARDAR CAMBIOS' : undefined}
          showSubmitButton={true}
        />

        {/* ESTRUCTURA INFERIOR: Columnas Divididas */}
        <div className="flex flex-col lg:flex-row gap-4 min-w-0 items-start">
          
          {/* COLUMNA IZQUIERDA: Clientes y DGI */}
          <div className="w-full lg:w-[360px] bg-white border border-zinc-200 rounded-2xl flex flex-col p-4 shrink-0 gap-4 shadow-sm">
            
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
              {clienteIdNumerico && clienteIdNumerico !== CONSUMIDOR_FINAL_ID && (
                <ClienteBilletera
                  clienteId={clienteIdNumerico}
                  clienteNombre={formData.DocCliNombre}
                />
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
          <div className="flex-1 flex flex-col gap-4">
            
            {/* Panel de Conceptos */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
              <form id="factura-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="flex justify-between items-center shrink-0 pb-1.5 border-b border-zinc-100 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <h3 className="font-black text-zinc-400 text-[10px] uppercase tracking-widest">2. Conceptos del Comprobante</h3>
                    {/* Selector moneda del documento */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Moneda:</span>
                      <div className="flex bg-zinc-100 border border-zinc-200 rounded-lg p-0.5 gap-0.5">
                        <button type="button" onClick={() => setMonedaOp('UYU')}
                          className={`px-2.5 py-1 text-[9px] font-black rounded-md transition-all ${ monedaOp === 'UYU' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700' }`}>
                          $ UYU
                        </button>
                        <button type="button" onClick={() => setMonedaOp('USD')}
                          className={`px-2.5 py-1 text-[9px] font-black rounded-md transition-all ${ monedaOp === 'USD' ? 'bg-amber-500 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700' }`}>
                          U$S USD
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={addLinea}
                    className="text-[10px] font-black text-indigo-600 bg-white border border-zinc-200 hover:bg-indigo-50 px-3 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1"
                  >
                    <Plus size={12}/> Agregar Concepto
                  </button>
                </div>

                <div>
                  <table className="w-full text-left min-w-[650px] border-collapse">
                    <thead className="bg-zinc-50 border-b border-zinc-200 text-[9px] font-black text-zinc-500 uppercase tracking-widest sticky top-0 z-10">
                      <tr>
                        <th className="p-2.5 pl-4">Concepto o Descripción</th>
                        <th className="p-2.5 w-16 text-right">Cant.</th>
                        <th className="p-2.5 w-28 text-right">
                          Precio Unit.
                          <span className={`ml-1 text-[9px] font-black px-1.5 py-0.5 rounded-full ${monedaOp === 'USD' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                            {monedaOp === 'USD' ? 'U$S' : '$UY'}
                          </span>
                        </th>
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
                        const searchTerm = articuloSearch[line.id] !== undefined ? articuloSearch[line.id] : line.concepto;
                        const artFiltered = searchTerm.length > 0
                          ? articulos.filter(a => a.NombreArticulo?.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 12)
                          : articulos.slice(0, 12);

                        return (
                          <tr key={line.id} className="hover:bg-zinc-50/50 align-top">
                            <td className="p-1.5 pl-4">
                              {/* Autocomplete de artículos */}
                              <div className="relative">
                                <input
                                  type="text"
                                  required
                                  placeholder="Escribir concepto o buscar artículo..."
                                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:border-indigo-500 focus:bg-white text-zinc-800 placeholder-zinc-300"
                                  value={searchTerm}
                                  autoComplete="off"
                                  onFocus={() => setArticuloOpen(prev => ({ ...prev, [line.id]: true }))}
                                  onBlur={() => setTimeout(() => setArticuloOpen(prev => ({ ...prev, [line.id]: false })), 150)}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setArticuloSearch(prev => ({ ...prev, [line.id]: val }));
                                    updateLinea(line.id, 'concepto', val);
                                  }}
                                />
                                {articuloOpen[line.id] && artFiltered.length > 0 && (
                                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
                                    {artFiltered.map(a => (
                                      <button
                                        key={a.CodigoArticulo}
                                        type="button"
                                        onMouseDown={() => {
                                          updateLinea(line.id, 'concepto', a.NombreArticulo);
                                          setArticuloSearch(prev => ({ ...prev, [line.id]: a.NombreArticulo }));
                                          setArticuloOpen(prev => ({ ...prev, [line.id]: false }));
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs font-bold text-zinc-800 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex justify-between items-center gap-2 border-b border-zinc-50 last:border-0"
                                      >
                                        <span className="truncate">{a.NombreArticulo}</span>
                                        <span className="text-[9px] text-zinc-400 shrink-0">{a.CodigoArticulo}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Sublínea siempre visible */}
                              <input
                                type="text"
                                placeholder="↳ Sublínea / detalle adicional"
                                className="w-full mt-1 px-2.5 py-1 text-[10px] text-zinc-500 bg-white border border-zinc-100 rounded-md outline-none focus:border-indigo-300 placeholder-zinc-300"
                                value={line.DcdDscItem || ''}
                                onChange={e => updateLinea(line.id, 'DcdDscItem', e.target.value)}
                              />
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
                              <div className="relative">
                                <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-black select-none pointer-events-none ${monedaOp === 'USD' ? 'text-amber-600' : 'text-blue-500'}`}>
                                  {monedaOp === 'USD' ? 'U$S' : '$'}
                                </span>
                                <input
                                  type="number"
                                  required min="0" step="any"
                                  className={`w-full bg-zinc-50 border rounded-lg pl-8 pr-2 py-1 text-xs text-right font-bold outline-none focus:bg-white ${
                                    monedaOp === 'USD'
                                      ? 'border-amber-200 focus:border-amber-400'
                                      : 'border-zinc-200 focus:border-indigo-500'
                                  }`}
                                  value={line.precioUnitario}
                                  onChange={e => updateLinea(line.id, 'precioUnitario', e.target.value)}
                                />
                              </div>
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
                              <span className={`text-[8px] mr-0.5 ${monedaOp === 'USD' ? 'text-amber-500' : 'text-blue-400'}`}>{monedaOp === 'USD' ? 'U$S' : '$'}</span>{formatMoney(subtotalNeto)}
                            </td>
                            <td className="p-1.5 text-right font-mono text-xs font-black text-zinc-800">
                              <span className={`text-[9px] mr-0.5 ${monedaOp === 'USD' ? 'text-amber-600' : 'text-blue-500'}`}>{monedaOp === 'USD' ? 'U$S' : '$'}</span>{formatMoney(subtotalConIva)}
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
