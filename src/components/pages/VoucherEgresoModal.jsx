import React, { useEffect, useRef } from 'react';
import { Printer, X, CheckCircle } from 'lucide-react';

/**
 * VoucherEgresoModal
 * Modal que muestra el comprobante de egreso y permite imprimirlo.
 * 
 * Props:
 *   voucher: objeto con datos del egreso (de GET /caja/egreso/:id/voucher)
 *   onClose: función para cerrar
 */
const VoucherEgresoModal = ({ voucher, onClose }) => {
  const printRef = useRef(null);

  if (!voucher) return null;

  const fmt = (n) => parseFloat(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d) => d ? new Date(d).toLocaleString('es-UY', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

  const handlePrint = () => {
    const content = printRef.current?.innerHTML;
    const printWin = window.open('', '_blank', 'width=700,height=900');
    printWin.document.write(`
      <html>
        <head>
          <title>Voucher ${voucher.VoucherNumero || voucher.EgrIdEgreso}</title>
          <style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family: 'Courier New', monospace; font-size: 12px; padding: 20px; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
            .empresa { font-size: 16px; font-weight: bold; text-transform: uppercase; }
            .titulo { font-size: 14px; font-weight: bold; margin-top: 6px; }
            .numero { font-size: 20px; font-weight: bold; color: #c00; }
            .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #ccc; }
            .label { color: #555; }
            .value { font-weight: bold; }
            .monto-box { border: 2px solid #000; padding: 10px; text-align: center; margin: 15px 0; }
            .monto-num { font-size: 26px; font-weight: bold; }
            .firma-box { margin-top: 40px; display: flex; justify-content: space-around; }
            .firma { text-align: center; border-top: 1px solid #000; padding-top: 5px; min-width: 150px; font-size: 11px; }
            .asiento { font-size: 10px; color: #666; margin-top: 15px; }
            .pie { text-align: center; margin-top: 20px; font-size: 10px; color: #999; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    printWin.document.close();
    printWin.focus();
    printWin.addEventListener('afterprint', () => {
      printWin.close();
    });
    setTimeout(() => {
      printWin.print();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">

        {/* Header modal */}
        <div className="flex items-center justify-between px-6 py-5 bg-slate-900 rounded-t-3xl">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-emerald-400" size={24} />
            <div>
              <p className="text-white font-black text-sm">Egreso Registrado</p>
              <p className="text-slate-400 text-xs font-bold">Voucher {voucher.VoucherNumero || `#${voucher.EgrIdEgreso}`}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Voucher preview */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <div ref={printRef} className="font-mono text-sm">
            {/* Header impresión */}
            <div className="header text-center border-b-2 border-slate-800 pb-3 mb-4">
              <div className="empresa text-base font-black uppercase">{voucher.EmpresaNombre || 'La Empresa'}</div>
              {voucher.EmpresaRuc && <div className="text-xs text-slate-500">RUC: {voucher.EmpresaRuc}</div>}
              <div className="titulo font-bold mt-2 text-slate-700">COMPROBANTE DE EGRESO DE CAJA</div>
              <div className="numero text-2xl font-black text-rose-600 mt-1">
                {voucher.VoucherSerie || 'A'} - {voucher.VoucherNumero || voucher.EgrIdEgreso}
              </div>
            </div>

            {/* Datos */}
            <div className="flex flex-col gap-1.5 text-xs">
              {[
                ['Fecha',           fmtDate(voucher.EgrFecha)],
                ['Tipo de Egreso',  voucher.TipoEgresoLabel || voucher.EgrTipoEgreso || '—'],
                ['Beneficiario',    voucher.EgrProveedor    || '—'],
                ['Concepto',        voucher.EgrConcepto     || '—'],
                ['Método de Pago',  voucher.MetodoPago      || '—'],
                ['Cuenta Contable', voucher.CuentaCodigo ? `[${voucher.CuentaCodigo}] ${voucher.CuentaNombre}` : '—'],
                ['Operario',        voucher.UsuarioNombre   || '—'],
                ['N° Asiento',      voucher.AsiIdAsiento    || '—'],
              ].map(([label, value]) => (
                <div key={label} className="row flex justify-between border-b border-dashed border-slate-200 py-1">
                  <span className="label text-slate-500">{label}:</span>
                  <span className="value font-bold text-slate-800 text-right max-w-[60%]">{value}</span>
                </div>
              ))}
            </div>

            {/* Monto destacado */}
            <div className="monto-box border-2 border-slate-800 rounded-xl p-4 text-center my-5 bg-rose-50">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black mb-1">Total Salida</p>
              <p className="monto-num text-3xl font-black text-rose-600">
                {voucher.EgrMoneda === 'USD' ? 'U$' : '$'} {fmt(voucher.EgrMonto)} {voucher.EgrMoneda}
              </p>
              {voucher.EgrMoneda === 'USD' && voucher.EgrMontoConvertido && (
                <p className="text-xs text-slate-500 mt-1 font-bold">
                  ≈ $ {fmt(voucher.EgrMontoConvertido)} UYU (cotiz. {voucher.EgrCotizacion})
                </p>
              )}
            </div>

            {/* Observaciones */}
            {voucher.EgrObservaciones && (
              <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 mb-4 border border-slate-200">
                <span className="font-black text-slate-500 uppercase tracking-widest text-[10px] block mb-1">Observaciones</span>
                {voucher.EgrObservaciones}
              </div>
            )}

            {/* Firmas */}
            <div className="firma-box flex justify-around mt-8 pt-2">
              <div className="firma text-center border-t border-slate-400 pt-2 min-w-[120px] text-xs text-slate-500">
                <span>Entregado por</span>
                <div className="font-bold text-slate-800 mt-1">{voucher.UsuarioNombre || '___________'}</div>
              </div>
              <div className="firma text-center border-t border-slate-400 pt-2 min-w-[120px] text-xs text-slate-500">
                <span>Recibido por</span>
                <div className="font-bold text-slate-800 mt-1">{voucher.EgrProveedor || '___________'}</div>
              </div>
            </div>

            <p className="pie text-center text-[10px] text-slate-400 mt-6 border-t border-dashed border-slate-200 pt-3">
              Documento interno · No válido como comprobante fiscal · {new Date().toLocaleDateString('es-UY')}
            </p>
          </div>
        </div>

        {/* Acciones */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-900 text-white font-black py-3.5 rounded-2xl hover:bg-slate-800 transition-all text-sm"
          >
            <Printer size={18} /> Imprimir Voucher
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3.5 rounded-2xl border-2 border-slate-200 text-slate-500 font-black text-sm hover:bg-slate-50 transition-all"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoucherEgresoModal;
