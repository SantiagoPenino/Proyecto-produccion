// SIN USO (13/10): maqueta estática (canales y mensajes fijos, input deshabilitado), nunca tuvo ruta. Confirmar con Yoania si se usa o se borra. Ver docs/auditoria-limpieza-2026-10-09.md.
import React from 'react';

const Chat = ({ onSwitchTab }) => {
  return (
    <div className="flex h-[calc(100vh-64px)] bg-slate-50 font-sans"> {/* Altura ajustada a navbar estandar */}

      {/* SIDEBAR: Lista de conversaciones */}
      <aside className="w-80 bg-white border-r border-slate-200 flex flex-col z-10 shrink-0">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <i className="fa-solid fa-comments text-cyan-500"></i>
              Mensajería
            </h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Canales Globales</p>
          </div>
          <button className="w-8 h-8 rounded-lg bg-cyan-50 text-cyan-600 hover:bg-cyan-500 hover:text-white transition-all flex items-center justify-center shadow-sm">
            <i className="fa-solid fa-plus text-sm"></i>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {/* Item Activo */}
          <div className="group flex items-start gap-3 p-3 rounded-xl bg-cyan-50 border border-cyan-100 cursor-pointer transition-all">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 text-white flex items-center justify-center text-sm shadow-md shadow-cyan-500/30">
              <i className="fa-solid fa-users"></i>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-0.5">
                <h4 className="font-bold text-sm text-slate-800 truncate">General Planta</h4>
                <span className="text-[10px] font-bold text-cyan-600">10:30</span>
              </div>
              <p className="text-xs font-medium text-slate-500 truncate group-hover:text-slate-700">Carlos: Atención en corte...</p>
            </div>
          </div>

          {/* Items Inactivos */}
          <div className="group flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100 transition-all">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm group-hover:bg-magenta-100 group-hover:text-magenta-500 transition-colors">
              <i className="fa-solid fa-print"></i>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-0.5">
                <h4 className="font-bold text-sm text-slate-700">Área DTF</h4>
                <span className="text-[10px] font-bold text-slate-400">09:15</span>
              </div>
              <p className="text-xs text-slate-400 truncate group-hover:text-slate-500">Problemas con la impresora #2</p>
            </div>
          </div>

          <div className="group flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100 transition-all">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-sm group-hover:bg-yellow-100 group-hover:text-yellow-600 transition-colors">
              <i className="fa-solid fa-wrench"></i>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-0.5">
                <h4 className="font-bold text-sm text-slate-700">Mantenimiento</h4>
                <span className="text-[10px] font-bold text-slate-400">Ayer</span>
              </div>
              <p className="text-xs text-slate-400 truncate group-hover:text-slate-500">Programar visita técnica</p>
            </div>
          </div>
        </div>
      </aside>

      {/* CHAT MAIN: Área principal */}
      <main className="flex-1 flex flex-col bg-slate-50/50 relative overflow-hidden">
        {/* Header Chat */}
        <div className="h-16 px-6 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => onSwitchTab('dashboard')} className="md:hidden text-slate-400 hover:text-slate-600">
              <i className="fa-solid fa-arrow-left"></i>
            </button>
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <h2 className="font-bold text-slate-700">General Planta</h2>
          </div>
          <button className="text-slate-400 hover:text-slate-600">
            <i className="fa-solid fa-circle-info"></i>
          </button>
        </div>

        {/* Messages List Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* System Message */}
          <div className="flex justify-center">
            <div className="bg-slate-100 px-4 py-1.5 rounded-full border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Hoy, 10 de Octubre</p>
            </div>
          </div>

          {/* Incoming Message Example */}
          <div className="flex gap-4 max-w-2xl">
            <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0 flex items-center justify-center text-xs">
              <i className="fa-solid fa-robot text-slate-500"></i>
            </div>
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-bold text-slate-700">Sistema</span>
                <span className="text-[10px] font-bold text-slate-400">10:30 AM</span>
              </div>
              <div className="bg-white p-4 rounded-tl-none rounded-2xl shadow-sm border border-slate-100 text-sm font-medium text-slate-600 leading-relaxed">
                ¡Hola! El sistema de chat estará disponible pronto con todas las funciones de comunicación en tiempo real.
              </div>
            </div>
          </div>

          {/* Outgoing Message Placeholder (Design only) */}
          <div className="flex gap-4 max-w-2xl ml-auto flex-row-reverse">
            <div className="w-8 h-8 rounded-full bg-cyan-100 shrink-0 flex items-center justify-center text-xs border-2 border-white shadow-sm">
              <span className="font-black text-cyan-600">YO</span>
            </div>
            <div className="text-right">
              <div className="flex items-baseline gap-2 mb-1 justify-end">
                <span className="text-[10px] font-bold text-slate-400">10:32 AM</span>
                <span className="text-xs font-bold text-slate-700">Tú</span>
              </div>
              <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-4 rounded-tr-none rounded-2xl shadow-lg shadow-cyan-500/20 text-sm font-medium text-white leading-relaxed">
                Entendido, estaré esperando la actualización.
              </div>
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-200">
          <div className="max-w-4xl mx-auto relative group">
            <input
              type="text"
              disabled
              placeholder="Escribe un mensaje..."
              className="w-full pl-6 pr-14 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-cyan-300 outline-none font-medium text-slate-600 placeholder-slate-400 transition-all cursor-not-allowed"
            />
            <button
              disabled
              className="absolute right-2 top-2 bottom-2 aspect-square rounded-xl bg-slate-200 text-slate-400 flex items-center justify-center transition-colors cursor-not-allowed"
            >
              <i className="fa-solid fa-paper-plane"></i>
            </button>
          </div>
          <p className="text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest mt-2">Chat en modo solo lectura</p>
        </div>

      </main>
    </div>
  );
};

export default Chat;
