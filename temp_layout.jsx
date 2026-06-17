  // ==========================================
  // PREMIUM MINIMALIST LAYOUT
  // ==========================================
  return (
    <div className="bg-white/80 backdrop-blur-md border border-white/50 shadow-2xl shadow-slate-200/50 rounded-3xl p-5 font-archivo flex flex-col gap-4">
      {/* Header Resultante */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Documento Resultante</span>
          <span className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 truncate">
            {resultingDocDescription}
          </span>
        </div>
        {cotizacion > 1 && (
          <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-1 rounded-xl text-[10px] font-black uppercase shadow-sm">
            TC: {fmt(cotizacion)}
          </div>
        )}
      </div>

      {/* Tipo y Condicion */}
      <div className="grid grid-cols-2 gap-4">
        <div className="group">
          <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest group-focus-within:text-indigo-500 transition-colors">
            Tipo Documento
          </label>
          <select 
            value={tipoDoc} 
            onChange={e => onTipoDoc && onTipoDoc(e.target.value)}
            disabled={esEgreso}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/10 transition-all appearance-none cursor-pointer hover:bg-slate-100 disabled:opacity-50"
          >
            {tiposDoc.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="group">
          <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest group-focus-within:text-emerald-500 transition-colors">
            Condición
          </label>
          <select 
            value={derivedCondicion}
            onChange={e => handleSelectCondicion(e.target.value)}
            disabled={esEgreso || !hasStandardVouchers}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10 transition-all appearance-none cursor-pointer hover:bg-slate-100 disabled:opacity-50"
          >
            <option value="CONTADO">CONTADO</option>
            <option value="CREDITO">CRÉDITO</option>
          </select>
        </div>
      </div>

      {/* Serie y Número */}
      {!esEgreso && tipoDoc !== 'NINGUNO' && (
        <div className="flex gap-4">
          <div className="w-1/3 group">
            <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest group-focus-within:text-indigo-500 transition-colors">Serie</label>
            <input 
              type="text" 
              value={serieDoc} 
              onChange={e => onSerieDoc && onSerieDoc(e.target.value.toUpperCase())}
              placeholder="Ej: A"
              className="w-full text-center bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2.5 text-xs font-black text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/10 transition-all"
            />
          </div>
          <div className="w-2/3 group">
            <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Siguiente N°</label>
            <div className="w-full flex items-center justify-center bg-slate-100/50 border border-slate-200 rounded-2xl px-3 py-2.5 text-xs font-black text-slate-500 shadow-inner">
              {numDoc || numDocPredict}
            </div>
          </div>
        </div>
      )}

      {/* Pagos */}
      <div className="bg-slate-50 border border-slate-200 rounded-3xl p-4 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-indigo-400 to-purple-500"></div>
        
        <div className="flex justify-between items-center mb-3 px-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Líneas de Pago</label>
          {totalACubrir > 0 && (
            <span className="text-[10px] font-black text-slate-700 bg-white px-3 py-1 rounded-full shadow-sm border border-slate-200 uppercase">
              Cubrir: <span className="text-indigo-600">{simbMoneda} {fmt(totalACubrir)}</span>
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {pagos.map((p) => (
            <div key={p.id} className="flex items-center gap-2 bg-white border border-slate-100 p-2 rounded-2xl shadow-sm hover:shadow-md transition-shadow group">
              <div className="flex-1 min-w-0">
                <select
                  value={p.metodoPagoId}
                  onChange={(e) => {
                    const val = e.target.value;
                    updatePago(p.id, 'metodoPagoId', val);
                    const isCheque = metodosPago.find(m => m.MPaIdMetodoPago === parseInt(val))?.MPaDescripcionMetodo?.toLowerCase().includes('cheque');
                    if (isCheque && !p.idCheque) setChequeIndexActivo(p.id);
                  }}
                  className="w-full bg-transparent text-[11px] font-black text-slate-700 outline-none cursor-pointer appearance-none px-1"
                >
                  <option value="" disabled>Medio...</option>
                  {metodosPago.map(m => (
                    <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>
                  ))}
                </select>
              </div>
              
              {!lockMoneda && (
                <select
                  value={p.moneda}
                  onChange={e => updatePago(p.id, 'moneda', e.target.value)}
                  className="w-14 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-[10px] font-black text-slate-600 outline-none text-center"
                >
                  <option value="UYU">$</option>
                  <option value="USD">U$</option>
                </select>
              )}

              <input
                type="number"
                placeholder="0.0"
                value={p.monto}
                onChange={(e) => updatePago(p.id, 'monto', e.target.value)}
                className="w-24 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-black text-slate-800 text-right outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 shadow-inner"
              />

              <button
                type="button"
                onClick={() => removePago(p.id)}
                className="text-slate-300 hover:text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition-all shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={addPago}
            className="flex-1 bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 text-[10px] font-black uppercase tracking-widest py-2.5 rounded-2xl transition-all flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Plus size={12} /> Agregar
          </button>
          {totalACubrir > 0 && diferencia > 0.01 && (
            <button
              type="button"
              onClick={autoRellenar}
              className="flex-1 bg-gradient-to-r from-emerald-400 to-teal-500 text-white text-[10px] font-black uppercase tracking-widest py-2.5 rounded-2xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 hover:-translate-y-0.5 transition-all"
            >
              Autocompletar
            </button>
          )}
        </div>

        {/* Balance Status Indicator */}
        {totalIngresado > 0 && (
          <div className={`mt-3 p-2.5 rounded-2xl flex justify-between items-center border ${balanceOK ? 'bg-emerald-50/50 border-emerald-100' : (diferencia > 0 ? 'bg-amber-50/50 border-amber-100' : 'bg-rose-50/50 border-rose-100')}`}>
            <span className={`text-[9px] font-black uppercase tracking-widest ${balanceOK ? 'text-emerald-600' : (diferencia > 0 ? 'text-amber-600' : 'text-rose-600')}`}>
              {balanceOK ? 'Balanceado' : (diferencia > 0 ? 'Falta Cubrir' : 'Vuelto/Exceso')}
            </span>
            <span className={`text-xs font-black ${balanceOK ? 'text-emerald-700' : (diferencia > 0 ? 'text-amber-700' : 'text-rose-700')}`}>
              {simbMoneda} {fmt(Math.abs(diferencia))}
            </span>
          </div>
        )}
      </div>

      {/* Notas */}
      <div className="group">
        <label className="block text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest group-focus-within:text-indigo-500 transition-colors">
          Observaciones
        </label>
        <textarea
          value={notas}
          onChange={e => onNotas(e.target.value)}
          placeholder="Notas internas..."
          rows={2}
          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-bold text-slate-700 outline-none resize-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/10 transition-all placeholder:text-slate-300"
        />
      </div>

      {/* Confirmar */}
      <button
        type="button"
        onClick={onConfirmar}
        disabled={!canConfirm}
        className={`w-full mt-2 py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest text-white shadow-xl flex justify-center items-center gap-2 transition-all duration-300 
          ${!canConfirm 
            ? 'bg-slate-200 shadow-none text-slate-400 cursor-not-allowed' 
            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0'
          }`}
      >
        {procesando ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <>
            <CheckCircle size={16} /> {confirmBtnText}
          </>
        )}
      </button>

      {chequeIndexActivo !== null && (
        <ChequeRecibirModal
          initialMonto={pagos.find(p => p.id === chequeIndexActivo)?.monto || ''}
          onClose={() => setChequeIndexActivo(null)}
          onSuccess={(idCheque) => {
            updatePago(chequeIndexActivo, 'idCheque', idCheque);
            setChequeIndexActivo(null);
          }}
        />
      )}
    </div>
  );
}
