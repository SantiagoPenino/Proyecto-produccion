import React, { useState, useEffect, useRef } from 'react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';
import CajaPanelPago from '../CajaPanelPago';
import CajaVentaDirectaTab from '../CajaVentaDirectaTab';

const TIPOS_DOC_VENDEDOR = [
  { value: '40', label: 'Pedido Caja' },
];

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VentaRolloAdelantoPage() {
  const [metodosPago, setMetodosPago] = useState([]);
  const [cotizacion, setCotizacion]   = useState(null);
  const [procesando, setProcesando]   = useState(false);

  // Pago — fijado a Transferencia / Pedido Caja / Contado
  const [pagos, setPagos]   = useState([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [tipoDoc, setTipoDoc]   = useState('40');
  const [serieDoc, setSerieDoc] = useState('A');
  const [obs, setObs]           = useState('');
  const [totalACubrir, setTotalACubrir] = useState(0);
  const [moneda, setMoneda]     = useState('UYU');

  // Comprobante obligatorio
  const [fileComprobante, setFileComprobante] = useState(null);
  const [comprobanteError, setComprobanteError] = useState(false);
  const [numDocActual, setNumDocActual] = useState('...');
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
    setComprobanteError(false);
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

    // Comprobante obligatorio
    if (!fileComprobante) {
      setComprobanteError(true);
      toast.error('Debe adjuntar el comprobante de transferencia para continuar.');
      return;
    }

    setProcesando(true);
    try {
      // 1. Subir comprobante
      let comprobanteUrl = null;
      try {
        const fd = new FormData();
        fd.append('comprobante', fileComprobante);
        const up = await api.post('/apipagos/uploadComprobante', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        comprobanteUrl = up.data?.filename || up.data?.comprobanteUrl || null;
      } catch (e) {
        console.warn('Error subiendo comprobante:', e);
        toast.error('No se pudo subir el comprobante. Intente nuevamente.');
        setProcesando(false);
        return;
      }

      // 2. Procesar venta
      const ventaPayload = {
        ...payload,
        header: { ...payload.header, admin: true, esCredito: false },
        comprobanteUrl,
        pagos: pagosFilt.map(p => ({
          metodoPagoId:     parseInt(p.metodoPagoId),
          montoOriginal:    parseFloat(p.monto),
          monedaId:         p.moneda === 'USD' ? 2 : 1,
          cotizacion:       p.moneda === 'USD' ? cotizacion : null,
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
    /* El scroll lo maneja el contenedor externo de MainAppContent */
    <div className="bg-slate-100 pb-8">
      <div className="max-w-[1400px] mx-auto p-4 flex flex-col gap-4">

        {/* ── Header ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">Venta de Rollo por Adelantado</h1>
            <p className="text-xs text-slate-400 font-semibold mt-0.5">Atención al Cliente — Caja Administrativa</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Número de documento */}
            <span className="text-xs font-black text-slate-600 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg font-mono">
              {numDocActual}
            </span>
            {/* TC */}
            {cotizacion && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">TC</span>
                <span className="text-sm font-black text-amber-800 font-mono">${fmt(cotizacion)}</span>
              </div>
            )}
            <span className="text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg uppercase tracking-widest">
              Pedido Caja · Contado · Transferencia
            </span>
          </div>
        </div>

        {/* ── Panel de pago (sin header "DOCUMENTO A GENERAR", fijado) ── */}
        <div>
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
            onNumDocPredict={setNumDocActual}
            comprobanteFile={fileComprobante}
            onComprobanteFile={(f) => { setFileComprobante(f); setComprobanteError(false); }}
            comprobanteError={comprobanteError}
            comprobanteRef={fileInputRef}
          />
        </div>

        {/* ── Formulario de venta — altura mínima para que el tab muestre sin scroll interno ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ minHeight: '620px' }}>
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
    </div>
  );
}
