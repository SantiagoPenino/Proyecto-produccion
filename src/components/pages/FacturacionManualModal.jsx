import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, CheckCircle, FileText, User, Plus, Trash2, DollarSign, UserCheck, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import ClienteBilletera from '../common/ClienteBilletera';
import CajaPanelPago from './CajaPanelPago';
import ConfirmationModal from '../modals/ConfirmationModal';
import { useEmpresas } from '../../hooks/useEmpresas';
import { validarDocumentoUY } from '../../utils/documentoUY';


// ID del Consumidor Final genérico (sin cuenta corriente)
const CONSUMIDOR_FINAL_ID = 2089;

// Fecha local (no UTC) en formato YYYY-MM-DD para <input type="date">
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toDateInputStr = (dateLike) => {
  if (!dateLike) return todayStr();
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return todayStr();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
  // Aviso "esta factura ya fue cobrada": lo dispara el 409 del backend al intentar
  // guardarla como NO pagada. Guarda el detalle del cobro para mostrárselo al usuario.
  const [avisoCobrada, setAvisoCobrada] = useState(null);
  // Cobro real del documento que se está editando (viene del endpoint de detalle).
  const [cobroDoc, setCobroDoc] = useState(null);
  const [updatingClient, setUpdatingClient] = useState(false);
  // Confirmación grande antes de pisar la ficha real del cliente desde "Actualizar"
  const [confirmActualizarCliente, setConfirmActualizarCliente] = useState(null); // { mensaje, payload }
  const [editDocInfo, setEditDocInfo] = useState(null);
  const esEditar = mode === 'editar' && !!editDocId;
  const { empresas, empresaSeleccionada, setEmpresaSeleccionada } = useEmpresas();
  // Guarda si el documento ORIGINAL era contado (para mostrar alerta de anulación de pago)
  const originalPagadoRef = useRef(null);
  // Snapshot de los pagos REALES cargados de BD (modo editar). Si el usuario no los toca,
  // se preservan tal cual al guardar (pueden diferir del total por un ajuste monetario de caja).
  const pagosOriginalesRef = useRef(null);

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
  // Umbral DGI para identificar comprador en e-Tickets (configurable en BD; env como fallback)
  const [dgiConfig, setDgiConfig] = useState({
    limiteUI: Number(import.meta.env.VITE_DGI_LIMITE_UI) || 10000,
    valorUI: Number(import.meta.env.VITE_DGI_VALOR_UI) || 6.5321,
  });
  const [pagos, setPagos] = useState(() => {
    if (initialData && Array.isArray(initialData.pagos)) {
      return initialData.pagos.map((p, idx) => {
        const mid = p.PagIdMonedaPago || p.monedaId || initialData.MonIdMoneda || 1;
        return {
          id: Date.now() + idx,
          metodoPagoId: String(p.MPaIdMetodoPago || p.metodoPagoId || ''),
          monedaId: mid,
          moneda: mid === 2 ? 'USD' : 'UYU',
          monto: String(p.PagMontoPago || p.monto || '')
        };
      });
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
        DocCliNombreFantasia: '',
        DocCliDocumento: initialData.DocCliDocumento || initialData.CliRUT || '',
        DocCliDireccion: initialData.DocCliDireccion || initialData.CliDireccion || '',
        DocCliCiudad: initialData.DocCliCiudad || '',
        DocPagado: initialData.DocPagado || false,
        MetodoPagoId: initialData.MetodoPagoId || '',
        DocFechaEmision: todayStr(), // documento nuevo (copia) → fecha de hoy por defecto
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
      DocCliNombreFantasia: '',
      DocCliDocumento: '',
      DocCliDireccion: '',
      DocCliCiudad: '',
      DocPagado: false,
      MetodoPagoId: '',
      DocFechaEmision: todayStr(),
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
        // Cobro real del documento: puede estar cobrada por cuenta corriente aunque
        // DocPagado siga en 0, así que no alcanza con mirar la bandera.
        setCobroDoc(res.data?.cobro || null);
        setEditDocInfo({ DocSerie: d.DocSerie, DocNumero: d.DocNumero, DocTipo: d.DocTipo, EmpIdEmpresa: d.EmpIdEmpresa });
        const lbl = (d.DocTipo || '').toUpperCase();
        if (lbl.includes('PEDIDO')) setTipoCliente('PEDIDO_CAJA');
        else if (d.RutObligatorio || lbl.includes('FACTURA')) setTipoCliente('RUT');
        else setTipoCliente('CONSUMIDOR_FINAL');
        const isContado = lbl.includes('CONTADO') || d.DocPagado === true || d.DocPagado === 1;
        // Guardar el estado original de pago para detectar cambio contado→crédito
        originalPagadoRef.current = isContado;
        setFormaPago(isContado ? 'CONTADO' : 'CREDITO');
        setNotas(d.DocObservaciones || '');
        if (res.data?.pagos && res.data.pagos.length > 0) {
          const pagosCargados = res.data.pagos.map((p, idx) => {
            // Si el pago guardado no trae moneda, asumir la MONEDA DEL DOCUMENTO (no UYU fijo)
            const mid = p.PagIdMonedaPago || p.monedaId || d.MonIdMoneda || 1;
            return {
              id: Date.now() + idx,
              metodoPagoId: String(p.MPaIdMetodoPago || p.metodoPagoId || ''),
              monedaId: mid,
              moneda: mid === 2 ? 'USD' : 'UYU',
              monto: String(p.PagMontoPago || p.monto || '')
            };
          });
          setPagos(pagosCargados);
          // Snapshot para detectar si el usuario los modifica
          pagosOriginalesRef.current = pagosCargados.map(p => ({
            metodoPagoId: String(p.metodoPagoId),
            monedaId: Number(p.monedaId),
            monto: parseFloat(p.monto) || 0
          }));
        }

        const docTotalReal = parseFloat(d.DocTotal) || 0;
        let sumLineas = 0;
        lineas.forEach(l => { sumLineas += parseFloat(l.DcdTotal) || 0; });
        
        let factorConversion = 1;
        if (d.MonIdMoneda === 1 && docTotalReal > 0 && sumLineas > 0) {
            const ratio = docTotalReal / sumLineas;
            // Si el ratio entre el total del documento (UYU) y la suma de las líneas (USD) es como el tipo de cambio
            if (ratio > 30 && ratio < 55) {
                factorConversion = ratio;
            }
        }

        const lineasMapeadas = lineas.map((l, idx) => {
          let sub = parseFloat(l.DcdSubtotal) || 0;
          let imp = parseFloat(l.DcdImpuestos) || 0;
          let total = parseFloat(l.DcdTotal) || (sub + imp);
          let rawUnitPrice = parseFloat(l.DcdPrecioUnitario) || 0;

          if (factorConversion !== 1) {
             sub = sub * factorConversion;
             imp = imp * factorConversion;
             total = total * factorConversion;
             rawUnitPrice = rawUnitPrice * factorConversion;
          }

          const qty = parseFloat(l.DcdCantidad) || 1;
          const unitPrice = qty > 0 ? (total / qty) : rawUnitPrice;
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
          DocFechaEmision: toDateInputStr(d.DocFechaEmision),
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

  // Multiempresa: al editar, preseleccionar la empresa emisora del documento
  useEffect(() => {
    if (mode === 'editar' && editDocInfo?.EmpIdEmpresa && empresas.length) {
      const m = empresas.find(e => e.EmpIdEmpresa === editDocInfo.EmpIdEmpresa);
      if (m) setEmpresaSeleccionada(m);
    }
  }, [empresas, editDocInfo, mode]);

  // Derivar DocTipo cuando cambian tiposDocs, tipoCliente o formaPago
  useEffect(() => {
    if (tiposDocs.length === 0) return;
    const docTipo = resolverDocTipo(tiposDocs, tipoCliente, formaPago);
    const esContado = formaPago === 'CONTADO';
    setFormData(prev => ({ ...prev, DocTipo: docTipo, DocPagado: esContado }));
  }, [tiposDocs, tipoCliente, formaPago]);

  // NOTA: un Pedido Caja puede ir a CRÉDITO (no se fuerza CONTADO).
  // El default a CONTADO para un Pedido Caja recién elegido ya lo aplica el handler
  // onTipoDoc (esContado = v === '40'), y la edición carga formaPago desde el documento.
  // Antes había un efecto que forzaba CONTADO al cambiar tipoCliente: pisaba el crédito
  // al editar un Pedido Caja creado a crédito, por eso se quitó.

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
    // Modo editar con pagos reales cargados de BD: NO pisarlos con el total teórico.
    // Pueden diferir legítimamente por un ajuste monetario de caja (redondeo/pago cerrado).
    if (esEditar && pagosOriginalesRef.current) return;
    if (formData.DocPagado && pagos.length === 1) {
      setPagos(prev => {
        const p = prev[0];
        // Respetar la moneda elegida en el pago y CONVERTIR el monto (no forzar la del documento)
        const esDocUSD = formData.MonIdMoneda === 2;
        const monedaPago = p.moneda || (esDocUSD ? 'USD' : 'UYU');
        let monto = totales.total;
        if (esDocUSD && monedaPago === 'UYU') monto = totales.total * (cotizacion || 1);
        if (!esDocUSD && monedaPago === 'USD') monto = totales.total / (cotizacion || 1);
        return [{
          ...p,
          monto: monto.toFixed(2),
          moneda: monedaPago,
          monedaId: monedaPago === 'USD' ? 2 : 1
        }];
      });
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
            moneda: formData.MonIdMoneda === 2 ? 'USD' : 'UYU',
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
      const [resClientes, resNomencladores, resDepartamentos, resArticulos, resMetodosPago, resCotizacion, resConfigDGI] = await Promise.all([
        api.get('/clients'),
        api.get('/contabilidad/cfe/nomencladores'),
        api.get('/nomenclators/departments').catch(() => ({ data: { success: false, data: [] } })),
        api.get('/contabilidad/articulos').catch(() => ({ data: { success: false, data: [] } })),
        api.get('/apipagos/metodos').catch(() => ({ data: [] })),
        api.get('/apicotizaciones/hoy').catch(() => null),
        api.get('/contabilidad/cfe/config-dgi').catch(() => null)
      ]);
      if (resConfigDGI?.data?.success) {
        setDgiConfig({
          limiteUI: Number(resConfigDGI.data.limiteUI) || 10000,
          valorUI: Number(resConfigDGI.data.valorUI) || 6.5321,
        });
      }
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
          DocCliNombreFantasia: '',
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
          DocCliNombreFantasia: '',
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
    if (!formData.CliIdCliente || Number(formData.CliIdCliente) <= 1 || Number(formData.CliIdCliente) === CONSUMIDOR_FINAL_ID) {
      toast.error('Este cliente es una cuenta genérica compartida (ej. Consumidor Final) y no se puede actualizar desde una factura. Si el receptor real es otro, creá o seleccioná su propio cliente.');
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

    // Ficha ACTUAL del cliente (tal como se cargó la lista al abrir el modal),
    // para mostrar el cambio real antes de pisarla.
    const clienteActual = clientes.find(item => String(item.CodCliente || item.CliIdCliente) === String(formData.CliIdCliente));
    const nombreFantasiaTrim = (formData.DocCliNombreFantasia || '').trim();

    const cambios = [];
    const norm = v => String(v || '').trim();
    if (norm(clienteActual?.Nombre) !== norm(formData.DocCliNombre)) {
      cambios.push(`Nombre / Razón Social:\n   "${norm(clienteActual?.Nombre) || '(vacío)'}"  →  "${formData.DocCliNombre}"`);
    }
    if (norm(clienteActual?.CioRuc) !== norm(formData.DocCliDocumento)) {
      cambios.push(`Documento (RUT/CI):\n   "${norm(clienteActual?.CioRuc) || '(vacío)'}"  →  "${formData.DocCliDocumento}"`);
    }
    if (norm(clienteActual?.DireccionTrabajo) !== norm(formData.DocCliDireccion)) {
      cambios.push(`Dirección:\n   "${norm(clienteActual?.DireccionTrabajo) || '(vacío)'}"  →  "${formData.DocCliDireccion}"`);
    }
    if (nombreFantasiaTrim && norm(clienteActual?.NombreFantasia) !== nombreFantasiaTrim) {
      cambios.push(`Nombre de Fantasía:\n   "${norm(clienteActual?.NombreFantasia) || '(vacío)'}"  →  "${nombreFantasiaTrim}"`);
    }

    if (cambios.length === 0) {
      toast.info('No hay cambios respecto a la ficha actual del cliente.');
      return;
    }

    const nombreActual = clienteActual?.Nombre || clienteActual?.NombreFantasia || formData.DocCliNombre;
    setConfirmActualizarCliente({
      mensaje: `⚠️ SE VA A ACTUALIZAR PERMANENTEMENTE el cliente:\n"${nombreActual}" (ID ${formData.CliIdCliente})\n\ncon estos datos:\n\n${cambios.join('\n\n')}\n\nEsto reemplaza la ficha real del cliente para SIEMPRE, en todas sus facturas pasadas y futuras. ¿CONFIRMÁS?`,
      payload: { Nombre: formData.DocCliNombre, Documento: formData.DocCliDocumento, Direccion: formData.DocCliDireccion, Ciudad: depId, NombreFantasia: nombreFantasiaTrim || undefined }
    });
  };

  const confirmarActualizarClienteDGI = async () => {
    if (!confirmActualizarCliente) return;
    setUpdatingClient(true);
    try {
      await api.patch(`/contabilidad/clientes/${formData.CliIdCliente}/dgi`, confirmActualizarCliente.payload);
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
        moneda: formData.MonIdMoneda === 2 ? 'USD' : 'UYU',
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

  // Cambiar la moneda del DOCUMENTO convirtiendo los precios con la cotización del día,
  // para que el comprobante mantenga su valor equivalente (ej: U$S 11 ⇄ $ 449,02).
  const cambiarMonedaDocumento = (nuevaMoneda) => {
    if (nuevaMoneda === monedaOp) return;
    const factor = nuevaMoneda === 'USD' ? 1 / (cotizacion || 1) : (cotizacion || 1);
    setFormData(prev => ({
      ...prev,
      Lineas: prev.Lineas.map(l => {
        const precio = parseFloat(l.precioUnitario);
        if (isNaN(precio) || precio === 0) return l;
        return {
          ...l,
          precioUnitario: parseFloat((precio * factor).toFixed(4)),
          precioNote: `Convertido ${monedaOp === 'USD' ? 'U$S→$' : '$→U$S'} (TC ${cotizacion})`
        };
      })
    }));
    setMonedaOp(nuevaMoneda);
  };

  const totalPagado = useMemo(() => {
    return pagos.reduce((acc, p) => {
      const amt = parseFloat(p.monto) || 0;
      const isComprobanteUSD = formData.MonIdMoneda === 2;
      // El panel de pagos usa p.moneda ('UYU'/'USD') y el modal p.monedaId (1/2):
      // aceptar ambos, priorizando p.moneda (lo que el usuario ve y toca en pantalla)
      const isPagoUSD = p.moneda ? p.moneda === 'USD' : String(p.monedaId) === '2';
      
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

  // ¿Los pagos actuales son exactamente los reales cargados de BD? → se preservan al guardar
  const pagosUntouched = useMemo(() => {
    const orig = pagosOriginalesRef.current;
    if (!esEditar || !orig) return false;
    if (pagos.length !== orig.length) return false;
    return pagos.every((p, i) =>
      String(p.metodoPagoId) === orig[i].metodoPagoId &&
      Number(p.monedaId) === orig[i].monedaId &&
      Math.abs((parseFloat(p.monto) || 0) - orig[i].monto) < 0.005
    );
  }, [pagos, esEditar]);

  // Ajuste monetario registrado en el cobro original (lo cobrado − total factura), en UYU.
  // Misma lógica que la caja: la factura va por el valor real, la diferencia es ajuste (5.2.03/4.2.2).
  const ajusteEdicionUYU = useMemo(() => {
    if (!pagosUntouched || !formData.DocPagado) return 0;
    const factor = formData.MonIdMoneda === 2 ? (cotizacion || 1) : 1;
    return parseFloat(((totalPagado - totales.total) * factor).toFixed(2));
  }, [pagosUntouched, formData.DocPagado, formData.MonIdMoneda, totalPagado, totales.total, cotizacion]);

  const autoRellenarPago = () => {
    if (diferenciaPago <= 0) return;
    const last = pagos[pagos.length - 1];
    if (!last) {
      addPago();
      return;
    }
    let fill = diferenciaPago;
    const isComprobanteUSD = formData.MonIdMoneda === 2;
    const isLastUSD = last.moneda ? last.moneda === 'USD' : String(last.monedaId) === '2';
    
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

  const handleSubmit = async (e, confirmarRevertir = false) => {
    e.preventDefault();

    // ── Validaciones DGI: documento del receptor (dígito verificador) y umbral e-Ticket ──
    const docTipoLabelV = ((tiposDocs.find(t => String(t.value) === String(formData.DocTipo))?.label) || String(formData.DocTipo || '')).toUpperCase();
    const esEFacturaV = docTipoLabelV.includes('FACTURA') && !docTipoLabelV.includes('NOTA');
    const esETicketV = docTipoLabelV.includes('TICKET') && !docTipoLabelV.includes('NOTA');
    const valDocCli = validarDocumentoUY(formData.DocCliDocumento);
    const totalUYUV = formData.MonIdMoneda === 2 ? totales.total * (cotizacion || 40) : totales.total;
    const umbralUYUV = dgiConfig.limiteUI * dgiConfig.valorUI;

    if (esEFacturaV && (!valDocCli.valido || valDocCli.tipo !== 'RUT')) {
      return toast.error(
        `No se puede emitir la e-Factura: ${valDocCli.motivo || 'falta el RUT del cliente'}. Solución: cargá un RUT válido de 12 dígitos en "Documento (RUT / CI)", o emití un e-Ticket si es consumidor final.`,
        { duration: 9000 }
      );
    }
    if (esETicketV) {
      if (totalUYUV > umbralUYUV && !valDocCli.valido) {
        return toast.error(
          `Este e-Ticket equivale a $ ${formatMoney(totalUYUV)} UYU y supera el umbral de $ ${formatMoney(umbralUYUV)} (${dgiConfig.limiteUI} UI): DGI exige identificar al comprador. ${valDocCli.motivo}. Solución: ingresá la Cédula (6-8 dígitos) o el RUT (12 dígitos) del cliente en "Documento (RUT / CI)".`,
          { duration: 10000 }
        );
      }
      if (String(formData.DocCliDocumento || '').trim() !== '' && !valDocCli.valido) {
        return toast.error(
          `${valDocCli.motivo}. Solución: corregí el campo "Documento (RUT / CI)" (Cédula de 6-8 dígitos o RUT de 12, sin puntos ni guiones) o dejalo vacío si es consumidor final.`,
          { duration: 9000 }
        );
      }
    }

    if (formData.DocTipo.includes('FACTURA') && !formData.CliIdCliente) {
      return toast.error('Las e-Facturas requieren un cliente con RUT seleccionado. Solución: buscá y seleccioná el cliente en "1. Seleccionar Cliente".');
    }
    if (formData.DocPagado && pagos.length === 0) {
      return toast.error('Debe seleccionar al menos un método de pago si el documento está pagado.');
    }
    if (formData.DocPagado && !balanceOK && !pagosUntouched) {
      const monedaDoc = formData.MonIdMoneda === 2 ? 'U$S' : '$';
      return toast.error(
        `La suma de los pagos no coincide con el total de la factura. Total: ${monedaDoc} ${formatMoney(totales.total)} — Pagos ingresados (convertidos): ${monedaDoc} ${formatMoney(totalPagado)} — Diferencia: ${monedaDoc} ${formatMoney(Math.abs(diferenciaPago))}. Ojo: los pagos en otra moneda se convierten con la cotización del día ($ ${cotizacion}). Solución: revisá la moneda ($/U$S) de cada pago, ajustá el monto, o usá "Completar Saldo".`,
        { duration: 12000 }
      );
    }
    
    const lineasValidas = formData.Lineas.filter(l => l.concepto.trim() !== '' && parseFloat(l.precioUnitario) >= 0);
    if (lineasValidas.length === 0) {
      return toast.error('Debe agregar al menos una línea con concepto y precio.');
    }

    setLoading(true);
    try {
      if (esEditar) {
        await api.put(`/contabilidad/cfe/documentos/${editDocId}`, {
          // Solo va en true cuando el usuario ya confirmó el aviso de factura cobrada
          // (el backend responde 409 y recién ahí se reintenta con esta bandera).
          confirmarRevertirCobro: confirmarRevertir,
          DocTipo: formData.DocTipo,
          MonIdMoneda: formData.MonIdMoneda,
          CliIdCliente: formData.CliIdCliente ? parseInt(formData.CliIdCliente) : CONSUMIDOR_FINAL_ID,
          DocCliNombre: formData.DocCliNombre,
          DocCliDocumento: formData.DocCliDocumento,
          DocCliDireccion: formData.DocCliDireccion,
          DocCliCiudad: formData.DocCliCiudad,
          DocPagado: formData.DocPagado,
          MetodoPagoId: formData.DocPagado ? parseInt(pagos[0]?.metodoPagoId) : null,
          // Pagos intactos de BD → el backend los preserva tal cual (no borra/recrea)
          preservarPagos: pagosUntouched,
          Pagos: formData.DocPagado ? pagos.map(p => ({
            metodoPagoId: parseInt(p.metodoPagoId),
            monto: parseFloat(p.monto),
            monedaId: p.moneda ? (p.moneda === 'USD' ? 2 : 1) : (parseInt(p.monedaId) || 1)
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
          DocObservaciones: notas,
          empresaId: empresaSeleccionada?.EmpIdEmpresa ?? null,
          DocFechaEmision: formData.DocFechaEmision || null
        });
        toast.success('Documento actualizado exitosamente');
      } else {
        await api.post('/contabilidad/cfe/manual', {
          DocTipo: formData.DocTipo,
          MonIdMoneda: formData.MonIdMoneda,
          CliIdCliente: formData.CliIdCliente ? parseInt(formData.CliIdCliente) : CONSUMIDOR_FINAL_ID,
          DocCliNombre: formData.DocCliNombre,
          DocCliDocumento: formData.DocCliDocumento,
          DocCliDireccion: formData.DocCliDireccion,
          DocCliCiudad: formData.DocCliCiudad,
          DocPagado: formData.DocPagado,
          MetodoPagoId: formData.DocPagado ? parseInt(pagos[0]?.metodoPagoId) : null,
          Pagos: formData.DocPagado ? pagos.map(p => ({
            metodoPagoId: parseInt(p.metodoPagoId),
            monto: parseFloat(p.monto),
            monedaId: p.moneda ? (p.moneda === 'USD' ? 2 : 1) : (parseInt(p.monedaId) || 1)
          })) : null,
          Lineas: lineasValidas.map(l => ({
            concepto: l.concepto,
            DcdDscItem: l.DcdDscItem || '',
            cantidad: parseFloat(l.cantidad),
            precioUnitario: parseFloat(l.precioUnitario),
            iva: parseFloat(l.iva)
          })),
          Totales: totales,
          empresaId: empresaSeleccionada?.EmpIdEmpresa ?? null,
          DocFechaEmision: formData.DocFechaEmision || null
        });
        toast.success('Documento generado exitosamente');
      }
      onSuccess();
    } catch (error) {
      // El backend frena una edición que devolvería a pendientes una factura ya cobrada.
      // No se pisa: se le muestra al usuario qué va a pasar y decide él.
      if (error.response?.status === 409 && error.response?.data?.requiereConfirmacion) {
        setLoading(false);
        setAvisoCobrada({ ...error.response.data, evento: { preventDefault: () => {} } });
        return;
      }
      toast.error(error.response?.data?.error || 'Error al emitir el documento');
    } finally {
      setQCliente('');
      setPagos([]);
      setLoading(false);
    }
  };

  const formatMoney = (val) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);

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
        {empresas.length > 0 && (
          <div className="flex items-center gap-2 ml-auto mr-3">
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Empresa emisora</span>
            <select
              value={empresaSeleccionada?.EmpIdEmpresa ?? ''}
              onChange={(ev) => setEmpresaSeleccionada(empresas.find(e => e.EmpIdEmpresa === Number(ev.target.value)))}
              disabled={empresas.length <= 1}
              className="bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-default"
            >
              {empresas.map(e => (
                <option key={e.EmpIdEmpresa} value={e.EmpIdEmpresa}>{e.EmpNombreFantasia || e.EmpRazonSocial}</option>
              ))}
            </select>
          </div>
        )}
        <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-xl transition-all">
          <X size={20} />
        </button>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex-1 flex flex-col p-4 gap-4 min-h-0 overflow-y-auto">

        {/* Esta factura YA SE COBRÓ — se avisa apenas se abre, antes de tocar nada.
            Se basa en la plata imputada, no en DocPagado: una factura a crédito cobrada
            por cuenta corriente puede tener la bandera en 0 y estar saldada igual. */}
        {esEditar && cobroDoc?.estaCobrada && (
          <div className="flex items-start gap-3 bg-emerald-50 border-2 border-emerald-300 rounded-2xl px-4 py-3">
            <div className="shrink-0 bg-emerald-500 text-white rounded-xl p-1.5 mt-0.5">
              <CheckCircle size={20} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <p className="text-emerald-900 font-black text-sm leading-snug">
                Esta factura ya fue cobrada
                {cobroDoc.importeImputado > 0.01 && (
                  <> — {formData.MonIdMoneda === 2 ? 'US$' : '$'} {Number(cobroDoc.importeImputado).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} imputado
                    {cobroDoc.cantidadPagos > 0 && ` en ${cobroDoc.cantidadPagos} pago(s)`}</>
                )}
              </p>
              <p className="text-emerald-800 font-semibold text-xs mt-1 leading-relaxed">
                Si la guardás como <strong>no pagada</strong>, se le regenera la deuda y vuelve a aparecer
                en pendientes. El sistema te va a pedir confirmación antes de hacerlo.
              </p>
            </div>
          </div>
        )}

        {/* ⚠️ ALERTA GRANDE: cambio de contado a crédito en edición */}
        {esEditar && originalPagadoRef.current === true && formaPago === 'CREDITO' && (
          <div className="flex items-start gap-4 bg-amber-50 border-2 border-amber-400 rounded-2xl px-5 py-4 shadow-lg animate-in fade-in">
            <div className="shrink-0 bg-amber-400 text-white rounded-xl p-2 mt-0.5">
              <AlertTriangle size={28} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-amber-900 font-black text-base leading-snug">
                ⚠️ ATENCIÓN — Se va a ANULAR el pago registrado en caja
              </p>
              <p className="text-amber-800 font-semibold text-sm mt-1 leading-relaxed">
                Este documento fue cobrado como <strong>Contado</strong>. Al cambiarlo a <strong>Crédito</strong>:
              </p>
              <ul className="mt-2 space-y-1 text-amber-800 text-sm font-medium list-none">
                <li className="flex items-center gap-2"><span className="text-amber-500 font-black">✕</span> La transacción de caja quedará <strong>ANULADA</strong></li>
                <li className="flex items-center gap-2"><span className="text-amber-500 font-black">✕</span> El cobro registrado desaparecerá del historial de pagos</li>
                <li className="flex items-center gap-2"><span className="text-green-600 font-black">✓</span> Se creará una <strong>deuda pendiente</strong> por el monto total</li>
              </ul>
              <p className="text-amber-700 text-xs mt-2 font-semibold">
                Solo confirmá si esto es intencional. Esta acción no se puede deshacer desde aquí.
              </p>
            </div>
          </div>
        )}

        {/* PANEL SUPERIOR: CajaPanelPago idéntico a Caja */}
        <CajaPanelPago
          layout="horizontal"
          mode="COBRO"
          totalACubrir={pagosUntouched && formData.DocPagado ? totalPagado : totales.total}
          ajusteMonto={ajusteEdicionUYU}
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
          condicion={formaPago}
          onCondicionChange={(cond) => {
            // El toggle CONTADO/CRÉDITO es la fuente de verdad de la condición de pago.
            // Necesario para permitir marcar un Pedido Caja (tipoDoc '40') como CRÉDITO:
            // sin esto, DocPagado quedaba en true y la validación exigía un método de pago.
            // Se llama después de onTipoDoc dentro del mismo handler, por lo que este
            // setFormaPago prevalece; DocPagado se recalcula en el efecto que observa formaPago.
            setFormaPago(cond === 'CREDITO' ? 'CREDITO' : 'CONTADO');
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

            {/* Fecha del documento (editable mientras no se haya enviado a DGI) */}
            <div className="flex flex-col gap-1.5 bg-zinc-50 border border-zinc-200/60 rounded-xl p-3">
              <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest px-1">Fecha del documento</label>
              <input
                type="date"
                value={formData.DocFechaEmision || todayStr()}
                max={todayStr()}
                onChange={e => setFormData({ ...formData, DocFechaEmision: e.target.value })}
                className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm cursor-pointer"
              />
              {formData.DocFechaEmision && formData.DocFechaEmision !== todayStr() && (
                <span className="text-[9px] font-black text-amber-600 px-1">
                  ⚠ Fecha retroactiva: {new Date(formData.DocFechaEmision + 'T00:00:00').toLocaleDateString('es-UY')} — se aplica también al asiento contable{formData.DocPagado ? ' y a la caja' : ''}.
                </span>
              )}
              <span className="text-[8px] font-bold text-zinc-400 px-1">Solo editable antes de enviar a DGI.</span>
            </div>

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
                  <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Nombre de Fantasía (opcional — no va al CFE)</label>
                  <input
                    type="text"
                    value={formData.DocCliNombreFantasia || ''}
                    onChange={e => setFormData({ ...formData, DocCliNombreFantasia: e.target.value })}
                    placeholder="Dejar vacío para no tocar el nombre de fantasía del cliente"
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
                  {/* Feedback en vivo del documento (no aplica a Pedido Caja, que es borrador interno) */}
                  {tipoCliente !== 'PEDIDO_CAJA' && (() => {
                    const docStr = String(formData.DocCliDocumento || '').trim();
                    const lblDoc = ((tiposDocs.find(t => String(t.value) === String(formData.DocTipo))?.label) || String(formData.DocTipo || '')).toUpperCase();
                    const esFacturaLbl = lblDoc.includes('FACTURA') && !lblDoc.includes('NOTA');
                    const esTicketLbl = lblDoc.includes('TICKET') && !lblDoc.includes('NOTA');

                    if (!docStr) {
                      if (esFacturaLbl) {
                        return <span className="text-[9px] font-black text-rose-600 px-1 block mt-0.5">✗ La e-Factura requiere el RUT del cliente (12 dígitos, sin puntos ni guiones)</span>;
                      }
                      if (esTicketLbl) {
                        const totUYU = formData.MonIdMoneda === 2 ? totales.total * (cotizacion || 40) : totales.total;
                        if (totUYU > dgiConfig.limiteUI * dgiConfig.valorUI) {
                          return <span className="text-[9px] font-black text-amber-600 px-1 block mt-0.5">⚠ Supera el umbral DGI ({dgiConfig.limiteUI.toLocaleString('es-UY')} UI): ingresá la CI o el RUT del comprador</span>;
                        }
                      }
                      return null;
                    }

                    const v = validarDocumentoUY(formData.DocCliDocumento);
                    if (!v.valido) {
                      return <span className="text-[9px] font-black text-rose-600 px-1 block mt-0.5">✗ {v.motivo}</span>;
                    }
                    if (esFacturaLbl && v.tipo !== 'RUT') {
                      return <span className="text-[9px] font-black text-rose-600 px-1 block mt-0.5">✗ Es una Cédula válida, pero la e-Factura requiere un RUT (12 dígitos)</span>;
                    }
                    return <span className="text-[9px] font-black text-emerald-600 px-1 block mt-0.5">✓ {v.tipo === 'RUT' ? 'RUT válido' : 'Cédula válida'}</span>;
                  })()}
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
                        <button type="button" onClick={() => cambiarMonedaDocumento('UYU')}
                          className={`px-2.5 py-1 text-[9px] font-black rounded-md transition-all ${ monedaOp === 'UYU' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700' }`}>
                          $ UYU
                        </button>
                        <button type="button" onClick={() => cambiarMonedaDocumento('USD')}
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

                <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-left min-w-[680px] border-collapse table-fixed">
                    <thead className="bg-zinc-50 border-b border-zinc-200 text-[9px] font-black text-zinc-500 uppercase tracking-widest sticky top-0 z-10">
                      <tr>
                        <th className="p-2.5 pl-4 w-[36%]">Concepto o Descripción</th>
                        <th className="p-2.5 w-[9%] min-w-[52px] text-right">Cant.</th>
                        <th className="p-2.5 w-[16%] min-w-[100px] text-right">
                          Precio Unit.
                          <span className={`ml-1 text-[9px] font-black px-1.5 py-0.5 rounded-full ${monedaOp === 'USD' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                            {monedaOp === 'USD' ? 'U$S' : '$UY'}
                          </span>
                        </th>
                        <th className="p-2.5 w-[13%] min-w-[86px] text-center">IVA %</th>
                        <th className="p-2.5 w-[12%] min-w-[92px] text-right">Subtotal Neto</th>
                        <th className="p-2.5 w-[14%] min-w-[100px] text-right pr-4">Total con IVA</th>
                        <th className="p-2.5 w-[44px] text-center"></th>
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
                            <td className="p-1.5 text-right font-mono text-xs text-zinc-700 font-bold whitespace-nowrap">
                              <span className={`text-[10px] mr-0.5 ${monedaOp === 'USD' ? 'text-amber-500' : 'text-blue-400'}`}>{monedaOp === 'USD' ? 'U$S' : '$'}</span>{formatMoney(subtotalNeto)}
                            </td>
                            <td className="p-1.5 pr-4 text-right font-mono text-xs font-black text-zinc-900 whitespace-nowrap">
                              <span className={`text-[10px] mr-0.5 ${monedaOp === 'USD' ? 'text-amber-600' : 'text-blue-500'}`}>{monedaOp === 'USD' ? 'U$S' : '$'}</span>{formatMoney(subtotalConIva)}
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

      {/* Aviso: la factura ya fue cobrada y este cambio la devolvería a pendientes */}
      {avisoCobrada && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 flex flex-col gap-4 border-2 border-amber-300">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0">
                <AlertTriangle size={22} className="text-amber-600" />
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-zinc-900 text-lg leading-tight">Esta factura ya fue cobrada</h3>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mt-0.5">{avisoCobrada.documento}</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex flex-col gap-2">
              {avisoCobrada.importeImputado > 0.01 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-amber-800">Ya imputado</span>
                  <span className="font-black text-amber-900 tabular-nums">
                    {Number(avisoCobrada.importeImputado).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {avisoCobrada.cantidadPagos > 0 && (
                      <span className="text-[11px] font-bold text-amber-700 ml-2">en {avisoCobrada.cantidadPagos} pago(s)</span>
                    )}
                  </span>
                </div>
              )}
              <p className="text-xs font-medium text-amber-800 leading-relaxed">
                La estás guardando como <strong>NO pagada</strong>: se le va a regenerar la deuda y va a
                volver a aparecer en la ventana de pendientes, aunque el cliente ya la haya pagado.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAvisoCobrada(null)}
                className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-brand-cyan text-white hover:bg-cyan-700 transition-colors"
              >
                Volver sin guardar
              </button>
              <button
                type="button"
                onClick={() => { const ev = avisoCobrada.evento; setAvisoCobrada(null); handleSubmit(ev, true); }}
                className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-white border-2 border-amber-400 text-amber-700 hover:bg-amber-50 transition-colors"
              >
                Guardar igual y reabrir la deuda
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!confirmActualizarCliente}
        onClose={() => setConfirmActualizarCliente(null)}
        onConfirm={confirmarActualizarClienteDGI}
        title="Actualizar ficha del cliente"
        message={confirmActualizarCliente?.mensaje || ''}
        confirmText="Sí, actualizar"
        cancelText="Cancelar"
        isDestructive
      />
    </div>
  );
}
