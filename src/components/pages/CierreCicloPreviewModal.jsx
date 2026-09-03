import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, RefreshCw, Edit3, DollarSign, Percent, ShoppingBag, Receipt, Building2, Pen } from 'lucide-react';
import api from '../../services/api';
// sonner: es el Toaster montado globalmente (MainAppContent). Con react-hot-toast los avisos
// de esta pantalla (ej. "Error al facturar") NO se mostraban: no hay Toaster de esa librería.
import { toast } from 'sonner';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';
import { useEmpresas } from '../../hooks/useEmpresas';
import { validarDocumentoUY } from '../../utils/documentoUY';
import { fmtFecha, porFechaDesc } from '../../utils/fechas';
// Paso 2 CONTADO: mismo panel de medios de pago que usa toda la caja
import CajaPanelPago from './CajaPanelPago';
import { codigoCuenta } from '../../utils/cuentaCodigo';

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
  const [cotFecha, setCotFecha] = useState(null);   // fecha de la cotización usada (para mostrarla)
  
  // Descuento Global
  const [descTipo, setDescTipo] = useState('%'); // '%' o '$'
  const [descValor, setDescValor] = useState(0);

  // Tipo Documento
  const tieneRUT = cliente?.CioRuc && String(cliente.CioRuc).replace(/\D/g, '').length === 12;
  const isAnticipo = ciclo?.CicIdCiclo === 'ANTICIPO';
  const [docType, setDocType] = useState(tieneRUT ? 'E-FACTURA' : 'E-TICKET');
  const [docCond, setDocCond] = useState(isAnticipo ? 'CONTADO' : 'CREDITO');

  // 'Pedidos Caja' es el MISMO texto que usa la caja (Config_TiposDocumento.Detalle del
  // CodDocumento 40) y es el que el backend busca para numerar con la serie PC-.
  // Antes acá decía 'E-TICKET CONTADO': elegir "Pedido Caja" emitía un e-Ticket con
  // número ET- y, de paso, forzaba CONTADO ignorando lo elegido en el paso 2 (reporte
  // Gerardo Mazzoni, 01-09-2026).
  const tipoDocumento = docType === 'FACTURA'
    ? 'FACTURA'
    : docType === 'PEDIDO_CAJA'
      ? 'Pedidos Caja'
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
  // Dos pasos, como las otras ventanas: 1) DOCUMENTO (tipo, datos DGI, líneas, descuento)
  // → 2) PAGO (contado/crédito y emisión). El paso 2 muestra el resumen de lo armado.
  const [paso, setPaso] = useState('documento'); // 'documento' | 'pago'
  // Paso 2 CONTADO: medios de pago (opcional — sin medios, la factura se cubre con el
  // saldo a favor del cliente o queda pendiente de cobro). Tras emitir, el cobro se
  // registra con el MISMO endpoint de Pago de Deudas de caja.
  const [metodosPago, setMetodosPago] = useState([]);
  const [pagosContado, setPagosContado] = useState([]);
  const [cuentasBilletera, setCuentasBilletera] = useState([]);
  // F2: simulación del consumo prepago del cierre (FIFO, órdenes enteras) —
  // qué órdenes cubre la billetera y cuáles van a factura. Se muestra en el paso 2.
  const [consumoPrev, setConsumoPrev] = useState(null);
  const [saldoPrincipal, setSaldoPrincipal] = useState({}); // { UYU: x, USD: y } saldo real de las principales
  // De qué cuenta sale el saldo a favor que cubre la factura: 'PRINCIPAL' (motor, como
  // siempre) o el CueIdCuenta de una cuenta libre — en ese caso, al emitir se transfiere
  // su saldo a la cuenta base del cierre y el cierre lo consume (la principal queda igual).
  const [cuentaCobertura, setCuentaCobertura] = useState('PRINCIPAL');
  useEffect(() => {
    if (paso !== 'pago' || metodosPago.length) return;
    api.get('/apipagos/metodos').then(r => {
      const mets = Array.isArray(r.data) ? r.data : [];
      setMetodosPago(mets);
      setPagosContado(p => p.length ? p : [{ id: Date.now(), metodoPagoId: mets[0]?.MPaIdMetodoPago || '', moneda: monedaFactura === 'USD' ? 'USD' : 'UYU', monedaId: monedaFactura === 'USD' ? 2 : 1, monto: '' }]);
    }).catch(() => {});
    api.get(`/contabilidad/cuentas/${cliente?.CliIdCliente}`).then(r => {
      const todas = (r.data?.data || []).filter(c => String(c.CueTipo || '').startsWith('DINERO'));
      // Solo cuentas de ANTICIPO libres pueden pagar documentos (regla de la billetera)
      setCuentasBilletera(todas.filter(c =>
        !c.CueEsPrincipal && !c.CueRestringida
        && (c.CueModalidadFiscal || 'ANTICIPO_A_FACTURAR') !== 'PREPAGO_FACTURADO' && c.CueActiva !== false));
      // Saldo real de las principales: el cierre lo aplica SOLO a la factura antes que nada
      const sp = {};
      todas.filter(c => c.CueEsPrincipal).forEach(c => { sp[c.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU'] = Number(c.CueSaldoActual || 0); });
      setSaldoPrincipal(sp);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso]);

  // F2: simular el consumo prepago del cierre (FIFO, órdenes ENTERAS) con los importes
  // FINALES por orden — los mismos que irían a la factura. Corre TAMBIÉN en el paso 1
  // (02/09, pedido del usuario): si la billetera cubre TODO, el paso 1 esconde tipo de
  // comprobante / datos DGI y no valida nada fiscal (se cierra SIN factura). Se refresca
  // al cambiar selección, precios o moneda, con un pequeño debounce.
  useEffect(() => {
    if (!cliente?.CliIdCliente) { setConsumoPrev(null); return; }
    const t = setTimeout(() => {
      try {
        const porOrden = new Map();
        for (const d of getDetallesParaPDF()) {
          const cod = String(d.OrdCodigoOrden || '').trim();
          if (!cod) continue;
          porOrden.set(cod, (porOrden.get(cod) || 0) + Number(d.DcdSubtotal || 0));
        }
        const ordenesSim = Array.from(porOrden.entries()).map(([codigo, importe]) => ({ codigo, importe }));
        if (!ordenesSim.length) { setConsumoPrev(null); return; }
        api.post(`/contabilidad/clientes/${cliente.CliIdCliente}/preview-consumo-prepago`, {
          ordenes: ordenesSim,
          monedaCicloId: monedaFactura === 'USD' ? 2 : 1,
          cotDolar,
        }).then(r => setConsumoPrev(r.data?.data || null)).catch(() => setConsumoPrev(null));
      } catch { setConsumoPrev(null); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, excluidos, detallesEditados, monedaFactura, cotDolar, movs]);
  const todoCubiertoPorPrepago = !!(consumoPrev && consumoPrev.cubiertas?.length && (consumoPrev.aFactura?.length || 0) === 0);


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
    // Órdenes de más nueva a más vieja. Manda la fecha de ENTREGA (depósito); si la orden
    // no se marcó entregada cae a la de ingreso, así ninguna queda huérfana al fondo.
    list.sort(porFechaDesc(m => m.OrdFechaEntrega || m.OrdFechaIngreso || m.MovFecha));
    setMovs(list);

    // Moneda del comprobante:
    //   · Órdenes de UNA sola moneda → la que traen las líneas (comportamiento de siempre).
    //   · Órdenes MEZCLADAS (pesos + dólares en el mismo comprobante) → SIEMPRE dólares.
    //     Es la moneda en la que se cotiza el trabajo; el botón USD/UYU queda igual por si
    //     en algún caso se quiere emitir en pesos.
    const monedasMovs = new Set(
      list.map(m => (Number(m.MovMonIdMoneda ?? cuenta?.MonIdMoneda) === 1 ? 'UYU' : 'USD'))
    );
    if (monedasMovs.size > 1) {
      setMonedaFactura('USD');
    } else if (primeraMoneda) {
      setMonedaFactura(primeraMoneda);
    }

    // Cotización del día. OJO con las claves: el endpoint devuelve
    // { fecha, compra, venta, promedio } — NO CotDolar. Al pedir res.data.data.CotDolar
    // salía undefined y caía siempre en el 40 fijo, así que ningún cierre cross-moneda
    // usaba el tipo de cambio real (hoy 40,85).
    api.get('/contabilidad/cotizacion-hoy').then(res => {
      const d = res.data?.data;
      const tc = Number(d?.promedio ?? d?.venta ?? d?.compra ?? d?.CotDolar);
      if (tc > 0) { setCotDolar(tc); setCotFecha(d?.fecha || null); }
    }).catch(() => {});
  }, [movsOriginales]);

  // Moneda BASE de cada movimiento (1=UYU, 2=USD).
  // Por defecto es la de la cuenta del ciclo — comportamiento histórico, una cuenta = una moneda.
  // Si el llamador manda MovMonIdMoneda en el movimiento (pre-factura multimoneda del Panel 360,
  // que junta órdenes en pesos y en dólares en un solo comprobante), manda la del movimiento.
  const monIdBaseMov = (m) => Number(m?.MovMonIdMoneda ?? cuenta?.MonIdMoneda);
  // ¿Hay órdenes de más de una moneda en esta pre-factura? (para avisarlo en pantalla)
  const monedasBase = Array.from(new Set(movs.map(m => (monIdBaseMov(m) === 1 ? 'UYU' : 'USD'))));
  const esMultimoneda = monedasBase.length > 1;

  // ── Moneda del importe CONGELADO de un detalle (criterio ÚNICO, 01/09/2026) ──
  // El número que se suma/muestra es el subtotal congelado en PedidosCobranza, así
  // que manda SU moneda (d.Moneda). Si el pedido no la trae: la moneda explícita de
  // la orden, y como último recurso la de la cuenta del movimiento. Sin esto, una
  // orden en PESOS cuyo movimiento fue trasladado a la cuenta USD (pre-factura
  // multimoneda) se sumaba como si fueran dólares — caso Puntogyf EUV-17592: $152
  // mostrados como US$ 152 → el guard anti-descuadre frenaba la emisión (146,14 vs 294,42).
  const monedaDetalle = (m, d) =>
    d?.Moneda === 'USD' ? 'USD'
      : d?.Moneda === 'UYU' ? 'UYU'
        : Number(m?.OrdMonIdMoneda) === 2 ? 'USD'
          : Number(m?.OrdMonIdMoneda) === 1 ? 'UYU'
            : (monIdBaseMov(m) === 1 ? 'UYU' : 'USD');
  // Factor para llevar ese importe a la moneda del comprobante elegida
  const rateDetalle = (m, d) => {
    const monBase = monedaDetalle(m, d);
    return (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar
      : (monedaFactura === 'USD' && monBase === 'UYU') ? (1 / cotDolar) : 1;
  };
  // Todo importe convertido se genera a 2 decimales (152/40,86 = 3,72, no 3,7199…):
  // el mismo número en la fila, en el subtotal y en la línea de la factura.
  const r2conv = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

        // Moneda del congelado (d.Moneda) primero — ver monedaDetalle
        const rate = rateDetalle(m, d);

        granTotalBase += r2conv(sub * rate);
      });
    } else {
      // Si no hay detalle, usamos el movimiento total
      let imp = Math.abs(m.MovImporte);
      const monBase = monIdBaseMov(m) === 1 ? 'UYU' : 'USD';
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

  // Cobertura estimada siguiendo el MOTOR: 1º el saldo a favor de la PRINCIPAL (lo aplica
  // el cierre solo, antes que nada), 2º las cuentas de saldo libres en la prioridad del
  // motor (⚡ automáticas primero, la más vieja primero), cada una hasta su saldo (sin negativo).
  const principalAFavor = Math.max(0, Number(saldoPrincipal[monedaFactura] || 0));
  const cubiertoPorPrincipal = Math.min(principalAFavor, granTotalNeto);
  const restanteTrasPrincipal = Math.max(0, granTotalNeto - cubiertoPorPrincipal);
  // Cobertura desde OTRA cuenta elegida (en vez de la principal): su saldo, convertido a
  // la moneda de la factura, cubre primero; la principal solo el resto que falte.
  const cuentaElegida = cuentaCobertura !== 'PRINCIPAL'
    ? cuentasBilletera.find(c => String(c.CueIdCuenta) === String(cuentaCobertura)) || null
    : null;
  const saldoElegidaFactura = cuentaElegida
    ? ((cuentaElegida.CueTipo === 'DINERO_USD') === (monedaFactura === 'USD')
        ? Number(cuentaElegida.CueSaldoActual || 0)
        : (cuentaElegida.CueTipo === 'DINERO_USD'
            ? Number(cuentaElegida.CueSaldoActual || 0) * cotDolar
            : Number(cuentaElegida.CueSaldoActual || 0) / cotDolar))
    : 0;
  const cubreElegida = cuentaElegida ? Math.min(Math.max(0, saldoElegidaFactura), granTotalNeto) : 0;
  const cubrePrincipalFinal = cuentaElegida
    ? Math.min(principalAFavor, Math.max(0, granTotalNeto - cubreElegida))
    : cubiertoPorPrincipal;
  const restaCobrarFinal = Math.max(0, granTotalNeto - cubreElegida - cubrePrincipalFinal);
  const sugerirSaldosCuentas = () => {
    const metodoSaldo = metodosPago.find(m => /saldo de cuenta/i.test(m.MPaDescripcionMetodo || ''));
    if (!metodoSaldo) { toast.error('Falta el medio de pago "Saldo de cuenta" (corré el script SQL de billetera).'); return; }
    let falta = restaCobrarFinal;
    if (falta <= 0.01) { toast.info('El saldo a favor elegido ya cubre toda la factura: no hace falta cobrar nada.'); return; }
    const lineas = [];
    const orden = cuentasBilletera
      .filter(c => Number(c.CueSaldoActual || 0) > 0.01 && String(c.CueIdCuenta) !== String(cuentaCobertura))
      .sort((a, b) => Number(b.CueAutoConsumo || 0) - Number(a.CueAutoConsumo || 0) || a.CueIdCuenta - b.CueIdCuenta);
    for (const c of orden) {
      if (falta <= 0.01) break;
      const monCta = c.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';
      // "falta" está en la moneda de la factura → convertir a la moneda de la cuenta
      const faltaEnCta = monCta === monedaFactura ? falta : (monCta === 'USD' ? falta / cotDolar : falta * cotDolar);
      const usar = Math.min(Number(c.CueSaldoActual), faltaEnCta);
      if (usar <= 0.01) continue;
      lineas.push({
        id: Date.now() + lineas.length,
        metodoPagoId: metodoSaldo.MPaIdMetodoPago,
        moneda: monCta, monedaId: monCta === 'USD' ? 2 : 1,
        monto: usar.toFixed(2), cueIdCuenta: c.CueIdCuenta,
      });
      falta -= monCta === monedaFactura ? usar : (monCta === 'USD' ? usar * cotDolar : usar / cotDolar);
    }
    if (!lineas.length) { toast.info('Ninguna cuenta de saldo del cliente tiene plata disponible: cobrá el resto con otro medio.'); return; }
    setPagosContado(lineas);
    toast.success(`${lineas.length} cuenta(s) aplicadas siguiendo la prioridad del motor${falta > 0.01 ? ` — quedan ${simbolo} ${fmt(falta)} para cobrar con otro medio (agregalo en el panel)` : ''}.`, { duration: 8000 });
  };

  const totalUYU = monedaFactura === 'UYU' ? granTotalNeto : granTotalNeto * cotDolar;
  // Pedido Caja es borrador interno (no fiscal) → nunca exige datos DGI
  const requiereDatosDGI = docType !== 'PEDIDO_CAJA' && tipoDocumento.includes('TICKET') && totalUYU > DGI_UMBRAL_UYU;
  // Nombre/Documento/Dirección/Ciudad son obligatorios solo cuando DGI los exige:
  // e-Factura siempre (necesita RUT del receptor), e-Ticket solo si supera el umbral.
  // Pedido Caja nunca los exige (borrador interno, no fiscal).
  // 🔋 Si la billetera prepaga cubre TODAS las órdenes, el cierre NO emite factura:
  // no aplican datos DGI ni tipo de comprobante (02/09, pedido del usuario).
  const requiereDatosComprobante = !todoCubiertoPorPrepago && (docType === 'E-FACTURA' || requiereDatosDGI);

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
          listFresca.sort(porFechaDesc(m => m.OrdFechaEntrega || m.OrdFechaIngreso || m.MovFecha));
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
    
    // Nombre/Documento/Dirección/Ciudad solo son obligatorios cuando DGI los exige
    if (requiereDatosComprobante && (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion || !cliDgiCiudad)) {
      setValError('Todos los datos del comprobante (Nombre, Documento, Dirección y Ciudad) son obligatorios para continuar.');
      setWorking(false);
      return;
    }

    // Validación de longitud y formato numérico (solo si se cargó un documento)
    const docLimpio = String(cliDgiDocumento).replace(/\s/g, '');
    if (docLimpio && !/^\d+$/.test(docLimpio)) {
      setValError('El documento debe contener únicamente números.');
      setWorking(false);
      return;
    }

    // Validación estructural del documento (RUT/CI con dígito verificador)
    // Pedido Caja es borrador interno (no fiscal): NO se valida contra reglas DGI.
    // 🔋 Billetera cubre todo → no hay factura → tampoco se valida nada fiscal.
    if (docType !== 'PEDIDO_CAJA' && !todoCubiertoPorPrepago) {
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

    // Medios del CONTADO (paso 2): validar ANTES de emitir — después no hay vuelta atrás.
    // Factura cubierta entera por el saldo a favor → los medios se IGNORAN (el panel ya
    // está bloqueado en pantalla; esto es el candado de atrás por si quedó algo cargado).
    const pagosValidosContado = (docType !== 'FACTURA' && docCond === 'CONTADO' && restaCobrarFinal > 0.01)
      ? pagosContado.filter(p => parseFloat(p.monto) > 0 && p.metodoPagoId)
      : [];
    const pagoSaldoSinCuenta = pagosValidosContado.find(p =>
      /saldo de cuenta/i.test(metodosPago.find(m => m.MPaIdMetodoPago === parseInt(p.metodoPagoId))?.MPaDescripcionMetodo || '') && !p.cueIdCuenta);
    if (pagoSaldoSinCuenta) {
      toast.error('El medio "Saldo de cuenta" necesita que elijas DE QUÉ CUENTA sale la plata (debajo del medio).');
      setWorking(false);
      return;
    }
    // Billetera: ninguna línea puede superar el saldo de su cuenta — como medio de pago
    // el saldo nunca deja la cuenta en negativo (el negativo es solo del motor automático)
    for (const p of pagosValidosContado) {
      if (!p.cueIdCuenta) continue;
      const ctaLinea = cuentasBilletera.find(c => c.CueIdCuenta === parseInt(p.cueIdCuenta));
      if (!ctaLinea) continue;
      if ((parseFloat(p.monto) || 0) > Number(ctaLinea.CueSaldoActual || 0) + 0.001) {
        toast.error(`"${ctaLinea.CueNombre || 'La cuenta'}" solo tiene ${ctaLinea.CueTipo === 'DINERO_USD' ? 'US$' : '$'} ${Number(ctaLinea.CueSaldoActual || 0).toFixed(2)}: bajá el monto de esa línea o usá otro medio. No se emitió nada.`);
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
        // Cuenta base del cierre. Con órdenes de varias monedas en la misma pre-factura,
        // el backend arrastra las de las otras cuentas a ésta (convertidas con cotDolar)
        // para que TODAS queden facturadas por este documento y ninguna se cobre dos veces.
        cueIdCuentaFactura: cuenta?.CueIdCuenta ?? null,
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

      // ── PAGO desde OTRA cuenta (no la principal): el saldo de la elegida pasa a la
      // cuenta del cierre ANTES de emitir y el motor lo consume como cobertura. Neto:
      // la principal queda igual y la cuenta elegida baja. En su libro queda como
      // "Pago con saldo — facturación de …" y, tras emitir, se vincula la factura.
      // Si este paso falla, NO se emite nada.
      let refPagoSaldo = null;
      if (cuentaElegida && docType !== 'FACTURA' && docCond === 'CONTADO') {
        const monCta = cuentaElegida.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';
        const totalEnCta = monCta === monedaFactura ? granTotalNeto : (monCta === 'USD' ? granTotalNeto / cotDolar : granTotalNeto * cotDolar);
        const importeOrigen = Math.round(Math.min(Number(cuentaElegida.CueSaldoActual || 0), totalEnCta) * 100) / 100;
        if (importeOrigen <= 0.01) {
          toast.error(`La cuenta ${codigoCuenta(cuentaElegida)} no tiene saldo disponible para pagar la factura. No se emitió nada.`);
          setWorking(false);
          return;
        }
        const monBase = Number(cuenta?.MonIdMoneda) === 2 ? 'USD' : 'UYU';
        const codsInc = movs.filter(m => !excluidos.has(m.MovIdMovimiento)).map(m => m.OrdCodigoOrden).filter(Boolean);
        const codsTxt = codsInc.slice(0, 3).join(', ') + (codsInc.length > 3 ? ` y ${codsInc.length - 3} más` : '');
        try {
          const trf = await api.post('/contabilidad/cuentas/transferir', {
            CueOrigen: cuentaElegida.CueIdCuenta,
            CueDestino: cuenta.CueIdCuenta,
            Importe: importeOrigen,
            Cotizacion: monCta === monBase ? null : cotDolar,
            ConceptoOrigen: `Pago con saldo — facturación de ${codsTxt || 'órdenes'}`,
            ConceptoDestino: `Pago recibido de ${codigoCuenta(cuentaElegida)} "${cuentaElegida.CueNombre || ''}" para facturación de ${codsTxt || 'órdenes'}`,
            Observaciones: `Pago de pre-factura con el saldo de ${codigoCuenta(cuentaElegida)}: el importe cubre la factura al emitirse (la principal no se toca)`,
          });
          refPagoSaldo = trf.data?.data?.referencia || null;
        } catch (trfErr) {
          toast.error(`No se pudo usar el saldo de ${codigoCuenta(cuentaElegida)}: ${trfErr.response?.data?.error || trfErr.message}. NO se emitió nada.`, { duration: 15000 });
          setWorking(false);
          return;
        }
      }

      const emision = await onConfirm(ciclo.CicIdCiclo, payload);

      // F2: informar qué descontó la billetera prepaga en el cierre
      if (emision?.consumoPrepago?.cubiertas?.length) {
        const cp = emision.consumoPrepago;
        toast.success(
          `Billetera prepaga: ${cp.cubiertas.length} orden(es) descontadas por ${simbolo} ${fmt(cp.totalCubierto)}${
            cp.aFactura?.length ? ` — la factura salió solo por el resto (${simbolo} ${fmt(cp.totalFactura)}).` : ' — ciclo cerrado SIN factura.'}`,
          { duration: 12000 },
        );
      }

      // Alerta clara cuando la factura salió pagada con el saldo a favor (sin medios)
      if (docType !== 'FACTURA' && docCond === 'CONTADO' && restaCobrarFinal <= 0.01) {
        toast.success(
          `Factura ${emision?.docNumero || ''} emitida y PAGADA con el saldo a favor del cliente${cuentaElegida ? ` (desde ${codigoCuenta(cuentaElegida)} "${cuentaElegida.CueNombre || ''}")` : ' (cuenta principal)'} — no se cobró ningún medio de pago.`,
          { duration: 12000 },
        );
      }

      // Vincular la factura recién emitida al pago con saldo (best-effort: si falla,
      // el movimiento queda igual de válido, solo sin el número de documento).
      if (refPagoSaldo) {
        const docIdEmit = emision?.DocIdDocumento || emision?.data?.DocIdDocumento || null;
        if (docIdEmit) {
          try { await api.post('/contabilidad/cuentas/transferencias/vincular-doc', { referencia: refPagoSaldo, DocIdDocumento: docIdEmit }); } catch { /* no bloquea */ }
        }
      }

      // ── Cobro CONTADO con medios: reusa el MISMO flujo de Pago de Deudas de caja ──
      // La factura YA salió: si el cobro falla, se avisa el camino manual (no se aborta).
      if (pagosValidosContado.length) {
        const docIdEmitido = emision?.DocIdDocumento || emision?.data?.DocIdDocumento || null;
        try {
          if (!docIdEmitido) throw new Error('la emisión no devolvió el número interno del documento');
          const dv = await api.get(`/contabilidad/clientes/${cliente.CliIdCliente}/deudas-vivas`);
          const deuda = (dv.data?.data || []).find(d => Number(d.DocIdDocumento) === Number(docIdEmitido));
          if (!deuda) {
            toast.info('La factura quedó cubierta con el saldo a favor del cliente: no había nada para cobrar, así que los medios de pago NO se usaron.', { duration: 12000 });
          } else {
            await api.post('/contabilidad/caja/pago-deuda', {
              empresaId: empresaSeleccionada?.EmpIdEmpresa ?? empresaSeleccionada?.EmpId ?? null,
              header: {
                clienteId: cliente.CliIdCliente,
                tipoDocumento: '05',
                serieDoc: 'A',
                moneda: monedaFactura,
                monedaId: monedaFactura === 'USD' ? 2 : 1,
                cotizacionTC: cotDolar,
                permitirExcedente: true,
                observaciones: `Cobro contado de ${emision?.docNumero || `doc #${docIdEmitido}`} (pre-factura)`,
                admin: true,
              },
              aplicaciones: [{
                tipo: 'PAGO_DEUDA',
                codigoRef: emision?.docNumero || `Doc #${docIdEmitido}`,
                descripcion: emision?.docNumero || 'Factura recién emitida',
                montoOriginal: Number(deuda.DDeImportePendiente),
                ddeId: deuda.DDeIdDocumento,
                docIdDocumento: docIdEmitido,
                ordIdOrden: null,
              }],
              pagos: pagosValidosContado.map(p => {
                const monId = p.moneda === 'USD' ? 2 : (p.moneda === 'UYU' ? 1 : (parseInt(p.monedaId, 10) || 1));
                return {
                  metodoPagoId: parseInt(p.metodoPagoId, 10),
                  monedaId: monId,
                  montoOriginal: parseFloat(p.monto),
                  cotizacion: monId === 2 ? cotDolar : 1,
                  idCheque: p.idCheque || null,
                  cueIdCuenta: p.cueIdCuenta || null,
                };
              }),
            });
            toast.success(`Factura ${emision?.docNumero || ''} emitida y cobrada al contado.`);
          }
        } catch (cobroErr) {
          toast.error(`La factura SE EMITIÓ bien, pero el cobro contado NO se registró: ${cobroErr.response?.data?.error || cobroErr.message}. Cobrala desde caja por "Pago de Deudas" (la deuda quedó viva).`, { duration: 20000 });
        }
      }

      onClose();
    } catch (err) {
      setPaso('documento'); // si el backend rechazó, volver al paso 1 para corregir
      // Mostrar el motivo REAL del backend (err.message de axios es solo "status code 500")
      toast.error('No se generó la factura: ' + (err.response?.data?.error || err.response?.data?.message || err.message), { duration: 15000 });
    } finally {
      setWorking(false);
    }
  };

  const handleUpdateClient = async () => {
    setWorking(true);
    setValError('');
    try {
      if (requiereDatosComprobante && (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion || !cliDgiCiudad)) {
        setValError('Todos los datos del comprobante son obligatorios para actualizar el cliente.');
        setWorking(false);
        return;
      }

      const docLimpio = String(cliDgiDocumento).replace(/\s/g, '');
      if (docLimpio && !/^\d+$/.test(docLimpio)) {
        setValError('El documento debe contener únicamente números.');
        setWorking(false);
        return;
      }

      if (docLimpio && tipoDocumento.includes('TICKET')) {
        if (docLimpio.length !== 8) {
          setValError('Para emitir un e-Ticket, la Cédula (CI) debe tener exactamente 8 dígitos.');
          setWorking(false);
          return;
        }
      } else if (docLimpio && tipoDocumento.includes('FACTURA')) {
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
      toast.error('Error al actualizar cliente: ' + (err.response?.data?.error || err.message));
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
          detallesFiltrados.forEach(d => {
            const ed = detallesEditados[d.DetalleID];
            const sub = ed ? ed.Subtotal : d.Subtotal;
            // Criterio único: moneda del congelado (d.Moneda) > orden > cuenta — ver monedaDetalle
            const rate = rateDetalle(m, d);
            orderSubtotal += r2conv(sub * rate);
          });
          const urgenciaOrden = esOrdenUrgente(m) || detallesFiltrados.some(d => tieneRecargoUrgencia(d.LogPrecioAplicado));
          detallesParaPDF.push({
            OrdCodigoOrden: m.OrdCodigoOrden || null,
            DcdNomItem: `${m.OrdCodigoOrden || m.MovConcepto}`,
            DcdDscItem: `${m.OrdNombreTrabajo ? m.OrdNombreTrabajo : ''}${urgenciaOrden ? ' (Urgencia)' : ''}`,
            DcdCantidad: 1,
            DcdSubtotal: orderSubtotal
          });
        } else {
          let orderSubtotal = 0;

          detallesFiltrados.forEach(d => {
            const ed = detallesEditados[d.DetalleID];
            const sub = ed ? ed.Subtotal : d.Subtotal;

            // Criterio único: moneda del congelado (d.Moneda) > orden > cuenta — ver monedaDetalle
            const rate = rateDetalle(m, d);
            const finalSub = r2conv(sub * rate);
            // Usar precio y descuento editados (no el precio original de DB)
            const editedPrice = ed ? ed.PrecioUnitario : (d.PrecioUnitario || (d.Subtotal / d.Cantidad));
            const editedCant  = ed?.Cantidad ?? d.Cantidad;
            const editedDescPct = (ed && ed.DescTipo === '%') ? ed.DescValor : 0;
            const unitario = r2conv(editedPrice * rate);
            const descItem = r2conv(editedPrice * editedCant * (editedDescPct / 100) * rate);
            orderSubtotal += finalSub;

            const descArticulo = `${d.ArticuloNombre ? d.ArticuloNombre.trim() + ' - ' : ''}${(d.Descripcion || d.LogPrecioAplicado || 'Servicio').trim()}`;
            const descOrden = `${m.OrdCodigoOrden || m.MovConcepto}${m.OrdNombreTrabajo ? ` - ${m.OrdNombreTrabajo}` : ''}${(esOrdenUrgente(m) || tieneRecargoUrgencia(d.LogPrecioAplicado)) ? ' (Urgencia)' : ''}`;

            detallesParaPDF.push({
              OrdCodigoOrden: m.OrdCodigoOrden || null,
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
        const cuentaEsUSD2 = monIdBaseMov(m) !== 1;
        const esMovUSD = Number(m.OrdMonIdMoneda) === 2 || (m.OrdMonIdMoneda == null && cuentaEsUSD2);
        const monBase = esMovUSD ? 'USD' : 'UYU';
        const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
        const finalSub = r2conv(importe * rate);
        
        const sufijoUrgencia = esOrdenUrgente(m) ? ' (Urgencia)' : '';
        detallesParaPDF.push({
          OrdCodigoOrden: m.OrdCodigoOrden || null,
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
    // Nombre/Documento/Dirección/Ciudad solo son obligatorios cuando DGI los exige
    if (requiereDatosComprobante && (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion || !cliDgiCiudad)) {
      setValError('Todos los datos del comprobante (Nombre, Documento, Dirección y Ciudad) son obligatorios para continuar.');
      return;
    }

    // Validación de longitud y formato numérico (solo si se cargó un documento)
    const docLimpio = String(cliDgiDocumento).replace(/\s/g, '');
    if (docLimpio && !/^\d+$/.test(docLimpio)) {
      setValError('El documento debe contener únicamente números.');
      return;
    }

    if (docLimpio && tipoDocumento.includes('TICKET')) {
      if (docLimpio.length !== 8) {
        setValError('Para emitir un e-Ticket, la Cédula (CI) debe tener exactamente 8 dígitos.');
        return;
      }
    } else if (docLimpio && tipoDocumento.includes('FACTURA')) {
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

  // Paso 1 → 2: validación liviana antes de elegir el pago (handleFacturar revalida
  // TODO al emitir; esto solo evita llegar al paso 2 con el documento incompleto).
  const irAlPago = () => {
    if (movs.filter(m => !excluidos.has(m.MovIdMovimiento)).length === 0) {
      toast.error('No hay órdenes incluidas en el documento: marcá al menos una.');
      return;
    }
    if (requiereDatosComprobante && (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion)) {
      toast.error('Completá los Datos DGI del comprobante (nombre, documento y dirección) antes de continuar al pago.');
      return;
    }
    setPaso('pago');
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
              {/* Indicador de pasos: 1 Documento → 2 Pago */}
              <div className="flex items-center gap-1.5 mt-1.5">
                {[['documento', '1 · Documento'], ['pago', '2 · Pago']].map(([key, label], i) => (
                  <React.Fragment key={key}>
                    {i > 0 && <span className={pageMode ? 'text-indigo-300 text-[10px]' : 'text-slate-300 text-[10px]'}>→</span>}
                    <span className={`text-[9px] font-black uppercase tracking-widest rounded px-2 py-0.5 border ${
                      paso === key
                        ? (pageMode ? 'bg-white text-indigo-700 border-white' : 'bg-indigo-600 text-white border-indigo-600')
                        : (pageMode ? 'text-indigo-200 border-white/25' : 'text-slate-400 border-slate-200')
                    }`}>{label}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* En el paso 2 el documento queda fijo: los controles se ocultan */}
            {paso === 'documento' && (<>
            <div className="flex flex-col items-end gap-1.5">
              {/* FILA 1: Tipo de Documento — oculto si la billetera cubre TODO (no hay factura) */}
              {!todoCubiertoPorPrepago && (
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
              )}

              {/* La condición Contado/Crédito se elige en el PASO 2 (Pago) */}
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
            </>)}
            <button onClick={onClose} className={`p-2 rounded-full transition-colors ${pageMode ? 'hover:bg-white/20 text-white/80 hover:text-white' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'}`}>
              <X size={20} />
            </button>
          </div>
        </div>
        
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 flex flex-col gap-4">
          {paso === 'documento' ? (<>

          {/* Error de validación DGI */}
          {valError && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl shadow-sm text-sm font-medium flex items-center gap-2">
              <i className="fa-solid fa-triangle-exclamation"></i>
              {valError}
            </div>
          )}

          {/* Aviso multimoneda: la pre-factura junta órdenes en pesos y en dólares */}
          {esMultimoneda && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl shadow-sm text-[13px] font-medium flex items-start gap-2">
              <i className="fa-solid fa-money-bill-transfer mt-0.5"></i>
              <span>
                Esta pre-factura junta órdenes en <strong>pesos y en dólares</strong> en un solo comprobante.
                Todo se convierte a <strong>{monedaFactura === 'USD' ? 'dólares (US$)' : 'pesos ($U)'}</strong> con la
                cotización <strong>{cotDolar}</strong>
                {cotFecha ? ` (del ${new Date(cotFecha).toLocaleDateString('es-UY', { timeZone: 'UTC' })})` : ' (valor por defecto: no se pudo leer la cotización del día)'}
                {' '}— cambiá el botón USD/UYU de arriba si querés emitirlo en la otra moneda.
                Al facturar, las órdenes de las dos monedas quedan saldadas por este documento.
              </span>
            </div>
          )}

          {/* 🔋 Billetera cubre TODO: sin factura → sin comprobante, sin DGI, sin pago */}
          {todoCubiertoPorPrepago && (
            <div className="bg-cyan-50 border border-cyan-200 text-cyan-900 px-4 py-3 rounded-xl shadow-sm text-[13px] font-medium flex items-start gap-2">
              <span className="mt-0.5">🔋</span>
              <span>
                <strong>La billetera prepaga del cliente cubre TODAS las órdenes de esta pre-factura</strong> — el
                ciclo se cierra descontando del saldo, <strong>sin emitir factura</strong> (esa plata ya se facturó
                al cargarla). Por eso no hay que elegir tipo de comprobante, ni datos DGI, ni forma de pago.
                Al continuar vas a ver el desglose orden por orden antes de confirmar.
              </span>
            </div>
          )}

          {/* Requerimientos DGI — ocultos si la billetera cubre todo (no hay factura) */}
          {!todoCubiertoPorPrepago && (
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
          )}

          <div className="rounded-xl border border-slate-200 overflow-y-auto bg-white shadow-sm max-h-[45vh] scrollbar-thin scrollbar-thumb-slate-200">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 w-12 text-center">
                    {/* Check maestro: marca/desmarca TODAS las órdenes de una */}
                    <div className="flex flex-col items-center gap-1">
                      <input type="checkbox"
                        checked={movs.length > 0 && excluidos.size === 0}
                        ref={el => { if (el) el.indeterminate = excluidos.size > 0 && excluidos.size < movs.length; }}
                        onChange={e => setExcluidos(e.target.checked ? new Set() : new Set(movs.map(m => m.MovIdMovimiento)))}
                        title={excluidos.size === 0 ? 'Desmarcar todas las órdenes' : 'Marcar todas las órdenes'}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500 cursor-pointer" />
                      <span>Inc</span>
                    </div>
                  </th>
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
                  const fechaIngresoStr = fmtFecha(m.OrdFechaIngreso || m.MovFecha, '');
                  const fechaEntregaStr = fmtFecha(m.OrdFechaEntrega, '');

                  return (
                    <React.Fragment key={m.MovIdMovimiento}>
                      {/* Fila principal (Orden) */}
                      <tr className={`transition-colors ${isExcluido ? 'opacity-40 bg-slate-50' : 'hover:bg-slate-50/80'}`}>
                        <td className="px-4 py-3 text-center align-top pt-4">
                          <input type="checkbox" checked={!isExcluido} onChange={() => toggleExcluido(m.MovIdMovimiento)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500 cursor-pointer" />
                        </td>
                        <td colSpan={5} className="px-4 py-3 pb-2">
                          <span className="font-black text-slate-800 text-[13px]">{m.OrdNombreTrabajo || 'Sin descripción'}</span>
                          <span className="font-black text-indigo-600 text-[13px]"> — {m.OrdCodigoOrden || m.MovConcepto}</span>
                          <span className="text-[11px] font-medium text-slate-500">
                            {m.OrdCodigoOrden ? (
                              <>
                                {fechaIngresoStr && <> · Ingreso <span className="font-bold">{fechaIngresoStr}</span></>}
                                {' · '}
                                {fechaEntregaStr
                                  ? <>Entregada <span className="font-bold">{fechaEntregaStr}</span></>
                                  : <span className="font-bold text-amber-600" title="No está marcada como Entregado en depósito — se ordena por la fecha de ingreso">Sin entrega</span>}
                              </>
                            ) : (fechaIngresoStr ? <> · <span className="font-bold">{fechaIngresoStr}</span></> : null)}
                          </span>
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
                               const monBase = monIdBaseMov(m) === 1 ? 'UYU' : 'USD';
                               const rate = (monedaFactura === 'UYU' && monBase === 'USD') ? cotDolar : (monedaFactura === 'USD' && monBase === 'UYU' ? (1/cotDolar) : 1);
                               const finalSub = importe * rate;
                               return (monedaFactura === 'USD' ? 'US$ ' : '$U ') + finalSub.toFixed(2);
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-center">0</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700">
                            {(() => {
                               const importe = Math.abs(Number(m.MovImporte));
                               const monBase = monIdBaseMov(m) === 1 ? 'UYU' : 'USD';
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

                        // Conversión visual: moneda del congelado (d.Moneda) primero — ver monedaDetalle
                        const rate = rateDetalle(m, d);
                        const vPunit  = r2conv(punit * rate);
                        const vSubt   = r2conv(subt  * rate);
                        const puNeto  = punit * (1 - descPct / 100);
                        const vPuNeto = r2conv(puNeto * rate);

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
          </>) : (
          /* ══ PASO 2 — PAGO: resumen del documento + condición de venta ══ */
          <div className="max-w-3xl w-full mx-auto flex flex-col gap-4 py-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Documento a emitir (armado en el paso 1)</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><p className="text-[10px] uppercase font-bold text-slate-400">Tipo</p><p className="font-black text-slate-800">{tipoDocumento}</p></div>
                <div><p className="text-[10px] uppercase font-bold text-slate-400">Cliente</p><p className="font-bold text-slate-700 truncate" title={cliDgiNombre || cliente?.Nombre}>{cliDgiNombre || cliente?.Nombre}</p></div>
                <div><p className="text-[10px] uppercase font-bold text-slate-400">Órdenes incluidas</p><p className="font-bold text-slate-700">{movs.filter(m => !excluidos.has(m.MovIdMovimiento)).length}</p></div>
                <div><p className="text-[10px] uppercase font-bold text-slate-400">Moneda</p><p className="font-bold text-slate-700">{monedaFactura === 'USD' ? 'Dólares (US$)' : 'Pesos ($U)'}{esMultimoneda ? ` · cot. ${cotDolar}` : ''}</p></div>
              </div>
              <div className="flex items-end justify-end gap-8 mt-4 pt-4 border-t border-slate-100">
                <div className="text-right"><p className="text-slate-400 uppercase tracking-widest font-bold text-[10px]">Subtotal</p><p className="font-mono text-slate-600 text-lg">{simbolo} {fmt(granTotalBase)}</p></div>
                {montoDescuento > 0 && (
                  <div className="text-right"><p className="text-slate-400 uppercase tracking-widest font-bold text-[10px]">Descuento</p><p className="font-mono text-rose-500 text-lg">- {simbolo} {fmt(montoDescuento)}</p></div>
                )}
                <div className="text-right"><p className="text-indigo-500 uppercase tracking-widest font-black text-[11px]">Total a facturar</p><p className="font-mono font-black text-indigo-600 text-3xl tracking-tight">{simbolo} {fmt(granTotalNeto)}</p></div>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">¿Algo no cierra? Volvé al paso 1 con el botón de abajo: nada se emite hasta apretar el botón final.</p>
            </div>

            {/* F2: desglose del consumo prepago (FIFO, órdenes enteras) antes de confirmar */}
            {consumoPrev?.cubiertas?.length > 0 && (
              <div className={`rounded-xl border-2 shadow-sm p-5 ${todoCubiertoPorPrepago ? 'border-emerald-300 bg-emerald-50' : 'border-violet-300 bg-violet-50/60'}`}>
                <h4 className={`text-xs font-black uppercase tracking-widest mb-2 ${todoCubiertoPorPrepago ? 'text-emerald-700' : 'text-violet-700'}`}>
                  🔋 Billetera prepaga del cliente
                </h4>
                <p className="text-[12px] text-slate-700 mb-2">
                  <strong>{consumoPrev.cubiertas.length} orden(es) se descuentan del saldo</strong> (de la más vieja a la más nueva, órdenes enteras, <b>sin generar documento</b> — su factura existió al cargar la plata):
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {consumoPrev.cubiertas.map(c => (
                    <span key={c.codigo || c.movId} className="text-[10px] font-bold bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-700"
                      title={`Sale de "${c.cuenta}"${c.cruzada ? ` (${c.mon === 'USD' ? 'US$' : '$'} ${fmt(c.importeCta)} @ cot.)` : ''}`}>
                      {c.codigo || `#${c.movId}`} · {simbolo} {fmt(c.importe)} ← {c.cuenta}
                    </span>
                  ))}
                </div>
                {todoCubiertoPorPrepago ? (
                  <p className="text-sm font-black text-emerald-800">
                    ✓ La billetera cubre TODAS las órdenes: el ciclo se cierra SIN emitir factura y sin cobrar nada.
                  </p>
                ) : (
                  <p className="text-[12px] font-bold text-violet-800">
                    A factura van {consumoPrev.aFactura.length} orden(es) por {simbolo} {fmt(consumoPrev.totalFactura)}
                    <span className="font-normal text-slate-600"> ({consumoPrev.aFactura.map(a => a.codigo).filter(Boolean).join(', ')}) — el documento sale SOLO por ese resto.</span>
                  </p>
                )}
                <p className="text-[10px] text-slate-500 mt-1.5">Vista previa: el cierre recalcula con los saldos del momento de confirmar.</p>
              </div>
            )}

            {docType !== 'FACTURA' && !todoCubiertoPorPrepago && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">¿Cómo se paga este documento?</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button type="button" onClick={() => setDocCond('CONTADO')}
                    className={`text-left rounded-xl border-2 p-4 transition-all ${docCond === 'CONTADO' ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-slate-200 bg-white hover:border-emerald-300'}`}>
                    <span className={`text-sm font-black uppercase ${docCond === 'CONTADO' ? 'text-emerald-700' : 'text-slate-700'}`}>Contado</span>
                    <p className="text-[11px] text-slate-500 mt-1">Se cobra <strong>ahora</strong>: si el saldo a favor del cliente cubre el total, el documento nace pago; si no alcanza, queda pendiente de cobro inmediato.</p>
                  </button>
                  <button type="button" onClick={() => setDocCond('CREDITO')}
                    className={`text-left rounded-xl border-2 p-4 transition-all ${docCond === 'CREDITO' ? 'border-amber-500 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-amber-300'}`}>
                    <span className={`text-sm font-black uppercase ${docCond === 'CREDITO' ? 'text-amber-700' : 'text-slate-700'}`}>Crédito</span>
                    <p className="text-[11px] text-slate-500 mt-1">El cliente paga <strong>después</strong>: el documento genera deuda en su estado de cuenta y se cobra por Pago de Deudas.</p>
                  </button>
                </div>
              </div>
            )}

            {/* Forma de pago del CONTADO: mismos medios que la caja. Opcional: sin medios,
                la factura se cancela con el saldo a favor del cliente (si alcanza) o queda
                pendiente de cobro inmediato. */}
            {docType !== 'FACTURA' && docCond === 'CONTADO' && !todoCubiertoPorPrepago && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-1">Forma de pago</h4>
                <p className="text-[11px] text-slate-400 mb-3">
                  El saldo a favor de la <strong>cuenta principal</strong> se aplica solo, antes que nada; lo que cobres acá cancela el resto
                  (si cobrás de más, el excedente queda como saldo a favor). Podés dejarlo vacío para que la factura
                  se cubra solo con el saldo a favor.
                </p>

                {/* ¿De qué cuenta sale el saldo a favor que cubre la factura? */}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">El pago sale de:</span>
                  <select value={cuentaCobertura} onChange={e => setCuentaCobertura(e.target.value)}
                    className="text-[11px] font-bold border border-slate-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-violet-500">
                    <option value="PRINCIPAL">Cuenta principal (como siempre)</option>
                    {cuentasBilletera.filter(c => Number(c.CueSaldoActual || 0) > 0.01).map(c => (
                      <option key={c.CueIdCuenta} value={String(c.CueIdCuenta)}>
                        {codigoCuenta(c)} · {c.CueNombre || `Cuenta #${c.CueIdCuenta}`} — {c.CueTipo === 'DINERO_USD' ? 'US$' : '$'} {Number(c.CueSaldoActual).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </div>
                {cuentaElegida && (
                  <p className="mb-3 text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                    La factura se <strong>paga con el saldo de {codigoCuenta(cuentaElegida)} "{cuentaElegida.CueNombre || ''}"</strong>:
                    <strong> la principal queda igual y esa cuenta baja</strong>. En su libro queda "Pago con saldo — facturación de …" con el número de la factura.
                    Si su saldo no alcanza, el resto se cubre con el saldo propio de la principal o con los medios de abajo.
                  </p>
                )}

                {/* Cobertura según las cuentas del cliente, con la prioridad del motor */}
                <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {cuentaElegida && (
                    <div className="text-[11px]">
                      <span className="font-black uppercase tracking-wider text-violet-600 mr-1.5">{codigoCuenta(cuentaElegida)} paga:</span>
                      <span className="font-mono font-black text-violet-700">{simbolo} {fmt(cubreElegida)}</span>
                      <span className="text-slate-400"> (al emitir)</span>
                    </div>
                  )}
                  <div className="text-[11px]">
                    <span className="font-black uppercase tracking-wider text-indigo-500 mr-1.5">{cuentaElegida ? 'Principal cubre el resto:' : 'Principal cubre sola:'}</span>
                    <span className={`font-mono font-black ${cubrePrincipalFinal > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{simbolo} {fmt(cubrePrincipalFinal)}</span>
                    <span className="text-slate-400"> (saldo a favor {simbolo} {fmt(principalAFavor)}, estimado)</span>
                  </div>
                  <div className="text-[11px]">
                    <span className="font-black uppercase tracking-wider text-indigo-500 mr-1.5">Resta cobrar:</span>
                    <span className={`font-mono font-black ${restaCobrarFinal > 0.01 ? 'text-rose-600' : 'text-emerald-700'}`}>{simbolo} {fmt(restaCobrarFinal)}</span>
                  </div>
                  {cuentasBilletera.some(c => Number(c.CueSaldoActual || 0) > 0.01) && restaCobrarFinal > 0.01 && (
                    <button type="button" onClick={sugerirSaldosCuentas}
                      title="Arma los medios de pago con las cuentas de saldo del cliente en la prioridad del motor: ⚡ automáticas primero, la más vieja primero, cada una hasta su saldo (nunca en negativo). Después podés ajustar o agregar otros medios."
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors">
                      ⚡ Completar con saldos de cuentas
                    </button>
                  )}
                </div>

                {/* Factura TOTALMENTE cubierta por el saldo a favor → el panel de medios se
                    BLOQUEA (no hay nada que cobrar; cargar medios acá sería doble cobro). */}
                {restaCobrarFinal <= 0.01 ? (
                  <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3">
                    <p className="text-sm font-black text-emerald-800">
                      ✓ Esta factura se paga entera con el saldo a favor — no hay nada que cobrar.
                    </p>
                    <p className="text-[11px] text-emerald-700 mt-1">
                      El panel de medios de pago queda deshabilitado para evitar un doble cobro.
                      Si el cliente además trae plata nueva (cheque, transferencia, efectivo), <strong>no la cargues acá</strong>:
                      registrala por <strong>"Saldo Anticipado"</strong> — entra como anticipo con su recibo, el cheque queda
                      en tesorería y el saldo a favor se recompone.
                    </p>
                  </div>
                ) : (
                <CajaPanelPago
                  layout="horizontal"
                  seccion="pago"
                  showSubmitButton={false}
                  hideDocTitle hideTC hideDocType compactNotas
                  mode="VENTA"
                  metodosPago={metodosPago}
                  pagos={pagosContado}
                  onPagosChange={setPagosContado}
                  totalACubrir={granTotalNeto}
                  moneda={monedaFactura === 'USD' ? 'USD' : 'UYU'}
                  cotizacion={cotDolar}
                  procesando={working}
                  cuentasBilletera={cuentasBilletera}
                  containerClassName="w-full bg-white flex flex-col"
                />
                )}
              </div>
            )}
          </div>
          )}
        </div>

        {/* Footer (solo PASO 1: descuento, observaciones y totales) */}
        {paso === 'documento' && (<>
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
            <button onClick={irAlPago}
              disabled={movs.filter(m => !excluidos.has(m.MovIdMovimiento)).length === 0}
              title={todoCubiertoPorPrepago
                ? 'La billetera cubre todas las órdenes: en el paso 2 ves el desglose del descuento y confirmás — se cierra SIN factura'
                : 'El documento no se emite todavía: en el paso 2 elegís cómo se paga (contado o crédito) y ahí sí se genera'}
              className={`flex items-center gap-2 px-8 py-2.5 text-white text-sm font-black rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50 ${todoCubiertoPorPrepago ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
              {todoCubiertoPorPrepago ? '🔋 Continuar: ver desglose de la billetera →' : 'Continuar al pago →'}
            </button>
          </div>
        </div>
        </>)}

        {/* Acciones del PASO 2: volver o emitir */}
        {paso === 'pago' && (
          <div className="bg-slate-50 px-6 py-4 flex justify-between items-center gap-3 border-t border-slate-200">
            <button onClick={() => setPaso('documento')}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition-colors">
              ← Volver al documento
            </button>
            <button onClick={handleFacturar} disabled={working}
              title={docType !== 'FACTURA'
                ? (docCond === 'CONTADO' ? 'Emite el documento CONTADO: se cancela ahora (con saldo a favor si alcanza)' : 'Emite el documento a CRÉDITO: genera deuda para cobrar después')
                : 'Emite el documento'}
              className="flex items-center gap-2 px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50">
              {working ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {todoCubiertoPorPrepago
                ? 'Cerrar ciclo descontando de la billetera (sin factura)'
                : (docType !== 'FACTURA' ? `Generar Factura ${docCond === 'CONTADO' ? 'CONTADO' : 'a CRÉDITO'}` : 'Generar Factura')}
            </button>
          </div>
        )}
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
