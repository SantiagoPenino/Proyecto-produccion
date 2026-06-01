import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ArrowDownCircle, CreditCard, Edit3 } from 'lucide-react';
import api from '../../services/apiClient';
import CajaPanelPago from './CajaPanelPago';

const TIPOS_DOC_PAGO = [
  { value: '05', label: 'Recibo' },
];

export default function CajaOtrosIngresosTab({ sesion, metodosPago = [], cotizacion = 1, tiposDocDisponibles = TIPOS_DOC_PAGO, onCobroCompletado, isAdminCaja }) {
  
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte]   = useState('');
  
  const [pagos, setPagos]         = useState([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [tipoDoc, setTipoDoc]     = useState('05');
  const [serieDoc, setSerieDoc]   = useState('A');
  const [observaciones, setObservaciones] = useState('');
  const [procesando, setProcesando] = useState(false);

  // Auto-seleccionar primer método de pago y tipo doc
  useEffect(() => {
    if (metodosPago.length > 0 && !pagos[0].metodoPagoId) {
      const contado = metodosPago.find(m => /contado|efectivo/i.test(m.MPaDescripcionMetodo));
      const def = contado || metodosPago[0];
      setPagos([{ id: Date.now(), metodoPagoId: def.MPaIdMetodoPago, moneda: 'UYU', monedaId: 1, monto: '' }]);
    }
  }, [metodosPago]);

  useEffect(() => {
    if (tiposDocDisponibles.length > 0 && !tipoDoc) {
      setTipoDoc(tiposDocDisponibles[0].value);
    }
  }, [tiposDocDisponibles]);

  const handleProcesar = async () => {
    if (!concepto.trim()) return toast.warning('Debe ingresar un concepto para el ingreso.');
    
    const importeNum = parseFloat(importe) || 0;
    if (importeNum <= 0) return toast.warning('El importe debe ser mayor a 0.');

    const pagosValidos = pagos.filter(p => parseFloat(p.monto) > 0 && p.metodoPagoId);
    if (!pagosValidos.length) return toast.warning('Ingrese al menos un método de pago.');

    const totalPagado = pagosValidos.reduce((acc, p) => acc + (parseFloat(p.monto) || 0), 0);
    const diferencia = importeNum - totalPagado;
    const tolerancia = pagosValidos[0].moneda === 'USD' ? 0.05 : 1.0;
    if (Math.abs(diferencia) > tolerancia) {
      return toast.warning(`Falta cubrir la diferencia o el monto excede el importe especificado.`);
    }

    const pagoActivo = pagosValidos[0];
    const m = parseFloat(pagoActivo.monto);
    const mon = pagoActivo.moneda;

    setProcesando(true);
    try {
      const res = await api.post('/contabilidad/caja/ingreso-generico', {
        stuIdSesion: isAdminCaja ? null : sesion?.StuIdSesion,
        concepto: concepto.trim(),
        monto: m,
        moneda: mon,
        monedaId: mon === 'USD' ? 2 : 1,
        cotizacion: mon === 'USD' ? cotizacion : null,
        metodoPagoId: parseInt(pagoActivo.metodoPagoId, 10),
        tipoDocumento: tipoDoc,
        serieDoc: serieDoc,
        observaciones: observaciones,
        admin: isAdminCaja
      });

      toast.success(`Ingreso registrado exitosamente.`);
      setConcepto('');
      setImporte('');
      setObservaciones('');
      
      const contado = metodosPago.find(met => /contado|efectivo/i.test(met.MPaDescripcionMetodo));
      const def = contado || metodosPago[0];
      setPagos([{ id: Date.now(), metodoPagoId: def?.MPaIdMetodoPago || '', moneda: 'UYU', monedaId: 1, monto: '' }]);
      
      if (onCobroCompletado) onCobroCompletado(res.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Error al registrar el ingreso.');
    } finally { setProcesando(false); }
  };

  const importeNum = parseFloat(importe) || 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-zinc-50">
      <div className="flex-1 p-4 overflow-y-auto w-full flex flex-col gap-4 bg-slate-100">
        
        <CajaPanelPago
          layout="horizontal"
          mode="VENTA"
          labelBoton="REGISTRAR INGRESO"
          metodosPago={metodosPago}
          pagos={pagos}
          onPagosChange={setPagos}
          totalACubrir={importeNum}
          moneda={pagos[0]?.moneda || 'UYU'}
          cotizacion={cotizacion}
          procesando={procesando}
          onConfirmar={handleProcesar}
          tipoDoc={tipoDoc}
          onTipoDoc={setTipoDoc}
          serieDoc={serieDoc}
          onSerieDoc={setSerieDoc}
          numDoc=""
          tiposDocDisponibles={tiposDocDisponibles.length > 0 ? tiposDocDisponibles : TIPOS_DOC_PAGO}
          disabledExtra={
            !concepto.trim() || 
            importeNum <= 0 || 
            Math.abs(importeNum - pagos.reduce((acc, p) => acc + (parseFloat(p.monto) || 0), 0)) > (pagos[0]?.moneda === 'USD' ? 0.05 : 1.0)
          }
        />

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col gap-6">
          <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
            <div className="w-14 h-14 bg-brand-cyan/10 rounded-2xl flex items-center justify-center text-brand-cyan shadow-sm border border-brand-cyan/20">
              <ArrowDownCircle size={32} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-zinc-800 tracking-tight">Otros Ingresos a Caja</h2>
              <p className="text-zinc-500 font-bold mt-1 text-sm">Registrá entradas de dinero genéricas que no estén asociadas a clientes ni facturación.</p>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-black text-zinc-400 uppercase tracking-widest px-1 font-archivo">
                  Concepto / Descripción del Ingreso
                </label>
                <div className="relative group">
                  <Edit3 size={20} className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-300 group-focus-within:text-brand-cyan transition-colors" />
                  <input 
                    type="text" 
                    value={concepto}
                    onChange={e => setConcepto(e.target.value)}
                    placeholder="Ej: Aporte de socio, Ingreso extraordinario..." 
                    className="w-full bg-white border-2 border-zinc-200 rounded-2xl pl-16 pr-6 py-4 text-zinc-800 font-bold focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 outline-none transition-all placeholder-zinc-400"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-black text-zinc-400 uppercase tracking-widest px-1 font-archivo">
                  Importe
                </label>
                <input
                  type="number"
                  value={importe}
                  onChange={e => setImporte(e.target.value)}
                  placeholder="0.00"
                  className="w-full border-2 border-zinc-200 bg-white rounded-2xl px-5 py-4 focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 outline-none font-black text-2xl text-zinc-800 transition-all placeholder-zinc-300"
                  min="0.01"
                  step="0.01"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-[11px] font-black text-zinc-400 uppercase tracking-widest px-1 font-archivo">
                Observaciones Adicionales (Opcional)
              </label>
              <textarea 
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Detalles adicionales si son necesarios..." 
                className="w-full bg-white border-2 border-zinc-200 rounded-2xl px-6 py-4 text-zinc-800 font-bold focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/5 outline-none h-24 resize-none transition-all placeholder-zinc-400"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
