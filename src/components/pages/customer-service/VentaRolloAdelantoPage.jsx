import React, { useState, useEffect, useRef } from 'react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';
import CajaPanelPago from '../CajaPanelPago';
import CajaVentaDirectaTab from '../CajaVentaDirectaTab';
import { evaluarDocumentoDGI } from '../../../utils/dgiComprobante';
import DatosDgiComprobante from '../../shared/DatosDgiComprobante';

const DATOS_DGI_VACIO = { nombre: '', nombreFantasia: '', documento: '', direccion: '', ciudad: '' };

// Comprobantes que puede emitir esta pantalla. Son los MISMOS códigos que usa la caja
// (Config_TiposDocumento.CodDocumento), solo que acá van únicamente las variantes de
// CONTADO: el rollo se cobra por adelantado, no existe la venta a crédito.
//   40 → Pedidos Caja (borrador interno, no va a DGI)
//   07 → E-Ticket Contado  → CFE 101
//   01 → E-Factura Contado → CFE 111 (exige RUT del cliente)
// Comprobantes que puede emitir esta pantalla. Son los MISMOS códigos que usa la caja
// (Config_TiposDocumento.CodDocumento), contado y crédito:
//   40 → Pedidos Caja (borrador interno, no va a DGI)
//   07 / 08 → E-Ticket contado / crédito  → CFE 101
//   01 / 02 → E-Factura contado / crédito → CFE 111 (exige RUT del cliente)
const TIPOS_DOC_VENDEDOR = [
  { value: '40', label: 'Pedido Caja' },
  { value: '07', label: 'E-Ticket Contado -> 101' },
  { value: '08', label: 'E-Ticket Crédito -> 101' },
  { value: '01', label: 'E-Factura Contado -> 111' },
  { value: '02', label: 'E-Factura Crédito -> 111' },
];

// Los que dejan la venta a crédito (sin cobro en el momento).
const TIPOS_CREDITO = ['02', '08'];

const ROTULO_TIPO_DOC = {
  '40': 'Pedido Caja',
  '07': 'E-Ticket', '08': 'E-Ticket',
  '01': 'E-Factura', '02': 'E-Factura',
};

// Esta es una CAJA ADMINISTRATIVA: no se maneja plata en mano. Todo cobro entra por un
// medio con respaldo (transferencia, cheque, débito…) y por eso se exige el comprobante.
// En MetodosPagos el efectivo se llama "Contado" (MPaIdMetodoPago = 1), así que se saca
// de la lista para que no se pueda elegir por error.
const esPagoEnEfectivo = (m) =>
  Number(m?.MPaIdMetodoPago) === 1 || /^\s*contado\s*$|efectivo|cash/i.test(m?.MPaDescripcionMetodo || '');

