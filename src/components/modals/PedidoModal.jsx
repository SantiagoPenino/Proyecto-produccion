import React from 'react';

const PedidoModal = ({ pedido, isOpen, onClose }) => {
  if (!isOpen || !pedido) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-zinc-200">

        {/* CABECERA */}
        <div className="px-8 py-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-zinc-800">Pedido #{pedido.nro_documento}</h2>
              <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold tracking-widest uppercase">
                ERP Sync
              </span>
            </div>
            <p className="text-sm font-medium text-zinc-500 mt-1">
              <i className="fa-solid fa-user mr-2"></i>{pedido.cliente}
              <span className="mx-2 text-zinc-300">|</span>
              <i className="fa-solid fa-calendar mr-2"></i>{pedido.fecha} {pedido.hora}
            </p>
          </div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-zinc-200 text-zinc-400 hover:text-zinc-600 transition-colors">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        {/* CONTENIDO */}
        <div className="p-8 overflow-y-auto flex-1 space-y-8">

          {/* METADATOS */}
          {pedido.metadatos?.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pedido.metadatos.map((meta) => (
                <div key={meta.cod_id} className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl group hover:bg-indigo-50 transition-colors">
                  <span className="block text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">
                    {meta.clave.replace('_', ' ')}
                  </span>
                  <span className="text-base font-bold text-indigo-900">{meta.valor}</span>
                </div>
              ))}
            </div>
          )}

          {/* NOTA GENERAL */}
          {pedido.nota && (
            <div className="relative p-5 bg-amber-50/50 border border-amber-100 rounded-2xl">
              <i className="fa-solid fa-quote-left absolute top-4 left-4 text-amber-200 text-2xl"></i>
              <div className="pl-8">
                <h3 className="text-xs font-bold text-amber-600 uppercase mb-2">Notas del Operador</h3>
                <p className="text-zinc-700 italic leading-relaxed">{pedido.nota}</p>
              </div>
            </div>
          )}

          {/* ITEMS (CORREGIDO CON .MAP) */}
          <div className="space-y-4">
            <h3 className="text-sm font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <i className="fa-solid fa-list-ul text-indigo-500"></i> Detalle de Artículos
            </h3>
            
            {pedido.items?.map((item, idx) => (
              <div key={idx} className="bg-zinc-50 px-5 py-4 flex justify-between items-center border border-zinc-100 rounded-2xl">
                <div className="flex flex-col">
                  <span className="font-bold text-zinc-800">
                    <span className="text-zinc-400 font-mono mr-3 text-sm">{item.codigo_articulo}</span>
                    {item.descripcion}
                  </span>

                  {/* BARRA DE DATOS TÉCNICOS */}
                  <div className="flex flex-wrap gap-3 mt-2">
                    <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-zinc-200 shadow-sm">
                      <span className="text-[9px] font-black text-zinc-400 uppercase">Grupo:</span>
                      <span className="text-[10px] font-bold text-indigo-600">{item.grupo || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-zinc-200 shadow-sm">
                      <span className="text-[9px] font-black text-zinc-400 uppercase">Familia:</span>
                      <span className="text-[10px] font-bold text-indigo-600">{item.familia || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-zinc-200 shadow-sm">
                      <span className="text-[9px] font-black text-zinc-400 uppercase">Stock:</span>
                      <span className="text-[10px] font-bold text-emerald-600">{item.codstock || 'N/A'}</span>
                    </div>

                    {/* Badge de Área ID */}
                    {item.area_id_asignada && (
                      <div className="flex items-center gap-1 bg-indigo-600 px-2 py-0.5 rounded shadow-sm">
                        <i className="fa-solid fa-location-dot text-[9px] text-white"></i>
                        <span className="text-[10px] font-black text-white uppercase tracking-tight">
                          Area ID: {item.area_id_asignada}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span className="bg-white px-4 py-1 rounded-full text-sm font-black text-indigo-600 border border-indigo-100 shadow-sm">
                    x {item.cantidad}
                  </span>
                  {item.precio > 0 && (
                    <span className="text-xs font-bold text-zinc-400">${item.precio.toLocaleString()} c/u</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-8 py-6 border-t border-zinc-100 bg-zinc-50 flex justify-between items-center">
          <div>
            <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total del Pedido</span>
            <span className="text-2xl font-black text-zinc-800">${pedido.total?.toLocaleString()}</span>
          </div>
          <button
            onClick={onClose}
            className="px-10 py-3 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 active:scale-95"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};

export default PedidoModal;
