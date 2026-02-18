import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { SERVICES_LIST } from '../constants/services';
import { GlassCard } from '../pautas/GlassCard';
import { PrintSettingsPanel } from '../pautas/PrintSettingsPanel';
import { CustomButton } from '../pautas/CustomButton';
import { FormInput } from '../pautas/FormInput';
import { useToast } from '../pautas/Toast';
import { fileService } from '../api/fileService';
import { apiClient } from '../api/apiClient';
import { ArrowLeft, Save, Trash2, Plus, UploadCloud, AlertTriangle, Zap, Archive, FileText, CheckCircle, Download, Scissors, Check, Image as ImageIcon, FileCode } from 'lucide-react';
import { useAuth } from '../auth/AuthContext'; // Assuming AuthContext provides useAuth

// --- Componente de Carga Tipo Google Drive (Fuera de OrderForm para evitar pérdida de foco) ---
const ErrorModal = ({ isOpen, onClose, message }) => {
    if (!isOpen) return null;
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 border-2 border-red-100 animate-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-500 mb-2">
                        <AlertTriangle size={32} />
                    </div>
                    <h3 className="text-xl font-black text-zinc-800 uppercase tracking-tight">
                        Error de Validación
                    </h3>
                    <p className="text-sm text-zinc-600 font-medium leading-relaxed">
                        {message}
                    </p>
                    <button
                        onClick={onClose}
                        className="mt-4 w-full py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl transition-colors shadow-lg hover:shadow-red-500/30"
                    >
                        ENTENDIDO
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

const UploadProgressModal = ({ isOpen, progress, isError, onRetry }) => {
    if (!isOpen) return null;
    const percentage = Math.round((progress.current / progress.total) * 100) || 0;

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 border border-zinc-100 relative overflow-hidden">
                {/* Background Decoration */}
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-gradient-x" />

                <div className="flex flex-col items-center text-center gap-6 relative z-10">
                    {isError ? (
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-2 animate-bounce">
                            <AlertTriangle size={40} />
                        </div>
                    ) : (
                        <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 mb-2 relative">
                            <UploadCloud size={40} className="animate-pulse" />
                            <div className="absolute inset-0 rounded-full border-4 border-blue-100 border-t-blue-500 animate-spin" />
                        </div>
                    )}

                    <div>
                        <h3 className="text-2xl font-black text-zinc-800 tracking-tight mb-2">
                            {isError ? '¡Ups! Algo falló' : 'Subiendo tus archivos'}
                        </h3>
                        <p className="text-sm text-zinc-500 font-medium">
                            {isError
                                ? 'Hubo un problema al subir uno de los archivos. No te preocupes, puedes reintentar.'
                                : `Por favor no cierres esta ventana. Estamos enviando ${progress.current} de ${progress.total} archivos a producción.`}
                        </p>
                    </div>

                    {!isError && (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between text-xs font-bold text-zinc-400 uppercase tracking-wider">
                                <span>Progreso Total</span>
                                <span>{percentage}%</span>
                            </div>
                            <div className="h-3 bg-zinc-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500 ease-out"
                                    style={{ width: `${percentage}%` }}
                                />
                            </div>
                            <p className="text-xs text-zinc-400 truncate mt-2 font-mono bg-zinc-50 py-1 px-2 rounded-lg border border-zinc-100">
                                {progress.filename || 'Preparando...'}
                            </p>
                        </div>
                    )}

                    {isError && (
                        <button
                            onClick={onRetry}
                            className="mt-2 w-full py-4 bg-zinc-900 hover:bg-black text-white font-black rounded-2xl transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2"
                        >
                            <Zap size={20} />
                            REINTENTAR AHORA
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

const FileUploadZone = ({ id, onFileSelected, selectedFile, label, icon: Icon = UploadCloud, color = "blue", multiple = false }) => {
    const [isOver, setIsOver] = useState(false);
    const uniqueId = `file-input-${id}-${label.replace(/\s+/g, '-')}`;

    const handleDrop = (e) => {
        e.preventDefault();
        setIsOver(false);
        if (multiple) {
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) onFileSelected(files);
        } else {
            const file = e.dataTransfer.files[0];
            if (file) onFileSelected(file);
        }
    };

    return (
        <div
            className={`relative group transition-all duration-300 border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer
                ${selectedFile ? 'border-green-400 bg-green-50/50' : (isOver ? 'border-blue-400 bg-blue-50' : 'border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50')}`}
            onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={() => setIsOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById(uniqueId).click()}
        >
            <input
                id={uniqueId}
                type="file"
                multiple={multiple}
                className="hidden"
                onChange={(e) => {
                    if (multiple) {
                        onFileSelected(Array.from(e.target.files));
                    } else {
                        onFileSelected(e.target.files[0]);
                    }
                }}
            />

            {selectedFile ? (
                <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300">
                    <CheckCircle size={28} className="text-green-500 mb-2" />
                    <span className="text-[10px] font-bold text-green-700 truncate max-w-[150px]">
                        {multiple ? 'Archivos listos' : selectedFile.name}
                    </span>
                    <p className="text-[10px] text-green-600 uppercase tracking-tighter">
                        {multiple ? '+ Agregar más' : 'Listo para Drive'}
                    </p>
                </div>
            ) : (
                <>
                    <div className={`p-2 rounded-full ${isOver ? 'bg-blue-100' : 'bg-zinc-100 group-hover:bg-zinc-200'} transition-colors`}>
                        <Icon size={24} className={isOver ? 'text-blue-500' : 'text-zinc-500'} />
                    </div>
                    <div className="text-center">
                        <span className="text-[10px] font-bold text-zinc-600 block uppercase tracking-tight">{label}</span>
                        <p className="text-[9px] text-zinc-400">Arrastra o haz click</p>
                    </div>
                </>
            )}
        </div>
    );
};

const CorteTechnicalUI = ({ serviceId, moldType, setMoldType, fabricOrigin, setFabricOrigin, clientFabricName, setClientFabricName, selectedSubOrderId, setSelectedSubOrderId, activeSubOrders, tizadaFiles, setTizadaFiles, handleMultipleSpecializedFileUpload, compact = false }) => (
    <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-4' : 'mb-12'}`}>
        <div className={`${compact ? 'bg-zinc-100/50 p-6' : 'bg-zinc-50/50 p-8'} rounded-[2rem] border border-zinc-200 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-8 opacity-5">
                <Zap size={compact ? 60 : 120} />
            </div>

            <div className="flex items-center gap-3 mb-6">
                <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">PASO 1</span>
                <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">Especificaciones de Corte</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Tipo de Molde</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {['SUBLIMACION', 'MOLDES CLIENTES'].map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                        setMoldType(m);
                                        if (m === 'MOLDES CLIENTES' && fabricOrigin === 'TELA SUBLIMADA EN USER') setFabricOrigin('TELA CLIENTE');
                                        if (m === 'SUBLIMACION') setFabricOrigin('TELA SUBLIMADA EN USER');
                                    }}
                                    className={`p-3 rounded-xl text-[9px] font-black border-2 transition-all ${moldType === m ? 'bg-white text-black border-black shadow-md' : 'bg-transparent text-zinc-400 border-zinc-200'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Origen de la Tela</label>
                        <select
                            className="w-full p-3 bg-white border border-zinc-200 rounded-xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all text-xs"
                            value={fabricOrigin}
                            onChange={(e) => setFabricOrigin(e.target.value)}
                            disabled={moldType === 'SUBLIMACION'}
                        >
                            {moldType !== 'MOLDES CLIENTES' && <option value="TELA SUBLIMADA EN USER">TELA SUBLIMADA EN USER</option>}
                            <option value="TELA CLIENTE">TELA CLIENTE</option>
                            <option value="TELA STOCK USER">TELA STOCK USER</option>
                        </select>

                        {fabricOrigin === 'TELA CLIENTE' && moldType !== 'SUBLIMACION' && (
                            <div className="mt-3 animate-fade-in bg-white p-3 rounded-xl border border-zinc-200">
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-1 tracking-widest">Nombre de la Tela *</label>
                                <input
                                    type="text"
                                    placeholder="Ej: Tropical Mecánico..."
                                    className="w-full p-2 border border-zinc-100 rounded-lg font-bold bg-zinc-50 outline-none text-xs"
                                    value={clientFabricName}
                                    onChange={(e) => setClientFabricName(e.target.value)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col justify-center">
                    {moldType === 'SUBLIMACION' ? (
                        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 shadow-sm">
                            <label className="block text-[10px] uppercase font-black text-blue-600 mb-2 tracking-widest text-center">Vincular Impresión</label>
                            {serviceId === 'sublimacion' ? (
                                <div className="bg-white/50 p-3 rounded-xl border border-blue-100 flex items-center justify-center gap-2">
                                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                                    <span className="text-[9px] font-black text-blue-800 uppercase tracking-widest">Vinculado a este Pedido</span>
                                </div>
                            ) : (
                                <select
                                    className="w-full p-3 bg-white border border-blue-200 rounded-xl font-black text-blue-900 outline-none text-xs shadow-sm"
                                    value={selectedSubOrderId}
                                    onChange={(e) => setSelectedSubOrderId(e.target.value)}
                                >
                                    <option value="">Seleccionar...</option>
                                    {activeSubOrders.map(o => (
                                        <option key={o.OrdenID} value={o.CodigoOrden}>{o.CodigoOrden} - {o.DescripcionTrabajo}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    ) : (
                        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                            <label className="block text-[10px] uppercase font-black text-amber-600 mb-2 tracking-widest text-center">Archivos de Tizada</label>
                            <FileUploadZone
                                id="tizada-upload-tree"
                                label="Subir Tizadas"
                                onFileSelected={(files) => handleMultipleSpecializedFileUpload(setTizadaFiles, files)}
                                selectedFile={tizadaFiles.length > 0}
                                multiple={true}
                                color="amber"
                            />
                            {tizadaFiles.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {tizadaFiles.map((tf, i) => (
                                        <div key={i} className="bg-white/80 border border-amber-200 rounded-md py-1 px-2 flex items-center gap-1">
                                            <span className="text-[9px] font-black text-amber-900 truncate max-w-[60px]">{tf.name}</span>
                                            <button type="button" onClick={() => setTizadaFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-amber-400 hover:text-red-500"><Trash2 size={10} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    </div>
);

const CosturaTechnicalUI = ({ isCorteActive, costuraNote, setCosturaNote, compact = false }) => (
    <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-4' : 'mb-12'}`}>
        <div className={`${compact ? 'bg-zinc-100/50 p-6' : 'bg-zinc-50/50 p-8'} rounded-[2rem] border border-zinc-200 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-8 opacity-5">
                <Scissors size={compact ? 60 : 120} />
            </div>

            <div className="flex items-center gap-3 mb-6">
                <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">PASO {isCorteActive ? '2' : '1'}</span>
                <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">Especificaciones de Costura / Confección</h3>
            </div>

            <div className="relative z-10 bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Instrucciones Especiales de Costura</label>
                <textarea
                    className="w-full p-3 bg-zinc-50 border border-zinc-100 rounded-xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all min-h-[100px] text-xs"
                    placeholder="Ej: Tipo de hilo, refuerzos, terminaciones específicas..."
                    value={costuraNote || ''}
                    onChange={(e) => setCosturaNote(e.target.value)}
                />
            </div>
        </div>
    </div>
);

const BordadoTechnicalUI = ({
    serviceId, garmentQuantity, setGarmentQuantity,
    bocetoFile, setBocetoFile,
    ponchadoFiles, setPonchadoFiles,
    globalMaterial, handleGlobalMaterialChange,
    serviceInfo, userStock,
    handleSpecializedFileUpload,
    handleMultipleSpecializedFileUpload,
    compact = false,
    // Props para modo complemento
    isComplement = false,
    compMaterial = '', setCompMaterial = null,
    compVariant = '', setCompVariant = null,
    compVariants = [], compMaterials = [],
    uniqueVariants = [], dynamicMaterials = [],
    serviceSubType = '', handleSubTypeChange = null
}) => {
    // Determinamos qué datos mostrar según si es standalone o complemento
    const isStandalone = serviceId === 'bordado';
    const displayVariants = isStandalone ? uniqueVariants : compVariants;
    const displayMaterials = isStandalone ? dynamicMaterials : compMaterials;

    const currentVariant = isStandalone ? serviceSubType : compVariant;
    const currentMaterial = isStandalone ? globalMaterial : compMaterial;

    const onVariantChange = isStandalone ? handleSubTypeChange : setCompVariant;
    const onMaterialChange = isStandalone ? handleGlobalMaterialChange : setCompMaterial;

    return (
        <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-0' : 'mb-8'}`}>
            <div className={`${compact ? 'bg-zinc-100 p-6' : 'bg-zinc-50/50 p-8'} rounded-[2rem] border border-zinc-200 relative overflow-hidden`}>
                {!compact && (
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Scissors size={120} />
                    </div>
                )}

                <div className="flex items-center gap-3 mb-6">
                    {!compact && <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">PASO 1</span>}
                    <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">{compact ? 'Especificaciones Técnicas' : 'Especificaciones de Bordado'}</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 relative z-10">
                    <div className="md:col-span-12 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Tipo / Variante *</label>
                                <select
                                    className="w-full h-[55px] px-4 bg-white border border-zinc-200 rounded-2xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all"
                                    value={currentVariant}
                                    onChange={(e) => onVariantChange(e.target.value)}
                                >
                                    <option value="" disabled>Seleccionar tipo...</option>
                                    {displayVariants.map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Prenda (Soporte) *</label>
                                <select
                                    className="w-full h-[55px] px-4 bg-white border border-zinc-200 rounded-2xl font-bold text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all"
                                    value={currentMaterial}
                                    onChange={(e) => onMaterialChange(e.target.value)}
                                >
                                    <option value="" disabled>Seleccionar prenda...</option>
                                    {(displayVariants.length > 0 ? displayMaterials : (isStandalone ? (serviceInfo?.materials || []) : []) || userStock || []).map(mat => {
                                        const label = mat.Material || mat.name || mat;
                                        const val = mat.Material || mat.name || mat;
                                        return <option key={label} value={val}>{label}</option>;
                                    })}
                                </select>
                            </div>

                            <div className="md:col-span-2 lg:col-span-1">
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest">Cantidad Total *</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="Cant."
                                    className="w-full h-[55px] px-4 bg-white border border-zinc-200 rounded-2xl font-bold text-lg text-zinc-800 outline-none focus:ring-1 focus:ring-black transition-all"
                                    value={garmentQuantity}
                                    onChange={(e) => setGarmentQuantity(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest text-center text-zinc-500">Logos a Bordar (Uno o más)</label>
                                <FileUploadZone
                                    id="bordado-logo"
                                    label="SUBIR LOGOS"
                                    onFileSelected={(f) => handleMultipleSpecializedFileUpload(setPonchadoFiles, f)}
                                    selectedFile={ponchadoFiles.length > 0}
                                    color="emerald"
                                    multiple={true}
                                />
                                {ponchadoFiles.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {ponchadoFiles.map((f, idx) => (
                                            <div key={idx} className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-full">
                                                <span className="text-[10px] font-bold text-emerald-700 max-w-[100px] truncate">{f.name}</span>
                                                <button
                                                    onClick={() => setPonchadoFiles(prev => prev.filter((_, i) => i !== idx))}
                                                    className="text-emerald-400 hover:text-emerald-600 transition-colors"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-400 mb-2 tracking-widest text-center text-zinc-500">Boceto / Ubicación</label>
                                <FileUploadZone
                                    id="bordado-boceto"
                                    label="UBICACIÓN VISUAL"
                                    onFileSelected={(f) => handleSpecializedFileUpload(setBocetoFile, f)}
                                    selectedFile={bocetoFile}
                                    color="blue"
                                />
                                {bocetoFile && (
                                    <div className="mt-3 flex justify-center">
                                        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full">
                                            <span className="text-[10px] font-bold text-blue-700 max-w-[150px] truncate">{bocetoFile.name}</span>
                                            <button
                                                onClick={() => setBocetoFile(null)}
                                                className="text-blue-400 hover:text-blue-600 transition-colors"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const OrderForm = () => {
    const { serviceId } = useParams();
    const navigate = useNavigate();
    const { addToast } = useToast();
    const { user } = useAuth(); // Assuming user has 'stock' in AuthContext, otherwise we default

    const serviceInfo = SERVICES_LIST.find(s => s.id === serviceId);
    const config = serviceInfo?.config || {};

    // State matching mockup logic
    const [jobName, setJobName] = useState('');
    const [serviceSubType, setServiceSubType] = useState('');
    const [urgency, setUrgency] = useState('');
    const [generalNote, setGeneralNote] = useState('');
    const [globalMaterial, setGlobalMaterial] = useState('');
    const [fabricType, setFabricType] = useState('lisa');
    const [requiresSample, setRequiresSample] = useState(false);
    const [items, setItems] = useState([]);
    const [referenceFiles, setReferenceFiles] = useState([]); // { id, name, type, fileData }
    const [selectedComplementary, setSelectedComplementary] = useState({});
    const [loading, setLoading] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [createdOrderIds, setCreatedOrderIds] = useState([]);

    // --- ESTADOS DE SUBIDA (STREAMING) ---
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, filename: '' });
    const [uploadError, setUploadError] = useState(false);
    const [pendingManifest, setPendingManifest] = useState([]);
    const [localFileMap, setLocalFileMap] = useState({});

    // --- VISIBILIDAD CONFIGURABLE ---
    const [visibleConfig, setVisibleConfig] = useState(null);

    useEffect(() => {
        apiClient.get('/web-orders/area-mapping').then(res => {
            if (res.success && res.data?.visibility) {
                setVisibleConfig(res.data.visibility);
            } else {
                setVisibleConfig({}); // Default show all
            }
        }).catch(err => {
            console.error("Error loading visibility config:", err);
            setVisibleConfig({});
        });
    }, []);

    // --- PROCESO DE SUBIDA SECUENCIAL ---
    const handleUploadProcess = async (manifest, fileMap) => {
        setUploading(true);
        setUploadError(false);
        setPendingManifest(manifest);
        setLocalFileMap(fileMap);

        let completed = 0;
        const total = manifest.length;

        try {
            for (let i = 0; i < manifest.length; i++) {
                const item = manifest[i];
                // item: { dbId, type, originalName, finalName, area }
                const fileObj = fileMap[item.originalName];

                if (!fileObj) {
                    console.warn("⚠️ Archivo no encontrado localmente para:", item.originalName);
                    // Si no lo tenemos, asumimos error o ya subido, continuamos para no bloquear
                    completed++;
                    continue;
                }

                setUploadProgress({ current: i + 1, total, filename: item.originalName });

                // Llamada al servicio de streaming
                try {
                    await fileService.uploadStream(fileObj, item);
                } catch (e) {
                    console.error(`Fallo subida de ${item.originalName}`, e);
                    throw e; // Relanzamos para detener la cadena y mostrar botón reintentar
                }

                completed++;
            }

            // Todo OK
            setUploading(false);
            setLocalFileMap({});
            setPendingManifest([]);
            setShowSuccessModal(true);
            addToast('Pedido completado y archivos subidos', 'success');

        } catch (err) {
            console.error("❌ Error en secuencia de subida:", err);
            setUploadError(true);
            // El usuario podrá reintentar con el botón del modal
            // Cortamos el array original desde donde falló para el reintento
            const remaining = manifest.slice(completed);
            setPendingManifest(remaining);
            addToast("Hubo un error al subir archivos. Reintenta.", "error");
        }
    };

    // Dynamic Priorities
    const [prioritiesList, setPrioritiesList] = useState([]);

    // Mock user stock if not present (to satisfy mockup requirements)
    const userStock = user?.stock || [
        { id: 'S001', name: 'Gorras Trucker Negras (x50)' },
        { id: 'S002', name: 'Remeras Algodón L (x100)' },
        { id: 'S003', name: 'MDF 3mm Propio (x20 placas)' },
        { id: 'S004', name: 'Tela Set Poliéster Blanca (Rollos)' },
    ];

    useEffect(() => {
        // Load Priorities
        apiClient.get('/nomenclators/priorities').then(res => {
            if (res.success && res.data.length > 0) {
                setPrioritiesList(res.data);
                setUrgency(res.data[0].Nombre); // Default first one
            } else {
                // Fallback default
                setPrioritiesList([{ IdPrioridad: 0, Nombre: 'Normal', Color: '#fff' }, { IdPrioridad: 1, Nombre: 'Urgente', Color: '#fbbf24' }]);
                setUrgency('Normal');
            }
        });
    }, []);

    // Dynamic Data
    const [uniqueVariants, setUniqueVariants] = useState([]);
    const [dynamicMaterials, setDynamicMaterials] = useState([]);

    // --- Especialidades para Corte/Costura ---
    const [moldType, setMoldType] = useState('SUBLIMACION');
    const [fabricOrigin, setFabricOrigin] = useState('TELA SUBLIMADA EN USER');
    const [clientFabricName, setClientFabricName] = useState('');
    const [activeSubOrders, setActiveSubOrders] = useState([]);
    const [selectedSubOrderId, setSelectedSubOrderId] = useState('');
    const [tizadaFiles, setTizadaFiles] = useState([]);
    const [pedidoExcelFile, setPedidoExcelFile] = useState(null);
    const [enableCorte, setEnableCorte] = useState(true);
    const [enableCostura, setEnableCostura] = useState(false);
    const [garmentQuantity, setGarmentQuantity] = useState('');
    const [ponchadoFiles, setPonchadoFiles] = useState([]); // Array para múltiples logos
    const [bocetoFile, setBocetoFile] = useState(null);
    const [bordadoBocetoFile, setBordadoBocetoFile] = useState(null); // Independiente para Bordado
    const [costuraNote, setCosturaNote] = useState(''); // Independiente para Costura

    // Dynamic Data for Bordado as Complement
    const [embroideryVariants, setEmbroideryVariants] = useState([]);
    const [embroideryMaterials, setEmbroideryMaterials] = useState([]);
    const [bordadoMaterial, setBordadoMaterial] = useState('');
    const [bordadoVariant, setBordadoVariant] = useState('');

    // Error Modal State
    const [errorModalOpen, setErrorModalOpen] = useState(false);
    const [errorModalMessage, setErrorModalMessage] = useState('');

    // Lógica de visibilidad dinámica de procesos
    const isCorteActive = (config.hasCuttingWorkflow && enableCorte) || selectedComplementary['TWC'] || selectedComplementary['laser'];
    const isCosturaActive = (config.hasCuttingWorkflow && enableCostura) || selectedComplementary['TWT'] || selectedComplementary['costura'];
    const hasSpecializedSection = isCorteActive || isCosturaActive;

    // Initialize defaults when serviceId changes
    useEffect(() => {
        if (!serviceInfo) return;

        setJobName('');
        // setUrgency('normal'); 
        setGeneralNote('');
        setFabricType('lisa');
        setRequiresSample(false);
        setSelectedComplementary({});
        setReferenceFiles([]);

        // Reset Especialidades
        setMoldType('SUBLIMACION');
        setFabricOrigin('TELA SUBLIMADA EN USER');
        setClientFabricName('');
        setSelectedSubOrderId('');
        setBocetoFile(null);
        setBordadoBocetoFile(null);
        setCosturaNote('');
        setTizadaFiles([]);
        setPedidoExcelFile(null);
        setEnableCorte(true);
        setEnableCostura(serviceId === 'corte-confeccion' ? true : false);

        // --- Fetch Dynamic Subtypes (Variants) & Materials ---
        const areaMap = {
            'dtf': 'DF',
            'DF': 'DF',
            'sublimacion': 'SB',
            'ecouv': 'ECOUV',
            'directa_320': 'DIRECTA',
            'directa_algodon': 'DIRECTA',
            'bordado': 'EMB',
            'laser': 'TWC',
            'tpu': 'TPU',
            'costura': 'TWT',
            'corte-confeccion': 'TWT',
            'estampado': 'EST'
        };
        const dbAreaId = areaMap[serviceId];

        if (dbAreaId) {
            // Load Variants first
            apiClient.get(`/nomenclators/variants/${dbAreaId}`).then(res => {
                if (res.success && res.data.length > 0) {
                    const variants = res.data.map(item => item.Variante);
                    setUniqueVariants(variants);

                    // Set default variant and load its materials
                    const firstVariant = variants[0];
                    setServiceSubType(firstVariant);
                    fetchMaterials(dbAreaId, firstVariant);
                } else {
                    // Fallback to static
                    setUniqueVariants([]);
                    setDynamicMaterials([]);
                    if (serviceInfo.subtypes?.length > 0) setServiceSubType(serviceInfo.subtypes[0]);
                    if (serviceInfo.materials?.length > 0) setGlobalMaterial(serviceInfo.materials[0]);
                }
            }).catch(e => {
                console.warn('Error fetching variants', e);
                setUniqueVariants([]);
                if (serviceInfo.subtypes?.length > 0) setServiceSubType(serviceInfo.subtypes[0]);
            });
        } else {
            // Fallback if no map
            if (serviceInfo.subtypes?.length > 0) setServiceSubType(serviceInfo.subtypes[0]);
            if (serviceInfo.materials?.length > 0) setGlobalMaterial(serviceInfo.materials[0]);
        }

        // Initial Item Integration
        setItems([{ id: Date.now(), file: null, fileBack: null, copies: 1, material: '', note: '', doubleSided: false, printSettings: {} }]);

    }, [serviceId, serviceInfo]);

    // Fetch Data for Bordado when used as complement
    useEffect(() => {
        const hasBordado = serviceInfo?.complementaryOptions?.some(o => o.id === 'EMB');
        if (hasBordado && serviceId !== 'bordado') {
            apiClient.get('/nomenclators/variants/EMB').then(res => {
                if (res.success && res.data.length > 0) {
                    const variants = res.data.map(item => item.Variante);
                    setEmbroideryVariants(variants);
                    const firstVariant = variants[0];
                    setBordadoVariant(firstVariant);
                    fetchEmbroideryMaterials(firstVariant);
                }
            });
        }
    }, [serviceId, serviceInfo]);

    const fetchEmbroideryMaterials = (variante) => {
        apiClient.get(`/nomenclators/materials/EMB/${encodeURIComponent(variante)}`).then(res => {
            if (res.success) {
                setEmbroideryMaterials(res.data);
                if (res.data.length > 0) setBordadoMaterial(res.data[0].Material);
            }
        });
    };

    useEffect(() => {
        if (moldType === 'SUBLIMACION') {
            apiClient.get('/web-orders/active-sublimation').then(res => {
                if (res.success) {
                    setActiveSubOrders(res.data);
                    if (res.data.length > 0) setSelectedSubOrderId(res.data[0].CodigoOrden);
                }
            });
            setFabricOrigin('TELA SUBLIMADA EN USER');
        }
    }, [moldType]);

    // Fetch Materials for a Specific Variant
    const fetchMaterials = (areaId, variante) => {
        if (!areaId || !variante) return;

        apiClient.get(`/nomenclators/materials/${areaId}/${encodeURIComponent(variante)}`).then(res => {
            if (res.success && res.data.length > 0) {
                setDynamicMaterials(res.data);
                // Select first material by default
                const firstMat = res.data[0];
                setGlobalMaterial(firstMat.Material);
                // Sincronizar items que no han sido editados manualmente o están vacíos
                setItems(curr => curr.map(it => ({ ...it, material: firstMat.Material })));
            } else {
                setDynamicMaterials([]);
                setGlobalMaterial('');
            }
        }).catch(e => {
            console.error('Error fetching materials', e);
            setDynamicMaterials([]);
        });
    };

    const handleGlobalMaterialChange = (newMat) => {
        setGlobalMaterial(newMat);
        // Cuando cambiamos el material global, actualizamos TODOS los items
        // para mantener la homogeneidad y evitar segmentación accidental
        setItems(prev => prev.map(item => ({ ...item, material: newMat })));
    };

    // Update Materials when SubType changes
    const handleSubTypeChange = (newSubType) => {
        setServiceSubType(newSubType);

        const areaMap = {
            'dtf': 'DF',
            'DF': 'DF',
            'sublimacion': 'SB',
            'ecouv': 'ECOUV',
            'directa_320': 'DIRECTA',
            'directa_algodon': 'DIRECTA',
            'bordado': 'EMB',
            'laser': 'TWC',
            'tpu': 'TPU',
            'costura': 'TWT',
            'corte-confeccion': 'TWT',
            'estampado': 'EST'
        };
        const dbAreaId = areaMap[serviceId];

        if (dbAreaId && newSubType) {
            fetchMaterials(dbAreaId, newSubType);
        }
    };

    if (!serviceInfo) {
        return <div className="p-8 text-center">Servicio no encontrado</div>;
    }

    // --- Handlers ---

    const addItem = () => {
        const lastItem = items[items.length - 1];
        const newMaterial = lastItem ? lastItem.material : globalMaterial;
        setItems([...items, { id: Date.now(), file: null, fileBack: null, copies: 1, material: newMaterial, note: '', doubleSided: false, printSettings: {} }]);
    };

    const removeItem = (id) => {
        if (items.length > 1) setItems(items.filter(item => item.id !== id));
    };

    const updateItem = (id, field, value) => {
        setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
    };

    const toggleComplementary = (id) => {
        const corteIds = ['laser', 'TWC'];
        const costuraIds = ['costura', 'TWT'];

        // Regla 1: Costura implica Corte
        if (costuraIds.includes(id)) {
            setSelectedComplementary(prev => {
                const isActive = prev[id] || costuraIds.some(cid => prev[cid]);
                if (!isActive) {
                    addToast('El servicio de costura requiere automáticamente el servicio de corte.', 'info');
                    const updated = { ...prev };
                    updated[id] = { active: true, text: '', file: null, fields: {} };
                    const targetCorteId = serviceId === 'sublimacion' ? 'TWC' : 'laser';
                    if (!updated[targetCorteId]) updated[targetCorteId] = { active: true, text: '', file: null, fields: {} };

                    // Reset specialized states if needed
                    setEnableCorte(true);
                    setEnableCostura(true);

                    return updated;
                } else {
                    const updated = { ...prev };
                    costuraIds.forEach(cid => delete updated[cid]);
                    setEnableCostura(false);
                    return updated;
                }
            });
            return;
        }

        // Regla 2: Quitar Corte implicar quitar Costura
        if (corteIds.includes(id)) {
            setSelectedComplementary(prev => {
                const isActive = prev[id] || corteIds.some(cid => prev[cid]);
                if (isActive) {
                    // Check if any costura is active
                    if (costuraIds.some(cid => prev[cid])) {
                        addToast('Se desactivará también el servicio de costura.', 'info');
                    }
                    const updated = { ...prev };
                    corteIds.forEach(cid => delete updated[cid]);
                    costuraIds.forEach(cid => delete updated[cid]);
                    setEnableCorte(false);
                    setEnableCostura(false);
                    return updated;
                } else {
                    const updated = { ...prev };
                    updated[id] = { active: true, text: '', file: null, fields: {} };
                    setEnableCorte(true);
                    return updated;
                }
            });
            return;
        }

        setSelectedComplementary(prev => {
            if (prev[id]) {
                const updated = { ...prev };
                delete updated[id];
                return updated;
            }

            const opt = serviceInfo.complementaryOptions.find(o => o.id === id);
            const initialFields = {};
            if (opt?.fields) {
                opt.fields.forEach(f => {
                    initialFields[f.name] = f.type === 'select' ? f.options[0] : '';
                });
            }

            return {
                ...prev,
                [id]: { active: true, text: '', file: null, fields: initialFields }
            };
        });
    };

    const updateComplementaryField = (id, fieldName, value) => {
        setSelectedComplementary(prev => ({
            ...prev,
            [id]: {
                ...prev[id],
                fields: {
                    ...(prev[id]?.fields || {}),
                    [fieldName]: value
                }
            }
        }));
    };

    const updateComplementaryText = (id, text) => {
        setSelectedComplementary(prev => ({
            ...prev,
            [id]: { ...prev[id], text }
        }));
    };

    const updateComplementaryFile = (id, fileData) => {
        setSelectedComplementary(prev => ({
            ...prev,
            [id]: { ...prev[id], file: fileData }
        }));
    };

    const addReferenceFile = () => {
        setReferenceFiles([...referenceFiles, { id: Date.now(), name: '', type: 'Boceto', fileData: null }]);
    };

    const removeReferenceFile = (id) => {
        setReferenceFiles(referenceFiles.filter(f => f.id !== id));
    };

    const updateReferenceFile = (id, field, value) => {
        setReferenceFiles(referenceFiles.map(f => f.id === id ? { ...f, [field]: value } : f));
    };

    const handleReferenceFileUpload = async (id, file) => {
        try {
            const result = await fileService.uploadFile(file);
            updateReferenceFile(id, 'fileData', result);
            addToast('Archivo de referencia cargado');
        } catch (err) {
            addToast(err.message, 'error');
        }
    };

    const handleSpecializedFileUpload = async (setter, file) => {
        if (!file) return;
        try {
            const result = await fileService.uploadFile(file);
            setter(result);
            addToast('Archivo adjunto');
        } catch (err) {
            addToast(err.message, 'error');
        }
    };

    const handleMultipleSpecializedFileUpload = async (setter, files) => {
        if (!files || files.length === 0) return;
        try {
            const newFiles = [];
            for (const file of files) {
                const result = await fileService.uploadFile(file);
                newFiles.push(result);
            }
            setter(prev => [...prev, ...newFiles]);
            addToast(`${newFiles.length} archivos adjuntos`);
        } catch (err) {
            addToast(err.message, 'error');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!jobName.trim()) return addToast('Nombre del proyecto requerido', 'error');

        // Validar Configuración de Impresión (Escala/Raport)
        const invalidPrintSettings = items.some(it => it.printSettings?.isValid === false);
        if (invalidPrintSettings) {
            return addToast('Hay errores en la configuración de impresión (Ancho excedido o invalido). Revise los items marcados en rojo.', 'error');
        }

        // Validación obligatoria para moldes de clientes
        if (config.hasCuttingWorkflow && moldType === 'MOLDES CLIENTES' && (!tizadaFiles || tizadaFiles.length === 0)) {
            return addToast('Debe subir al menos un archivo de tizada para moldes de clientes', 'error');
        }

        setLoading(true);

        try {
            // --- 1. PREPARACIÓN DE MAPA DE ARCHIVOS (Para Segunda Fase) ---
            const filesToUploadMap = {};
            const addToMap = (f) => {
                if (f && f.name) {
                    // El objeto fileData es el File nativo que necesitamos para FormData
                    if (f.fileData && f.fileData instanceof File) {
                        filesToUploadMap[f.name] = f.fileData;
                    } else if (f instanceof File) {
                        filesToUploadMap[f.name] = f;
                    }
                }
            };

            // Recolectar de Referencias Especiales
            if (bocetoFile) addToMap(bocetoFile);
            if (bordadoBocetoFile) addToMap(bordadoBocetoFile);

            if (tizadaFiles && tizadaFiles.length > 0) {
                tizadaFiles.forEach(tf => addToMap(tf)); // tf tiene {name, fileData} o es File? Revisar fileService
            }
            if (pedidoExcelFile) addToMap(pedidoExcelFile); // fileService return

            if (ponchadoFiles && ponchadoFiles.length > 0) {
                ponchadoFiles.forEach(pf => addToMap(pf));
            }

            // Recolectar referencias generales
            if (referenceFiles && referenceFiles.length > 0) {
                referenceFiles.forEach(rf => addToMap(rf));
            }

            // Recolectar de Servicios Extras
            if (selectedComplementary) {
                Object.keys(selectedComplementary).forEach(id => {
                    const comp = selectedComplementary[id];
                    if (comp.active && comp.file) {
                        addToMap(comp.file);
                    }
                });
            }

            // Mapeo de Materiales a Códigos (Helper interno)
            const mapMaterial = (matName, areaId = null) => {
                const searchList = areaId === 'EMB' ? embroideryMaterials : dynamicMaterials;
                const found = searchList.find(m => m.Material === matName);
                if (found) return { name: found.Material, codArt: found.CodArticulo, codStock: found.CodStock };
                return { name: matName };
            };

            // Enriquecer servicios complementarios con cabeceras (METADATA SOLO)
            const enrichedComplementary = {};
            if (selectedComplementary) {
                Object.keys(selectedComplementary).forEach(id => {
                    const comp = selectedComplementary[id];
                    if (comp.active) {
                        let cabecera = { variante: serviceSubType, material: mapMaterial(globalMaterial) };
                        if (id === 'TWC' || id === 'laser') {
                            cabecera = { variante: 'Corte Laser', material: { name: 'Corte Laser por prenda', codArt: '111', codStock: '1.1.6.1' } };
                        } else if (id === 'EST' || id === 'estampado') {
                            cabecera = { variante: 'Estampado', material: { name: 'Estampado por bajada', codArt: '110', codStock: '1.1.5.1' } };
                        } else if (id === 'EMB' || id === 'BORDADO') {
                            cabecera = { variante: bordadoVariant || serviceSubType, material: mapMaterial(bordadoMaterial || globalMaterial, 'EMB') };
                        }

                        enrichedComplementary[id] = {
                            activo: comp.active,
                            observacion: comp.text,
                            archivo: comp.file ? { name: comp.file.name, size: comp.file.size } : null, // SOLO METADATA
                            campos: comp.fields,
                            cabecera
                        };
                    }
                });
            }

            // --- ESTRUCTURA DE LINEAS Y SUBLINEAS ---
            const grupos = {};
            items.forEach(it => {
                const matInfo = mapMaterial(it.material);
                const key = `${matInfo.name}|${serviceSubType}`.toUpperCase();

                if (!grupos[key]) {
                    grupos[key] = {
                        cabecera: {
                            material: matInfo.name,
                            variante: serviceSubType,
                            codArticulo: matInfo.codArt,
                            codStock: matInfo.codStock
                        },
                        sublineas: []
                    };
                }

                // Add to Map
                if (it.file) addToMap(it.file);
                if (it.fileBack) addToMap(it.fileBack);

                const printNote = it.printSettings?.observation ? ` [${it.printSettings.observation}]` : '';

                // Lógica de Impresión Especial (Escala / Raport)
                const isSpecialPrint = it.printSettings?.mode && it.printSettings.mode !== 'normal';

                // DEFINIR MEDIDAS FINALES EN METROS (Usuario: "NO PX, METROS")
                // Si viene de PDF Vectorial (unit: 'meters'), usar valor directo. Si es imagen (px), convertir.
                const finalWidthM = isSpecialPrint && it.printSettings.finalWidthM
                    ? parseFloat(it.printSettings.finalWidthM)
                    : (it.file?.width ? (it.file.unit === 'meters' ? it.file.width : (it.file.width / 300) * 0.0254) : 0);

                const finalHeightM = isSpecialPrint && it.printSettings.finalHeightM
                    ? parseFloat(it.printSettings.finalHeightM)
                    : (it.file?.height ? (it.file.unit === 'meters' ? it.file.height : (it.file.height / 300) * 0.0254) : 0);

                // Forzar cantidad a 1 si es Raport/Escala
                const finalQty = isSpecialPrint ? 1 : it.copies;

                grupos[key].sublineas.push({
                    archivoPrincipal: it.file ? {
                        name: it.file.name,
                        width: finalWidthM,
                        height: finalHeightM,
                        observaciones: it.printSettings?.observation || '' // ENVIAR A ARCHIVOSORDEN
                    } : null,
                    archivoDorso: it.fileBack ? { name: it.fileBack.name } : null,
                    cantidad: finalQty,
                    nota: (it.note || '') + printNote,
                    printSettings: it.printSettings,
                    width: finalWidthM,
                    height: finalHeightM,
                    widthBack: it.fileBack ? finalWidthM : undefined,
                    heightBack: it.fileBack ? finalHeightM : undefined
                });
            });

            // Caso BORDADO solo
            if (Object.keys(grupos).length === 0 && (serviceId === 'bordado' || !config.requiresProductionFiles)) {
                const matInfo = mapMaterial(globalMaterial);
                const key = `${matInfo.name}|${serviceSubType}`.toUpperCase();
                const sublineas = (ponchadoFiles.length > 0 ? ponchadoFiles : [null]).map((logo, idx) => ({
                    archivoPrincipal: logo ? { name: logo.name } : null,
                    cantidad: garmentQuantity || 1,
                    nota: `Logo ${idx + 1} - Bordado`
                }));

                grupos[key] = {
                    cabecera: {
                        material: matInfo.name,
                        variante: serviceSubType,
                        codArticulo: matInfo.codArt,
                        codStock: matInfo.codStock
                    },
                    sublineas
                };
            }

            // Payload Solo Metadata
            const payload = {
                idServicio: serviceId,
                nombreTrabajo: jobName,
                prioridad: urgency,
                notasGenerales: (items.some(it => it.printSettings?.mode && it.printSettings.mode !== 'normal')
                    ? '[CONTIENE ARCHIVOS CON ESCALA/RAPORT] '
                    : '') + generalNote,
                configuracion: {
                    materialBase: mapMaterial(globalMaterial),
                    varianteBase: serviceSubType,
                    tipoTela: fabricType
                },
                especificacionesCorte: config.hasCuttingWorkflow ? {
                    tipoMolde: moldType,
                    origenTela: fabricOrigin,
                    nombreTelaCliente: clientFabricName,
                    idOrdenSublimacionVinc: selectedSubOrderId,
                    habilitarCorte: enableCorte,
                    habilitarCostura: enableCostura,
                    cabeceraCorte: enableCorte ? { codArticulo: '111', codStock: '1.1.6.1', material: 'Corte Laser por prenda', variante: 'Corte Laser' } : null
                } : null,
                especificacionesBordado: (serviceId === 'bordado' || selectedComplementary['EMB']?.active || selectedComplementary['EMB']?.activo) ? {
                    cantidadPrendas: garmentQuantity,
                    boceto: bordadoBocetoFile ? { name: bordadoBocetoFile.name } : (bocetoFile ? { name: bocetoFile.name } : null),
                    logos: ponchadoFiles.map(p => ({ name: p.name })),
                    material: bordadoMaterial || globalMaterial,
                    variante: bordadoVariant || serviceSubType
                } : null,
                especificacionesCostura: (serviceId === 'costura' || serviceId === 'corte-confeccion' || selectedComplementary['costura']?.active || selectedComplementary['costura']?.activo || selectedComplementary['TWT']?.active) ? {
                    instrucciones: costuraNote
                } : null,
                lineas: Object.values(grupos),
                archivosReferencia: referenceFiles.map(rf => ({
                    nombre: rf.name,
                    tipo: rf.type
                })),
                archivosTecnicos: [ // Recolectamos manualmente para el payload de refs especializadas
                    ...(bocetoFile ? [{ name: bocetoFile.name, type: 'ARCHIVO DE BOCETO' }] : []),
                    ...(bordadoBocetoFile ? [{ name: bordadoBocetoFile.name, type: 'ARCHIVO DE BOCETO BORDADO' }] : []),
                    ...(tizadaFiles || []).map(tf => ({ name: tf.name, type: 'ARCHIVO DE TIZADA' })),
                    ...(pedidoExcelFile ? [{ name: pedidoExcelFile.name, type: 'ARCHIVO DE INFORMACION DE PEDIDO' }] : []),
                    ...(ponchadoFiles || []).map(pf => ({ name: pf.name, type: 'ARCHIVO DE LOGO' }))
                ],
                serviciosExtras: enrichedComplementary,
            };

            // 1. ENVIAR METADATA
            console.log("🚀 Enviando Metadata de Pedido...", payload);
            const response = await apiClient.post('/web-orders/create', payload);

            if (response.success) {
                setCreatedOrderIds(response.orderIds || []);

                // 2. INICIAR UPLOAD STREAMING SI ES NECESARIO
                if (response.requiresUpload && response.uploadManifest) {
                    await handleUploadProcess(response.uploadManifest, filesToUploadMap);
                } else {
                    setShowSuccessModal(true);
                    addToast('Pedido enviado con éxito', 'success');
                }
            }
        } catch (error) {
            console.error(error);
            addToast(error.message || 'Error al enviar pedido', 'error');
        } finally {
            setLoading(false);
        }
    };


    const handleFileUpload = async (itemId, field, file) => {
        if (!file) return;

        // Validación de Formato de Producción (JPG, PNG, PDF)
        const allowed = ['image/png', 'image/jpeg', 'application/pdf'];
        const isAllowed = allowed.includes(file.type) || file.name.toLowerCase().match(/\.(jpg|jpeg|png|pdf)$/);

        if (!isAllowed) {
            addToast('Formato de archivo inválido, debe ajustarse a los formatos establecidos.', 'error');
            return;
        }

        try {
            const result = await fileService.uploadFile(file);

            // --- VALIDACION DE ANCHO IMPRIMIBLE ---
            // Solo si tenemos medida y material configurado
            if (result.width && !result.measurementError) {
                let selectedMatName = globalMaterial;

                // Si es configuración por ítem (ni single ni hidden), buscamos el material específico del ítem
                if (!config.singleMaterial && !config.hideMaterial) {
                    const currentItem = items.find(it => it.id === itemId);
                    if (currentItem && currentItem.material) {
                        selectedMatName = currentItem.material;
                    }
                }

                // Buscamos el material en la lista dinámica para obtener su Ancho
                const matObj = dynamicMaterials.find(m => m.Material === selectedMatName);

                if (matObj && matObj.Ancho) {
                    // Si la unidad ya es metros (PDF vectorial), usamos el valor directo.
                    // Si es píxeles (Imagen), convertimos asumiendo 300 DPI.
                    const fileWidthM = result.unit === 'meters'
                        ? result.width
                        : (result.width / 300) * 0.0254;

                    const maxWidth = parseFloat(matObj.Ancho);

                    if (fileWidthM > maxWidth) {
                        setErrorModalMessage(
                            `El ancho del archivo (${fileWidthM.toFixed(3)}m) excede el ancho imprimible del material "${selectedMatName}" (${maxWidth}m). Por favor, ajuste el archivo o seleccione otro material.`
                        );
                        setErrorModalOpen(true);
                        // Limpiamos el input file reseteando la referencia si fuera necesario, 
                        // pero como updateItem no se llama, el estado del item no cambia.
                        return;
                    }
                }
            }
            // --- FIN VALIDACION ---

            // Si hubo error de medida, lo agregamos a la nota del item automáticamente y DAMOS ALERTA
            if (result.measurementError) {
                // Alerta prominente según solicitud
                addToast(`ALERTA TÉCNICA: El archivo se cargó pero no pudo ser medido automáticamente. (${result.measurementError})`, 'warning');

                setItems(prev => prev.map(it => {
                    if (it.id === itemId) {
                        const errorMsg = `[NO PUDO MEDIR: ${result.measurementError.toUpperCase()}]`;
                        const currentNote = it.note || '';
                        return {
                            ...it,
                            [field]: result,
                            note: currentNote.includes(errorMsg) ? currentNote : (errorMsg + " " + currentNote).trim()
                        };
                    }
                    return it;
                }));
            } else {
                updateItem(itemId, field, result);
                addToast('Archivo listo (Medida Detectada)', 'success');
            }
        } catch (err) {
            addToast(err.message, 'error');
        }
    };

    const isBlackoutSelected = serviceId === 'directa_320' && globalMaterial === 'Lona Blackout';

    // Configuración Dinámica (CMS)
    const currentCode = (() => {
        const areaMapLocal = {
            'dtf': 'DF',
            'DF': 'DF',
            'sublimacion': 'SB',
            'ecouv': 'ECOUV',
            'directa_320': 'DIRECTA',
            'directa_algodon': 'DIRECTA', // Asumiendo que comparte código o es otro
            'bordado': 'EMB',
            'laser': 'TWC',
            'tpu': 'TPU',
            'costura': 'TWT',
            'corte-confeccion': 'TWT',
            'estampado': 'EST'
        };
        return areaMapLocal[serviceId] || (serviceId ? serviceId.toUpperCase() : '');
    })();

    const specificConfig = visibleConfig ? visibleConfig[currentCode] : null;

    return (
        <div className="animate-fade-in pb-20">

            {/* 📢 INFORMACIÓN ADICIONAL DEL SERVICIO (SI EXISTE) */}
            {specificConfig && (specificConfig.description || specificConfig.image) && (
                <div className="mb-8 animate-fade-in-down">
                    <GlassCard className="border-l-4 border-l-amber-500 overflow-hidden !p-0">
                        <div className="flex flex-col md:flex-row">
                            {specificConfig.image && (
                                <div className="w-full md:w-1/3 min-h-[200px] md:min-h-0 bg-zinc-100 relative">
                                    <img
                                        src={specificConfig.image}
                                        alt="Guía del Servicio"
                                        className="absolute inset-0 w-full h-full object-cover transform hover:scale-105 transition-transform duration-500"
                                        onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                    />
                                </div>
                            )}
                            <div className={`flex-1 flex flex-col justify-center p-6 ${!specificConfig.image ? 'w-full' : ''}`}>
                                <h3 className="text-xl font-bold text-amber-600 mb-3 flex items-center gap-2">
                                    <i className="fa-solid fa-circle-info"></i> Información Importante
                                </h3>
                                {specificConfig.description && (
                                    <div className="prose prose-zinc prose-sm max-w-none whitespace-pre-wrap text-zinc-600 leading-relaxed font-medium">
                                        {specificConfig.description}
                                    </div>
                                )}
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <CustomButton variant="ghost" onClick={() => navigate('/')} icon={ArrowLeft}>
                    Volver
                </CustomButton>
                <div>
                    <h2 className="text-2xl font-bold text-neutral-800 flex items-center gap-2">
                        Nuevo Pedido: <span className="text-black">{serviceInfo.label}</span>
                    </h2>
                    <p className="text-sm text-neutral-500">{serviceInfo.desc}</p>
                </div>
            </div>

            {config.dependencyWarning && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r flex items-start gap-3">
                    <AlertTriangle className="text-amber-500 flex-shrink-0" />
                    <div>
                        <h4 className="font-bold text-amber-800 text-sm">Requisito Previo</h4>
                        <p className="text-sm text-amber-700">{config.dependencyWarning}</p>
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">

                {/* 1. SECCION SUPERIOR: CONFIGURACION */}
                <div className="w-full">
                    <GlassCard title="1. Configuración del Trabajo">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                                <FormInput
                                    label="Nombre del Proyecto / Trabajo *"
                                    placeholder="Ej: Camisetas Verano 2024"
                                    value={jobName}
                                    onChange={(e) => setJobName(e.target.value)}
                                    required
                                />
                            </div>

                            {(uniqueVariants.length > 0 || serviceInfo.subtypes) && (
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-2">Sub-Categoría (Variante) *</label>
                                    <select
                                        className="w-full p-2.5 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-black outline-none bg-white/50 backdrop-blur-sm"
                                        value={serviceSubType}
                                        onChange={(e) => handleSubTypeChange(e.target.value)}
                                    >
                                        {(uniqueVariants.length > 0 ? uniqueVariants : (serviceInfo.subtypes || [])).map(type => (
                                            <option key={type} value={type}>{type}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-neutral-700 mb-2">Prioridad / Modalidad *</label>
                                <div className="flex bg-neutral-100 p-1 rounded-lg gap-1">
                                    {(prioritiesList && prioritiesList.length > 0) ? (
                                        prioritiesList.map((param) => (
                                            <button
                                                key={param.IdPrioridad || param.Nombre}
                                                type="button"
                                                onClick={() => setUrgency(param.Nombre)}
                                                style={{
                                                    backgroundColor: urgency === param.Nombre ? (param.Color === '#ffffff' ? '#FFF' : '#FEF3C7') : 'transparent',
                                                    color: urgency === param.Nombre && param.Color !== '#ffffff' ? '#D97706' : '#52525B'
                                                }}
                                                className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2 ${urgency === param.Nombre ? 'shadow-sm' : 'hover:bg-zinc-200'}`}
                                            >
                                                {param.Nombre !== 'Normal' && <Zap size={14} />}
                                                {param.Nombre}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="text-xs text-zinc-500 p-2 w-full text-center">Cargando...</div>
                                    )}
                                </div>
                            </div>

                            {!config.singleMaterial && (uniqueVariants.length > 0 || serviceInfo.materials) && (
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-neutral-700 mb-2">{serviceInfo.materialLabel || 'Material / Soporte (Global)'} *</label>
                                    <select
                                        className="w-full p-2.5 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-black outline-none bg-white/50"
                                        value={globalMaterial}
                                        onChange={(e) => handleGlobalMaterialChange(e.target.value)}
                                        disabled={uniqueVariants.length > 0 && dynamicMaterials.length === 0}
                                    >
                                        <option value="" disabled>Seleccionar material...</option>
                                        {(uniqueVariants.length > 0 ? dynamicMaterials : (serviceInfo.materials || [])).map(mat => {
                                            const label = mat.Material || mat;
                                            return <option key={label} value={label}>{label}</option>;
                                        })}
                                    </select>
                                </div>
                            )}

                        </div>
                    </GlassCard>
                </div>

                {/* 1.5 SECCIÓN ESPECIAL CORTE Y COSTURA (Solo para pedidos principales de Corte/Costura) */}
                {config.hasCuttingWorkflow && serviceId !== 'sublimacion' && (
                    <GlassCard>
                        <div className="p-2">
                            {/* Header Principal con Toggles Integrados */}
                            <div className="flex flex-col gap-6 mb-12">
                                <div className="flex items-center gap-4 border-b border-zinc-100 pb-8">
                                    <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center shadow-xl rotate-3">
                                        <Scissors size={24} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black tracking-tight text-zinc-900 uppercase">Configuración de Procesos</h2>
                                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Seleccione los servicios a realizar tecnicamente</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {/* BLOQUE TÉCNICO: CORTE */}
                                    <div className={`rounded-3xl border-2 transition-all duration-500 overflow-hidden ${enableCorte ? 'border-black bg-white shadow-lg' : 'border-zinc-100 bg-zinc-50/50'}`}>
                                        <label className={`flex items-center justify-between p-6 cursor-pointer transition-colors ${enableCorte ? 'bg-black text-white' : 'hover:bg-zinc-100'}`}>
                                            <div className="flex items-center gap-4">
                                                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${enableCorte ? 'border-white bg-white/20' : 'border-zinc-300 bg-white'}`}>
                                                    <Check size={16} className={`transition-all duration-300 ${enableCorte ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                                                </div>
                                                <div>
                                                    <span className="text-xs font-black uppercase tracking-widest">1. Servicio de Corte / Moldes</span>
                                                    <p className={`text-[9px] font-bold uppercase tracking-tight ${enableCorte ? 'text-zinc-400' : 'text-zinc-400'}`}>Configuración de tizadas y origen de material</p>
                                                </div>
                                            </div>
                                            <input type="checkbox" className="hidden" checked={enableCorte} onChange={() => setEnableCorte(!enableCorte)} />
                                            {enableCorte ? <Zap className="text-amber-400" size={18} /> : <span className="text-[9px] font-black text-zinc-300">INACTIVO</span>}
                                        </label>

                                        <div className={`transition-all duration-500 ease-in-out ${enableCorte ? 'max-h-[1000px] opacity-100 p-6' : 'max-h-0 opacity-0'} overflow-hidden`}>
                                            <CorteTechnicalUI
                                                serviceId={serviceId}
                                                moldType={moldType}
                                                setMoldType={setMoldType}
                                                fabricOrigin={fabricOrigin}
                                                setFabricOrigin={setFabricOrigin}
                                                clientFabricName={clientFabricName}
                                                setClientFabricName={setClientFabricName}
                                                selectedSubOrderId={selectedSubOrderId}
                                                setSelectedSubOrderId={setSelectedSubOrderId}
                                                activeSubOrders={activeSubOrders}
                                                tizadaFiles={tizadaFiles}
                                                setTizadaFiles={setTizadaFiles}
                                                handleMultipleSpecializedFileUpload={handleMultipleSpecializedFileUpload}
                                                compact={true}
                                            />
                                        </div>
                                    </div>

                                    {/* BLOQUE TÉCNICO: COSTURA */}
                                    <div className={`rounded-3xl border-2 transition-all duration-500 overflow-hidden ${enableCostura ? 'border-black bg-white shadow-lg' : 'border-zinc-100 bg-zinc-50/50'}`}>
                                        <label className={`flex items-center justify-between p-6 cursor-pointer transition-colors ${enableCostura ? 'bg-black text-white' : 'hover:bg-zinc-100'}`}>
                                            <div className="flex items-center gap-4">
                                                <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${enableCostura ? 'border-white bg-white/20' : 'border-zinc-300 bg-white'}`}>
                                                    <Check size={16} className={`transition-all duration-300 ${enableCostura ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                                                </div>
                                                <div>
                                                    <span className="text-xs font-black uppercase tracking-widest">2. Servicio de Costura / Confección</span>
                                                    <p className={`text-[9px] font-bold uppercase tracking-tight ${enableCostura ? 'text-zinc-400' : 'text-zinc-400'}`}>Instrucciones de armado y terminación</p>
                                                </div>
                                            </div>
                                            <input type="checkbox" className="hidden" checked={enableCostura} onChange={() => setEnableCostura(!enableCostura)} />
                                            {enableCostura ? <Scissors className="text-amber-400" size={18} /> : <span className="text-[9px] font-black text-zinc-300">INACTIVO</span>}
                                        </label>

                                        <div className={`transition-all duration-500 ease-in-out ${enableCostura ? 'max-h-[1000px] opacity-100 p-6' : 'max-h-0 opacity-0'} overflow-hidden`}>
                                            <CosturaTechnicalUI
                                                isCorteActive={enableCorte}
                                                costuraNote={costuraNote}
                                                setCosturaNote={setCosturaNote}
                                                compact={true}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* CONTENEDOR 3: ARCHIVOS GENERALES DEL PEDIDO */}
                            <div className="bg-white rounded-[2.5rem] p-8 border border-zinc-100 shadow-sm">
                                <div className="flex items-center gap-3 mb-10">
                                    <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">FINAL</span>
                                    <h3 className="text-sm font-black text-zinc-800 uppercase tracking-widest">Documentación y Planillas</h3>
                                </div>

                                {/* Link de Descarga y Carga de Pedido */}
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-12">
                                    <div className="md:col-span-4 space-y-4">
                                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-2">1. Descargar Plantillas</p>
                                        <div className="flex flex-col gap-3">
                                            {config.templateButtons?.map(btn => (
                                                <a key={btn.label} href={btn.url} download className="flex items-center justify-between bg-zinc-50 hover:bg-zinc-100 p-4 rounded-2xl border border-zinc-100 transition-all no-underline group">
                                                    <span className="text-[10px] font-black text-zinc-600 group-hover:text-black">{btn.label}</span>
                                                    <Download size={18} className="text-zinc-300 group-hover:text-black" />
                                                </a>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="md:col-span-4">
                                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4 pl-2 text-center">2. Cargar Planilla de Pedido</p>
                                        <FileUploadZone
                                            id="pedido-upload"
                                            label="SUBIR EXCEL COMPLETADO"
                                            onFileSelected={(f) => handleSpecializedFileUpload(setPedidoExcelFile, f)}
                                            selectedFile={pedidoExcelFile}
                                            color="emerald"
                                        />
                                    </div>

                                    <div className="md:col-span-4">
                                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4 pl-2 text-center">3. Cargar Boceto / Mockup</p>
                                        <FileUploadZone
                                            id="boceto-upload"
                                            label="SUBIR ARCHIVO VISUAL"
                                            onFileSelected={(f) => handleSpecializedFileUpload(setBocetoFile, f)}
                                            selectedFile={bocetoFile}
                                            color="blue"
                                        />
                                    </div>
                                </div>

                                <div className="bg-blue-50/30 p-6 rounded-3xl border border-dashed border-blue-200 flex items-center gap-4">
                                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-blue-500 shadow-sm">
                                        <ImageIcon size={20} />
                                    </div>
                                    <p className="text-[11px] text-blue-900/60 font-bold leading-relaxed uppercase">
                                        Asegúrese de subir la planilla excel correspondiente al servicio (Ropa o Varios) para que producción pueda verificar las cantidades contra los cortes.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </GlassCard>
                )}

                {/* 1.7 SECCIÓN ESPECIAL BORDADO (Como servicio principal) */}
                {serviceId === 'bordado' && (
                    <GlassCard>
                        <div className="p-2">
                            <BordadoTechnicalUI
                                serviceId={serviceId}
                                garmentQuantity={garmentQuantity}
                                setGarmentQuantity={setGarmentQuantity}
                                bocetoFile={bordadoBocetoFile}
                                setBocetoFile={setBordadoBocetoFile}
                                ponchadoFiles={ponchadoFiles}
                                setPonchadoFiles={setPonchadoFiles}
                                globalMaterial={globalMaterial}
                                handleGlobalMaterialChange={handleGlobalMaterialChange}
                                serviceInfo={serviceInfo}
                                userStock={userStock}
                                handleSpecializedFileUpload={handleSpecializedFileUpload}
                                handleMultipleSpecializedFileUpload={handleMultipleSpecializedFileUpload}
                                uniqueVariants={uniqueVariants}
                                dynamicMaterials={dynamicMaterials}
                                serviceSubType={serviceSubType}
                                handleSubTypeChange={handleSubTypeChange}
                            />
                        </div>
                    </GlassCard>
                )}

                {/* 2. SECCION DE ITEMS (Full Width) */}
                {config.requiresProductionFiles && (
                    <GlassCard title="2. Archivos de Producción">
                        <div className="space-y-6">
                            {items.map((item, index) => (
                                <div key={item.id} className="relative bg-zinc-50/30 p-6 rounded-2xl border border-zinc-200 hover:border-zinc-400 transition-all shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <span className="text-xs font-black bg-zinc-900 text-white py-1 px-3 rounded-full">ARCHIVO No. {index + 1}</span>
                                        {items.length > 1 && (
                                            <button type="button" onClick={() => removeItem(item.id)} className="text-zinc-400 hover:text-red-500 transition-colors">
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                        {/* Dropzone Principal */}
                                        <div className={isBlackoutSelected ? "md:col-span-4" : "md:col-span-6"}>
                                            <FileUploadZone
                                                id={item.id}
                                                label={isBlackoutSelected ? "Frente" : (config.productionFileLabel || "Archivo de Producción")}
                                                selectedFile={item.file}
                                                onFileSelected={(f) => handleFileUpload(item.id, 'file', f)}
                                            />
                                            {item.file && (item.file.width || item.file.type) && (
                                                <div className="bg-zinc-100 text-[10px] font-bold text-zinc-600 px-2 py-1 rounded-md border border-zinc-200 flex items-center gap-1.5 mt-2 w-fit">
                                                    <FileCode size={12} className="text-blue-500" />
                                                    {item.file.type?.split('/')[1]?.toUpperCase() || 'FILE'}
                                                    {item.file.width && ` • ${item.file.unit === 'meters' ? item.file.width.toFixed(3) : ((item.file.width / 300) * 0.0254).toFixed(3)}x${item.file.unit === 'meters' ? item.file.height.toFixed(3) : ((item.file.height / 300) * 0.0254).toFixed(3)} M`}
                                                </div>
                                            )}
                                        </div>

                                        {/* Dropzone Dorso */}
                                        {isBlackoutSelected && (
                                            <div className="md:col-span-4">
                                                <FileUploadZone
                                                    id={item.id}
                                                    label="Dorso"
                                                    selectedFile={item.fileBack}
                                                    onFileSelected={(f) => handleFileUpload(item.id, 'fileBack', f)}
                                                    color="purple"
                                                />
                                                {item.fileBack && (item.fileBack.width || item.fileBack.type) && (
                                                    <div className="bg-zinc-100 text-[10px] font-bold text-zinc-600 px-2 py-1 rounded-md border border-zinc-200 flex items-center gap-1.5 mt-2 w-fit">
                                                        <FileCode size={12} className="text-purple-500" />
                                                        {item.fileBack.type?.split('/')[1]?.toUpperCase() || 'FILE'}
                                                        {item.fileBack.width && ` • ${item.fileBack.unit === 'meters' ? item.fileBack.width.toFixed(3) : ((item.fileBack.width / 300) * 0.0254).toFixed(3)}x${item.fileBack.unit === 'meters' ? item.fileBack.height.toFixed(3) : ((item.fileBack.height / 300) * 0.0254).toFixed(3)} M`}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Configuración del iÍem */}
                                        <div className={isBlackoutSelected ? "md:col-span-4" : "md:col-span-6"}>
                                            <div className="flex flex-col sm:flex-row gap-4">
                                                {/* (Copias movido a PrintSettingsPanel) */}

                                                {!config.singleMaterial && !config.hideMaterial && (
                                                    <div className="flex-1 min-w-0">
                                                        <label className="block text-[10px] uppercase font-bold text-zinc-500 mb-1 text-ellipsis overflow-hidden whitespace-nowrap">Material</label>
                                                        <select
                                                            className="w-full h-[45px] px-3 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-black outline-none font-medium"
                                                            value={item.material}
                                                            onChange={(e) => updateItem(item.id, 'material', e.target.value)}
                                                            disabled={uniqueVariants.length > 0 && dynamicMaterials.length === 0}
                                                        >
                                                            <option value="" disabled>Seleccionar material...</option>
                                                            {(config.useClientStock ? (userStock || []) : (uniqueVariants.length > 0 ? dynamicMaterials : (serviceInfo.materials || []))).map(mat => {
                                                                const label = mat.Material || mat.name || mat;
                                                                const val = mat.Material || mat.name || mat;
                                                                return <option key={label} value={val}>{label}</option>;
                                                            })}
                                                        </select>
                                                    </div>
                                                )}
                                            </div>

                                            {/* PANEL DE CONFIGURACIÓN DE IMPRESIÓN (ESCALA / RAPORT) */}
                                            {item.file && item.file.width && (
                                                <div className="mt-4">
                                                    {(() => {
                                                        const currentMatName = config.singleMaterial ? globalMaterial : item.material;
                                                        // Fallback logic para encontrar el ancho del material
                                                        const matList = (uniqueVariants.length > 0 ? dynamicMaterials : (serviceInfo.materials || []));
                                                        const matObj = matList.find(m => (m.Material || m.name || m) === currentMatName);
                                                        // Si no hay material seleccionado o no tiene ancho definido, usar un default amplio o 1.50
                                                        const maxW = (matObj && matObj.Ancho) ? parseFloat(matObj.Ancho) : 1.50;

                                                        const fileW_m = item.file.unit === 'meters' ? item.file.width : (item.file.width / 300) * 0.0254;
                                                        const fileH_m = item.file.unit === 'meters' ? item.file.height : (item.file.height / 300) * 0.0254;

                                                        return (
                                                            <PrintSettingsPanel
                                                                originalWidthM={fileW_m}
                                                                originalHeightM={fileH_m}
                                                                materialMaxWidthM={maxW}
                                                                values={item.printSettings || {}}
                                                                copies={item.copies}
                                                                onCopiesChange={(val) => updateItem(item.id, 'copies', val)}
                                                                onChange={(newSettings) => updateItem(item.id, 'printSettings', newSettings)}
                                                            />
                                                        );
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            <button
                                type="button"
                                onClick={addItem}
                                className="w-full py-4 border-2 border-dashed border-zinc-300 rounded-2xl text-zinc-500 hover:text-black hover:border-zinc-500 hover:bg-zinc-50 transition-all flex items-center justify-center gap-3 font-bold text-sm"
                            >
                                <Plus size={20} />
                                AGREGAR OTRA PIEZA / ARCHIVO
                            </button>
                        </div>
                    </GlassCard>
                )
                }

                {/* 3. FINALIZACION Y EXTRAS */}
                <GlassCard title="3. Finalización y Detalles">
                    {/* Complementary Services First */}
                    {serviceInfo.complementaryOptions?.length > 0 && (
                        <div className="mb-8">
                            <label className="block text-sm font-medium text-neutral-700 mb-4 flex items-center gap-2">
                                <Plus size={16} className="text-zinc-400" />
                                Servicios Complementarios / Procesos Adicionales
                            </label>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {serviceInfo.complementaryOptions.map((opt) => {
                                    // Filtrado por configuración de visibilidad (BD)
                                    if (visibleConfig && visibleConfig[opt.id]?.visible === false) {
                                        return null;
                                    }

                                    return (
                                        <div key={opt.id} className={`p-4 rounded-xl border-2 transition-all ${opt.fullWidth ? 'md:col-span-2 lg:col-span-3' : ''} ${selectedComplementary[opt.id] ? 'border-black bg-zinc-50 shadow-sm' : 'border-zinc-200 bg-white/50'}`}>
                                            <label className="flex items-center gap-3 cursor-pointer mb-3">
                                                <input
                                                    type="checkbox"
                                                    checked={!!selectedComplementary[opt.id]}
                                                    onChange={() => toggleComplementary(opt.id)}
                                                    className="w-5 h-5 accent-black rounded"
                                                />
                                                <span className="text-sm font-bold text-neutral-800 uppercase tracking-tight">{opt.label}</span>
                                            </label>

                                            {selectedComplementary[opt.id] && (opt.hasFile || opt.hasInput || opt.fields || opt.id === 'TWC' || opt.id === 'laser' || opt.id === 'TWT' || opt.id === 'costura' || opt.id === 'EMB') && (
                                                <div className="mt-3 space-y-4 pt-4 border-t border-zinc-200 animate-in fade-in slide-in-from-top-2 duration-300">
                                                    {/* Generic File Upload (Hidden for EMB as it uses the specialized block) */}
                                                    {opt.hasFile && opt.id !== 'EMB' && (
                                                        <div>
                                                            <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Cargar Croquis o Boceto</label>
                                                            <div className="flex items-center gap-2 bg-white border border-zinc-300 rounded-lg p-2">
                                                                <UploadCloud size={16} className={selectedComplementary[opt.id].file ? "text-green-500" : "text-zinc-400"} />
                                                                <input
                                                                    type="file"
                                                                    className="text-xs w-full text-zinc-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-zinc-100"
                                                                    onChange={(e) => {
                                                                        const file = e.target.files[0];
                                                                        if (file) {
                                                                            fileService.uploadFile(file).then(res => {
                                                                                updateComplementaryFile(opt.id, res);
                                                                                addToast('Archivo complementario listo');
                                                                            });
                                                                        }
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Rendering custom fields if defined */}
                                                    {opt.fields && (
                                                        <div className={`grid grid-cols-1 ${opt.fullWidth ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-2'} gap-4`}>
                                                            {opt.fields.map((f) => (
                                                                <div key={f.name} className={f.type === 'text' ? 'md:col-span-2' : ''}>
                                                                    <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">{f.label}</label>
                                                                    {f.type === 'select' ? (
                                                                        <select
                                                                            className="w-full p-2 text-xs border border-zinc-300 rounded-lg focus:ring-1 focus:ring-black outline-none bg-white"
                                                                            value={selectedComplementary[opt.id]?.fields?.[f.name] || ''}
                                                                            onChange={(e) => updateComplementaryField(opt.id, f.name, e.target.value)}
                                                                        >
                                                                            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                                                                        </select>
                                                                    ) : f.type === 'text' ? (
                                                                        <textarea
                                                                            rows="2"
                                                                            className="w-full p-2 text-xs border border-zinc-300 rounded-lg focus:ring-1 focus:ring-black outline-none bg-white resize-none"
                                                                            placeholder={f.placeholder}
                                                                            value={selectedComplementary[opt.id]?.fields?.[f.name] || ''}
                                                                            onChange={(e) => updateComplementaryField(opt.id, f.name, e.target.value)}
                                                                        />
                                                                    ) : (
                                                                        <input
                                                                            type={f.type || 'text'}
                                                                            placeholder={f.placeholder}
                                                                            className="w-full p-2 text-xs border border-zinc-300 rounded-lg focus:ring-1 focus:ring-black outline-none bg-white"
                                                                            value={selectedComplementary[opt.id]?.fields?.[f.name] || ''}
                                                                            onChange={(e) => updateComplementaryField(opt.id, f.name, e.target.value)}
                                                                        />
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {opt.hasInput && !opt.fields && (
                                                        <div>
                                                            <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">{opt.inputLabel || 'Notas adicionales'}</label>
                                                            <textarea
                                                                rows="2"
                                                                className="w-full p-2 text-xs border border-zinc-300 rounded-lg focus:ring-1 focus:ring-black outline-none bg-white resize-none"
                                                                placeholder="Instrucciones específicas..."
                                                                value={selectedComplementary[opt.id].text || ''}
                                                                onChange={(e) => updateComplementaryText(opt.id, e.target.value)}
                                                            />
                                                        </div>
                                                    )}

                                                    {/* UI Arbolada para Sublimación (Ocultamos paso 1 y mostramos paso 2 directamente aquí) */}
                                                    {serviceId === 'sublimacion' && (opt.id === 'TWC' || opt.id === 'laser') && (
                                                        <div className="mt-4 border-t border-zinc-100 pt-6 animate-in slide-in-from-top duration-500">
                                                            <div className="flex items-center gap-3 mb-6 pl-1">
                                                                <span className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black rounded-lg">PASO ÚNICO</span>
                                                                <h3 className="text-xs font-black text-zinc-800 uppercase tracking-widest">Documentación del Pedido</h3>
                                                            </div>

                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                                                <div>
                                                                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-2">1. Descargar Plantillas</p>
                                                                    {config.templateButtons && config.templateButtons.map(btn => (
                                                                        <a key={btn.label} href={btn.url} download className="group flex items-center justify-between p-3 bg-white border border-zinc-200 rounded-xl hover:border-black transition-all cursor-pointer no-underline mb-2">
                                                                            <span className="text-[9px] font-black text-zinc-600 group-hover:text-black uppercase max-w-[120px] leading-tight">{btn.label}</span>
                                                                            <Download size={12} className="text-zinc-300 group-hover:text-black" />
                                                                        </a>
                                                                    ))}
                                                                </div>

                                                                <div>
                                                                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-2">2. Cargar Planilla Excel</p>
                                                                    <FileUploadZone
                                                                        id="pedido-upload-sub-inline"
                                                                        label="PLANILLA COMPLETADA"
                                                                        onFileSelected={(f) => handleSpecializedFileUpload(setPedidoExcelFile, f)}
                                                                        selectedFile={pedidoExcelFile}
                                                                        color="emerald"
                                                                    />
                                                                </div>

                                                                <div>
                                                                    <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-2">3. Cargar Boceto / Mockup</p>
                                                                    <FileUploadZone
                                                                        id="boceto-upload-sub-inline"
                                                                        label="MOCKUP VISUAL"
                                                                        onFileSelected={(f) => handleSpecializedFileUpload(setBocetoFile, f)}
                                                                        selectedFile={bocetoFile}
                                                                        color="blue"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {serviceId === 'sublimacion' && (opt.id === 'TWT' || opt.id === 'costura') && (
                                                        <div className="mt-4 animate-in slide-in-from-top duration-300">
                                                            <CosturaTechnicalUI
                                                                isCorteActive={isCorteActive}
                                                                costuraNote={costuraNote} setCosturaNote={setCosturaNote}
                                                                compact={true}
                                                            />
                                                        </div>
                                                    )}

                                                    {/* Bordado Complementary UI */}
                                                    {opt.id === 'EMB' && (
                                                        <div className="mt-4 animate-in slide-in-from-top duration-300">
                                                            <BordadoTechnicalUI
                                                                garmentQuantity={garmentQuantity}
                                                                setGarmentQuantity={setGarmentQuantity}
                                                                bocetoFile={bordadoBocetoFile}
                                                                setBocetoFile={setBordadoBocetoFile}
                                                                ponchadoFiles={ponchadoFiles}
                                                                setPonchadoFiles={setPonchadoFiles}
                                                                globalMaterial={globalMaterial}
                                                                handleGlobalMaterialChange={handleGlobalMaterialChange}
                                                                serviceInfo={serviceInfo}
                                                                userStock={userStock}
                                                                handleSpecializedFileUpload={handleSpecializedFileUpload}
                                                                handleMultipleSpecializedFileUpload={handleMultipleSpecializedFileUpload}
                                                                compact={true}
                                                                // Independent state for complement
                                                                isComplement={true}
                                                                compMaterial={bordadoMaterial}
                                                                setCompMaterial={setBordadoMaterial}
                                                                compVariant={bordadoVariant}
                                                                setCompVariant={(v) => {
                                                                    setBordadoVariant(v);
                                                                    fetchEmbroideryMaterials(v);
                                                                }}
                                                                compVariants={embroideryVariants}
                                                                compMaterials={embroideryMaterials}
                                                            />
                                                        </div>
                                                    )}

                                                    {/* Documentación Compartida - Removida de aquí para usar sección final única */}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}



                    <div className="pt-6 border-t border-zinc-100">
                        <label className="block text-sm font-medium text-neutral-700 mb-2">Nota General del Pedido</label>
                        <textarea
                            rows="2"
                            className="w-full p-3 border border-zinc-200 rounded-lg focus:ring-2 focus:ring-black outline-none bg-white/50 resize-none text-sm"
                            placeholder="Instrucciones adicionales para administración o producción..."
                            value={generalNote}
                            onChange={(e) => setGeneralNote(e.target.value)}
                        />
                    </div>
                </GlassCard>

                {/* Resumen Final (Al final de todo) */}
                <div className="mt-8">
                    <div className="bg-zinc-900 text-white p-8 rounded-3xl shadow-2xl border border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-8">
                        <div className="flex flex-wrap items-center gap-10">
                            <div>
                                <p className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Servicio</p>
                                <p className="text-xl font-bold">{serviceInfo.label}</p>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Prioridad</p>
                                <p className="text-xl font-bold text-amber-500">{urgency}</p>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Archivos</p>
                                <p className="text-2xl font-black">{items.length}</p>
                            </div>
                        </div>

                        <div className="w-full md:w-auto">
                            <CustomButton
                                type="submit"
                                variant="primary"
                                className="w-full md:px-14 py-5 bg-white text-black hover:bg-zinc-200 border-none font-bold text-lg shadow-lg transition-all active:scale-95"
                                isLoading={loading}
                                icon={Save}
                            >
                                Confirmar y Enviar a Drive
                            </CustomButton>
                        </div>
                    </div>
                </div>

            </form>

            <UploadProgressModal
                isOpen={uploading || uploadError}
                progress={uploadProgress}
                isError={uploadError}
                onRetry={() => handleUploadProcess(pendingManifest, localFileMap)}
            />

            <ErrorModal
                isOpen={errorModalOpen}
                onClose={() => setErrorModalOpen(false)}
                message={errorModalMessage}
            />

            {/* Modal de Éxito */}
            {
                showSuccessModal && createPortal(
                    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/40 animate-in fade-in duration-300">
                        <div className="bg-white rounded-[40px] shadow-2xl max-w-md w-full p-10 text-center transform animate-in zoom-in slide-in-from-bottom-10 duration-500 border border-zinc-100">
                            <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                                <CheckCircle className="w-14 h-14 text-emerald-500" />
                            </div>

                            <h2 className="text-4xl font-black text-zinc-900 mb-3 tracking-tight">¡Genial!</h2>
                            <p className="text-zinc-500 mb-10 leading-relaxed font-medium">
                                Tu pedido ha sido recibido y ya está sincronizado con producción.
                            </p>

                            <div className="bg-zinc-50 rounded-3xl p-6 mb-10 border border-zinc-100 shadow-sm">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-black mb-4">Órdenes Generadas</p>
                                <div className="flex flex-wrap justify-center gap-2">
                                    {createdOrderIds.map(id => (
                                        <div key={id} className="bg-white border border-zinc-200 rounded-2xl py-3 px-6 shadow-sm">
                                            <span className="text-zinc-900 font-bold block">{id}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col gap-4">
                                <CustomButton
                                    variant="primary"
                                    className="w-full py-5 rounded-2xl font-bold text-lg shadow-xl shadow-zinc-200"
                                    onClick={() => navigate('/factory')}
                                >
                                    Ver mis pedidos
                                </CustomButton>

                                <button
                                    onClick={() => window.location.reload()}
                                    className="text-zinc-400 text-sm font-bold hover:text-zinc-900 transition-colors uppercase tracking-widest pt-2"
                                >
                                    + CREAR OTRO PEDIDO
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }
        </div >
    );
};

