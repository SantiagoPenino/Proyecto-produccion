/*
 * PedidoPrendaPage.jsx — Ruta: /ventas/pedido-prenda
 *
 * Alta interna de pedidos de PRENDAS. La carga un vendedor a nombre de un cliente.
 *
 * PASO 1 (lo único que hay hasta ahora): elegir el cliente al que se le carga el pedido.
 * El selector es copia fiel del de WmsOrderPage.jsx (mismo clientsService.search, mismo
 * debounce de 500ms, mismo mínimo de 3 caracteres, mismo markup) — no se reescribió nada.
 *
 * PENDIENTE, en orden:
 *   2. Catálogo de prendas (falta definir qué artículos son: ¿las PT-* de SupFlia 2?)
 *   3. Producto → talle → cantidad  (WmsOrderPage ya lo tiene resuelto con su modal de variantes)
 *   4. Servicios por ítem: estampado / bordado   ← esto es lo nuevo de verdad
 *   5. Confirmar → crear el pedido + las órdenes de producción de los servicios
 *
 * No toca /atencion-cliente/pedidos-wms ni ninguna otra pantalla.
 */
import React, { useState, useRef } from 'react';
import { Search, RefreshCw, User, Trash2 } from 'lucide-react';
import { clientsService } from '../../../services/api';

const PedidoPrendaPage = () => {
    // --- Client Selection State (idéntico a WmsOrderPage) ---
    const [clientSearchTerm, setClientSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchingClient, setIsSearchingClient] = useState(false);
    const [selectedClient, setSelectedClient] = useState(null);
    const searchTimeoutRef = useRef(null);

    const handleClientSearch = (e) => {
        const val = e.target.value;
        setClientSearchTerm(val);

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (val.trim().length < 3) {
            setSearchResults([]);
            return;
        }

        setIsSearchingClient(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await clientsService.search(val);
                setSearchResults(res.data || res || []);
            } catch (error) {
                console.error("Error searching clients:", error);
            } finally {
                setIsSearchingClient(false);
            }
        }, 500);
    };

    // El id con el que se va a cargar el pedido, resuelto igual que en WmsOrderPage
    const clienteId = selectedClient
        ? (selectedClient.CliIdCliente || selectedClient.CodCliente || selectedClient.ClienteID || selectedClient.id)
        : null;

    return (
        <div className="p-6 min-h-full">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-800">Pedido de Prendas</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Paso 1 de 4 — elegí el cliente al que se le carga el pedido.
                </p>
            </div>

            <div className="max-w-md">
                {/* Panel — mismo look que el carrito de Pedidos WMS */}
                <div className="bg-slate-800 rounded-3xl p-6 shadow-xl">
                    <div>
                        {!selectedClient ? (
                            <div className="relative">
                                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2 block">Cliente</label>
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        type="text"
                                        className="w-full bg-slate-700/50 border border-slate-600 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                        placeholder="Buscar cliente (RUC, CI, Nombre)..."
                                        value={clientSearchTerm}
                                        onChange={handleClientSearch}
                                    />
                                    {isSearchingClient && (
                                        <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" size={16} />
                                    )}
                                </div>

                                {/* Dropdown Results */}
                                {searchResults.length > 0 && clientSearchTerm.length >= 3 && (
                                    <div className="absolute z-50 mt-2 w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                                        {searchResults.map(client => (
                                            <div
                                                key={client.CodCliente || client.ClienteID || client.id}
                                                className="p-3 hover:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                                                onClick={() => {
                                                    setSelectedClient(client);
                                                    setSearchResults([]);
                                                    setClientSearchTerm('');
                                                }}
                                            >
                                                <p className="font-bold text-slate-800 text-sm">{client.Nombre || client.RazonSocial || client.nombre}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">ID: {client.CodCliente || client.ClienteID || client.id} | DOC: {client.CioRuc || client.RUT || client.RUC || client.CI || 'N/A'}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl p-5 shadow-lg border border-slate-200 relative">
                                <button
                                    onClick={() => setSelectedClient(null)}
                                    className="absolute top-4 right-4 p-2 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-xl transition-colors"
                                    title="Cambiar cliente"
                                >
                                    <Trash2 size={18} />
                                </button>
                                <div className="flex items-center gap-4 mb-4 border-b border-slate-100 pb-4">
                                    <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                                        <User size={24} />
                                    </div>
                                    <div className="pr-10">
                                        <h3 className="font-bold text-slate-800 leading-tight">{selectedClient.Nombre || selectedClient.RazonSocial || selectedClient.nombre}</h3>
                                        <p className="text-xs text-slate-500 font-mono mt-1 tracking-wide uppercase">IDCLIENTE: {selectedClient.CodCliente || selectedClient.ClienteID || selectedClient.id}</p>
                                    </div>
                                </div>
                                <div className="space-y-2.5 text-xs text-slate-600">
                                    <p className="flex justify-between"><span className="text-slate-400 font-medium">RUC / CI:</span> <span className="font-bold text-slate-800">{selectedClient.CioRuc || selectedClient.RUT || selectedClient.RUC || selectedClient.CI || 'N/A'}</span></p>
                                    <p className="flex justify-between"><span className="text-slate-400 font-medium">Email:</span> <span className="font-medium text-slate-800">{selectedClient.Email || selectedClient.Correo || 'N/A'}</span></p>
                                    <p className="flex justify-between"><span className="text-slate-400 font-medium">Teléfono:</span> <span className="font-medium text-slate-800">{selectedClient.TelefonoTrabajo || selectedClient.Telefono || selectedClient.Celular || 'N/A'}</span></p>
                                    <p className="flex justify-between"><span className="text-slate-400 font-medium">Dirección:</span> <span className="font-medium text-slate-800 text-right w-2/3 truncate" title={selectedClient.DireccionTrabajo || selectedClient.CliDireccion || selectedClient.Direccion || 'N/A'}>{selectedClient.DireccionTrabajo || selectedClient.CliDireccion || selectedClient.Direccion || 'N/A'}</span></p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* El dato que importa: con qué id se va a cargar el pedido */}
                    {selectedClient && (
                        <div className="mt-5 pt-5 border-t border-slate-700">
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2">El pedido se carga a</p>
                            <p className="font-mono text-sm text-emerald-400">clienteId = {clienteId}</p>
                        </div>
                    )}
                </div>

                {/* Qué sigue */}
                <div className="mt-5 bg-white border border-slate-200 rounded-2xl p-5">
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-3">Qué sigue</p>
                    <ol className="text-sm text-slate-500 space-y-1.5 list-decimal list-inside">
                        <li>Catálogo de prendas <span className="text-slate-400">— falta definir qué artículos son</span></li>
                        <li>Producto → talle → cantidad</li>
                        <li>Servicios por ítem: estampado / bordado</li>
                        <li>Confirmar</li>
                    </ol>
                </div>
            </div>
        </div>
    );
};

export default PedidoPrendaPage;
