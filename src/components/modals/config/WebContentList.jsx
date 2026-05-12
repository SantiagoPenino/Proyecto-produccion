import React, { useState, useEffect, useRef } from 'react';
import api from '../../../services/apiClient';



const BASE_URL = api.defaults.baseURL ? api.defaults.baseURL.replace(/\/api\/?$/, '') : '';

const getImageUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    return `${BASE_URL}${url}`;
};

const WebContentList = ({ type }) => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);

    // Form State for new item
    const [newItem, setNewItem] = useState({ title: '', link: '', image: null, preview: null });
    const fileInputRef = useRef(null);

    useEffect(() => {
        loadItems();
    }, [type]);

    const loadItems = async () => {
        setLoading(true);
        try {
            const res = await api.get('/web-content/all');
            if (res.data?.success) {
                // Filter by type and sort by order
                const filtered = res.data.data.filter(i => i.Tipo === type).sort((a, b) => a.Orden - b.Orden);
                setItems(filtered);
            }
        } catch (error) {
            console.error("Error loading content:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (file) => {
        const formData = new FormData();
        formData.append('image', file);
        const res = await api.post('/web-orders/config-image-upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        if (res.data?.success) {
            // Fix URL: if relative, ensure it works. 
            // Usually returns /uploads/...
            let url = res.data.url;
            // Hack for localhost if needed, but relative is best for portability
            return url;
        }
        throw new Error("Upload failed");
    };

    const handleAddItem = async () => {
        if (!newItem.image) return alert("Selecciona una imagen");
        setUploading(true);
        try {
            const imageUrl = await handleUpload(newItem.image);

            await api.post('/web-content', {
                tipo: type,
                titulo: newItem.title,
                linkDestino: newItem.link,
                imagenUrl: imageUrl,
                orden: items.length + 1,
                activo: true
            });

            setNewItem({ title: '', link: '', image: null, preview: null });
            loadItems();
        } catch (error) {
            console.error(error);
            alert("Error al guardar");
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("¿Eliminar este elemento?")) return;
        try {
            await api.delete(`/web-content/${id}`);
            loadItems();
        } catch (error) {
            console.error(error);
        }
    };

    const handleUpdate = async (id, data) => {
        try {
            await api.put(`/web-content/${id}`, data);
            loadItems(); // Refresh to ensure sync
        } catch (error) {
            console.error(error);
        }
    };

    const moveItem = async (index, direction) => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === items.length - 1) return;

        const newItems = [...items];
        const swapIndex = direction === 'up' ? index - 1 : index + 1;

        // Swap locally
        const temp = newItems[index];
        newItems[index] = newItems[swapIndex];
        newItems[swapIndex] = temp;

        // Optimistic UI
        setItems(newItems);

        // Update Backend orders
        try {
            // Update both items
            await api.put(`/web-content/${newItems[index].ID}`, { orden: index + 1 }); // Backend index might be different but we map array index + 1
            await api.put(`/web-content/${newItems[swapIndex].ID}`, { orden: swapIndex + 1 });
            // Ideally we re-fetch effectively
            loadItems();
        } catch (error) {
            console.error(error);
            loadItems(); // Revert on error
        }
    };

    return (
        <div className="space-y-8 animate-fade-in">
            {/* Add New */}
            <div className="bg-zinc-100 p-4 rounded-xl border border-zinc-200">
                <h4 className="text-xs font-bold uppercase text-zinc-500 mb-3">Agregar Nuevo {type === 'SIDEBAR' ? 'Banner' : 'Popup'}</h4>
                <div className="flex gap-4 items-start">
                    <div className="w-24 h-24 bg-white rounded-lg border-2 border-dashed border-zinc-300 flex items-center justify-center shrink-0 relative overflow-hidden group cursor-pointer" onClick={() => fileInputRef.current.click()}>
                        {newItem.preview ? (
                            <img src={newItem.preview} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                            <i className="fa-solid fa-plus text-zinc-300 text-2xl group-hover:text-indigo-400 transition-colors"></i>
                        )}
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
                            const f = e.target.files[0];
                            if (f) setNewItem({ ...newItem, image: f, preview: URL.createObjectURL(f) });
                        }} />
                    </div>
                    <div className="flex-1 space-y-2">
                        <input type="text" placeholder="Título (Opcional)" className="w-full text-sm p-2 rounded border border-zinc-300" value={newItem.title} onChange={e => setNewItem({ ...newItem, title: e.target.value })} />
                        <input type="text" placeholder="Link Destino (Opcional, ej: https://...)" className="w-full text-sm p-2 rounded border border-zinc-300" value={newItem.link} onChange={e => setNewItem({ ...newItem, link: e.target.value })} />
                        <button onClick={handleAddItem} disabled={uploading || !newItem.image} className="bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50">
                            {uploading ? <i className="fa-solid fa-spinner fa-spin"></i> : 'AGREGAR'}
                        </button>
                    </div>
                </div>
            </div>

            {/* List */}
            <div className="space-y-3">
                {items.length === 0 && <p className="text-center text-zinc-400 py-4 italic">No hay contenido activo.</p>}

                {items.map((item, idx) => (
                    <div key={item.ID} className={`flex items-center gap-4 bg-white p-3 rounded-xl border ${item.Activo ? 'border-indigo-100' : 'border-zinc-200 opacity-60'}`}>
                        <div className="w-16 h-16 bg-zinc-100 rounded border border-zinc-200 shrink-0 overflow-hidden">
                            <img src={getImageUrl(item.ImagenUrl)} className="w-full h-full object-cover" onError={(e) => e.target.src = 'https://placehold.co/100?text=?'} />
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <h5 className="text-sm font-bold text-zinc-800 truncate">{item.Titulo || 'Sin Título'}</h5>
                            <p className="text-xs text-zinc-400 truncate">{item.LinkDestino || 'Sin Link'}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${item.Activo ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                                    {item.Activo ? 'ACTIVO' : 'INACTIVO'}
                                </span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            <div className="flex flex-col gap-1">
                                <button onClick={() => moveItem(idx, 'up')} className="w-6 h-6 flex items-center justify-center bg-zinc-50 hover:bg-indigo-50 text-zinc-400 hover:text-indigo-600 rounded" disabled={idx === 0}><i className="fa-solid fa-chevron-up text-xs"></i></button>
                                <button onClick={() => moveItem(idx, 'down')} className="w-6 h-6 flex items-center justify-center bg-zinc-50 hover:bg-indigo-50 text-zinc-400 hover:text-indigo-600 rounded" disabled={idx === items.length - 1}><i className="fa-solid fa-chevron-down text-xs"></i></button>
                            </div>
                            <button onClick={() => handleUpdate(item.ID, { activo: !item.Activo })} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${item.Activo ? 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200' : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'}`} title={item.Activo ? "Desactivar" : "Activar"}>
                                <i className={`fa-solid ${item.Activo ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                            </button>
                            <button onClick={() => handleDelete(item.ID)} className="w-8 h-8 rounded-full flex items-center justify-center bg-red-50 text-red-500 hover:bg-red-100 transition-colors" title="Eliminar">
                                <i className="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default WebContentList;

