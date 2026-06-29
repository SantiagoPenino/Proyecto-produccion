import React, { useState, useEffect, useRef } from 'react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';
import { Paperclip, X, CheckCircle } from 'lucide-react';
import CajaPanelPago from '../CajaPanelPago';
import CajaVentaDirectaTab from '../CajaVentaDirectaTab';

const TIPOS_DOC_VENDEDOR = [
  { value: '40', label: 'Pedido Caja' },
];

export default function VentaRolloAdelantoPage() {
  const [metodosPago, setMetodosPago] = useState([]);
  const [cotizacion, setCotizacion]   = useState(1);
  const [procesando, setProcesando]   = useState(false);

  // Estado pago — bloqueado a Transferencia / Pedido Caja / Contado
  const [pagos, setPagos]             = useState([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [tipoDoc, setTipoDoc]         = useState('40');
  const [serieDoc, setSerieDoc]       = useState('A');
  const [obs, setObs]                 = useState('');
  const [totalACubrir, setTotalACubrir] = useState(0);
  const [moneda, setMoneda]           = useState('UYU');

  // Comprobante de transferencia (se sube junto con la venta)
  const [fileComprobante, setFileComprobante] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const fetchInit = async () => {
      try {
        const [rMet, rCot] = await Promise.allSettled([
          api.get('/apipagos/metodos'),
          api.get('/apicotizaciones/hoy'),
        ]);
        if (rMet.status === 'fulfilled') {
          const methods = rMet.value.data?.data || rMet.value.data || [];
          setMetodosPago(methods);
          const transferId = methods.find(m =>
            m.MPaDescripcionMetodo?.toLowerCase().includes('transfer')
          )?.MPaIdMetodoPago;
          if (transferId) {
            setPagos([{ id: Date.now(), metodoPagoId: transferId, moneda: 'UYU', monedaId: 1, monto: '' }]);
          }
        }
        if (rCot.status === 'fulfilled' && rCot.value.data?.cotizaciones?.[0]) {
          setCotizacion(rCot.value.data.cotizaciones[0].CotDolar);
        }
      } catch (e) { console.error(e); }
    };
    fetchInit();
  }, []);

  const resetForm = () => {
    const currentTransferId = pagos[0]?.metodoPagoId || '';
    setPagos([{ id: Date.now(), metodoPagoId: currentTransferId, moneda: 'UYU', monedaId: 1, monto: '' }]);
    setObs('');
    setTotalACubrir(0);
    setMoneda('UYU');
    setFileComprobante(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    document.dispatchEvent(new CustomEvent('caja:limpiarVenta'));
  };

  const handleConfirmar = async (payload) => {
    if (!payload.header.clienteId) { toast.warning('Debe seleccionar un cliente.'); return; }
    if (!payload.items.every(i => i.codigo && i.precioTotal && i.cantidad)) {
      toast.warning('Complete todos los campos de los ítems.'); return;
    }
    const pagosFilt = pagos.filter(p => p.monto && p.metodoPagoId);
    if (pagosFilt.length === 0 && totalACubrir > 0) {
      toast.warning('Ingrese el monto de la transferencia antes de procesar.'); return;
    }

    setProcesando(true);
    try {
      // 1. Subir comprobante si hay archivo adjunto
      let comprobanteUrl = null;
      if (fileComprobante) {
        try {
          const fd = new FormData();
          fd.append('comprobante', fileComprobante);
          const up = await api.post('/apipagos/uploadComprobante', fd, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          comprobanteUrl = up.data?.filename || up.data?.comprobanteUrl || null;
        } catch (e) {
          console.warn('Comprobante no subió:', e);
        }
      }

      // 2. Procesar venta
      const ventaPayload = {
        ...payload,
        header: { ...payload.header, admin: true, esCredito: false },
        comprobanteUrl,
        pagos: pagosFilt.map(p => ({
          metodoPagoId:    parseInt(p.metodoPagoId),
          montoOriginal:   parseFloat(p.monto),
          monedaId:        p.moneda === 'USD' ? 2 : 1,
          cotizacion:      p.moneda === 'USD' ? cotizacion : null,
          referenciaNumero: comprobanteUrl || ''
        }))
      };
      const res = await api.post('/contabilidad/caja/venta-directa', ventaPayload);
      toast.success(`Venta procesada. Comprobante: ${res.data.numeroDocFormato || res.data.tcaIdTransaccion}`);
      resetForm();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al procesar venta');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight">Venta de Rollo por Adelantado</h1>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Atención al Cliente — Caja Administrativa</p>
        </div>
        <span className="text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg uppercase tracking-widest">
          Pedido Caja · Contado · Transferencia
        </span>
      </div>

      {/* Panel de pago + campo comprobante */}
      <div className="shrink-0 bg-white border-b border-slate-200">
        <CajaPanelPago
          layout="horizontal"
          mode="VENTA"
          totalACubrir={totalACubrir}
          moneda={moneda}
          cotizacion={cotizacion}
          metodosPago={metodosPago}
          pagos={pagos}
          onPagosChange={setPagos}
          tipoDoc={tipoDoc}
          onTipoDoc={setTipoDoc}
          serieDoc={serieDoc}
          onSerieDoc={setSerieDoc}
          numDoc=""
          notas={obs}
          onNotas={setObs}
          onConfirmar={() => document.dispatchEvent(new CustomEvent('caja:confirmarVenta'))}
          procesando={procesando}
          tiposDocDisponibles={TIPOS_DOC_VENDEDOR}
          disabledExtra={procesando}
          locked={true}
        />

        {/* ── Campo comprobante de transferencia (inline, igual que entrega-pedidos) ── */}
        <div className="px-6 pb-4">
          <div className="flex flex-col gap-1 max-w-sm">
            <label className="text-sm font-bold text-zinc-800">
              Cargar comprobante de transferencia <span className="text-zinc-400 font-normal">(opcional)</span>
            </label>
            {fileComprobante ? (
              <div className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-2 text-sm">
                <CheckCircle size={15} className="text-emerald-500 shrink-0" />
                <span className="text-emerald-700 font-semibold truncate flex-1">{fileComprobante.name}</span>
                <button
                  type="button"
                  onClick={() => { setFileComprobante(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="text-emerald-400 hover:text-red-500 shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  onChange={e => setFileComprobante(e.target.files[0] || null)}
                  className="w-full text-sm border border-zinc-300 p-2 rounded-lg cursor-pointer file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Formulario de venta */}
      <div className="flex-1 min-h-0 m-4 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <CajaVentaDirectaTab
          allowedTipos={['RECURSO']}
          metodosPago={metodosPago}
          cotizacion={cotizacion}
          tiposDocDisponibles={TIPOS_DOC_VENDEDOR}
          isAdminCaja={true}
          onVentaExitosa={() => {}}
          onClienteChange={() => {}}
          pagos={pagos}
          onPagosChange={setPagos}
          tipoDocumento={tipoDoc}
          onTipoDocumento={setTipoDoc}
          serieDoc={serieDoc}
          onSerieDoc={setSerieDoc}
          obs={obs}
          onObs={setObs}
          procesando={procesando}
          onConfirmar={handleConfirmar}
          onTotalChange={(t, m) => { setTotalACubrir(t); if (m) setMoneda(m); }}
        />
      </div>
    </div>
  );
}
