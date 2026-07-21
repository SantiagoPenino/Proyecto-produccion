import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Landmark, Calendar, User, Hash, DollarSign, Building2, PenTool, Book, AlertTriangle } from 'lucide-react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';

/**
 * origenCaja: true cuando el cheque se da de alta desde un cobro de caja. En ese caso el
 * cobro genera su propio asiento (Valores a Depositar / Deudores), así que acá NO se
 * contabiliza: si no, el mismo cheque se asienta dos veces.
 */
export default function ChequeRecibirModal({ onClose, onSuccess, initialMonto = '', origenCaja = false }) {
  const [bancos, setBancos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [loadingBancos, setLoadingBancos] = useState(true);
  const [procesando, setProcesando] = useState(false);
  // Aviso de cheque repetido (409 del backend): trae el cheque que ya estaba cargado.
  const [avisoDuplicado, setAvisoDuplicado] = useState(null);

  const [formData, setFormData] = useState({
    NumeroCheque: '',
    IdBanco: '',
    Monto: initialMonto,
    FechaEmision: new Date().toISOString().split('T')[0],
    FechaVencimiento: new Date().toISOString().split('T')[0],
    IdClienteOrigen: '',
    Agencia: '',
    EmitidoPor: '',
    EndosadoPor: '',
    EsPagoParcial: false,
    CategoriaPropiedad: 'Tercero',
    ClasificacionPlazo: 'Común',
    RubroContableId: ''
  });

  useEffect(() => {
    fetchBancos();
    fetchClientes();
    fetchCuentas();
  }, []);

  const fetchBancos = async () => {
    try {
      const res = await api.get('/tesoreria/bancos');
      setBancos(res.data.data || []);
    } catch (e) {
      toast.error('Error cargando bancos');
    } finally {
      setLoadingBancos(false);
    }
  };

  const fetchClientes = async () => {
    try {
      const res = await api.get('/clients');
      setClientes(res.data || []);
    } catch (e) {
      console.error('Error cargando clientes:', e);
    }
  };

  const fetchCuentas = async () => {
    try {
      const res = await api.get('/contabilidad/erp/cuentas');
      setCuentas(res.data.data || []);
    } catch (e) {
      console.error('Error cargando rubros:', e);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
  };

  const handleSubmit = async (e, confirmarDuplicado = false) => {
    e.preventDefault();
    if (!formData.NumeroCheque || !formData.IdBanco || !formData.Monto) {
      return toast.error('Completar campos obligatorios');
    }
    setProcesando(true);
    try {
      const payload = {
        ...formData,
        Monto: parseFloat(formData.Monto),
        IdClienteOrigen: formData.IdClienteOrigen ? parseInt(formData.IdClienteOrigen) : null,
        RubroContableId: formData.RubroContableId ? parseInt(formData.RubroContableId) : null,
        contabilizar: !origenCaja,
        confirmarDuplicado,
      };

      const res = await api.post('/tesoreria/cheques/recibir', payload);
      toast.success(res.data.message || 'Cheque ingresado correctamente');
      onSuccess(res.data.data.IdCheque);
    } catch (error) {
      // El backend frena el cheque repetido: se le muestra el que ya está cargado y decide.
      if (error.response?.status === 409 && error.response?.data?.requiereConfirmacion) {
        setProcesando(false);
        setAvisoDuplicado(error.response.data);
        return;
      }
      toast.error(error.response?.data?.error || 'Error al guardar el cheque');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50  animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-100 p-2.5 rounded-xl text-emerald-600">
              <Landmark size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">Recibir Cheque</h2>
              <p className="text-sm font-medium text-slate-500">Datos detallados del documento</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-6 overflow-y-auto max-h-[75vh]">
          
          {/* Fila superior: Opciones y Montos */}
          <div className="grid grid-cols-12 gap-6 items-start">
            
            {/* Opciones de tipo */}
            <div className="col-span-4 flex flex-col gap-3">
              <div className="flex gap-4 p-3 border border-slate-200 rounded-xl bg-slate-50">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input type="radio" name="CategoriaPropiedad" value="Propio" checked={formData.CategoriaPropiedad === 'Propio'} onChange={handleChange} className="w-4 h-4 text-emerald-600 focus:ring-emerald-500" /> Propio
                </label>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input type="radio" name="CategoriaPropiedad" value="Tercero" checked={formData.CategoriaPropiedad === 'Tercero'} onChange={handleChange} className="w-4 h-4 text-emerald-600 focus:ring-emerald-500" /> Tercero
                </label>
              </div>
              <div className="flex gap-4 p-3 border border-slate-200 rounded-xl bg-slate-50">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input type="radio" name="ClasificacionPlazo" value="Común" checked={formData.ClasificacionPlazo === 'Común'} onChange={handleChange} className="w-4 h-4 text-emerald-600 focus:ring-emerald-500" /> Común
                </label>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <input type="radio" name="ClasificacionPlazo" value="Diferido" checked={formData.ClasificacionPlazo === 'Diferido'} onChange={handleChange} className="w-4 h-4 text-emerald-600 focus:ring-emerald-500" /> Diferido
                </label>
              </div>
            </div>

            {/* Monto y Cheque */}
            <div className="col-span-8 grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                  <Hash size={16} className="text-slate-400" /> Cheque Nº *
                </label>
                <input type="text" name="NumeroCheque" value={formData.NumeroCheque} onChange={handleChange} required placeholder="Ej. 12345678" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                  <DollarSign size={16} className="text-slate-400" /> Importe *
                </label>
                <input type="number" step="0.01" name="Monto" value={formData.Monto} onChange={handleChange} required placeholder="0.00" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
              </div>
              
              <div className="col-span-2 mt-1">
                <label className="flex items-center gap-2 text-sm font-bold text-rose-600 cursor-pointer bg-rose-50 p-3 rounded-xl border border-rose-100">
                  <input type="checkbox" name="EsPagoParcial" checked={formData.EsPagoParcial} onChange={handleChange} className="w-4 h-4 text-rose-600 rounded focus:ring-rose-500" />
                  El Importe Corresponde a un pago Parcial y no al Total de Cheque
                </label>
              </div>
            </div>

          </div>

          <hr className="border-slate-100" />

          {/* Datos Bancarios */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-8">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                <Landmark size={16} className="text-slate-400" /> Banco Emisor *
              </label>
              <select name="IdBanco" value={formData.IdBanco} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white">
                <option value="">Seleccione un banco...</option>
                {bancos.map(b => <option key={b.IdBanco} value={b.IdBanco}>{b.NombreBanco}</option>)}
              </select>
            </div>
            <div className="col-span-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                <Building2 size={16} className="text-slate-400" /> Agencia
              </label>
              <input type="text" name="Agencia" value={formData.Agencia} onChange={handleChange} placeholder="Ej. Casa Central" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
            </div>
          </div>

          {/* Firmantes */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                <PenTool size={16} className="text-slate-400" /> Emitido por
              </label>
              <input type="text" name="EmitidoPor" value={formData.EmitidoPor} onChange={handleChange} placeholder="Titular de la cuenta" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                <PenTool size={16} className="text-slate-400" /> Endosado por
              </label>
              <input type="text" name="EndosadoPor" value={formData.EndosadoPor} onChange={handleChange} placeholder="Si aplica" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                <Calendar size={16} className="text-slate-400" /> Emisión *
              </label>
              <input type="date" name="FechaEmision" value={formData.FechaEmision} onChange={handleChange} required className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                <Calendar size={16} className="text-indigo-400" /> Vencimiento *
              </label>
              <input type="date" name="FechaVencimiento" value={formData.FechaVencimiento} onChange={handleChange} required className="w-full border border-indigo-200 rounded-xl px-4 py-2.5 font-medium text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Rubros Contables */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
             <h4 className="text-sm font-black text-slate-500 mb-4 uppercase tracking-widest flex items-center gap-2"><Book size={16}/> Rubros Contables</h4>
             
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                    <User size={16} className="text-slate-400" /> Cliente / Origen
                  </label>
                  <select name="IdClienteOrigen" value={formData.IdClienteOrigen} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white">
                    <option value="">(Opcional) Seleccione cliente...</option>
                    {clientes.map(c => <option key={c.IdCliente} value={c.IdCliente}>{c.RazonSocial || c.NombreFidelidad}</option>)}
                  </select>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                    <Book size={16} className="text-slate-400" /> Rubro Debe
                  </label>
                  <select name="RubroContableId" value={formData.RubroContableId} onChange={handleChange} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 bg-white">
                    <option value="">(Opcional) Seleccione rubro...</option>
                    {cuentas.map(c => <option key={c.CueIdCuenta} value={c.CueIdCuenta}>[{c.CueCodigo}] {c.CueNombre}</option>)}
                  </select>
                </div>
             </div>
          </div>

        </form>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={procesando} className="px-6 py-2.5 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed">
            {procesando ? 'Guardando...' : <><CheckCircle size={18} /> Aceptar y Cargar</>}
          </button>
        </div>
      </div>

      {/* Cheque repetido — se avisa antes de duplicarlo en cartera */}
      {avisoDuplicado && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 flex flex-col gap-4 border-2 border-amber-300">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0">
                <AlertTriangle size={22} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-lg leading-tight">Este cheque ya está cargado</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">N° {formData.NumeroCheque}</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs font-medium text-amber-800 leading-relaxed">
              {avisoDuplicado.mensaje}
              <div className="mt-2 font-bold">
                Si es el mismo cheque, cargarlo de nuevo lo va a contar dos veces en cartera
                {!origenCaja && ' y le va a cancelar al cliente una deuda que no pagó'}.
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAvisoDuplicado(null)}
                className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Volver y revisar
              </button>
              <button
                type="button"
                onClick={() => { setAvisoDuplicado(null); handleSubmit({ preventDefault: () => {} }, true); }}
                className="flex-1 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-white border-2 border-amber-400 text-amber-700 hover:bg-amber-50"
              >
                Es otro cheque, cargarlo igual
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