// El comprobante se exige SOLO en transferencia, que es la que deja un papel del banco.
// Débito, crédito, Mercado Pago y demás ya quedan registrados por su propio medio; pedirles
// un adjunto trababa la venta sin que hubiera nada que adjuntar.
const requiereComprobante = (m) => /transfer/i.test(m?.MPaDescripcionMetodo || '');

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VentaRolloAdelantoPage() {
  const [metodosPago, setMetodosPago] = useState([]);
  const [cotizacion, setCotizacion]   = useState(null);
  const [procesando, setProcesando]   = useState(false);

  // Pago — fijado a Transferencia / Pedido Caja / Contado
  const [pagos, setPagos]   = useState([{ id: Date.now(), metodoPagoId: '', moneda: 'UYU', monedaId: 1, monto: '' }]);
  const [tipoDoc, setTipoDoc]   = useState('40');
  // 'CONTADO' | 'CREDITO'. En Pedido Caja ('40') el código es el mismo para ambos, así que
  // la condición se lleva aparte; en los CFE la define el propio tipo (08/02 = crédito).
  const [condicion, setCondicion] = useState('CONTADO');
  const esVentaCredito = TIPOS_CREDITO.includes(tipoDoc) || condicion === 'CREDITO';

  const [serieDoc, setSerieDoc] = useState('A');
  const [obs, setObs]           = useState('');
  const [totalACubrir, setTotalACubrir] = useState(0);
  const [moneda, setMoneda]     = useState('UYU');

  // Cliente elegido (lo levanta CajaVentaDirectaTab) y umbral DGI, para validar el receptor
  // igual que la Facturación Manual: el documento del CFE sale de la ficha del cliente.
  const [clienteSel, setClienteSel] = useState(null);
  const [dgiConfig, setDgiConfig]   = useState({ limiteUI: 10000, valorUI: 6.5321 });
  // Datos del receptor editables en el comprobante (bloque "Datos DGI"), igual que la
  // Facturación Manual. Se validan contra la ficha por defecto, pero se pueden editar acá.
  const [datosDgi, setDatosDgi] = useState(DATOS_DGI_VACIO);

  // Estado DGI del comprobante: valida el documento de la ficha del cliente contra el tipo
  // elegido (e-Factura exige RUT; e-Ticket sobre el umbral exige identificar). El CFE toma el
  // documento de la ficha, así que lo que se valida acá es exactamente lo que se emitirá.
  const totalUYU = moneda === 'USD' ? totalACubrir * (cotizacion || 40) : totalACubrir;
  // Se valida el documento del bloque editable; si está vacío, cae al de la ficha.
  const documentoReceptor = String(datosDgi.documento || '').trim() || clienteSel?.CioRuc || '';
  const dgiEstado = evaluarDocumentoDGI({
    tipoDoc,
    documento: documentoReceptor,
    totalUYU,
    umbralUYU: dgiConfig.limiteUI * dgiConfig.valorUI,
  });
  // Solo importa mostrarlo/bloquear cuando el comprobante va a DGI (e-Ticket / e-Factura).
  const esComprobanteFiscal = ['01', '02', '07', '08'].includes(tipoDoc);

  // Comprobante obligatorio
  const [fileComprobante, setFileComprobante] = useState(null);
  const [comprobanteError, setComprobanteError] = useState(false);
  const [numDocActual, setNumDocActual] = useState('...');
  const fileInputRef = useRef(null);

  useEffect(() => {
    const fetchInit = async () => {
      try {
        const [rMet, rCot, rDgi] = await Promise.allSettled([
          api.get('/apipagos/metodos'),
          api.get('/apicotizaciones/hoy'),
          api.get('/contabilidad/cfe/config-dgi').catch(() => null),
        ]);
        if (rDgi.status === 'fulfilled' && rDgi.value?.data?.success) {
          setDgiConfig({
            limiteUI: Number(rDgi.value.data.limiteUI) || 10000,
            valorUI:  Number(rDgi.value.data.valorUI) || 6.5321,
          });
        }
        if (rMet.status === 'fulfilled') {
          const todos = rMet.value.data?.data || rMet.value.data || [];
          const methods = todos.filter(m => !esPagoEnEfectivo(m));
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
    setDatosDgi(DATOS_DGI_VACIO);
    if (fileInputRef.current) fileInputRef.current.value = '';
    document.dispatchEvent(new CustomEvent('caja:limpiarVenta'));
  };

  const handleConfirmar = async (payload) => {
    if (!payload.header.clienteId) { toast.warning('Debe seleccionar un cliente.'); return; }
    if (!payload.items.every(i => i.codigo && i.precioTotal && i.cantidad)) {
      toast.warning('Complete todos los campos de los ítems.'); return;
    }
    // Requisitos DGI del receptor (e-Factura exige RUT; e-Ticket sobre el umbral, identificar).
    // Se valida acá y no se procesa si no cumple: emitir un CFE mal formado lo rechaza DGI.
    if (esComprobanteFiscal && !dgiEstado.ok) {
      toast.error(dgiEstado.mensaje, { duration: 9000 });
      return;
    }

    const pagosFilt = pagos.filter(p => p.monto && p.metodoPagoId);
    // En una venta a CRÉDITO no hay cobro en el momento: la deuda queda en la cuenta del
    // cliente. Por eso ni el pago ni el comprobante se exigen — solo cuando es contado.
    if (!esVentaCredito) {
      if (pagosFilt.length === 0 && totalACubrir > 0) {
        toast.warning('Ingrese el monto del pago antes de procesar.'); return;
      }
      // El adjunto solo se pide si alguno de los pagos entró por transferencia.
      const hayTransferencia = pagosFilt.some(p =>
        requiereComprobante(metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId)))
      );
      if (hayTransferencia && !fileComprobante) {
        setComprobanteError(true);
        toast.error('Debe adjuntar el comprobante de la transferencia para continuar.');
        return;
      }
    }

    setProcesando(true);
    try {
      // 1. Subir comprobante (solo si hay: a crédito no se cobra nada todavía)
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
          console.warn('Error subiendo comprobante:', e);
          toast.error('No se pudo subir el comprobante. Intente nuevamente.');
          setProcesando(false);
          return;
        }
      }

      // 2. Procesar venta
      const ventaPayload = {
        ...payload,
        header: {
          ...payload.header,
          admin: true,
          esCredito: esVentaCredito,
          // Datos del receptor editados en el bloque DGI. Solo se mandan para comprobantes
          // fiscales; en Pedido Caja no aplican. Vacío → el CFE los toma de la ficha.
          ...(esComprobanteFiscal ? {
            docCliNombre: datosDgi.nombre || null,
            docCliNombreFantasia: datosDgi.nombreFantasia || null,
            docCliDocumento: datosDgi.documento || null,
            docCliDireccion: datosDgi.direccion || null,
            docCliCiudad: datosDgi.ciudad || null,
          } : {}),
        },
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
              {ROTULO_TIPO_DOC[tipoDoc] || 'Comprobante'} · {esVentaCredito ? 'Crédito' : 'Contado'}
              {esVentaCredito ? ' · Queda en cuenta corriente' : ' · Sin efectivo'}
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
            disabledExtra={procesando || (esComprobanteFiscal && !dgiEstado.ok)}
            // Antes iba locked: el tipo de comprobante estaba fijado a Pedido Caja y no se
            // podía elegir. Ahora se elige tipo y condición, igual que en la caja.
            locked={false}
            condicion={condicion}
            onCondicionChange={setCondicion}
            onNumDocPredict={setNumDocActual}
            comprobanteFile={fileComprobante}
            onComprobanteFile={(f) => { setFileComprobante(f); setComprobanteError(false); }}
            comprobanteError={comprobanteError}
            comprobanteRef={fileInputRef}
          />
        </div>

        {/* ── Formulario de venta — el bloque DGI va DEBAJO del cliente, vía slot del tab ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ minHeight: '620px' }}>
          <CajaVentaDirectaTab
            allowedTipos={['RECURSO']}
            debajoCliente={esComprobanteFiscal ? (
              <div className="flex flex-col gap-3">
                <div className={`rounded-xl border px-3 py-2 flex items-start gap-2 text-[11px] font-bold ${
                  dgiEstado.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                  <span className="text-sm leading-none">{dgiEstado.ok ? '✓' : '✗'}</span>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-70">
                      Requisito DGI — {ROTULO_TIPO_DOC[tipoDoc]}
                    </span>
                    <span className="leading-snug">{dgiEstado.mensaje || (clienteSel ? '' : 'Seleccioná el cliente para verificar el documento.')}</span>
                  </div>
                </div>
                <DatosDgiComprobante
                  value={datosDgi}
                  onChange={setDatosDgi}
                  cliente={clienteSel}
                  tipoDoc={tipoDoc}
                  totalUYU={totalUYU}
                  umbralUYU={dgiConfig.limiteUI * dgiConfig.valorUI}
                />
              </div>
            ) : null}
            metodosPago={metodosPago}
            cotizacion={cotizacion}
            tiposDocDisponibles={TIPOS_DOC_VENDEDOR}
            isAdminCaja={true}
            onVentaExitosa={() => {}}
            onClienteChange={(c) => {
              setClienteSel(c);
              // Al elegir cliente, precargar sus datos en el bloque DGI (editables después).
              if (c) {
                setDatosDgi({
                  nombre: c.Nombre || c.NombreFantasia || '',
                  nombreFantasia: '',
                  documento: c.CioRuc || '',
                  direccion: c.DireccionTrabajo || '',
                  ciudad: c.Ciudad || c.Departamento || '',
                });
              } else {
                setDatosDgi(DATOS_DGI_VACIO);
              }
            }}
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
