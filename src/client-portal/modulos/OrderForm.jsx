import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
    Save, UploadCloud, Plus, Trash2, ArrowLeft,
    AlertTriangle, Check, Scissors, Zap, Download,
    ImageIcon, User, FileCode, CheckCircle, ClipboardList, Layers
} from 'lucide-react';

// Custom Hooks
import { useOrderForm } from './order-form/hooks/useOrderForm';
import { useToast } from '../pautas/Toast';

// Services
import { fileService } from '../api/fileService';
import { apiClient } from '../api/apiClient';
import Swal from 'sweetalert2';
import { toast } from 'react-toastify';

// UI Components
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { FormInput } from '../pautas/FormInput';
import { PrintSettingsPanel } from '../pautas/PrintSettingsPanel';

import { CustomSelect } from '../pautas/CustomSelect';
import PlanoPieza, { COLOR_CAPA, IconoBordes, PRESETS_BORDE } from '../../components/shared/PlanoPieza';
import {
    cantidadSugerida, textoReparto, labelUbicacion,
    ladosDeUbicacion, ubicacionDeLados, LADO_NOMBRE,
    SOLDADURA_CM, profundidadBolsilloCm, margenOjalCm, pasoMaxCm
} from '../../utils/terminacionesGeo';
import { rasterizarPdf, liberarPdfPreviews } from '../api/pdfPreview';
import { medirTizada, MESA_CORTE_ANCHO_M, MESA_CORTE_LARGO_M, MARGEN_TELA_M } from './order-form/utils/medirTizada';
import ErrorModal from './order-form/components/ErrorModal';
import UploadProgressModal from './order-form/components/UploadProgressModal';
import FileUploadZone from './order-form/components/FileUploadZone';
import CorteTechnicalUI from './order-form/components/CorteTechnicalUI';
import BobinaSelector from './order-form/components/BobinaSelector';
import CosturaTechnicalUI from './order-form/components/CosturaTechnicalUI';
import BordadoTechnicalUI from './order-form/components/BordadoTechnicalUI';
import { puntadasDePaleta, estimarMinutos } from './order-form/utils/bordadoHilos';
import { EstampadoTechnicalUI } from './order-form/components/EstampadoTechnicalUI';
import EcouvTerminacionesUI from './EcouvTerminacionesUI';

const ServiceAccordion = ({ title, subtitle, isActive, onToggle, children, icon: Icon, main = false, optional = false }) => {
    return (
        <div className={`md:!rounded-3xl !rounded-none border-y !border-x-0 md:!border transition-all duration-300 ${isActive ? 'border-zinc-700 bg-custom-dark shadow-xl shadow-black/20 overflow-visible' : 'border-zinc-700/50 bg-custom-dark/60 overflow-hidden'} -mx-4 md:mx-0`}>
            <div
                className={`p-4 md:p-6 flex items-center justify-between cursor-pointer transition-colors ${isActive ? 'bg-custom-dark text-zinc-100 md:rounded-t-[1.7rem] rounded-t-none' : 'hover:bg-custom-dark text-zinc-400 md:rounded-[1.7rem] rounded-none'}`}
                onClick={onToggle}
            >
                <div className="flex items-center gap-4">
                    {Icon && <Icon size={20} className="text-brand-gold" />}
                    <div>
                        <span className="font-bold uppercase tracking-wide text-sm">{title}</span>
                        {subtitle && <p className="text-[10px] text-zinc-500 mt-0.5 md:hidden">{subtitle}</p>}
                        {optional && (
                            <p className={`text-[10px] mt-0.5 font-medium tracking-wide ${isActive ? 'text-cyan-400' : 'text-zinc-500'}`}>
                                {isActive ? '✓ Incluido en el pedido' : 'Opcional · Tocá para agregar'}
                            </p>
                        )}
                    </div>
                </div>
                {main && <span className="text-[10px] bg-cyan-400 text-zinc-900 px-2.5 py-1 rounded-full font-black tracking-wider">PRINCIPAL</span>}
                {optional && !main && (
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-black tracking-wider ${isActive ? 'bg-cyan-400/20 text-cyan-400' : 'bg-zinc-700/50 text-zinc-500'}`}>
                        {isActive ? 'ACTIVO' : '+ AGREGAR'}
                    </span>
                )}
            </div>

            {isActive && (
                <div className="p-4 md:p-6 border-t border-zinc-700/50 animate-in slide-in-from-top-4">
                    {children}
                </div>
            )}
        </div>
    );
};

// Tolerancia de ancho: distintos software de diseño exportan medidas con diferencias
// mínimas (un mismo diseño de 1.80 puede medir 1.8005 o 1.801 según la herramienta).
// Se resta al ancho medido ANTES de redondear al cm, para no rebotar por décimas de mm.
// (Mantener en sincronía con TOLERANCIA_ANCHO_M de pautas/PrintSettingsPanel.jsx.)
const TOLERANCIA_ANCHO_M = 0.002; // 2 mm

// Helper to robustly resolve material printable width from DB 'Ancho' field or fallback to regex name parsing
const resolveMaterialWidth = (matObj) => {
    if (!matObj) return 1.83;
    
    // 1. Try parsing from Ancho if it's a valid positive number
    if (matObj && matObj.Ancho !== undefined && matObj.Ancho !== null) {
        const rawAncho = typeof matObj.Ancho === 'string' 
            ? parseFloat(matObj.Ancho.replace(',', '.')) 
            : parseFloat(matObj.Ancho);
        if (!isNaN(rawAncho) && rawAncho > 0) {
            return rawAncho;
        }
    }
    
    // 2. Fallback: extract from description name
    const matName = matObj.Material || matObj.Descripcion || (typeof matObj === 'string' ? matObj : '');
    if (matName) {
        // Look for number inside parenthesis, e.g., (1,83) or (1.83) or (1,70 m)
        const parenMatch = matName.match(/\((\d+(?:[.,]\d+)?)(?:\s*m)?/);
        if (parenMatch) {
            const parsed = parseFloat(parenMatch[1].replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        
        // Look for any decimal number in the string, e.g. 1.83 or 1,83
        const numberMatch = matName.match(/(\d+(?:[.,]\d+)+)/);
        if (numberMatch) {
            const parsed = parseFloat(numberMatch[1].replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
    }

    return 1.83;
};

// TPU: el tope de medida viene en el NOMBRE del producto ("Parche (De hasta 10x8)", "Hasta 4x4",
// "ETIQUETAS OFICIALES HASTA 4X4"). No hay campo aparte en el catálogo, así que se lee de ahí.
// El primer número es el alto y el segundo el ancho. Sin medida en el nombre (ej. "TPU STANDARD")
// devuelve null y los selectores no aparecen.
const medidaMaximaTPU = (nombreMaterial) => {
    const m = String(nombreMaterial || '').match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    if (!m) return null;
    const alto = parseFloat(m[1].replace(',', '.'));
    const ancho = parseFloat(m[2].replace(',', '.'));
    if (!(alto > 0) || !(ancho > 0)) return null;
    return { alto, ancho };
};

// Opciones de 1 cm hasta el tope, incluido.
const opcionesCm = (max) => Array.from({ length: Math.floor(max) }, (_, i) => {
    const v = String(i + 1);
    return { value: v, label: `${v} cm` };
});

const OrderForm = ({ serviceId: propServiceId }) => {
    const { serviceId: paramServiceId } = useParams();
    const navigate = useNavigate();
    const { addToast } = useToast();
    const location = useLocation();

    // Allows passing overrides via navigate('/order/...', { state: { config: { allowedOptions: ['...'] } } })
    const overrideConfig = location.state?.config || {};

    // El serviceId de la URL puede venir con cualquier caja (/ORDER/TPU desde un bookmark).
    // Todo el form compara contra slugs en minúscula (=== 'tpu', 'corte', 'bordado'…), y el
    // backend mapea el área por ese slug, así que normalizamos el param a minúscula acá — si no,
    // /ORDER/TPU cae al form genérico (sin selector de matriz) y crea el pedido en área GENE.
    // propServiceId (uso interno) se deja intacto: puede ser un alias de ÁREA en mayúscula (EST/EMB).
    const serviceId = propServiceId || (paramServiceId || '').toLowerCase();
    // svcId se mantiene por las pocas reglas de material que ya lo usan; ahora coincide con serviceId.
    const svcId = (serviceId || '').toLowerCase();

    // Modal de anuncio: se muestra una sola vez por sesión para DF
    const [showDFAnnouncement, setShowDFAnnouncement] = useState(() => {
        if (serviceId?.toUpperCase() !== 'DF') return false;
        const seen = sessionStorage.getItem('df_announcement_seen');
        return !seen;
    });
    const closeDFAnnouncement = () => {
        sessionStorage.setItem('df_announcement_seen', '1');
        setShowDFAnnouncement(false);
    };

    const { state, actions, config, serviceInfo, userStock, visibleComplementaryOptions, corteServicioVisible, costuraServicioVisible } = useOrderForm(serviceId, overrideConfig);

    // Destructure state for easier access in render
    const {
        jobName, serviceSubType, urgency, generalNote, globalMaterial, fabricType,
        items, referenceFiles, selectedComplementary,
        moldType, fabricOrigin, clientFabricName, selectedSubOrderId, tizadaFiles,
        selectedBobinaId, selectedBobinaAncho, selectedBobinaMetros, bobinasDisponibles,
        pedidoExcelFile, enableCorte, enableCostura, garmentQuantity,
        ponchadoFiles, bocetoFile, bordadoBocetoFile, costuraNote,
        bordadoMaterial, bordadoVariant,
        // [BORDADO] diseños (uno por logo) y prendas del cliente con saldo
        disenosBordado, prendasDisponibles,
        // Estampado
        estampadoFile, estampadoQuantity, estampadoPrints, estampadoOrigin,
        // TPU
        tpuForma,
        loading, showSuccessModal, createdOrderIds, uploading, uploadProgress, uploadError, uploadErrorMsg,
        errorModalOpen, errorModalMessage,
        uniqueVariants, variantsInfo, dynamicMaterials, visibleConfig, prioritiesList, areasConUrgencia, portalConfig,
        activeSubOrders, embroideryVariants, embroideryMaterials
    } = state;

    // Helper for TPU Service logic
    const currentMaterials = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
    const selectedMaterialObj = currentMaterials.find(m => (m.Material || m) === globalMaterial);

    // Check by Name OR Code 1568
    const isTpuEtiquetaOficial = serviceId === 'tpu' && (
        globalMaterial === 'ETIQUETA PRODUCTO OFICIAL' ||
        globalMaterial === 'ETIQUETAS OFICIALES HASTA 4X4' ||
        (selectedMaterialObj && String(selectedMaterialObj.CodArticulo || '').trim() === '1568')
    );

    // Sublimación con Tela de Cliente: el cliente elige su bobina (mismo flujo que Corte tela cliente:
    // ancho/metros de la bobina validan el archivo y sus metros se descuentan al confirmar).
    const isSubliTelaCliente = svcId === 'sublimacion' && /tela de cliente/i.test(serviceSubType || '');

    // ECOUV: comportamiento por VARIANTE VIRTUAL elegida (services.js → variantsInfo).
    // Material Impreso     → impresión por m2. Las terminaciones que se ofrecen las
    //                        define EL MATERIAL (tabla MaterialTerminaciones): las lonas
    //                        llevan soldadura, ojales y bolsillo; el canvas, bastidor; etc.
    //                        Si el material no tiene ninguna configurada, no se muestra nada.
    // Productos Terminados → ficha con dimensiones/incluidas y precio cerrado.
    const ecouvVariantInfo = config?.variantMode === 'virtual'
        ? (variantsInfo || {})[(serviceSubType || '').trim()]
        : null;
    const isEcouvMaterial = !!ecouvVariantInfo && ecouvVariantInfo.tipoStock === 'MATERIAL';
    const isEcouvPT = !!ecouvVariantInfo && ecouvVariantInfo.tipoStock === 'PRODUCTO_TERMINADO';

    // Terminaciones permitidas POR MATERIAL (multimaterial: cada archivo puede llevar
    // otro material, así que las permitidas se cachean por nombre de material).
    const [termsPorMaterial, setTermsPorMaterial] = useState({});
    useEffect(() => { setTermsPorMaterial({}); }, [serviceSubType]);
    useEffect(() => {
        if (!isEcouvMaterial) return;
        const mats = [...new Set([globalMaterial, ...items.map(it => it.material)]
            .map(m => (m || '').trim()).filter(Boolean))];
        mats.forEach(mName => {
            if (termsPorMaterial[mName] !== undefined) return;
            const mat = (dynamicMaterials || []).find(m => (m.Material || '').trim() === mName);
            const codArt = (mat?.CodArticulo || '').trim();
            if (!codArt) return;
            apiClient.get(`/nomenclators/terminaciones-material/${encodeURIComponent(codArt)}`)
                .then(res => setTermsPorMaterial(prev => ({ ...prev, [mName]: res.success ? res.data : [] })))
                .catch(() => setTermsPorMaterial(prev => ({ ...prev, [mName]: [] })));
        });
    }, [isEcouvMaterial, globalMaterial, items, dynamicMaterials]);
    const termsDeMaterial = (mName) => termsPorMaterial[(mName || '').trim()] || [];

    // Tinta de impresión (ECOUV: Ecosolvente/UV — el magic sort rutea el lote por Tinta).
    // Default: la primera opción del servicio (Ecosolvente).
    const [tintaSeleccionada, setTintaSeleccionada] = useState(config?.tintaOptions?.[0] || '');

    // FORMA DE ENVÍO del pedido (mismo nomenclador FormasEnvio que usa el retiro:
    // Retiro en el Local / Encomienda / Envío a Domicilio / Entrega Coordinada).
    // Se guarda en Ordenes.ModoRetiro de cada orden del pedido.
    const [formasEnvio, setFormasEnvio] = useState([]);
    const [formaEnvioId, setFormaEnvioId] = useState(null);
    useEffect(() => {
        apiClient.get('/nomenclators/shipping-methods')
            .then(res => {
                const lista = res.success ? (res.data || []) : [];
                // El nomenclador trae las cuatro formas, pero acá (ECOUV, el único servicio con
                // este selector) solo se ofrecen RETIRO EN EL LOCAL y ENCOMIENDA: entrega
                // coordinada y envío a domicilio no aplican.
                const permitidas = lista.filter(f => /retiro|encomienda/i.test(f.Nombre || ''));
                setFormasEnvio(permitidas);
                // Default: Retiro en el Local (lo más habitual). El cliente puede cambiarlo,
                // pero el pedido nunca queda sin forma de envío definida.
                setFormaEnvioId(prev => prev ?? (
                    permitidas.find(f => /retiro/i.test(f.Nombre || ''))?.ID ?? permitidas[0]?.ID ?? null
                ));
            })
            .catch(() => setFormasEnvio([]));
    }, []);

    // Categoría (clasificación física de StockArt: Lonas/Canvas/Vinilos/Cuadros...)
    // — filtra el combo de materiales. Variante · Categoría · Material en una línea.
    const [categoriaFiltro, setCategoriaFiltro] = useState('');
    useEffect(() => { setCategoriaFiltro(''); }, [serviceSubType]);
    const categoriasFisicas = config?.variantMode === 'virtual'
        ? [...new Set((dynamicMaterials || []).map(m => (m.Categoria || '').trim()).filter(Boolean))]
        : [];
    const materialesParaSelect = (config?.variantMode === 'virtual')
        ? (categoriaFiltro
            ? (dynamicMaterials || []).filter(m => (m.Categoria || '').trim() === categoriaFiltro)
            : (dynamicMaterials || []))
        : (dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []));
    // Default de Categoría: 'Lonas' si existe en la variante actual, sino la primera.
    // (Sin opción 'Todas': siempre hay una categoría concreta seleccionada.)
    useEffect(() => {
        if (config?.variantMode !== 'virtual' || categoriasFisicas.length === 0) return;
        if (!categoriaFiltro || !categoriasFisicas.includes(categoriaFiltro)) {
            setCategoriaFiltro(categoriasFisicas.find(c => /lona/i.test(c)) || categoriasFisicas[0]);
        }
    }, [config?.variantMode, categoriasFisicas.join('|'), categoriaFiltro]);

    useEffect(() => {
        if (config?.variantMode !== 'virtual' || !categoriaFiltro) return;
        // Material: el primero que cumple la categoría elegida (si el actual no pertenece)
        if (!materialesParaSelect.some(m => (m.Material || '').trim() === (globalMaterial || '').trim())) {
            actions.setGlobalMaterial(materialesParaSelect[0]?.Material || '');
        }
    }, [categoriaFiltro, materialesParaSelect.length]);

    // Ficha del producto terminado elegido (dimensiones + material de impresión + incluidas)
    const [fichaPT, setFichaPT] = useState(null);
    useEffect(() => {
        if (!isEcouvPT || !globalMaterial) { setFichaPT(null); return; }
        const mat = (dynamicMaterials || []).find(m => (m.Material || '').trim() === (globalMaterial || '').trim());
        const codArt = (mat?.CodArticulo || '').trim();
        if (!codArt) { setFichaPT(null); return; }
        apiClient.get(`/nomenclators/producto-terminado/${encodeURIComponent(codArt)}`)
            .then(res => {
                const data = res.success ? res.data : null;
                setFichaPT(data);
                // La tinta de la ficha es el punto de partida; el cliente puede cambiarla
                // en el selector (y el recargo % de UV/Latex aplica solo vía perfil).
                if (data?.tinta) setTintaSeleccionada(data.tinta);
            })
            .catch(() => setFichaPT(null));
    }, [isEcouvPT, globalMaterial, dynamicMaterials]);

    // ── Terminaciones por archivo: manera de aplicación (ubicación) + cantidad
    //    SUGERIDA por la regla de la terminación, siempre visible y editable. ──

    const dimsDeItem = (it) => {
        const w = parseFloat(it.printSettings?.finalWidthM) || (it.file?.width ? (it.file.unit === 'meters' ? it.file.width : (it.file.width / 300) * 0.0254) : 0);
        const h = parseFloat(it.printSettings?.finalHeightM) || (it.file?.height ? (it.file.unit === 'meters' ? it.file.height : (it.file.height / 300) * 0.0254) : 0);
        return { w, h };
    };

    // ── PRODUCTO TERMINADO: el arte debe medir lo que dice la ficha del producto ──
    // Se acepta girado y con el borde (demasía) ya incluido. Tolerancia 2 cm.
    // Se usa al subir el archivo Y al cambiar de producto (revalida lo ya cargado).
    const TOL_PT = 0.02;
    // Con borde en la ficha, el arte DEBE traer la demasía: un cuadro de 1,00 × 1,00
    // con 5 cm de borde exige un archivo de 1,10 × 1,10 (5 cm por cada lado).
    // Sin borde configurado, el arte mide la medida final. Girado siempre vale.
    const medidaPTOk = (w, h, ficha) => {
        if (!ficha || ficha.anchoM == null || ficha.altoM == null || !w || !h) return true;
        const W = parseFloat(ficha.anchoM), H = parseFloat(ficha.altoM);
        const b = (parseFloat(ficha.bordeCm) || 0) / 100;
        const reqW = W + 2 * b, reqH = H + 2 * b;
        const matchea = (ew, eh) => Math.abs(w - ew) <= TOL_PT && Math.abs(h - eh) <= TOL_PT;
        return matchea(reqW, reqH) || matchea(reqH, reqW);
    };
    const medidaPTTexto = (ficha) => {
        if (!ficha || ficha.anchoM == null || ficha.altoM == null) return '';
        const W = parseFloat(ficha.anchoM), H = parseFloat(ficha.altoM);
        const b = (parseFloat(ficha.bordeCm) || 0) / 100;
        if (b > 0) {
            return `${(W + 2 * b).toFixed(2)} x ${(H + 2 * b).toFixed(2)} m ` +
                `(${W.toFixed(2)} x ${H.toFixed(2)} de medida final + ${parseFloat(ficha.bordeCm)} cm de borde por lado)`;
        }
        return `${W.toFixed(2)} x ${H.toFixed(2)} m`;
    };
    // Archivos ya cargados que NO cumplen la medida del producto elegido
    const itemsFueraDeMedida = (!isEcouvPT || !fichaPT) ? [] : items.filter(it => {
        if (!it.file) return false;
        const { w, h } = dimsDeItem(it);
        return w > 0 && h > 0 && !medidaPTOk(w, h, fichaPT);
    });

    // Al CAMBIAR de producto, revalidar lo que ya estaba cargado (el arte de un cuadro
    // 1,20x0,80 no sirve para uno de 0,43x0,24).
    const productoValidadoRef = React.useRef(null);
    useEffect(() => {
        if (!isEcouvPT || !fichaPT?.anchoM) { productoValidadoRef.current = null; return; }
        const clave = `${globalMaterial}|${fichaPT.anchoM}x${fichaPT.altoM}`;
        if (productoValidadoRef.current === clave) return;   // ya avisado para este producto
        productoValidadoRef.current = clave;
        const malos = items.filter(it => {
            if (!it.file) return false;
            const { w, h } = dimsDeItem(it);
            return w > 0 && h > 0 && !medidaPTOk(w, h, fichaPT);
        });
        if (malos.length > 0) {
            actions.setErrorModalMessage(
                `Cambiaste el producto a "${globalMaterial}", cuyo arte debe medir ${medidaPTTexto(fichaPT)}. ` +
                `${malos.length === 1 ? 'El archivo' : `${malos.length} archivos`} que ya cargaste no mide${malos.length === 1 ? '' : 'n'} esa medida: ` +
                malos.map(m => { const d = dimsDeItem(m); return `"${m.file?.name}" (${d.w.toFixed(2)} x ${d.h.toFixed(2)} m)`; }).join(', ') +
                `. Quitalo${malos.length === 1 ? '' : 's'} y subí el arte en la medida del producto, o volvé al producto anterior.`
            );
            actions.setErrorModalOpen(true);
        }
    }, [isEcouvPT, fichaPT, globalMaterial, items]);
    // Cantidad sugerida y reparto salen del cálculo compartido (utils/terminacionesGeo):
    // los ojales se cuentan como PUNTOS sobre el borde (7 en 3 m cada 50 cm, no 6) y
    // las esquinas no se cuentan dos veces. Lo mismo usa la orden de taller.
    const cantidadSugeridaItem = (term, ubi, item) => cantidadSugerida(term, ubi, dimsDeItem(item));

    // Bolsillo y soldadura NO conviven en un mismo lado: el doblez del bolsillo
    // YA incluye su propia soldadura (tamaño×2 + 5 cm), sumarle otra es contradictorio.
    const esSoldaduraTerm = (x) => /soldadura/i.test(x?.Nombre || x?.nombre || '');
    const esBolsilloTerm = (x) => /bolsillo/i.test(x?.Nombre || x?.nombre || '');
    // Lados de `lados` que ya ocupa la terminación rival (bolsillo↔soldadura) en el item
    const ladosEnConflicto = (item, term, lados) => {
        const rival = esBolsilloTerm(term) ? esSoldaduraTerm
            : (esSoldaduraTerm(term) ? esBolsilloTerm : null);
        if (!rival) return [];
        const current = Array.isArray(item.terminaciones) ? item.terminaciones : [];
        const ocupados = new Set(current
            .filter(t => t.terminacionId !== term.TerminacionID && rival(t))
            .flatMap(t => ladosDeUbicacion(t.ubicacion)));
        return lados.filter(l => ocupados.has(l));
    };
    const nombreRival = (term) => esBolsilloTerm(term) ? 'soldadura' : 'bolsillo';
    const nombraLados = (lados) => lados.map(l => LADO_NOMBRE[l]).join(' y ');

    const toggleItemTerminacion = (item, term) => {
        const current = Array.isArray(item.terminaciones) ? item.terminaciones : [];
        const exists = current.find(t => t.terminacionId === term.TerminacionID);
        let next;
        if (exists) {
            next = current.filter(t => t.terminacionId !== term.TerminacionID);
        } else {
            const ubis = (term.Ubicaciones || '').split(',').map(x => x.trim()).filter(Boolean);
            // Default: todo el perímetro si está habilitado (es lo más pedido, y en
            // ojales garantiza las 4 esquinas como mínimo). Si no, la primera opción.
            let ubi = ubis.includes('PERIMETRO') ? 'PERIMETRO' : (ubis[0] || '');
            // Si el default pisa lados donde ya está la rival (bolsillo↔soldadura),
            // se arranca solo con los lados libres — y si no queda ninguno, no se agrega.
            const conflicto = ladosEnConflicto(item, term, ladosDeUbicacion(ubi));
            if (conflicto.length) {
                const libres = ladosDeUbicacion(ubi).filter(l => !conflicto.includes(l));
                if (!libres.length) {
                    addToast(`No se puede agregar "${term.Nombre}": todos los lados ya tienen ${nombreRival(term)}, y bolsillo y soldadura no van en el mismo lado (el doblez del bolsillo ya incluye la soldadura).`, 'error');
                    return;
                }
                ubi = ubicacionDeLados(libres);
                addToast(`"${term.Nombre}" quedó en ${labelUbicacion(ubi)}: en ${nombraLados(conflicto)} ya hay ${nombreRival(term)}, y bolsillo y soldadura no van en el mismo lado.`, 'error');
            }
            next = [...current, {
                terminacionId: term.TerminacionID,
                ubicacion: ubi,
                cantidad: cantidadSugeridaItem(term, ubi, item),
                param: term.ParamCantidad != null ? parseFloat(term.ParamCantidad) : null,
                nombre: term.Nombre,
                unidad: term.UnidadCobro
            }];
        }
        actions.updateItem(item.id, 'terminaciones', next);
    };
    const setItemTerminacionCantidad = (item, terminacionId, cantidad) => {
        const current = Array.isArray(item.terminaciones) ? item.terminaciones : [];
        // manual: el cliente la escribió él. A partir de ahí no se vuelve a pisar
        // con la sugerencia automática.
        actions.updateItem(item.id, 'terminaciones', current.map(t =>
            t.terminacionId === terminacionId ? { ...t, cantidad, manual: true } : t
        ));
    };
    const setItemTerminacionUbicacion = (item, term, ubi) => {
        // Frenar bolsillo y soldadura compartiendo lado (presets y clicks en el plano)
        const conflicto = ladosEnConflicto(item, term, ladosDeUbicacion(ubi));
        if (conflicto.length) {
            addToast(`En ${nombraLados(conflicto)} ya hay ${nombreRival(term)}: bolsillo y soldadura no van en el mismo lado (el doblez del bolsillo ya incluye la soldadura). Quitá ${nombreRival(term)} de ese lado primero.`, 'error');
            return;
        }
        const current = Array.isArray(item.terminaciones) ? item.terminaciones : [];
        // Al cambiar la ubicación se recalcula la sugerencia respetando el parámetro
        // QUE ELIGIÓ EL CLIENTE (ojales cada X cm), no el del catálogo: si no, al
        // tocar un borde la cantidad volvía al reparto por defecto.
        actions.updateItem(item.id, 'terminaciones', current.map(t => {
            if (t.terminacionId !== term.TerminacionID) return t;
            const efectivo = (t.param !== undefined && t.param !== null && t.param !== '')
                ? { ...term, ParamCantidad: t.param } : term;
            return { ...t, ubicacion: ubi, cantidad: cantidadSugeridaItem(efectivo, ubi, item) };
        }));
    };
    // Marcar/desmarcar un borde en el plano: el cliente arma la combinación que
    // quiera (arriba, arriba+izquierda, los cuatro...) tocando la pieza.
    const toggleLadoTerminacion = (item, term, sel, lado) => {
        const actuales = ladosDeUbicacion(sel.ubicacion);
        const nuevos = actuales.includes(lado)
            ? actuales.filter(l => l !== lado)
            : [...actuales, lado];
        setItemTerminacionUbicacion(item, term, ubicacionDeLados(nuevos));
    };
    // Cuál de las terminaciones se está marcando en el plano, por archivo
    const [terminacionActiva, setTerminacionActiva] = useState({});

    // Miniatura del arte para dibujarla dentro del plano. El preview que guarda
    // fileService viene recortado, así que se arma desde el File original y se
    // cachea por archivo (un solo objectURL por item). Los PDF se renderizan
    // (primera página, vía pdfjs) a una imagen; mientras se genera, el plano
    // sale sin arte y aparece solo cuando termina.
    const artesRef = React.useRef({});
    // Ver el candado del envío en handleSubmit
    const enviandoRef = React.useRef(false);
    const [artesPdf, setArtesPdf] = useState({});
    const esPdf = (f) => (f?.type || '') === 'application/pdf' || /\.pdf$/i.test(f?.name || '');
    const arteDeItem = (item) => {
        const f = item?.file;
        if (!f?.fileData) return null;
        const clave = `${item.id}|${f.name}|${f.size}`;
        if (esPdf(f)) return artesPdf[clave] || null;
        if (!(f.type || '').startsWith('image/')) return null;
        if (!artesRef.current[clave]) {
            try { artesRef.current[clave] = URL.createObjectURL(f.fileData); }
            catch { return null; }
        }
        return artesRef.current[clave];
    };
    useEffect(() => {
        items.forEach(item => {
            const f = item?.file;
            if (!f?.fileData || !esPdf(f)) return;
            const clave = `${item.id}|${f.name}|${f.size}`;
            if (artesRef.current[clave]) return;      // ya renderizado o en curso
            artesRef.current[clave] = 'pdf-en-curso';
            // Mismo render que la miniatura de la tarjeta (FileUploadZone): api/pdfPreview lo genera
            // UNA vez por archivo y los dos lo comparten. Antes cada uno abría y rasterizaba el
            // mismo PDF por su cuenta, y con los artes de sublimación eso era la mitad del
            // `drawImage` de pdf.js — el 47,8% del tiempo del hilo medido con el profiler.
            rasterizarPdf(f.fileData, 600).then((url) => {
                if (!url) { delete artesRef.current[clave]; return; } // un fallo se puede reintentar
                artesRef.current[clave] = url;   // reemplaza la marca 'pdf-en-curso'
                setArtesPdf(prev => ({ ...prev, [clave]: url }));
            });
        });
    }, [items]);
    useEffect(() => () => {   // liberar los objectURL al desmontar el formulario
        Object.values(artesRef.current).forEach(u => { try { URL.revokeObjectURL(u); } catch { } });
        liberarPdfPreviews();  // y los renders compartidos con las tarjetas de archivo
    }, []);

    // Cómo se dibuja cada terminación en el plano, según lo que es
    const tipoCapa = (term) => {
        const n = (term?.Nombre || '').toLowerCase();
        if ((term?.ReglaCantidad || '') === 'CADA_X_CM') return 'ojales';
        if (n.includes('bolsillo')) return 'bolsillo';
        if (n.includes('palo')) return 'palos';
        if (n.includes('roll up')) return 'rollup';
        return 'linea';
    };
    // Palos y roll up van siempre en los extremos: no se eligen bordes
    const usaBordes = (term) => !!(term?.Ubicaciones || '').trim()
        && term?.ClienteElige !== false
        && !['palos', 'rollup'].includes(tipoCapa(term));
    // Parámetro que el cliente ajusta: separación de los ojales (cm) o
    // distancia del bolsillo al borde (cm). Al cambiarlo se recalcula la cantidad.
    const setItemTerminacionParam = (item, term, valor) => {
        let v = parseFloat(valor);
        const current = Array.isArray(item.terminaciones) ? item.terminaciones : [];
        actions.updateItem(item.id, 'terminaciones', current.map(t => {
            if (t.terminacionId !== term.TerminacionID) return t;
            // Ojales: la separación no puede superar el lado más corto donde van
            // (en un lado de 21 cm no entran "cada 70 cm").
            if ((term.ReglaCantidad || '') === 'CADA_X_CM' && v > 0) {
                const { w, h } = dimsDeItem(item);
                const max = pasoMaxCm(t.ubicacion, w, h);
                if (max > 0 && v > max) {
                    v = max;
                    addToast(`La separación máxima para esos lados es ${max} cm.`, 'warning');
                }
            }
            const next = { ...t, param: isNaN(v) ? '' : v };
            // Los ojales dependen del paso: se recalcula el reparto
            if ((term.ReglaCantidad || '') === 'CADA_X_CM' && v > 0) {
                next.cantidad = cantidadSugeridaItem({ ...term, ParamCantidad: v }, t.ubicacion, item);
            }
            return next;
        }));
    };
    const unidadLabel = (u) => u === 'M2' ? 'm²' : u === 'M' ? 'm' : 'u.';

    // Tiempos estimados de entrega del área (tabla ConfiguracionTiemposEntrega → GET /delivery-times, público).
    const [deliveryTimes, setDeliveryTimes] = useState([]);
    useEffect(() => {
        apiClient.get('/delivery-times')
            .then(res => setDeliveryTimes(Array.isArray(res) ? res : (res?.data || [])))
            .catch(() => {});
    }, []);

    // TPU — modo (trabajo nuevo vs reusar una matriz) y listado de "Mis matrices"
    const [tpuMode, setTpuMode] = useState('nuevo');
    // Medida del parche que pide el cliente, acotada por el tope del producto elegido.
    const [tpuAlto, setTpuAlto] = useState('');
    const [tpuAncho, setTpuAncho] = useState('');
    // Reuso con cantidad distinta a la de la matriz: se regenera el arte (aviso en el modal de éxito).
    const [reusoRegen, setReusoRegen] = useState(false);
    const [matrices, setMatrices] = useState([]);
    const [matrizSel, setMatrizSel] = useState(null);
    const [loadingMatrices, setLoadingMatrices] = useState(false);
    useEffect(() => {
        if (serviceId !== 'tpu') return;
        setLoadingMatrices(true);
        apiClient.get('/web-orders/mis-matrices')
            .then(res => setMatrices(Array.isArray(res) ? res : (res?.data?.data || res?.data || [])))
            .catch(() => setMatrices([]))
            .finally(() => setLoadingMatrices(false));
    }, [serviceId]);
    const tiempoEntregaTexto = (prio) => {
        const area = serviceInfo?.areaId;
        const row = (deliveryTimes || []).find(t =>
            String(t.AreaID || '').trim() === String(area || '').trim() &&
            String(t.Prioridad || '').trim().toLowerCase() === prio
        );
        if (!row) return null;
        // Por defecto se muestra el campo Texto; si es null/vacío, se cae a "{Horas} horas".
        const txt = row.Texto != null && String(row.Texto).trim() !== '' ? String(row.Texto).trim() : null;
        return txt || `${row.Horas} horas`;
    };
    const tiempoEntregaNormal = tiempoEntregaTexto('normal');
    const tiempoEntregaUrgente = tiempoEntregaTexto('urgente');

    // Urgencia configurable por área: si el área del servicio no está en la lista de
    // "áreas con urgencia" (perfil de urgencia / AREAS_SIN_URGENCIA — misma regla que
    // el motor de precios), se oculta el botón Urgente y su tiempo de entrega.
    // Sin dato (null) no se oculta nada, para no romper si el endpoint falla.
    const areaConUrgencia = !Array.isArray(areasConUrgencia)
        ? true
        : areasConUrgencia.includes(String(serviceInfo?.areaId || '').toUpperCase());
    // ECOUV (regla 01/08): la urgencia SOLO aplica a Material Impreso sin
    // terminaciones. Un producto terminado o un trabajo con terminaciones pasa por
    // el taller de armado y ese tiempo no se puede comprimir.
    const urgenciaBloqueadaEcouv = (serviceId === 'ecouv') && (
        isEcouvPT || items.some(it => (it.terminaciones || []).length > 0)
    );
    const prioridadesVisibles = (prioritiesList || []).filter(
        p => (areaConUrgencia && !urgenciaBloqueadaEcouv) || (p.Nombre || '').toLowerCase() !== 'urgente'
    );
    // Si ya estaba marcada Urgente y el pedido dejó de admitirla (eligió producto
    // terminado o agregó una terminación): avisar con un modal y volver a Normal.
    useEffect(() => {
        if (!urgenciaBloqueadaEcouv || (urgency || '').toLowerCase() !== 'urgente') return;
        actions.setUrgency('Normal');
        Swal.fire({
            icon: 'info',
            title: 'La urgencia no aplica a este pedido',
            html: isEcouvPT
                ? 'Los <b>productos terminados</b> llevan armado en taller y no pueden ir con urgencia.<br>El pedido sigue como <b>Normal</b>.'
                : 'Los trabajos con <b>terminaciones</b> (ojales, soldadura, bolsillo...) llevan taller y no pueden ir con urgencia.<br>El pedido sigue como <b>Normal</b>.',
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#06b6d4',
        });
    }, [urgenciaBloqueadaEcouv, urgency]);

    // Initial Config for Specific Services
    // Corte standalone (de cara al cliente): molde y origen van FIJOS — el form no
    // muestra los selectores, así que se re-asegura el valor si algún reset lo pisa.
    useEffect(() => {
        if (serviceId === 'corte' && moldType !== 'MOLDES CLIENTES') {
            actions.setMoldType('MOLDES CLIENTES');
        }
        if (serviceId === 'corte' && fabricOrigin !== 'TELA CLIENTE') {
            actions.setFabricOrigin('TELA CLIENTE');
        }
    }, [serviceId, moldType, fabricOrigin]);

    // TPU: garantizar SIEMPRE 1 item que lleve la cantidad (el submit agrupa por item; un item
    // sin archivo produce un pedido válido). SIN array de deps a propósito: la carga de config
    // despacha RESET_FORM en el MISMO flush que este efecto, así que el "1 item" nunca llegaba a
    // commitearse y con deps [serviceId, items.length] el efecto no volvía a disparar (0 === 0)
    // → cantidad muerta y submit rechazado. Corriendo tras cada commit se auto-corrige y no puede
    // loopear: solo actúa cuando items está vacío.
    useEffect(() => {
        if (serviceId === 'tpu' && items.length === 0) {
            actions.setItems([{
                id: Date.now(), file: null, fileBack: null,
                copies: config.minCopies || 15, material: globalMaterial || '',
                note: '', doubleSided: false, printSettings: {}
            }]);
        }
    });


    // Directa 3.20 Twinface Logic (Code 1560)
    const isDirectaTwinface = serviceId === 'directa_320' && (
        (selectedMaterialObj && String(selectedMaterialObj.CodArticulo || '').trim() === '1560') ||
        (globalMaterial && globalMaterial.toUpperCase().includes('TWOFACE'))
    );

    // Ancho y largo-fijo del material de un ítem. `largoFijo > 0` = el artículo se imprime a MEDIDA
    // FIJA (articulos.largoimprimible, ej. Bandera Confeccionada): el archivo debe medir exactamente
    // ancho x largoFijo (±2mm) y no aplica el tope "ancho - 3cm".
    const itemMatInfo = (item) => {
        const isSingleMat = config.materialMode === 'single' && !config.allowItemMaterialOverride;
        const itemMat = isSingleMat ? globalMaterial : (item?.material || globalMaterial);
        // Sin material seleccionado → ancho null, para no validar todavía.
        if (!itemMat || !String(itemMat).trim()) return { ancho: null, largoFijo: 0 };
        const matList = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
        const foundMat = matList.find(m => (m.Material || m.Descripcion || m) === itemMat);
        return {
            ancho: resolveMaterialWidth(foundMat || itemMat),
            largoFijo: (foundMat && typeof foundMat === 'object') ? (parseFloat(foundMat.Largo) || 0) : 0,
        };
    };

    // Ancho y largo-fijo de un material POR NOMBRE (no por ítem): se usa para revalidar los archivos
    // ya cargados cuando el cliente cambia el material.
    const matInfoPorNombre = (matName) => {
        if (!matName || !String(matName).trim()) return { ancho: null, largoFijo: 0 };
        const matList = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
        const foundMat = matList.find(m => (m.Material || m.Descripcion || m) === matName);
        return {
            ancho: resolveMaterialWidth(foundMat || matName),
            largoFijo: (foundMat && typeof foundMat === 'object') ? (parseFloat(foundMat.Largo) || 0) : 0,
        };
    };

    // ¿El archivo ya cargado sirve para ESTE material? Devuelve el motivo o null.
    // El flujo real es: primero se sube el archivo, DESPUÉS se elige la tela. Con medida fija
    // (banderas) eso dejaba pasar un archivo inválido sin decir nada hasta el "Confirmar",
    // donde el error genérico de subida no explicaba nada.
    const errorArchivoParaMaterial = (fileObj, matName) => {
        if (!fileObj || !fileObj.width || !fileObj.height) return null; // sin medir → no se valida acá
        const { ancho, largoFijo } = matInfoPorNombre(matName);
        if (!(ancho > 0) || !(largoFijo > 0)) return null;              // solo materiales de medida fija
        const aM = (v) => (fileObj.unit === 'meters' ? v : (v / 300) * 0.0254);
        const wM = aM(fileObj.width), hM = aM(fileObj.height);
        const fuera = (real, esp) => Math.abs(real - esp) > TOLERANCIA_ANCHO_M + 1e-9;
        if (!fuera(wM, ancho) && !fuera(hM, largoFijo)) return null;
        const invertido = !fuera(wM, largoFijo) && !fuera(hM, ancho);
        return `"${matName}" se imprime a MEDIDA FIJA: el archivo debe medir exactamente `
            + `${ancho.toFixed(2)}m de ancho x ${largoFijo.toFixed(2)}m de largo. `
            + `"${fileObj.name}" mide ${wM.toFixed(2)}m x ${hM.toFixed(2)}m`
            + (invertido ? ' — está rotado: girá el arte para que el ancho sea el lado de '
                + `${ancho.toFixed(2)}m.` : '. Ajustá el archivo a la medida exacta.');
    };

    // Al cambiar el material, revisa los archivos ya cargados y avisa en el acto.
    const avisarSiMaterialNoAplica = (itemsAValidar, matName) => {
        const motivo = itemsAValidar.map(it => errorArchivoParaMaterial(it.file, matName)).find(Boolean);
        if (motivo) {
            actions.setErrorModalMessage(motivo);
            actions.setErrorModalOpen(true);
        }
    };

    const [twinfaceSame, setTwinfaceSame] = useState(false);
    const [applyMaterialToAll, setApplyMaterialToAll] = useState(true); // check por defecto: el material elegido aplica a todo el pedido

    // ECOUV material impreso: UN solo material para todo el pedido (todos los archivos
    // se imprimen en el mismo rollo) — el check queda fijo en "aplicar a todo".
    // Productos Terminados NO: ahí sí se pueden mezclar cuadros distintos por archivo.
    const materialUnicoEcouv = isEcouvMaterial && !isEcouvPT;
    useEffect(() => {
        if (materialUnicoEcouv && !applyMaterialToAll) handleApplyMaterialToAll(true);
    }, [materialUnicoEcouv, applyMaterialToAll]);

    const handleApplyMaterialToAll = (checked) => {
        setApplyMaterialToAll(checked);
        if (checked && items.length > 0) {
            const firstMaterial = items[0].material;
            const updated = items.map(it => ({ ...it, material: firstMaterial }));
            actions.setItems(updated);
            avisarSiMaterialNoAplica(updated, firstMaterial);
        }
    };

    const handleItemMaterialChange = (itemId, val) => {
        if (applyMaterialToAll) {
            const updated = items.map(it => ({ ...it, material: val }));
            actions.setItems(updated);
            avisarSiMaterialNoAplica(updated, val);
        } else {
            actions.updateItem(itemId, 'material', val);
            avisarSiMaterialNoAplica(items.filter(it => it.id === itemId), val);
        }
    };

    // --- Handlers for File Uploads (that need UI feedback or validation) ---

    // Generic handler for single file specialized upload
    const handleSpecializedFileUpload = (setterAction, file) => {
        if (!file) return;
        // STORE RAW FILE, DO NOT UPLOAD YET. Defer to final submit.
        setterAction(file);
        addToast('Archivo adjunto (Pendiente de envío con el pedido)');
    };

    // Generic handler for multiple file specialized upload
    const handleMultipleSpecializedFileUpload = (addFilesAction, filesInput) => {
        if (!filesInput) return;

        // Ensure regular array
        let files = [];
        if (filesInput instanceof FileList) {
            files = Array.from(filesInput);
        } else if (Array.isArray(filesInput)) {
            files = filesInput;
        } else {
            files = [filesInput];
        }

        if (files.length === 0) return;

        // Filter valid files
        const validFiles = files.filter(f => (f instanceof Blob || f instanceof File));

        if (validFiles.length > 0) {
            addFilesAction(validFiles);
            addToast(`${validFiles.length} archivos adjuntos (Pendientes de envío)`);
        }
    };

    // CORTE standalone: cada tizada se MIDE al subirla (piezas + metros de corte del láser
    // + largo de tela). Si el archivo no se puede leer/medir, NO se deja adjuntar —
    // regla del negocio: sin medición no hay forma de cotizar el corte.
    const handleTizadaUploadCorte = async (filesInput) => {
        if (!filesInput) return;
        const files = (filesInput instanceof FileList ? Array.from(filesInput)
            : Array.isArray(filesInput) ? filesInput : [filesInput])
            .filter(f => f instanceof Blob || f instanceof File);
        if (files.length === 0) return;

        const aceptados = [];
        // Cada tizada elige SU bobina en la tarjeta (multi-tela); el control tizada-vs-bobina
        // (largo acumulado y ancho) se hace por bobina en Confirmar Pedido.
        for (const f of files) {
            try {
                f.medicion = await medirTizada(f);

                // MESA DE CORTE: la tizada no puede ser más grande que el equipo,
                // sin importar qué tela se elija después.
                const { anchoTelaM: aT, largoTelaM: lT } = f.medicion;
                if (aT > MESA_CORTE_ANCHO_M + 1e-9 || lT > MESA_CORTE_LARGO_M + 1e-9) {
                    Swal.fire({
                        icon: 'error',
                        title: 'La tizada no entra en la mesa de corte',
                        html: `<b>${f.name}</b> mide <b>${aT.toFixed(2)} × ${lT.toFixed(2)} m</b> ` +
                            `y la mesa de corte es de <b>${MESA_CORTE_ANCHO_M.toFixed(3)} × ${MESA_CORTE_LARGO_M.toFixed(2)} m</b>.<br><br>` +
                            '<b>No se adjuntó</b> — dividí la tizada en partes que entren en la mesa.',
                        confirmButtonText: 'Entendido',
                        confirmButtonColor: '#06b6d4',
                    });
                    continue;
                }

                f.copias = 1;
                // Con una sola bobina disponible se preselecciona sola
                if ((bobinasDisponibles || []).length === 1) f.bobinaId = bobinasDisponibles[0].BobinaID;
                aceptados.push(f);
            } catch (e) {
                Swal.fire({
                    icon: 'error',
                    title: 'No se pudo medir la tizada',
                    html: `<b>${f.name}</b><br>${e.message}<br><br>` +
                        'El archivo debe ser el <b>archivo de corte vectorial</b> (PDF, AI o DXF) ' +
                        'para calcular las piezas y los metros de corte del láser. ' +
                        '<b>No se adjuntó</b> — exportá la tizada desde el programa de corte y volvé a subirla.',
                    confirmButtonText: 'Entendido',
                    confirmButtonColor: '#06b6d4',
                });
            }
        }
        if (aceptados.length > 0) {
            handleMultipleSpecializedFileUpload(actions.addTizadaFiles, aceptados);
        }
    };

    // CORTE: cambiar el archivo de una tarjeta ya cargada (se vuelve a medir y
    // conserva la tela y las veces a cortar que ya había elegido).
    const handleReemplazarTizadaCorte = async (index, file) => {
        if (!file) return;
        const anterior = tizadaFiles[index] || {};
        try {
            file.medicion = await medirTizada(file);
            file.copias = anterior.copias || 1;
            file.bobinaId = anterior.bobinaId ?? null;
            actions.setTizadaFiles(tizadaFiles.map((f, i) => (i === index ? file : f)));
            addToast('Tizada reemplazada y medida');
        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'No se pudo medir la tizada',
                html: `<b>${file.name}</b><br>${e.message}<br><br>` +
                    'Se mantiene el archivo anterior. Subí el <b>archivo de corte vectorial</b> (PDF, AI o DXF).',
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#06b6d4',
            });
        }
    };

    // Main Item File Upload Handler (with Validation)
    const handleFileUpload = async (itemId, field, file) => {
        if (!file) return false;

        // Validation — sublimación y ECOUV aceptan también JPEG (no necesitan transparencia:
        // el arte va impreso sobre el material, no recortado); el resto solo PNG/PDF.
        const allowJpeg = svcId === 'sublimacion' || svcId === 'ecouv';
        const allowed = ['image/png', 'application/pdf', ...(allowJpeg ? ['image/jpeg', 'image/jpg'] : [])];
        const extRegex = allowJpeg ? /\.(png|pdf|jpe?g)$/ : /\.(png|pdf)$/;
        const isAllowed = allowed.includes(file.type) || file.name.toLowerCase().match(extRegex);

        if (!isAllowed) {
            addToast(allowJpeg ? 'Formato inválido. Solo se permite PNG, JPEG o PDF.' : 'Formato inválido. Solo se permite PNG o PDF.', 'error');
            return false;
        }

        try {
            const result = await fileService.uploadFile(file, { allowJpeg });

            // Sin DPI en el archivo → NO se puede medir: se RECHAZA. Antes se ofrecía confirmar una
            // medida calculada asumiendo 300 DPI, pero si el archivo no trae la metadata esa medida
            // es una suposición y terminaba imprimiéndose cualquier tamaño.
            if (result.hasDPI === false) {
                await Swal.fire({
                    title: 'NO PUDIMOS MEDIR TU ARCHIVO',
                    html: `
                        <div class="text-left font-medium text-zinc-400 mt-2">
                            <p class="mb-4 text-sm text-center">Tu imagen <span class="text-white font-bold">no tiene la información de resolución (DPI)</span> que necesitamos para saber a qué tamaño hay que imprimirla, así que no podemos aceptarla.</p>

                            <div class="bg-[#0a0a0a] border border-brand-cyan/30 rounded-xl p-5 my-6">
                                <p class="text-[10px] uppercase tracking-widest text-brand-cyan mb-3 font-black">¿Cómo lo resolvés?</p>
                                <p class="text-sm text-zinc-300 mb-3"><span class="text-white font-bold">1.</span> Volvé a guardar el archivo como <span class="text-white font-bold">PDF</span> desde el programa donde lo diseñaste y subilo de nuevo.</p>
                                <p class="text-sm text-zinc-300"><span class="text-white font-bold">2.</span> Si no podés, escribinos a <span class="text-white font-bold">Atención al Cliente</span> y lo vemos con vos.</p>
                            </div>

                            <p class="text-center text-[10px] text-zinc-500 uppercase tracking-widest mt-4">
                                El PDF conserva las medidas exactas de tu diseño
                            </p>
                        </div>
                    `,
                    icon: 'error',
                    iconColor: '#D6006E',
                    background: '#18181b', // zinc-900
                    color: '#f4f4f5',
                    confirmButtonText: 'ENTENDIDO',
                    buttonsStyling: false,
                    customClass: {
                        popup: 'border border-zinc-800 rounded-3xl shadow-2xl',
                        title: 'text-xl font-black tracking-tighter text-white pt-4',
                        htmlContainer: 'px-2',
                        actions: 'w-full mt-6 px-6 pb-2',
                        confirmButton: 'w-full bg-brand-cyan hover:bg-cyan-500 text-[#0a0a0a] font-black tracking-wide py-3.5 px-4 rounded-xl transition-all',
                    }
                });
                toast.error('Archivo rechazado: guardalo como PDF y volvé a intentar, o contactá a Atención al Cliente.', {
                    position: "top-right",
                    autoClose: 6000,
                    theme: "dark",
                });
                return false;
            }

            // Validation of Printable Width
            if (result.width && !result.measurementError) {
                const currentItem = items.find(it => it.id === itemId);
                const itemMaterial = currentItem?.material || '';

                let selectedMatName;
                let maxWidth;
                // Largo imprimible del material (articulos.largoimprimible): si es > 0, el material
                // se imprime a MEDIDA FIJA (banderas de Impresión Directa) y el archivo debe medir
                // EXACTAMENTE Ancho x Largo del artículo (no aplica el tope "ancho - 3cm").
                let largoFijo = 0;

                if (svcId === 'sublimacion') {
                    // For sublimación: validate against item material if selected, else default 1.83m
                    if (itemMaterial) {
                        selectedMatName = itemMaterial;
                        const matList = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
                        const matObj = matList.find(m => (m.Material || m.Descripcion || m) === itemMaterial) || itemMaterial;
                        maxWidth = resolveMaterialWidth(matObj);
                        // MEDIDA FIJA también en Sublimación (ej. Bandera Confeccionada): si el artículo
                        // define largoimprimible, el archivo va a medida exacta y no aplica el "ancho - 3cm".
                        if (matObj && typeof matObj === 'object') {
                            largoFijo = parseFloat(matObj.Largo) || 0;
                        }
                    } else {
                        selectedMatName = null;
                        maxWidth = 1.83;
                    }
                    // Sublimación Tela de Cliente: el ancho lo define la bobina seleccionada, no el material
                    if (isSubliTelaCliente && selectedBobinaAncho) {
                        selectedMatName = clientFabricName ? `bobina ${clientFabricName}` : 'la bobina seleccionada';
                        maxWidth = parseFloat(selectedBobinaAncho);
                        largoFijo = 0;
                    }
                } else {
                    selectedMatName = globalMaterial;
                    if (config.materialMode === 'multiple' && itemMaterial) {
                        selectedMatName = itemMaterial;
                    }
                    const matList = dynamicMaterials.length > 0 ? dynamicMaterials : (serviceInfo?.materials || []);
                    const matObj = matList.find(m => (m.Material || m.Descripcion || m) === selectedMatName) || selectedMatName;
                    maxWidth = resolveMaterialWidth(matObj);
                    if (matObj && typeof matObj === 'object') {
                        largoFijo = parseFloat(matObj.Largo) || 0;
                    }

                    // TELA CLIENTE: el ancho lo define la bobina seleccionada, no el material
                    if (fabricOrigin === 'TELA CLIENTE' && selectedBobinaAncho) {
                        selectedMatName = clientFabricName ? `bobina ${clientFabricName}` : 'la bobina seleccionada';
                        maxWidth = parseFloat(selectedBobinaAncho);
                        largoFijo = 0;
                    }
                }

                const fileWidthM = result.unit === 'meters' ? result.width : (result.width / 300) * 0.0254;
                // Ancho medido redondeado SIEMPRE PARA ARRIBA al cm (1.5701 → 1.58; 1.57 → 1.57).
                // Así el valor que se valida es el mismo que se muestra (antes: 1.5701 fallaba contra
                // 1.57 pero el mensaje decía "1.57 excede 1.57"). El toFixed(6) limpia ruido de float
                // para que un 1.57 "sucio" (1.5700000000003) no suba injustamente a 1.58.
                // Se resta TOLERANCIA_ANCHO_M (2mm) antes de redondear: una diferencia imperceptible entre
                // software (1.8005 vs 1.80) "cae" al cm exacto en vez de saltar al siguiente y rebotar.
                const fileWidthRounded = Math.ceil(Number(((fileWidthM - TOLERANCIA_ANCHO_M) * 100).toFixed(6))) / 100;
                const maxPrintableWidth = Math.round((maxWidth - 0.03) * 100) / 100;

                if (largoFijo > 0) {
                    // MEDIDA FIJA (banderas): ancho y largo del archivo deben coincidir con
                    // anchoimprimible x largoimprimible del artículo, admitiendo la misma TOLERANCIA_ANCHO_M
                    // (2mm) que el resto del form — distintos software exportan con diferencias mínimas.
                    // La orientación IMPORTA: un archivo rotado (largo x ancho) no se acepta.
                    const fileHeightM = result.unit === 'meters' ? result.height : (result.height / 300) * 0.0254;
                    const fueraDeTolerancia = (real, esperado) => Math.abs(real - esperado) > TOLERANCIA_ANCHO_M + 1e-9;
                    if (fueraDeTolerancia(fileWidthM, maxWidth) || fueraDeTolerancia(fileHeightM, largoFijo)) {
                        actions.setErrorModalMessage(
                            `"${selectedMatName}" se imprime a MEDIDA FIJA: el archivo debe medir exactamente ${maxWidth.toFixed(2)}m de ancho x ${largoFijo.toFixed(2)}m de largo. Tu archivo mide ${fileWidthM.toFixed(2)}m x ${fileHeightM.toFixed(2)}m. Ajustá el archivo a la medida exacta.`
                        );
                        actions.setErrorModalOpen(true);
                        return false;
                    }
                } else if (!(isEcouvPT && fichaPT?.anchoM != null) && fileWidthRounded > maxPrintableWidth + 1e-9) {
                    // (Producto terminado: el "material" del combo es el PRODUCTO, no el rollo —
                    // este tope de ancho no aplica; el PT valida contra su ficha más abajo,
                    // incluido el ancho imprimible del material real.)
                    const matLabel = selectedMatName || `ancho máximo ${maxWidth.toFixed(2)}m`;
                    actions.setErrorModalMessage(
                        `El ancho del archivo (${fileWidthRounded.toFixed(2)}m) excede el ancho imprimible del material "${matLabel}" (${maxPrintableWidth.toFixed(2)}m). Por favor, ajuste el archivo o seleccione otro material.`
                    );
                    actions.setErrorModalOpen(true);
                    return false;
                }

                // TELA CLIENTE: el largo del archivo no puede superar los metros restantes de la bobina
                if ((fabricOrigin === 'TELA CLIENTE' || isSubliTelaCliente) && selectedBobinaMetros && result.height) {
                    const fileHeightM = result.unit === 'meters' ? result.height : (result.height / 300) * 0.0254;
                    if (fileHeightM > parseFloat(selectedBobinaMetros)) {
                        actions.setErrorModalMessage(
                            `El largo del archivo (${fileHeightM.toFixed(2)}m) supera los metros disponibles en la bobina (${parseFloat(selectedBobinaMetros).toFixed(2)}m). Ajuste el archivo o seleccione otra bobina.`
                        );
                        actions.setErrorModalOpen(true);
                        return false;
                    }
                }

                // Validación de alto máximo para DTF (2.50m)
                if (serviceId?.toUpperCase() === 'DF') {
                    const fileHeightM = result.unit === 'meters' ? result.height : (result.height / 300) * 0.0254;
                    if (fileHeightM > 2.50) {
                        actions.setErrorModalMessage(
                            `El alto del archivo (${fileHeightM.toFixed(2)}m) excede el máximo permitido para DTF (2.50m). Por favor, ajuste el archivo.`
                        );
                        actions.setErrorModalOpen(true);
                        return false;
                    }
                }
            }

            // PRODUCTO TERMINADO (ECOUV): el archivo debe medir lo que define la FICHA.
            // Se acepta girado (ancho x alto ó alto x ancho) y también con el borde
            // (demasía por lado) ya incluido en el arte. Tolerancia: 2 cm.
            if (isEcouvPT && fichaPT?.anchoM != null && fichaPT?.altoM != null && result.width && result.height) {
                const fw = result.unit === 'meters' ? result.width : (result.width / 300) * 0.0254;
                const fh = result.unit === 'meters' ? result.height : (result.height / 300) * 0.0254;
                if (!medidaPTOk(fw, fh, fichaPT)) {
                    actions.setErrorModalMessage(
                        `El arte de "${globalMaterial}" debe medir ${medidaPTTexto(fichaPT)}, pero tu archivo mide ${fw.toFixed(2)} x ${fh.toFixed(2)} m. Ajustá el arte y volvé a subirlo.`
                    );
                    actions.setErrorModalOpen(true);
                    return false;
                }
                // El arte (medida + borde) tiene que entrar en el rollo del MATERIAL real
                // de la ficha, descontando los 3 cm de margen no imprimible — la misma
                // regla de "ancho − 3 cm" que usan las demás áreas contra su material.
                const matAncho = parseFloat(fichaPT.materialAncho);
                if (matAncho > 0) {
                    const imprimible = Math.round((matAncho - 0.03) * 100) / 100;
                    const b = (parseFloat(fichaPT.bordeCm) || 0) / 100;
                    const reqW = parseFloat(fichaPT.anchoM) + 2 * b;
                    const reqH = parseFloat(fichaPT.altoM) + 2 * b;
                    if (Math.min(reqW, reqH) > imprimible + 1e-9) {
                        actions.setErrorModalMessage(
                            `El producto "${globalMaterial}" con su borde necesita ${reqW.toFixed(2)} x ${reqH.toFixed(2)} m, ` +
                            `pero su material (${fichaPT.materialDescripcion || 'sin definir'}) imprime hasta ${imprimible.toFixed(2)} m de ancho ` +
                            `(rollo de ${matAncho.toFixed(2)} m menos 3 cm de margen). Revisá la ficha del producto.`
                        );
                        actions.setErrorModalOpen(true);
                        return false;
                    }
                }
            }

            // Validación de páginas: NO se permiten archivos con más de 1 página (ningún servicio).
            if (result.pageCount && result.pageCount > 1) {
                actions.setErrorModalMessage(
                    `El archivo tiene ${result.pageCount} páginas. Solo se permite 1 página por archivo.`
                );
                actions.setErrorModalOpen(true);
                return false;
            }

            // TWINFACE (Tela Doble Cara): el frente y el dorso son la MISMA bandera impresa de los dos
            // lados, así que deben medir EXACTAMENTE lo mismo. Se compara el archivo que se está subiendo
            // contra el que ya esté cargado del otro lado (±2mm, la misma tolerancia del resto del form).
            if (isDirectaTwinface && result.width && !result.measurementError) {
                const otherField = field === 'fileBack' ? 'file' : 'fileBack';
                const other = items.find(it => it.id === itemId)?.[otherField];
                const toM = (v, unit) => unit === 'meters' ? (v || 0) : (v ? (v / 300) * 0.0254 : 0);
                if (other && other.width && !other.measurementError) {
                    const nw = toM(result.width, result.unit), nh = toM(result.height, result.unit);
                    const ow = toM(other.width, other.unit), oh = toM(other.height, other.unit);
                    if (Math.abs(nw - ow) > TOLERANCIA_ANCHO_M + 1e-9 || Math.abs(nh - oh) > TOLERANCIA_ANCHO_M + 1e-9) {
                        const nombreLado = field === 'fileBack' ? 'dorso' : 'frente';
                        const nombreOtro = field === 'fileBack' ? 'frente' : 'dorso';
                        actions.setErrorModalMessage(
                            `En Tela Doble Cara (Twinface) el frente y el dorso deben tener la MISMA medida. El ${nombreLado} mide ${nw.toFixed(2)} x ${nh.toFixed(2)} m, pero el ${nombreOtro} mide ${ow.toFixed(2)} x ${oh.toFixed(2)} m. Ajustá el archivo a la misma medida y volvé a subirlo.`
                        );
                        actions.setErrorModalOpen(true);
                        return false;
                    }
                }
            }

            if (result.measurementError) {
                addToast(`ALERTA TÉCNICA: El archivo se cargó pero no pudo ser medido automáticamente. (${result.measurementError})`, 'warning');

                // Update with error note
                const newItems = items.map(it => {
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
                });
                actions.setItems(newItems);
            } else {
                actions.updateItem(itemId, field, result);
                addToast('Archivo listo (Medida Detectada)', 'success');
                return true;
            }
            return true;
        } catch (err) {
            addToast(err.message, 'error');
            return false;
        }
    };

    // --- Submit Logic ---
    // CANDADO CONTRA EL DOBLE ENVÍO.
    // El `loading` del botón no alcanza: es estado de React y tarda un render en
    // aplicarse, así que dos clicks seguidos entran los dos y crean DOS pedidos
    // completos (pasó: BOR-12291 y BOR-12292, con 8 segundos de diferencia).
    // Un ref se marca en el acto, en el mismo tick.
    //
    // Va como envoltorio y no adentro del cuerpo porque el envío tiene dificil
    // decenas de `return` de validación: soltar el candado en cada uno sería
    // olvidarse de alguno y dejar el botón muerto para siempre. El `finally` lo
    // suelta pase lo que pase.
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (enviandoRef.current) return;
        enviandoRef.current = true;
        try {
            await enviarPedido(e);
        } finally {
            enviandoRef.current = false;
        }
    };

    const enviarPedido = async (e) => {
        setReusoRegen(false); // se activa solo en reuso de matriz con cantidad distinta
        if (!jobName.trim()) return addToast('Nombre del proyecto requerido', 'error');

        // TPU — reuso de matriz: flujo aparte (endpoint /reuse-matriz), sin boceto ni archivos.
        if (serviceId === 'tpu' && tpuMode === 'matriz') {
            if (!matrizSel) return addToast('Elegí una matriz de "Mis matrices".', 'error');
            const cant = items[0]?.copies || 0;
            const minTpu = config.minCopies || 15;
            if (cant < minTpu) return addToast(`El pedido mínimo para TPU es de ${minTpu} unidades.`, 'error');
            // La medida se exige igual que en trabajo nuevo: los selectores están a la vista y
            // marcados con *, pero esta rama sale antes de la validación de abajo y los ignoraba.
            if (medidaMaximaTPU(globalMaterial) && (!tpuAlto || !tpuAncho)) {
                return addToast('Elegí el alto y el ancho del parche.', 'error');
            }
            actions.setLoading(true);
            try {
                const resp = await apiClient.post('/web-orders/reuse-matriz', {
                    matrizOrdenId: matrizSel.OrdenID,
                    cantidad: cant,
                    nombreTrabajo: jobName.trim(),
                    medida: (tpuAlto && tpuAncho) ? `${tpuAlto} x ${tpuAncho} cm` : null
                });
                const cod = resp?.codigoOrden || resp?.data?.codigoOrden || '';
                // Cantidad distinta a la de la matriz: el arte se regenera con la nueva cantidad
                // (el cliente no aprueba nada). Se avisa en el modal de éxito.
                setReusoRegen(!!(resp?.regenerar ?? resp?.data?.regenerar));
                actions.setCreatedOrderIds(cod ? [cod] : []);
                actions.setShowSuccessModal(true);
            } catch (err) {
                addToast('Error al crear el pedido: ' + (err?.response?.data?.error || err?.message || ''), 'error');
            } finally {
                actions.setLoading(false);
            }
            return;
        }

        const invalidPrintSettings = items.some(it => it.printSettings?.isValid === false);
        if (invalidPrintSettings) {
            return addToast('Hay errores en la configuración de impresión. Revise los items.', 'error');
        }

        // Forma de envío obligatoria: define cómo recibe el cliente (retiro/encomienda/
        // domicilio) y viaja a la orden para logística.
        if (formasEnvio.length > 0 && !formaEnvioId) {
            return addToast('Elegí la forma de envío: cómo recibís el pedido.', 'error');
        }

        // PRODUCTO TERMINADO: no se confirma con arte que no mide lo que el producto.
        // (Puede pasar si el cliente cambió de producto DESPUÉS de subir el archivo.)
        if (itemsFueraDeMedida.length > 0) {
            return addToast(
                `El arte de "${globalMaterial}" debe medir ${medidaPTTexto(fichaPT)}. Corregí los archivos marcados en rojo antes de confirmar.`,
                'error'
            );
        }

        if (config.hasCuttingWorkflow && moldType === 'MOLDES CLIENTES' && (!tizadaFiles || tizadaFiles.length === 0)) {
            return addToast('Debe subir al menos un archivo de tizada para moldes de clientes', 'error');
        }

        // TWINFACE (Tela Doble Cara): boceto obligatorio POR CADA archivo (juego frente/dorso)
        if (isDirectaTwinface && items.some(it => it.file && !it.boceto)) {
            return addToast('Cada archivo de Tela Doble Cara (Twinface) necesita su boceto Frente/Dorso.', 'error');
        }

        // TWINFACE: frente y dorso deben medir lo mismo (candado final por si se reemplazó un archivo
        // después de la validación del upload). No aplica con "misma imagen frente y dorso": ahí no hay dorso.
        if (isDirectaTwinface && !twinfaceSame) {
            const toM = (v, unit) => unit === 'meters' ? (v || 0) : (v ? (v / 300) * 0.0254 : 0);
            const desigual = items.some(it => it.file && it.fileBack &&
                (Math.abs(toM(it.file.width, it.file.unit) - toM(it.fileBack.width, it.fileBack.unit)) > TOLERANCIA_ANCHO_M + 1e-9 ||
                 Math.abs(toM(it.file.height, it.file.unit) - toM(it.fileBack.height, it.fileBack.unit)) > TOLERANCIA_ANCHO_M + 1e-9));
            if (desigual) {
                return addToast('En Tela Doble Cara (Twinface) el frente y el dorso deben tener la misma medida. Revisá los archivos marcados.', 'error');
            }
        }

        // IMPRESIÓN DIRECTA: mínimo de metros a subir (configurable en ConfiguracionGlobal.DIRECTA_MINIMO_METROS).
        // Se valida contra el Largo Total (suma de alto × copias; raport no multiplica). 0/vacío = sin validación.
        if (serviceId === 'directa_320') {
            const minMetros = parseFloat(portalConfig?.directaMinimoMetros) || 0;
            if (minMetros > 0) {
                const largoTotal = items.reduce((acc, it) => {
                    const h = it.printSettings?.finalHeightM || (it.file?.unit === 'meters' ? it.file?.height : (it.file?.height ? (it.file.height / 300) * 0.0254 : 0)) || 0;
                    return acc + (it.printSettings?.mode === 'raport' ? h : h * (it.copies || 1));
                }, 0);
                if (largoTotal < minMetros - 1e-9) {
                    return addToast(`El pedido mínimo de Impresión Directa es de ${minMetros}m. Tu pedido suma ${largoTotal.toFixed(2)}m. Agregá más archivos o copias.`, 'error');
                }
            }
        }

        // TELA CLIENTE: la bobina es obligatoria (de ahí se descuentan los metros del pedido).
        // En corte standalone la bobina se elige POR TIZADA (más abajo), no hay una sola.
        if (serviceId !== 'corte'
            && ((config.hasCuttingWorkflow && fabricOrigin === 'TELA CLIENTE' && moldType !== 'SUBLIMACION') || isSubliTelaCliente)
            && !selectedBobinaId) {
            return addToast('Seleccioná la bobina de tela del cliente antes de confirmar el pedido.', 'error');
        }

        // CORTE standalone: toda tizada debe estar MEDIDA y tener SU bobina elegida; el
        // consumo se valida POR BOBINA (varias tizadas pueden compartir la misma tela).
        if (serviceId === 'corte') {
            if ((tizadaFiles || []).some(f => !f.medicion)) {
                return addToast('Hay tizadas sin medir. Quitalas y volvé a subirlas para que se calculen piezas y metros de corte.', 'error');
            }
            if ((tizadaFiles || []).some(f => !f.bobinaId)) {
                return addToast('Elegí la bobina de tela de cada tizada antes de confirmar el pedido.', 'error');
            }

            // Agrupar por bobina: una ORDEN por tela (así producción controla por bobina)
            const porBobina = new Map();
            for (const f of tizadaFiles) {
                const bob = (bobinasDisponibles || []).find(b => b.BobinaID === f.bobinaId);
                if (!porBobina.has(f.bobinaId)) porBobina.set(f.bobinaId, { bobina: bob, archivos: [] });
                porBobina.get(f.bobinaId).archivos.push(f);
            }

            for (const [, grupo] of porBobina) {
                const b = grupo.bobina;
                if (!b) return addToast('Una de las bobinas elegidas ya no está disponible. Actualizá la página.', 'error');
                // Ancho ÚTIL de la tela = ancho del rollo − 3 cm de margen (misma regla
                // que sublimación contra el ancho imprimible del material).
                const anchoBob = parseFloat(b.AnchoReal ?? b.Ancho) || 0;
                const anchoUtil = anchoBob > 0 ? Math.round((anchoBob - MARGEN_TELA_M) * 100) / 100 : 0;
                const anchoMax = Math.max(...grupo.archivos.map(f => f.medicion.anchoTelaM));
                if (anchoUtil && anchoMax > anchoUtil + 1e-9) {
                    return addToast(`Una tizada mide ${anchoMax.toFixed(2)}m de ancho y en la tela "${b.DescripcionTela || b.CodigoEtiqueta}" entran ${anchoUtil.toFixed(2)}m (rollo de ${anchoBob.toFixed(2)}m menos 3 cm de margen). Elegí otra tela o rehacé la tizada.`, 'error');
                }
                const telaNecesaria = grupo.archivos.reduce((s, f) => s + f.medicion.largoTelaM * (f.copias || 1), 0);
                const disponible = parseFloat(b.MetrosRestantes) || 0;
                if (telaNecesaria > disponible + 1e-9) {
                    return addToast(`La tela "${b.DescripcionTela || b.CodigoEtiqueta}" necesita ${telaNecesaria.toFixed(2)}m y solo tiene ${disponible.toFixed(2)}m. Reducí los cortes o elegí otra tela.`, 'error');
                }
            }

            // El cliente CONFIRMA los datos que el sistema leyó de las tizadas antes de
            // enviar (regla 06/08): con esas piezas se controla el pedido en producción.
            const filasHtml = [...porBobina.values()].map(g => {
                const pz = g.archivos.reduce((s, f) => s + f.medicion.piezas * (f.copias || 1), 0);
                const mc = g.archivos.reduce((s, f) => s + f.medicion.metrosCorte * (f.copias || 1), 0);
                const mt = g.archivos.reduce((s, f) => s + f.medicion.largoTelaM * (f.copias || 1), 0);
                return `<div style="margin:6px 0;text-align:left">` +
                    `<b>${g.bobina.DescripcionTela || 'Tela'}</b> <small>(${g.bobina.CodigoEtiqueta})</small><br>` +
                    `<b>${pz} piezas</b> · ${mc.toFixed(2)} m de corte · ${mt.toFixed(2)} m de tela` +
                    `</div>`;
            }).join('');
            const confirmacion = await Swal.fire({
                icon: 'question',
                title: 'Confirmá tu pedido de corte',
                html: `El sistema leyó de tus tizadas (${porBobina.size} ${porBobina.size === 1 ? 'orden' : 'órdenes'}, una por tela):<br>` +
                    filasHtml +
                    '<br>¿Confirmás que el pedido es correcto?',
                showCancelButton: true,
                confirmButtonText: 'Sí, enviar pedido',
                cancelButtonText: 'Volver a revisar',
                confirmButtonColor: '#06b6d4',
            });
            if (!confirmacion.isConfirmed) return;
        }

        if (serviceId === 'tpu') {
            const minTpu = config.minCopies || 15;
            // (El modo matriz ya se resolvió arriba con return; acá siempre es "trabajo nuevo".)
            // Modo boceto: el boceto (PNG/JPG/PDF) es obligatorio; con él diseñamos el arte.
            if (config.bocetoMode && !bocetoFile) {
                return addToast('Subí el boceto de lo que querés (PNG, JPG o PDF).', 'error');
            }
            // La medida es obligatoria cuando el producto tiene un tope (o sea, cuando los selectores
            // están a la vista). Con un producto sin medida en el nombre no hay nada que elegir.
            if (medidaMaximaTPU(globalMaterial) && (!tpuAlto || !tpuAncho)) {
                return addToast('Elegí el alto y el ancho del parche.', 'error');
            }
            const invalidCopies = items.length === 0 || items.some(it => (it.copies || 0) < minTpu);
            if (invalidCopies) {
                return addToast(`El pedido mínimo para TPU es de ${minTpu} unidades.`, 'error');
            }
            if (isTpuEtiquetaOficial && !tpuForma) {
                return addToast('Debe seleccionar una Forma para la Etiqueta de Producto Oficial.', 'error');
            }
        }

        // Variante y material obligatorios también en modo 'single' — mismas condiciones con las
        // que se MUESTRAN esos selectores (si el selector está a la vista, elegir es obligatorio).
        // Sin esto, si la carga async del nomenclador falla o el cliente confirma antes de que
        // termine, el pedido viaja con los combos vacíos y la orden nace 'Estándar'/'N/A'
        // (caso DTF-13084).
        if ((config.variantMode === 'select' || config.variantMode === 'virtual')
            && serviceId !== 'bordado' && serviceId !== 'EMB'
            && !String(serviceSubType || '').trim()) {
            return addToast(config.variantMode === 'virtual'
                ? 'Seleccioná la categoría antes de confirmar el pedido.'
                : 'Seleccioná la variante antes de confirmar el pedido.', 'error');
        }
        if (config.materialMode === 'single' && svcId !== 'bordado' && svcId !== 'emb' && svcId !== 'sublimacion'
            && !String(globalMaterial || '').trim()) {
            return addToast('Seleccioná el material antes de confirmar el pedido.', 'error');
        }

        // Material obligatorio: en modo "multiple" (material por archivo) cada archivo debe tener
        // su material elegido — no se autocompleta, así que validamos antes de confirmar.
        if (config.materialMode === 'multiple' && items.some(it => !it.material || !String(it.material).trim())) {
            return addToast('Seleccioná el material de cada archivo antes de confirmar el pedido.', 'error');
        }

        // MEDIDA FIJA (banderas): último chequeo antes de enviar. El backend rechaza igual, pero acá
        // se explica el motivo — si se llegaba hasta la subida, el modal solo decía "hubo un problema
        // al subir uno de los archivos" y el cliente reintentaba a ciegas algo que nunca iba a entrar.
        // Cubre el caso de elegir la tela después de cargar el arte, y el de cambiarla al final.
        const errMedidaFija = items
            .map(it => errorArchivoParaMaterial(it.file, (config.materialMode === 'single' && !config.allowItemMaterialOverride) ? globalMaterial : (it.material || globalMaterial)))
            .find(Boolean);
        if (errMedidaFija) {
            actions.setErrorModalMessage(errMedidaFija);
            actions.setErrorModalOpen(true);
            return;
        }

        // Impresión (sublimación, DTF, etc.): tiene que haber al menos un archivo de arte. Sin arte la
        // orden nace con 0 metros y hay que cancelarla a mano. TPU va con boceto (bocetoMode) y
        // bordado/estampado validan su arte por otro lado → todos exentos de este chequeo. El backend
        // rechaza igual (guard por UM≠'u'); esto es solo para avisar antes de enviar.
        if (config.requiresProductionFiles && !config.bocetoMode) {
            const hayArte = items.some(it => it.file || it.fileBack);
            if (!hayArte) {
                return addToast('Subí al menos un archivo de arte para imprimir antes de confirmar el pedido.', 'error');
            }
        }

        // [BORDADO] Cada diseño tiene que estar completo antes de mandar el pedido.
        // Lo más importante: sobre QUÉ prendas va. Sin eso el backend no sabe de qué
        // línea descontar y la orden nacería sin origen (salvo parche, que se
        // fabrica de cero y no consume prendas del cliente).
        if (serviceId === 'bordado' && Array.isArray(disenosBordado)) {
            const esParcheBordado = /parche/i.test(serviceSubType || '');

            if (disenosBordado.length === 0) {
                return addToast('Agregá al menos un diseño a bordar antes de confirmar el pedido.', 'error');
            }
            for (let i = 0; i < disenosBordado.length; i++) {
                const d = disenosBordado[i];
                const n = i + 1;
                if (!esParcheBordado && !d.prendaClienteId) {
                    return addToast(`Diseño ${n}: elegí sobre qué prendas va antes de confirmar el pedido.`, 'error');
                }
                if (!d.file) {
                    return addToast(`Diseño ${n}: falta subir el logo a bordar.`, 'error');
                }
                if (!(parseFloat(d.ancho) > 0) || !(parseFloat(d.alto) > 0)) {
                    return addToast(`Diseño ${n}: cargá el ancho y el largo del bordado en cm.`, 'error');
                }
                if (!(parseInt(d.cantidad) > 0)) {
                    return addToast(`Diseño ${n}: indicá cuántas ${esParcheBordado ? 'parches querés' : 'prendas llevan este logo'}.`, 'error');
                }
            }
            // El saldo se valida sumando TODOS los diseños que usan la misma línea:
            // uno por uno puede entrar y entre todos pasarse.
            const porLinea = {};
            disenosBordado.forEach(d => {
                if (!d.prendaClienteId) return;
                porLinea[d.prendaClienteId] = (porLinea[d.prendaClienteId] || 0) + (parseInt(d.cantidad) || 0);
            });
            for (const [lineaId, pedido] of Object.entries(porLinea)) {
                const linea = (prendasDisponibles || []).find(p => String(p.PrendaClienteID) === String(lineaId));
                const libre = linea ? (parseInt(linea.CantidadDisponible) || 0) : 0;
                if (pedido > libre) {
                    return addToast(
                        `Estás pidiendo ${pedido} prendas de "${linea?.Descripcion || 'una línea'}" y solo tenés ${libre} disponibles.`,
                        'error'
                    );
                }
            }
        }

        actions.setLoading(true);

        try {
            // Helper to map files for upload
            const filesToUploadMap = {};
            const addToMap = (f) => {
                if (f && f.name) {
                    if (f.fileData && f.fileData instanceof File) {
                        filesToUploadMap[f.name] = f.fileData;
                    } else if (f instanceof File) {
                        filesToUploadMap[f.name] = f;
                    }
                }
            };

            // Collect Files
            if (bocetoFile) addToMap(bocetoFile);
            if (bordadoBocetoFile) addToMap(bordadoBocetoFile);
            if (Array.isArray(tizadaFiles)) tizadaFiles.forEach(addToMap);
            if (pedidoExcelFile) addToMap(pedidoExcelFile);
            if (Array.isArray(tizadaFiles)) tizadaFiles.forEach(addToMap);
            if (pedidoExcelFile) addToMap(pedidoExcelFile);
            if (Array.isArray(ponchadoFiles)) ponchadoFiles.forEach(addToMap);
            // [BORDADO] Los tres archivos de cada diseño. Antes solo se juntaban
            // ponchadoFiles/bordadoBocetoFile, que quedaron vacíos cuando el form
            // pasó a trabajar por diseño — por eso no subía ningún archivo.
            if (Array.isArray(disenosBordado)) {
                disenosBordado.forEach(d => {
                    if (d.file) addToMap(d.file);
                    if (d.boceto) addToMap(d.boceto);
                    if (d.arteDisenado) addToMap(d.arteDisenado);
                });
            }
            if (estampadoFile) addToMap(estampadoFile);
            if (referenceFiles) referenceFiles.forEach(addToMap);
            items.forEach(it => {
                if (it.file) addToMap(it.file);
                if (it.fileBack) addToMap(it.fileBack);
                if (it.boceto) addToMap(it.boceto); // Twinface: boceto de referencia por archivo
            });
            if (selectedComplementary) {
                Object.keys(selectedComplementary).forEach(id => {
                    const comp = selectedComplementary[id];
                    if (comp.active && comp.file) addToMap(comp.file);
                });
            }

            // Helper to map material codes
            const mapMaterial = (matName, areaId = null) => {
                const searchList = areaId === 'EMB' ? embroideryMaterials : dynamicMaterials;
                const found = searchList.find(m => m.Material === matName);
                if (found) return { name: found.Material, codArt: found.CodArticulo, codStock: found.CodStock };
                return { name: matName };
            };

            // Enriched Complementary Services Metadata
            const enrichedComplementary = {};
            if (selectedComplementary) {
                Object.keys(selectedComplementary).forEach(id => {
                    const comp = selectedComplementary[id];
                    if (comp.active) {
                        let cabecera = { variante: serviceSubType, material: mapMaterial(globalMaterial) };
                        if (id === 'TWC' || id === 'laser') {
                            cabecera = { variante: 'Corte Laser', material: { name: 'Corte Laser por prenda', id: 90, codArt: '1375', codStock: '1.1.6.1' } };
                        } else if (id === 'EST' || id === 'estampado') {
                            cabecera = {
                                variante: 'Estampado',
                                material: { name: 'Estampado por bajada', codArt: serviceInfo?.config?.defaultCodArt || '110', codStock: serviceInfo?.config?.defaultCodStock || '1.1.5.1' }
                            };
                        } else if (id === 'EMB' || id === 'BORDADO') {
                            cabecera = { variante: bordadoVariant || serviceSubType, material: mapMaterial(bordadoMaterial || globalMaterial, 'EMB') };
                        }

                        // Determinar Tipo de Archivo Específico
                        let fileType = 'ARCHIVO_EXTRA';
                        if (id === 'TWC') fileType = 'ARCHIVO_CORTE';
                        if (id === 'TWT') fileType = 'GUIA_CONFECCION';
                        if (id === 'EST' || id === 'estampado') fileType = 'BOCETO_ESTAMPADO';
                        if (id === 'EMB' || id === 'BORDADO') fileType = 'BOCETO_BORDADO';

                        // Prepare files array
                        const archivosComp = [];
                        if (comp.file) archivosComp.push({ name: comp.file.name, size: comp.file.size, tipo: fileType });

                        // Fallback: Si no hay archivo específico y es Estampado, usar global (Solo si NO se usó comp.file que ya lo cubría antes, pero aquí somos explícitos)
                        if ((id === 'EST' || id === 'estampado') && !comp.file && estampadoFile) {
                            archivosComp.push({ name: estampadoFile.name, tipo: 'BOCETO_ESTAMPADO' });
                        }

                        // Fallback y Extras para Bordado complementario
                        if (id === 'EMB' || id === 'BORDADO') {
                            if (!comp.file && bordadoBocetoFile) {
                                archivosComp.push({ name: bordadoBocetoFile.name, tipo: 'BOCETO_BORDADO' });
                            }
                            if (ponchadoFiles && ponchadoFiles.length > 0) {
                                ponchadoFiles.forEach(f => archivosComp.push({ name: f.name, tipo: 'LOGO_BORDADO' }));
                            }
                        }

                        enrichedComplementary[id] = {
                            activo: comp.active,
                            observacion: comp.text,
                            archivos: archivosComp, // NEW: Array structure
                            campos: comp.fields,
                            cabecera,
                            // Capturar metadatos si están disponibles en variables globales (para Estampado/Bordado como secundario, idealmente deberían tener su input propio, pero usamos globales como fallback o props)
                            metadata: (id === 'EST' || id === 'estampado')
                                ? { prendas: estampadoQuantity, estampadosPorPrenda: estampadoPrints, origen: estampadoOrigin }
                                : (id === 'EMB' || id === 'BORDADO' ? { prendas: garmentQuantity } : {})
                        };
                    }
                });
            }

            // *** CRITICAL FIX: Explicitly add TWC (Corte) and TWT (Costura) if enabled via Workflow ***
            if (config.hasCuttingWorkflow) {
                if (enableCorte) {
                    enrichedComplementary['TWC'] = {
                        activo: true,
                        observacion: `Corte habilitado. Molde: ${moldType}. Tela: ${fabricOrigin}.`,
                        archivo: (tizadaFiles && tizadaFiles.length > 0) ? { name: tizadaFiles[0].name } : null,
                        cabecera: {
                            variante: 'Corte Laser',
                            material: { name: 'Corte Laser por prenda', id: 90, codArt: '1375', codStock: '1.1.6.1' }
                        },
                        // Pass specific technical data if needed in a custom field
                        metadata: { moldType, fabricOrigin, clientFabricName, selectedSubOrderId }
                    };
                }
                if (enableCostura) {
                    enrichedComplementary['TWT'] = {
                        activo: true,
                        observacion: costuraNote || 'Servicio de Costura solicitado',
                        cabecera: {
                            variante: 'Costura',
                            material: { name: 'Costura Standard', codArt: '112', codStock: '1.1.7.1' }
                        }
                    };
                }
            }

            // Structure Lines and Sublines
            const grupos = {};
            items.forEach((it, idx) => {
                const matInfo = mapMaterial(it.material || globalMaterial);
                const key = `${matInfo.name}| ${serviceSubType} `.toUpperCase();

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

                let extraNote = it.printSettings?.observation ? ` [${it.printSettings.observation}]` : '';
                if (serviceId === 'tpu' && tpuForma) extraNote += ` [Forma: ${tpuForma}]`;
                if (serviceId === 'tpu' && tpuAlto && tpuAncho) extraNote += ` [Medida: ${tpuAlto} x ${tpuAncho} cm]`;

                const printNote = extraNote;
                const isSpecialPrint = it.printSettings?.mode && it.printSettings.mode !== 'normal';

                const finalWidthM = isSpecialPrint && it.printSettings.finalWidthM
                    ? parseFloat(it.printSettings.finalWidthM)
                    : (it.file?.width ? (it.file.unit === 'meters' ? it.file.width : (it.file.width / 300) * 0.0254) : 0);

                const finalHeightM = isSpecialPrint && it.printSettings.finalHeightM
                    ? parseFloat(it.printSettings.finalHeightM)
                    : (it.file?.height ? (it.file.unit === 'meters' ? it.file.height : (it.file.height / 300) * 0.0254) : 0);

                // Escala respeta las copias (cada copia es un largo escalado más); Raport NO
                // (su ancho/largo total YA es el resultado, las copias no lo multiplican).
                const finalQty = (it.printSettings?.mode === 'raport') ? 1 : it.copies;

                const shouldUseSame = (isDirectaTwinface && twinfaceSame);
                const fileBackEffective = it.fileBack || (shouldUseSame ? it.file : null);

                grupos[key].sublineas.push({
                    archivoPrincipal: it.file ? {
                        name: it.file.name,
                        width: finalWidthM,
                        height: finalHeightM,
                        observaciones: it.printSettings?.observation || '',
                        sinDPI: it.file.dpiConfirmedByUser ? 1 : null
                    } : null,
                    archivoDorso: fileBackEffective ? {
                        name: fileBackEffective.name, // ENVIAR NOMBRE ORIGINAL para que el backend encuentre el archivo
                        width: finalWidthM, // Enviar dimensiones correctas
                        height: finalHeightM,
                        observaciones: (it.printSettings?.observation || '') + ' [DORSO]', // Agregar DORSO a observaciones
                        sinDPI: fileBackEffective.dpiConfirmedByUser ? 1 : null
                    } : null,
                    // Twinface: boceto de referencia de ESTE archivo (va a ArchivosReferencia).
                    // La etiqueta identifica a qué archivo pertenece (coincide con "Archivo N de M" del arte).
                    boceto: it.boceto ? { name: it.boceto.name, etiqueta: `Boceto Archivo ${idx + 1} de ${items.length}` } : null,
                    cantidad: finalQty,
                    nota: (it.note || '') + printNote + (shouldUseSame ? ' [TWINFACE: MISMA IMAGEN DORSO]' : ''),
                    printSettings: it.printSettings,
                    width: finalWidthM,
                    height: finalHeightM,
                    widthBack: fileBackEffective ? finalWidthM : undefined,
                    heightBack: fileBackEffective ? finalHeightM : undefined,
                    // ECOUV: terminaciones del archivo, solo las que permite el material DE ESTE archivo
                    terminaciones: isEcouvMaterial
                        ? (() => {
                            const permit = termsDeMaterial(it.material || globalMaterial);
                            return (it.terminaciones || [])
                                .filter(t => permit.some(p => p.TerminacionID === t.terminacionId))
                                .map(t => ({
                                    terminacionId: t.terminacionId,
                                    cantidad: parseFloat(t.cantidad) || 1,
                                    ubicacion: t.ubicacion || null,
                                    // Lo que el cliente ajustó en el plano: separación de los
                                    // ojales o distancia del bolsillo al borde (cm).
                                    param: (t.param !== undefined && t.param !== null && t.param !== '')
                                        ? parseFloat(t.param) : null,
                                }));
                        })()
                        : []
                });
            });

            // Fallback for Bordado without files (just quantity/logo)
            if (Object.keys(grupos).length === 0 && (serviceId === 'bordado' || !config.requiresProductionFiles)) {
                const matInfo = mapMaterial(globalMaterial);
                const key = `${matInfo.name}| ${serviceSubType} `.toUpperCase();
                const logos = (ponchadoFiles && ponchadoFiles.length > 0) ? ponchadoFiles : [null];
                const sublineas = logos.map((logo, idx) => ({
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

            // Fallback for Estampado (Principal)
            if (Object.keys(grupos).length === 0 && (serviceId === 'estampado' || serviceId === 'EST')) {
                const key = `ESTAMPADO|${estampadoOrigin}|${estampadoPrints}x`.toUpperCase();

                grupos[key] = {
                    cabecera: {
                        variante: 'Estampado',
                        material: 'Estampado (Servicio)',
                        codArticulo: serviceInfo?.config?.defaultCodArt || '110', // FIX: Hardcoded fallback based on services.js
                        codStock: serviceInfo?.config?.defaultCodStock || '1.1.5.1'
                    },
                    sublineas: [{
                        archivoPrincipal: estampadoFile ? { name: estampadoFile.name, typeOverride: 'BOCETO_ESTAMPADO' } : null, // FIX: Override type for production loop
                        cantidad: (estampadoQuantity || 1) * (estampadoPrints || 1),
                        nota: `Prendas: ${estampadoQuantity} | Estampados x Prenda: ${estampadoPrints}. Origen: ${estampadoOrigin}`,
                        observaciones: `OBS: Prendas: ${estampadoQuantity}, Estampados: ${estampadoPrints}`
                    }]
                };
            }

            // 1. Construir Lista Unificada de Servicios
            const listaServicios = [];

            // A) SERVICIO PRINCIPAL (Convertir grupos a objetos de servicio)
            Object.values(grupos).forEach((grp, idx) => {
                // Archivos del Servicio Principal
                const archivosServicio = [];

                // Archivos de Items (Producción)
                grp.sublineas.forEach(sl => {
                    const tipoPrincipal = sl.archivoPrincipal?.typeOverride || 'PRODUCCION';
                    if (sl.archivoPrincipal) archivosServicio.push({ ...sl.archivoPrincipal, tipo: tipoPrincipal });
                    if (sl.archivoDorso) archivosServicio.push({ ...sl.archivoDorso, tipo: 'PRODUCCION' }); // FIX: Usar tipo estándar, distinción via obs
                    // Twinface: boceto de ESTE archivo → REFERENCIA (no producción)
                    if (sl.boceto) archivosServicio.push({ name: sl.boceto.name, tipo: 'BOCETO', etiqueta: sl.boceto.etiqueta });
                });

                // Archivos de Referencia (Solo al primer grupo del principal para no duplicar metadatos globales)
                // Archivos de Referencia (Solo al primer grupo del principal para no duplicar metadatos globales)
                if (idx === 0) {
                    if (referenceFiles) referenceFiles.forEach(f => archivosServicio.push({ name: f.name, tipo: 'REFERENCIA' }));

                    // Solo adjuntar Boceto/Excel al Principal si NO es Corte (porque en UI están en Corte)
                    // Solo adjuntar boceto general SI NO HAY boceto especializado (para evitar duplicados)
                    const hasSpecializedSketch = (
                        ((serviceId === 'bordado' || serviceId === 'EMB') && bordadoBocetoFile) ||
                        ((serviceId === 'estampado' || serviceId === 'EST') && estampadoFile)
                    );

                    if (!enableCorte && bocetoFile && !hasSpecializedSketch) {
                        archivosServicio.push({ name: bocetoFile.name, tipo: 'BOCETO' });
                    }
                    if (!enableCorte && pedidoExcelFile) archivosServicio.push({ name: pedidoExcelFile.name, tipo: 'INFO_PEDIDO' });

                    // CORRECCIÓN: Solo adjuntar archivos específicos si el servicio principal coincide
                    // PREVENIR QUE ARCHIVOS DE BORDADO VAYAN A SUBLIMACIÓN U OTROS

                    // Estampado Principal
                    if ((serviceId === 'estampado' || serviceId === 'EST') && estampadoFile) {
                        if (!archivosServicio.some(f => f.name === estampadoFile.name)) {
                            archivosServicio.push({ name: estampadoFile.name, tipo: 'BOCETO_ESTAMPADO' });
                        }
                    }

                    // Bordado Principal
                    if ((serviceId === 'bordado' || serviceId === 'EMB') && bordadoBocetoFile) {
                        if (!archivosServicio.some(f => f.name === bordadoBocetoFile.name)) {
                            archivosServicio.push({ name: bordadoBocetoFile.name, tipo: 'BOCETO_BORDADO' });
                        }
                    }

                    if ((serviceId === 'bordado' || serviceId === 'EMB') && ponchadoFiles) {
                        ponchadoFiles.forEach(f => {
                            if (!archivosServicio.some(existing => existing.name === f.name)) {
                                archivosServicio.push({ name: f.name, tipo: 'LOGO_BORDADO' });
                            }
                        });
                    }

                    // [BORDADO] Los archivos de cada diseño, con su tipo. El logo y el
                    // boceto son del cliente; el prediseño lo genera el editor y va
                    // aparte para que nadie lo confunda con la matriz.
                    if ((serviceId === 'bordado' || serviceId === 'EMB') && Array.isArray(disenosBordado)) {
                        const sumar = (f, tipo) => {
                            if (!f || archivosServicio.some(x => x.name === f.name)) return;
                            archivosServicio.push({ name: f.name, tipo });
                        };
                        disenosBordado.forEach(d => {
                            sumar(d.file, 'LOGO_BORDADO');
                            sumar(d.boceto, 'BOCETO_BORDADO');
                            sumar(d.arteDisenado, 'PREDISENO_BORDADO');
                        });
                    }
                }



                // Metadata Específica del Servicio Principal
                let metadata = {};
                if (serviceId === 'estampado' || serviceId === 'EST') {
                    metadata = { prendas: estampadoQuantity, estampadosPorPrenda: estampadoPrints, origen: estampadoOrigin };
                } else if (serviceId === 'bordado' || serviceId === 'EMB') {
                    // La cantidad total ya no es un campo suelto: es la suma de lo que
                    // pide cada diseño. `disenos` viaja para que el backend pueda
                    // guardar medidas, prenda de origen, paleta y relieve por diseño.
                    const totalPrendas = (disenosBordado || [])
                        .reduce((acc, d) => acc + (parseInt(d.cantidad) || 0), 0);
                    metadata = {
                        prendas: totalPrendas || garmentQuantity,
                        disenos: (disenosBordado || []).map(d => {
                            // Las puntadas se derivan de la paleta y las medidas (no se
                            // guardan en el diseño, así se recalculan al corregir el tamaño).
                            const punt = puntadasDePaleta(d.paleta, d.ancho, d.alto);
                            const hilos = (d.paleta || []).length;
                            const cant = parseInt(d.cantidad) || 0;
                            return {
                                logo: d.file?.name || null,
                                boceto: d.boceto?.name || null,
                                prediseno: d.arteDisenado?.name || null,
                                anchoCm: parseFloat(d.ancho) || null,
                                altoCm: parseFloat(d.alto) || null,
                                cantidad: cant,
                                prendaClienteId: d.prendaClienteId || null,
                                relieve3D: !!d.relieve3D || (d.paleta || []).some(p => p.relieve),
                                puntadasEstimadas: punt || null,
                                hilos,
                                // Minutos de máquina de TODO el trabajo de este diseño:
                                // es el dato que después alimenta la agenda del taller.
                                minutosEstimados: punt
                                    ? Math.round(estimarMinutos(punt, hilos) * (cant || 1))
                                    : null,
                                paleta: d.paleta || [],
                            };
                        }),
                    };
                }

                listaServicios.push({
                    esPrincipal: true,
                    areaId: serviceInfo?.areaId || serviceId, // FIX: Send DB-aligned ID (e.g. SB, ECOUV) forcorrect priority mapping
                    cabecera: grp.cabecera,
                    archivos: archivosServicio, // Lista oficial de archivos
                    // Mantenemos items con ref al archivo para saber qué cantidad va con qué archivo
                    items: grp.sublineas.map(sl => ({
                        cantidad: sl.cantidad,
                        nota: sl.nota,
                        width: sl.width,
                        height: sl.height,
                        fileName: sl.archivoPrincipal?.name, // <--- NECESARIO PARA VINCULAR
                        fileBackName: sl.archivoDorso?.name,
                        printSettings: sl.printSettings,
                        terminaciones: sl.terminaciones || [], // ECOUV: por archivo

                        widthBack: sl.widthBack, // Pass back dimensions
                        heightBack: sl.heightBack,
                        observaciones: sl.archivoPrincipal?.observaciones, // Pass main observations
                        observacionesBack: sl.archivoDorso?.observaciones, // Pass back observations if any
                        sinDPI: sl.archivoPrincipal?.sinDPI,
                        sinDPIBack: sl.archivoDorso?.sinDPI
                    })),
                    metadata: metadata, // NUEVO CAMPO METADATA
                    notas: '' // la nota general viaja en notasGenerales; no repetirla acá (evita duplicado en la Nota)
                });
            });

            // A.bis) CORTE STANDALONE: el servicio principal TWC se arma desde las tizadas
            // medidas. OJO: el form arranca con un item vacío por defecto que mete un principal
            // fantasma por la vía de grupos (Material 'Estándar', cantidad 1) — se descarta y
            // se reemplaza SIEMPRE por este. Cada archivo viaja con su medición
            // (piezas + metros de corte) para que el backend la guarde.
            if (serviceId === 'corte') {
                for (let i = listaServicios.length - 1; i >= 0; i--) {
                    if (listaServicios[i].esPrincipal) listaServicios.splice(i, 1);
                }
            }
            if (serviceId === 'corte') {
                // UNA ORDEN POR BOBINA (como sublimación agrupa por material): así producción
                // controla las cantidades tela por tela y cada orden descuenta SU bobina.
                // Las tizadas viajan como ARCHIVOS DE PRODUCCIÓN (items con fileName), no como
                // referencias: el área los descarga y maneja igual que los de impresión.
                const grupos = new Map();
                (tizadaFiles || []).forEach(f => {
                    if (!grupos.has(f.bobinaId)) grupos.set(f.bobinaId, []);
                    grupos.get(f.bobinaId).push(f);
                });

                const r2 = (n) => Math.round(n * 100) / 100;
                let excelAdjuntado = false; // la planilla va UNA sola vez (a la primera orden)
                for (const [bobinaId, archivos] of grupos) {
                    const bob = (bobinasDisponibles || []).find(b => b.BobinaID === bobinaId);
                    const piezasTotal = archivos.reduce((s, f) => s + f.medicion.piezas * (f.copias || 1), 0);
                    const metrosCorteTotal = r2(archivos.reduce((s, f) => s + f.medicion.metrosCorte * (f.copias || 1), 0));
                    const largoTelaTotal = r2(archivos.reduce((s, f) => s + f.medicion.largoTelaM * (f.copias || 1), 0));

                    listaServicios.push({
                        esPrincipal: true,
                        areaId: 'TWC',
                        cabecera: {
                            variante: 'Corte Laser',
                            // El "material" de la orden ES la tela elegida (como en sublimación),
                            // pero el artículo a cotizar sigue siendo el de corte (1375).
                            material: {
                                name: bob?.DescripcionTela || 'Corte Laser por prenda',
                                id: 90, codArt: '1375', codStock: '1.1.6.1'
                            }
                        },
                        // Marca de producción: el backend filtra estos de las referencias y los
                        // vincula a los items por nombre de archivo. La planilla Excel del pedido
                        // NO es producción: va como referencia (INFO_PEDIDO) a la primera orden.
                        archivos: [
                            ...archivos.map(f => ({ name: f.name, tipo: 'PRODUCCION' })),
                            ...((pedidoExcelFile && !excelAdjuntado)
                                ? [{ name: pedidoExcelFile.name, tipo: 'INFO_PEDIDO' }]
                                : [])
                        ],
                        items: archivos.map(f => ({
                            fileName: f.name,
                            cantidad: f.copias || 1,       // cuántas veces se corta esa tizada
                            width: f.medicion.anchoTelaM,  // ancho de tela que ocupa
                            height: f.medicion.largoTelaM, // largo de tela (los "metros" del archivo)
                            piezas: f.medicion.piezas,
                            metrosCorte: f.medicion.metrosCorte,
                            nota: `${f.medicion.piezas} piezas · ${f.medicion.metrosCorte.toFixed(2)}m de corte`
                        })),
                        // Bobina y metros de tela de ESTA orden (el backend descuenta por orden)
                        bobinaTelaId: bobinaId,
                        magnitudTela: largoTelaTotal,
                        metadata: {
                            moldType, fabricOrigin, clientFabricName,
                            piezasTotal, metrosCorteTotal, largoTelaTotal,
                            tela: bob ? `${bob.DescripcionTela || 'Tela'} (${bob.CodigoEtiqueta})` : null
                        },
                        notas: ''
                    });
                    if (pedidoExcelFile) excelAdjuntado = true;
                }
            }

            // B) SERVICIOS COMPLEMENTARIOS (Corte, Costura, etc.)
            // Normalizamos 'enrichedComplementary' que ya calculamos arriba
            if (enrichedComplementary) {
                Object.keys(enrichedComplementary).forEach(key => {
                    const comp = enrichedComplementary[key];
                    if (comp.activo || comp.active) {

                        // Combinar archivos del array enriquecido o del singular legacy
                        const archivosExtra = comp.archivos ? [...comp.archivos] : [];

                        // Legacy singular fallback (por si acaso TWC u otros no migraron)
                        if (comp.archivo && !archivosExtra.some(f => f.name === comp.archivo.name)) {
                            archivosExtra.push({ name: comp.archivo.name, size: comp.archivo.size, tipo: 'ARCHIVO_EXTRA' });
                        }

                        // Si es TWC (Corte), adjuntar archivos de tizada si existen y no están ya
                        if (key === 'TWC') {
                            if (tizadaFiles && tizadaFiles.length > 0) {
                                tizadaFiles.forEach(f => {
                                    if (!archivosExtra.some(existing => existing.name === f.name)) {
                                        archivosExtra.push({ name: f.name, tipo: 'ARCHIVO_CORTE' });
                                    }
                                });
                            }
                            // Si están en el contenedor de Corte, van a Corte (ya evitamos ponerlos en Principal arriba)
                            if (bocetoFile) archivosExtra.push({ name: bocetoFile.name, tipo: 'BOCETO_CORTE' });
                            if (pedidoExcelFile) archivosExtra.push({ name: pedidoExcelFile.name, tipo: 'INFO_CORTE' });
                        }

                        // Si es Bordado (EMB/bordado), adjuntar archivos y metadata
                        if (key === 'EMB' || key === 'bordado') {
                            if (bordadoBocetoFile) {
                                archivosExtra.push({ name: bordadoBocetoFile.name, tipo: 'BOCETO_BORDADO' });
                            }
                            if (ponchadoFiles && ponchadoFiles.length > 0) {
                                ponchadoFiles.forEach(f => {
                                    if (!archivosExtra.some(existing => existing.name === f.name)) {
                                        archivosExtra.push({ name: f.name, tipo: 'LOGO_BORDADO' });
                                    }
                                });
                            }
                            // Inyectar Metadata de Prendas
                            comp.metadata = {
                                ...comp.metadata,
                                prendas: garmentQuantity, // Actualizar cantidad de prendas
                                material: bordadoMaterial,
                                variante: bordadoVariant
                            };
                        }

                        // Si es Estampado (EST), adjuntar archivos y metadata (FIX: Faltaba este bloque)
                        if (key === 'EST') {
                            if (estampadoFile) {
                                archivosExtra.push({ name: estampadoFile.name, tipo: 'BOCETO_ESTAMPADO' });
                            }
                            // Inyectar Metadata y Códigos Hardcoded para Estampado
                            comp.metadata = {
                                ...comp.metadata,
                                prendas: estampadoQuantity,
                                estampadosPorPrenda: estampadoPrints,
                                origen: estampadoOrigin
                            };
                            // Forzar códigos de Estampado si no vienen en cabecera
                            if (!comp.cabecera) comp.cabecera = {};
                            comp.cabecera.codArticulo = '110';
                            comp.cabecera.codStock = '1.1.5.1';
                            comp.cabecera.material = 'Estampado (Servicio)';
                        }

                        listaServicios.push({
                            esPrincipal: false,
                            areaId: key,
                            cabecera: comp.cabecera,
                            archivos: archivosExtra,
                            items: [], // Complementarios no suelen tener items productivos aquí
                            notas: comp.observacion,
                            metadata: comp.metadata || {}
                        });
                    }
                });
            }



            // --- LOOKUP COD ARTICULO PARA PRINCIPAL ---
            // Buscar el objeto material real para obtener CodArticulo
            let mainCodArt = '';
            let mainCodStock = '';

            if (globalMaterial) {
                // Buscar en materiales dinámicos
                const foundMat = dynamicMaterials.find(m => (m.Material || m.Descripcion || m) === globalMaterial);
                if (foundMat) {
                    mainCodArt = foundMat.CodArticulo || foundMat.CodigoArticulo || '';
                    mainCodStock = foundMat.CodStock || foundMat.CodigoStock || '';
                } else if (serviceInfo?.materials) {
                    // Buscar en estáticos
                    const foundStatic = serviceInfo.materials.find(m => (m.Material || m) === globalMaterial);
                    if (foundStatic && typeof foundStatic === 'object') {
                        mainCodArt = foundStatic.codArt || '';
                        mainCodStock = foundStatic.codStock || '';
                    }
                }
            }

            // Si es Estampado Principal y no hay mat, usar default
            if (serviceId === 'estampado' || serviceId === 'EST') {
                if (!mainCodArt) mainCodArt = '110';
                if (!mainCodStock) mainCodStock = '1.1.5.1';
            }

            // Inyectar en el primer servicio (Principal)
            if (listaServicios.length > 0 && listaServicios[0].esPrincipal) {
                if (!listaServicios[0].cabecera.codArticulo) listaServicios[0].cabecera.codArticulo = mainCodArt;
                if (!listaServicios[0].cabecera.codStock) listaServicios[0].cabecera.codStock = mainCodStock;
            }

            // TELA CLIENTE: metros del pedido = largo total de los archivos (misma fórmula que el footer).
            // El backend descuenta este valor de la bobina al crear la orden.
            // CORTE standalone queda FUERA: cada orden lleva su propia bobina y sus metros
            // (bobinaTelaId/magnitudTela por servicio), así que no hay bobina top-level.
            const usaTelaCliente = serviceId !== 'corte' && selectedBobinaId
                && ((fabricOrigin === 'TELA CLIENTE' && moldType !== 'SUBLIMACION') || isSubliTelaCliente);
            const largoTotalM = Math.round(items.reduce((acc, it) => {
                    const h = it.printSettings?.finalHeightM || (it.file?.unit === 'meters' ? it.file?.height : (it.file?.height ? (it.file.height / 300) * 0.0254 : 0)) || 0;
                    // Raport no multiplica por copias (su largo total ya es el resultado); escala/normal sí.
                    const factorCopias = (it.printSettings?.mode === 'raport') ? 1 : (it.copies || 1);
                    return acc + (h * factorCopias);
                }, 0) * 100) / 100;

            const payload = {
                idServicioBase: serviceId,
                nombreTrabajo: jobName,
                prioridad: urgency,
                // TPU: la medida del parche va acá para que llegue a `Ordenes.Nota`, que es de donde
                // la lee el detalle de orden. Abajo también se agrega a la nota del ÍTEM, pero esa
                // termina en ArchivosOrden.Observaciones y un pedido de TPU no tiene archivo al
                // crearse (el boceto va a Referencias): por ese camino la medida se perdía.
                notasGenerales: (serviceId === 'tpu' && tpuAlto && tpuAncho)
                    ? `${generalNote || ''} [Medida: ${tpuAlto} x ${tpuAncho} cm]`.trim()
                    : generalNote,

                // Forma de envío elegida (FormasEnvio.ID) — el backend la guarda en Ordenes.ModoRetiro
                formaEnvioId: formaEnvioId || null,

                // Tinta de impresión (ECOUV) — el backend la guarda en Ordenes.Tinta
                tinta: (Array.isArray(config.tintaOptions) && tintaSeleccionada) ? tintaSeleccionada : null,

                // TELA CLIENTE (top-level: el backend los espera acá)
                bobinaId: usaTelaCliente ? selectedBobinaId : null,
                magnitud: usaTelaCliente ? largoTotalM : null,

                // Nueva Estructura Unificada
                servicios: listaServicios,

                // Mantenemos cliente y fechas arriba
                clienteInfo: {
                    // Si tienes info de cliente aqui
                }
            };

            console.log("🚀 Enviando Metadata de Pedido...", payload);
            const response = await apiClient.post('/web-orders/create', payload);

            if (response.success) {
                actions.setCreatedOrderIds(response.orderIds || []);
                if (response.requiresUpload && response.uploadManifest) {
                    // La subida termina en UPLOAD_SUCCESS, que ya abre el modal.
                    await actions.handleUploadProcess(response.uploadManifest, filesToUploadMap);
                } else {
                    // Pedido sin archivos que subir. Antes acá solo salía un toast y el
                    // modal con las órdenes generadas nunca aparecía: el cliente no veía
                    // confirmación, el botón volvía a quedar activo y era natural darle
                    // de nuevo — así se creaban pedidos duplicados.
                    actions.setShowSuccessModal(true);
                }
            } else {
                addToast(response.message || 'Error al enviar', 'error');
            }

        } catch (error) {
            console.error(error);
            addToast(error.message || 'Error al enviar pedido', 'error');
        } finally {
            actions.setLoading(false);
        }
    };

    // --- Render Logic Checks ---
    const isBlackoutSelected = (serviceId === 'directa_320' && globalMaterial === 'Lona Blackout') || isDirectaTwinface;
    const currentCode = (() => {
        const areaMapLocal = { 'dtf': 'DF', 'DF': 'DF', 'sublimacion': 'SB', 'ecouv': 'ECOUV', 'directa_320': 'DIRECTA', 'directa_algodon': 'DIRECTA', 'bordado': 'EMB', 'laser': 'TWC', 'tpu': 'TPU', 'costura': 'TWT', 'corte-confeccion': 'TWT', 'estampado': 'EST' };
        return areaMapLocal[serviceId] || (serviceId ? serviceId.toUpperCase() : '');
    })();
    const specificConfig = visibleConfig ? visibleConfig[currentCode] : null;

    return (
        <div className="animate-fade-in pb-20">
            {specificConfig && (specificConfig.description || specificConfig.image) && (
                <div className="mb-8 animate-fade-in-down">
                    <GlassCard className="-mx-4 md:mx-0 md:!rounded-xl !rounded-none !border-r-0 md:!border-r border-y md:border-y-0 border-l-4 border-l-brand-gold overflow-hidden !p-0">
                        <div className="flex flex-col md:flex-row">
                            {specificConfig.image && <div className="w-full md:w-1/3 min-h-[200px] md:min-h-0 bg-zinc-800/40 relative"><img src={specificConfig.image} alt="Info" className="absolute inset-0 w-full h-full object-cover opacity-80" /></div>}
                            <div className="flex-1 p-8">
                                <h3 className="text-xl font-black text-brand-gold mb-3 uppercase tracking-widest flex items-center gap-2">
                                    <AlertTriangle className="text-brand-gold" size={20} /> Información Importante
                                </h3>
                                {specificConfig.description && <div className="prose prose-invert prose-sm text-zinc-400 font-bold leading-relaxed whitespace-pre-wrap">{specificConfig.description}</div>}
                            </div>
                        </div>
                    </GlassCard>
                </div>
            )}

            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-6 px-4 md:px-0">
                <div className="flex-shrink-0">
                    <CustomButton variant="ghost" onClick={() => navigate('/portal')} icon={ArrowLeft} className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 -ml-4 md:ml-0 px-2">Volver</CustomButton>
                </div>
                <div>
                    <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 uppercase tracking-widest leading-tight">
                        <span>Nuevo Pedido:</span> <span className="text-cyan-400">{serviceInfo?.label}</span>
                    </h2>
                    <p className="text-xs md:text-sm text-zinc-500 font-bold tracking-tight mt-1">{serviceInfo?.desc}</p>
                </div>
            </div>

            {config.dependencyWarning && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r flex items-start gap-3">
                    <AlertTriangle className="text-amber-500" />
                    <div><h4 className="font-bold text-amber-800 text-sm">Requisito Previo</h4><p className="text-sm text-amber-700">{config.dependencyWarning}</p></div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">

                {/* 1. Datos Generales (Resumed) */}
                <GlassCard title="Datos Generales del Pedido" icon={ClipboardList} className="-mx-4 md:mx-0 md:!rounded-xl !rounded-none !border-x-0 md:!border-x border-y md:border-y-0 px-4 md:px-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <FormInput label="Nombre del Proyecto / Trabajo *" placeholder="Ej: Camisetas Verano 2024" value={jobName} onChange={(e) => actions.setJobName(e.target.value)} required />
                        </div>
                        <div>
                            <p className="block text-sm font-medium text-zinc-400 mb-2">Prioridad *</p>
                            <div className="flex bg-brand-dark p-1 rounded-lg gap-1 border border-zinc-700">
                                {prioridadesVisibles.map(p => {
                                    const isUrgent = p.Nombre.toLowerCase() === 'urgente';
                                    const isSelected = urgency === p.Nombre;
                                    const selectedClass = isUrgent
                                        ? 'shadow-sm bg-custom-magenta/20 text-custom-magenta border border-custom-magenta/30'
                                        : 'shadow-sm bg-cyan-400/20 text-cyan-300 border border-cyan-500/30';
                                    const isDisabled = false;
                                    return (
                                    <button key={p.Nombre} type="button" onClick={() => actions.setUrgency(p.Nombre)}
                                        className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${isSelected ? selectedClass : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'} `}
                                    >
                                        {p.Nombre}{p.Texto && p.Texto.trim() ? ` ${p.Texto.trim()}` : ''}
                                    </button>
                                    );
                                })}
                            </div>

                            {(tiempoEntregaNormal || tiempoEntregaUrgente) && (
                                <div className="mt-2 space-y-0.5 text-[11px]">
                                    {tiempoEntregaNormal && (
                                        <p className="text-brand-cyan font-semibold">Tiempo estimado de entrega normal: <span className="font-black text-zinc-100">{tiempoEntregaNormal}</span></p>
                                    )}
                                    {tiempoEntregaUrgente && areaConUrgencia && (
                                        <p className="text-brand-magenta font-semibold">Tiempo estimado de entrega urgente: <span className="font-black text-zinc-100">{tiempoEntregaUrgente}</span></p>
                                    )}
                                </div>
                            )}

                        </div>

                        {/* Forma de envío del pedido (nomenclador FormasEnvio del retiro).
                            Solo se elige en EcoUV; en el resto queda el default (Retiro en el
                            Local) y viaja igual a la orden. */}
                        {formasEnvio.length > 0 && svcId === 'ecouv' && (
                            <div>
                                <p className="block text-sm font-medium text-zinc-400 mb-2">Forma de envío *</p>
                                <CustomSelect
                                    name="formaEnvio"
                                    aria-label="Forma de envío"
                                    value={formaEnvioId != null ? String(formaEnvioId) : ''}
                                    onChange={(val) => setFormaEnvioId(val ? parseInt(val, 10) : null)}
                                    options={formasEnvio.map(f => ({ value: String(f.ID), label: (f.Nombre || '').trim() }))}
                                    placeholder="¿Cómo recibís el pedido?"
                                />
                            </div>
                        )}

                    </div>
                </GlassCard>

                {/* 2. Servicios - Stack */}
                <div className="space-y-4">
                    <h3 className="text-lg font-black text-zinc-200 px-2 uppercase tracking-tight">Servicios y Procesos</h3>

                    {/* Main Service Block */}
                    <ServiceAccordion
                        title={`Producción Principal: ${serviceInfo?.label || 'Servicio'}`}
                        isActive={true} // Always active
                        onToggle={() => { }} // No toggle for main
                        icon={Layers}
                        main={true}
                    >
                        <div className="space-y-8">
                            {/* Material Selectors for Main Service */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-custom-dark md:rounded-2xl rounded-none border-y border-x-0 md:border-x border-zinc-700/50 -mx-4 md:mx-0">
                                {(config.variantMode === 'select' || config.variantMode === 'virtual') && serviceId !== 'bordado' && serviceId !== 'EMB' && (
                                    <div>
                                        <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">{config.variantMode === 'virtual' ? 'Categoría *' : 'Variante / Sub-Categoría *'}</p>
                                        <CustomSelect
                                            name="serviceSubType"
                                            aria-label={config.variantMode === 'virtual' ? 'Categoría' : 'Variante / Sub-Categoría'}
                                            value={serviceSubType}
                                            onChange={(val) => actions.handleSubTypeChange(val)}
                                            options={(uniqueVariants.length > 0 ? uniqueVariants : (serviceInfo?.subtypes || [])).map(t => ({ value: t, label: t }))}
                                            placeholder="Seleccionar..."
                                            variant="black"
                                        />
                                    </div>
                                )}

                                {/* Variante física (StockArt: Lonas/Canvas/Vinilos/Cuadros...) — filtra materiales */}
                                {config.variantMode === 'virtual' && categoriasFisicas.length > 0 && (
                                    <div>
                                        <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">Variante *</p>
                                        <CustomSelect
                                            name="categoriaFisica"
                                            aria-label="Variante"
                                            value={categoriaFiltro}
                                            onChange={(val) => setCategoriaFiltro(val)}
                                            options={categoriasFisicas.map(c => ({ value: c, label: c }))}
                                            placeholder="Seleccionar Variante..."
                                            variant="black"
                                        />
                                    </div>
                                )}

                                {/* Global Material Selector - Hidden for Bordado and Sublimacion */}
                                {config.materialMode === 'single' && svcId !== 'bordado' && svcId !== 'emb' && svcId !== 'sublimacion' && (() => {
                                    // TPU: al lado del producto van la medida del parche. El tope sale del
                                    // nombre del producto elegido ("Parche (De hasta 10x8)"), así que los
                                    // selectores solo aparecen cuando ese nombre trae una medida.
                                    const topeTPU = serviceId === 'tpu' ? medidaMaximaTPU(globalMaterial) : null;
                                    // md:col-span-2: el contenedor de arriba es un grid de 2 columnas, así que
                                    // sin esto los tres selectores se apretaban en la mitad izquierda. Con las dos
                                    // columnas tomadas, el producto se lleva la mitad del ancho REAL y cada medida
                                    // un cuarto.
                                    return (
                                    <div className={topeTPU ? 'md:col-span-2 grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-3 items-end' : ''}>
                                    <div>
                                        <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">{isEcouvPT ? 'Producto' : (serviceInfo?.config?.materialLabel || 'Material / Soporte')} *</p>
                                        <CustomSelect
                                            name="globalMaterial"
                                            aria-label={isEcouvPT ? 'Producto' : (serviceInfo?.config?.materialLabel || 'Material / Soporte')}
                                            value={globalMaterial}
                                            onChange={(val) => actions.setGlobalMaterial(val)}
                                            options={materialesParaSelect.map(m => {
                                                const val = m.Material || m.Descripcion || m;
                                                return { value: val, label: val };
                                            })}
                                            placeholder={isEcouvPT ? 'Seleccionar Producto...' : 'Seleccionar Material...'}
                                            variant="black"
                                        />
                                    </div>

                                    {topeTPU && (
                                        <>
                                            <div>
                                                <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">
                                                    Alto <span className="text-red-400">*</span> <span className="text-zinc-600 normal-case font-normal">(máx. {topeTPU.alto} cm)</span>
                                                </p>
                                                <CustomSelect
                                                    name="tpuAlto"
                                                    aria-label="Alto del parche"
                                                    value={tpuAlto}
                                                    onChange={setTpuAlto}
                                                    options={opcionesCm(topeTPU.alto)}
                                                    placeholder="Alto..."
                                                    variant="black"
                                                />
                                            </div>
                                            <div>
                                                <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">
                                                    Ancho <span className="text-red-400">*</span> <span className="text-zinc-600 normal-case font-normal">(máx. {topeTPU.ancho} cm)</span>
                                                </p>
                                                <CustomSelect
                                                    name="tpuAncho"
                                                    aria-label="Ancho del parche"
                                                    value={tpuAncho}
                                                    onChange={setTpuAncho}
                                                    options={opcionesCm(topeTPU.ancho)}
                                                    placeholder="Ancho..."
                                                    variant="black"
                                                />
                                            </div>
                                        </>
                                    )}
                                    </div>
                                    );
                                })()}

                                {/* Producto Terminado: el material lo define la FICHA (no editable);
                                    la TINTA arranca en la de la ficha pero el cliente PUEDE cambiarla
                                    — si elige UV/Latex, el recargo % aplica solo (perfil de tinta). */}
                                {isEcouvPT && fichaPT && (
                                    <>
                                        <div>
                                            <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">Material de impresión <span className="text-zinc-600 normal-case font-normal">(definido por el producto)</span></p>
                                            <div className="w-full px-4 py-3 bg-zinc-900/40 border border-zinc-700/40 rounded-[10px] text-sm font-medium text-zinc-400 cursor-not-allowed select-none">
                                                {fichaPT.materialDescripcion || '— A definir en producción —'}
                                            </div>
                                        </div>
                                        <div>
                                            <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">Tinta <span className="text-zinc-600 normal-case font-normal">{fichaPT.tinta ? '(sugerida por el producto — podés cambiarla)' : '(la elegís vos)'}</span></p>
                                            <CustomSelect
                                                name="tintaImpresionPT"
                                                aria-label="Tinta"
                                                value={tintaSeleccionada}
                                                onChange={(val) => setTintaSeleccionada(val)}
                                                options={(config.tintaOptions || ['Ecosolvente', 'UV']).map(t => ({ value: t, label: t }))}
                                                placeholder="Seleccionar Tinta..."
                                                variant="black"
                                            />
                                        </div>
                                    </>
                                )}

                                {/* Tinta de impresión (ECOUV: rutea el lote a la máquina Ecosolvente/UV).
                                    En Productos Terminados el selector va arriba, junto a la ficha. */}
                                {Array.isArray(config.tintaOptions) && config.tintaOptions.length > 0 && !isEcouvPT && (
                                    <div>
                                        <p className="block text-xs font-bold uppercase text-zinc-400 mb-2">Tinta</p>
                                        <CustomSelect
                                            name="tintaImpresion"
                                            aria-label="Tinta"
                                            value={tintaSeleccionada}
                                            onChange={(val) => setTintaSeleccionada(val)}
                                            options={config.tintaOptions.map(t => ({ value: t, label: t }))}
                                            placeholder="Seleccionar Tinta..."
                                            variant="black"
                                        />
                                    </div>
                                )}

                                {isTpuEtiquetaOficial && (
                                    <div className="md:col-span-2 mt-2 animate-in slide-in-from-top-2 p-3 bg-amber-50 rounded-xl border border-amber-200">
                                        <p className="block text-xs font-bold uppercase text-amber-800 mb-2">Forma de Etiqueta *</p>
                                        <CustomSelect
                                            name="tpuForma"
                                            aria-label="Forma de Etiqueta"
                                            value={tpuForma || ''}
                                            onChange={(val) => actions.setTpuForma(val)}
                                            options={['Ovalado', 'Rectangular', 'Redondo', 'Cuadrado Redondeado', 'Triangulo Redondeado', 'Hexagonal'].map(f => ({ value: f, label: f }))}
                                            placeholder="Seleccionar Forma..."
                                            variant="light"
                                            size="small"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* La ficha del producto terminado NO va acá: se ve en su propia
                                pestaña dentro del archivo, junto al arte (solo lectura). */}

                            {/* Sublimación Tela de Cliente: elegí tu bobina (valida ancho/largo y descuenta metros) */}
                            {isSubliTelaCliente && (
                                <BobinaSelector
                                    bobinasDisponibles={bobinasDisponibles}
                                    selectedBobinaId={selectedBobinaId}
                                    setSelectedBobina={actions.setSelectedBobina}
                                />
                            )}

                            {/* Bordado Specific UI if Main Service is Bordado */}
                            {serviceId === 'bordado' && (
                                <BordadoTechnicalUI
                                    serviceId={serviceId} garmentQuantity={garmentQuantity} setGarmentQuantity={actions.setGarmentQuantity}
                                    bocetoFile={bordadoBocetoFile} setBocetoFile={actions.setBordadoBocetoFile}
                                    ponchadoFiles={ponchadoFiles} setPonchadoFiles={actions.setPonchadoFiles}
                                    globalMaterial={globalMaterial} handleGlobalMaterialChange={actions.setGlobalMaterial}
                                    serviceInfo={serviceInfo} userStock={userStock}
                                    handleSpecializedFileUpload={(file) => handleSpecializedFileUpload(actions.setBordadoBocetoFile, file)}
                                    handleMultipleSpecializedFileUpload={(files) => handleMultipleSpecializedFileUpload(actions.addPonchadoFiles, files)}
                                    uniqueVariants={uniqueVariants} dynamicMaterials={dynamicMaterials}
                                    serviceSubType={serviceSubType} handleSubTypeChange={actions.handleSubTypeChange}
                                    disenosBordado={disenosBordado}
                                    addDiseno={actions.addDisenoBordado}
                                    updateDiseno={actions.updateDisenoBordado}
                                    removeDiseno={actions.removeDisenoBordado}
                                    prendasDisponibles={prendasDisponibles}
                                />
                            )}

                            {/* Estampado UI */}
                            {(serviceId === 'estampado' || serviceId === 'EST') && (
                                <EstampadoTechnicalUI
                                    file={estampadoFile} setFile={actions.setEstampadoFile}
                                    quantity={estampadoQuantity} setQuantity={actions.setEstampadoQuantity}
                                    printsPerGarment={estampadoPrints} setPrintsPerGarment={actions.setEstampadoPrints}
                                    origin={estampadoOrigin} setOrigin={actions.setEstampadoOrigin}
                                    handleSpecializedFileUpload={(file) => handleSpecializedFileUpload(actions.setEstampadoFile, file)}
                                />
                            )}

                            {/* Corte UI only if Main Service */}
                            {serviceId === 'corte' && (
                                <div className="space-y-6">
                                    <CorteTechnicalUI
                                        serviceId={serviceId} moldType={moldType} setMoldType={actions.setMoldType}
                                        fabricOrigin={fabricOrigin} setFabricOrigin={actions.setFabricOrigin}
                                        clientFabricName={clientFabricName} setClientFabricName={actions.setClientFabricName}
                                        selectedSubOrderId={selectedSubOrderId} setSelectedSubOrderId={actions.setSelectedSubOrderId}
                                        activeSubOrders={activeSubOrders} tizadaFiles={tizadaFiles} setTizadaFiles={actions.setTizadaFiles}
                                        handleMultipleSpecializedFileUpload={handleTizadaUploadCorte}
                                        onReemplazarTizada={handleReemplazarTizadaCorte}
                                        compact={false}
                                        bobinasDisponibles={bobinasDisponibles} selectedBobinaId={selectedBobinaId} setSelectedBobina={actions.setSelectedBobina}
                                    />
                                    {/* PLANILLA DE PEDIDO: descarga de las plantillas Excel + subida de
                                        la planilla completada (el mockup/croquis sigue oculto). */}
                                    <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-[2rem] p-6 md:p-8">
                                        <h4 className="text-sm font-black uppercase text-zinc-100 tracking-widest mb-1">Planilla de Pedido</h4>
                                        <p className="text-[11px] text-zinc-500 mb-5">Descargá la plantilla, completala con el detalle de tu pedido y subila acá.</p>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                                            {config.templateButtons?.map(btn => (
                                                <a
                                                    key={btn.label}
                                                    href={btn.url}
                                                    download
                                                    className="flex items-center justify-between gap-3 bg-zinc-800/60 p-3.5 rounded-xl border-2 border-zinc-700/50 hover:border-brand-cyan hover:bg-brand-cyan/5 transition-colors"
                                                >
                                                    <span className="text-[10px] font-black uppercase text-zinc-300">{btn.label}</span>
                                                    <Download size={16} className="text-brand-cyan shrink-0" />
                                                </a>
                                            ))}
                                        </div>

                                        <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Planilla completada (Excel)</label>
                                        <FileUploadZone
                                            id="pedido-upload-corte-main"
                                            label="SUBIR PLANILLA (XLS / XLSX / CSV)"
                                            selectedFile={pedidoExcelFile}
                                            onFileSelected={(f) => handleSpecializedFileUpload(actions.setPedidoExcelFile, f)}
                                            color="emerald"
                                        />
                                        {pedidoExcelFile && (
                                            <div className="mt-2 text-[10px] font-bold text-zinc-400 bg-zinc-900/60 py-1 px-2 rounded border border-zinc-700/50 w-fit flex items-center gap-1">
                                                <FileCode size={12} className="text-emerald-400/70" /> {pedidoExcelFile.name}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}


                            {/* Standard Production Files (Items) */}
                            {serviceId === 'tpu' && (
                                <div className="space-y-4">
                                    {/* Selector: trabajo nuevo vs reusar una matriz */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <button type="button" onClick={() => { setTpuMode('nuevo'); setMatrizSel(null); }}
                                            className={`text-left p-3 rounded-xl border-2 transition-all ${tpuMode === 'nuevo' ? 'border-cyan-400 bg-cyan-400/5' : 'border-zinc-700 hover:border-zinc-600'}`}>
                                            <div className="text-sm font-bold text-zinc-100">Trabajo nuevo</div>
                                            <div className="text-[11px] text-zinc-500 mt-0.5">Subís un boceto y diseñamos el arte. Incluye el costo de matriz.</div>
                                        </button>
                                        <button type="button" onClick={() => setTpuMode('matriz')}
                                            className={`text-left p-3 rounded-xl border-2 transition-all ${tpuMode === 'matriz' ? 'border-cyan-400 bg-cyan-400/5' : 'border-zinc-700 hover:border-zinc-600'}`}>
                                            <div className="text-sm font-bold text-zinc-100">Usar una matriz</div>
                                            <div className="text-[11px] text-zinc-500 mt-0.5">Reusás un diseño ya hecho. Sin costo de matriz.</div>
                                        </button>
                                    </div>

                                    {tpuMode === 'nuevo' ? (
                                        <div>
                                            <div className="flex justify-between items-center mb-4">
                                                <p className="text-sm font-bold uppercase text-zinc-400">Boceto de tu diseño <span className="text-red-400">*</span></p>
                                            </div>
                                            <div className="bg-brand-dark p-4 md:rounded-2xl rounded-none border-y border-x-0 md:border-x border-zinc-700/50 shadow-sm -mx-4 md:mx-0 space-y-5">
                                                <div>
                                                    <FileUploadZone
                                                        id="boceto-tpu"
                                                        label="BOCETO (PNG / JPG / PDF)"
                                                        selectedFile={bocetoFile}
                                                        onFileSelected={(f) => handleSpecializedFileUpload(actions.setBocetoFile, f)}
                                                        color="blue"
                                                    />
                                                    {bocetoFile && (
                                                        <div className="mt-2 text-[10px] font-bold text-zinc-400 bg-zinc-900/60 p-1 px-2 rounded border border-zinc-700/50 w-fit flex gap-1">
                                                            <FileCode size={12} className="text-cyan-400/60" /> {bocetoFile.name}
                                                        </div>
                                                    )}
                                                    <p className="text-[11px] text-zinc-500 mt-2">Subí una referencia de lo que querés. Nosotros diseñamos los archivos finales y te los enviamos para que los apruebes.</p>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] uppercase font-black text-zinc-400 mb-1">Cantidad (mínimo {config.minCopies || 15})</label>
                                                    <input
                                                        type="number"
                                                        min={config.minCopies || 15}
                                                        value={items[0]?.copies ?? ''}
                                                        onChange={(e) => items[0] && actions.updateItem(items[0].id, 'copies', parseInt(e.target.value) || 0)}
                                                        className="w-full bg-zinc-900/60 border border-zinc-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 outline-none"
                                                        placeholder={String(config.minCopies || 15)}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <div className="flex justify-between items-center mb-3">
                                                <p className="text-sm font-bold uppercase text-zinc-400">Mis matrices</p>
                                                {matrizSel && <span className="text-[10px] text-cyan-400 font-bold">Seleccionada: {matrizSel.CodigoOrden}</span>}
                                            </div>
                                            {loadingMatrices ? (
                                                <div className="text-zinc-500 text-sm py-10 text-center">Cargando tus matrices…</div>
                                            ) : matrices.length === 0 ? (
                                                <div className="text-zinc-500 text-sm py-10 text-center border border-dashed border-zinc-700 rounded-xl">
                                                    Todavía no tenés matrices finalizadas. Empezá con un trabajo nuevo.
                                                </div>
                                            ) : (
                                                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
                                                    {/* Entran las que quepan por fila, de 120px para arriba. El `1fr` reparte el
                                                        sobrante en vez de dejarlo muerto a la derecha: en un teléfono son 3 por
                                                        fila ocupando todo el ancho, en desktop ~8 de 140px. Con un número fijo de
                                                        columnas (grid-cols-N) cada tarjeta se estiraba al ancho del form y
                                                        quedaban gigantes; con ancho fijo sobraba espacio en mobile. */}
                                                    {matrices.map(m => {
                                                        const sel = matrizSel?.OrdenID === m.OrdenID;
                                                        return (
                                                            <button type="button" key={m.OrdenID} onClick={() => setMatrizSel(m)}
                                                                className={`text-left rounded-lg border-2 overflow-hidden transition-all ${sel ? 'border-cyan-400 ring-2 ring-cyan-400/30' : 'border-zinc-700 hover:border-zinc-600'}`}>
                                                                {/* El cartel va DEBAJO de la imagen: si el thumbnail no existe (404) el onError
                                                                    esconde el <img> y queda el aviso, en vez de un recuadro vacío. */}
                                                                <div className="aspect-square bg-zinc-800 flex items-center justify-center relative">
                                                                    <span className="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-600 font-bold uppercase tracking-wide text-center px-1">Sin vista previa</span>
                                                                    <img src={`/thumbnails/${m.CodigoOrden}/${m.ArteArchivoID}.jpg`} alt={m.DescripcionTrabajo || m.CodigoOrden}
                                                                        className="w-full h-full object-contain relative bg-zinc-800"
                                                                        onError={e => { e.target.style.display = 'none'; }} />
                                                                </div>
                                                                <div className="p-1.5">
                                                                    <div className="text-[11px] font-bold text-zinc-200 truncate leading-tight">{m.DescripcionTrabajo || m.CodigoOrden}</div>
                                                                    <div className="text-[9px] text-zinc-500 font-mono">{m.CodigoOrden}</div>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            {matrizSel && (
                                                <div className="mt-4">
                                                    <label className="block text-[10px] uppercase font-black text-zinc-400 mb-1">Cantidad (mínimo {config.minCopies || 15})</label>
                                                    <input
                                                        type="number"
                                                        min={config.minCopies || 15}
                                                        value={items[0]?.copies ?? ''}
                                                        onChange={(e) => items[0] && actions.updateItem(items[0].id, 'copies', parseInt(e.target.value) || 0)}
                                                        className="w-full bg-zinc-900/60 border border-zinc-700 rounded-lg p-2.5 text-white text-sm focus:border-cyan-500 outline-none"
                                                        placeholder={String(config.minCopies || 15)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {config.requiresProductionFiles && (
                                <div>
                                    <div className="flex justify-between items-center mb-4">
                                        <p className="text-sm font-bold uppercase text-zinc-400">Archivos para Producción ({items.length}/15)</p>
                                    </div>
                                    <div className="space-y-4">
                                        {items.map((item, index) => (
                                            <div key={item.id} className="bg-brand-dark p-4 md:rounded-2xl rounded-none border-y border-x-0 md:border-x border-zinc-700/50 shadow-sm -mx-4 md:mx-0">
                                                <div className="flex justify-between items-center mb-4 pb-2 border-b border-zinc-700/30">
                                                    <span className="text-[10px] font-black bg-cyan-400/10 text-cyan-400 py-1 px-3 rounded-full border border-cyan-500/20">ARCHIVO {index + 1}</span>
                                                    <button type="button" onClick={() => actions.removeItem(item.id)}><Trash2 size={16} className="text-zinc-500 hover:text-red-400 transition-colors" /></button>
                                                </div>
                                                {/* Item Material Override (multiple = Sublimación; allowItemMaterialOverride = ECOUV multimaterial) */}
                                                {(config.materialMode === 'multiple' || config.allowItemMaterialOverride) && (
                                                    <div className="mb-4 px-1">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="block text-[9px] uppercase font-black text-zinc-400">Material (Específico)</span>
                                                            {index === 0 && (
                                                                <label className={`flex items-center gap-1.5 select-none ${materialUnicoEcouv ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
                                                                    title={materialUnicoEcouv ? 'En material impreso todos los archivos del pedido llevan el mismo material' : undefined}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={materialUnicoEcouv ? true : applyMaterialToAll}
                                                                        disabled={materialUnicoEcouv}
                                                                        onChange={(e) => !materialUnicoEcouv && handleApplyMaterialToAll(e.target.checked)}
                                                                        className={`w-3 h-3 rounded border-zinc-600 accent-cyan-400 ${materialUnicoEcouv ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                                                    />
                                                                    <span className="text-[9px] font-bold uppercase text-zinc-500">
                                                                        Aplicar a todo el pedido{materialUnicoEcouv ? ' (fijo en material impreso)' : ''}
                                                                    </span>
                                                                </label>
                                                            )}
                                                        </div>
                                                        {/* El selector se muestra también si ESTE archivo quedó sin
                                                            material, aunque esté "aplicar a todo": si no, un archivo
                                                            sin material mostraba el cartel "Global" (con el material
                                                            del primero) y el cliente no tenía cómo corregirlo. */}
                                                        {(index === 0 || !applyMaterialToAll || !item.material) ? (
                                                            <CustomSelect
                                                                value={item.material}
                                                                onChange={(val) => handleItemMaterialChange(item.id, val)}
                                                                options={materialesParaSelect.map(m => {
                                                                    const val = m.Material || m.Descripcion || m;
                                                                    return { value: val, label: val };
                                                                })}
                                                                placeholder="Selecciona material"
                                                                variant="black"
                                                                size="small"
                                                                disabled={uniqueVariants.length > 0 && dynamicMaterials.length === 0}
                                                            />
                                                        ) : (
                                                            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded-[10px] text-xs text-zinc-400">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 flex-shrink-0"></span>
                                                                <span className="truncate">{items[0]?.material || 'Sin material'}</span>
                                                                <span className="ml-auto text-[9px] font-black uppercase text-cyan-500/60 flex-shrink-0">Global</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* ══ ECOUV: UNA sola vista del arte con sus terminaciones + tabs al lado ══
                                                    En vez de repetir el arte (preview + plano), el plano ES la vista:
                                                    muestra la pieza con lo que se le va a hacer. A la derecha, la
                                                    configuración de impresión y cada terminación en su pestaña. */}
                                                {(() => {
                                                    const esEcouv = isEcouvMaterial || isEcouvPT;
                                                    const dimsIt = dimsDeItem(item);
                                                    // En producto terminado la pieza mide lo que dice la FICHA.
                                                    // Si la ficha tiene borde, el plano muestra el ARTE completo
                                                    // (medida final + borde por cada lado) con el corte marcado.
                                                    const bordePT = isEcouvPT ? ((parseFloat(fichaPT?.bordeCm) || 0) / 100) : 0;
                                                    const wPlano = isEcouvPT && fichaPT?.anchoM ? parseFloat(fichaPT.anchoM) + 2 * bordePT : dimsIt.w;
                                                    const hPlano = isEcouvPT && fichaPT?.altoM ? parseFloat(fichaPT.altoM) + 2 * bordePT : dimsIt.h;
                                                    if (!esEcouv || !item.file || !(wPlano > 0 && hPlano > 0)) return null;

                                                    const termsItem = isEcouvPT ? [] : termsDeMaterial(item.material || globalMaterial);
                                                    const elegidas = item.terminaciones || [];
                                                    // Producto terminado: las terminaciones vienen de la ficha (no se eligen)
                                                    const incluidas = isEcouvPT ? (fichaPT?.terminacionesIncluidas || []) : [];

                                                    // Reglas físicas visibles en el dibujo: soldadura toma 5 cm,
                                                    // ojal a 2,5 cm (7,5 si el lado comparte soldadura), bolsillo
                                                    // = tamaño×2 (doblez) + 5 cm de soldadura.
                                                    const armarCapa = (t, sel, idx) => {
                                                        const tipo = tipoCapa(t);
                                                        const param = parseFloat(sel?.param ?? t.ParamCantidad);
                                                        const capa = {
                                                            id: t.TerminacionID, nombre: t.Nombre,
                                                            color: COLOR_CAPA[idx % COLOR_CAPA.length],
                                                            ubicacion: sel?.ubicacion ?? t.Ubicacion,
                                                            tipo, pasoM: (param || 50) / 100,
                                                        };
                                                        if (tipo === 'bolsillo') {
                                                            const tam = param || 5;
                                                            capa.anchoCm = profundidadBolsilloCm(tam);
                                                            capa.detalle = `${tam}×2+${SOLDADURA_CM} = ${profundidadBolsilloCm(tam)} cm`;
                                                        }
                                                        if (tipo === 'linea' && /soldadura/i.test(t.Nombre || '')) {
                                                            capa.detalle = `${SOLDADURA_CM} cm`;
                                                        }
                                                        return capa;
                                                    };
                                                    const capasBase = isEcouvPT
                                                        ? [
                                                            // El borde del producto (demasía de montaje) se dibuja
                                                            // como línea de corte por dentro del arte
                                                            ...(bordePT > 0 ? [{
                                                                id: '__borde_pt', nombre: 'Borde',
                                                                color: '#f59e0b', tipo: 'borde',
                                                                anchoCm: parseFloat(fichaPT.bordeCm),
                                                                detalle: `borde ${parseFloat(fichaPT.bordeCm)} cm por lado`,
                                                            }] : []),
                                                            ...incluidas.map((t, i) => armarCapa(t, null, i)),
                                                        ]
                                                        : elegidas.map(sel => {
                                                            const t = termsItem.find(x => x.TerminacionID === sel.terminacionId);
                                                            if (!t) return null;
                                                            return armarCapa(t, sel, termsItem.findIndex(x => x.TerminacionID === sel.terminacionId));
                                                        }).filter(Boolean);
                                                    // Margen de los ojales por lado: 7,5 cm donde también hay soldadura
                                                    const ladosSold = new Set(capasBase
                                                        .filter(c => c.detalle && c.tipo === 'linea')
                                                        .flatMap(c => ladosDeUbicacion(c.ubicacion)));
                                                    const capas = capasBase.map(c => {
                                                        if (c.tipo !== 'ojales') return c;
                                                        const insets = {};
                                                        ladosDeUbicacion(c.ubicacion).forEach(l => { insets[l] = margenOjalCm(ladosSold.has(l)); });
                                                        const conSold = ladosDeUbicacion(c.ubicacion).some(l => ladosSold.has(l));
                                                        return { ...c, insets, detalle: conSold ? `a ${SOLDADURA_CM + 2.5} cm (sold. ${SOLDADURA_CM} + ojal 2,5)` : 'a 2,5 cm' };
                                                    });

                                                    const tab = terminacionActiva[item.id] ?? 'impresion';
                                                    const termTab = (tab !== 'impresion') ? termsItem.find(x => x.TerminacionID === tab) : null;
                                                    const selTab = termTab ? elegidas.find(x => x.terminacionId === tab) : null;
                                                    const capaTab = capas.find(c => c.id === tab) || null;
                                                    const fueraMedida = itemsFueraDeMedida.some(m => m.id === item.id);

                                                    return (
                                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                                                        {/* ── EL ARTE, con sus terminaciones dibujadas ── */}
                                                        <div className="md:col-span-5">
                                                            <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-2xl p-3 flex flex-col items-center text-zinc-400">
                                                                <PlanoPieza
                                                                    anchoM={wPlano} altoM={hPlano} size="md"
                                                                    capas={capas} arteUrl={arteDeItem(item)}
                                                                    interactivo={!!(capaTab && usaBordes(termTab))}
                                                                    capaActivaId={capaTab?.id}
                                                                    onToggleLado={(lado) => {
                                                                        if (termTab && selTab) toggleLadoTerminacion(item, termTab, selTab, lado);
                                                                    }}
                                                                />
                                                                {isEcouvPT && (
                                                                    <p className="text-[10px] text-purple-300/80 font-bold text-center mt-1">
                                                                        {globalMaterial}
                                                                        {bordePT > 0
                                                                            ? ` — arte ${wPlano.toFixed(2)} × ${hPlano.toFixed(2)} m · medida final ${parseFloat(fichaPT.anchoM).toFixed(2)} × ${parseFloat(fichaPT.altoM).toFixed(2)} m (borde ${parseFloat(fichaPT.bordeCm)} cm/lado)`
                                                                            : ` — ${wPlano.toFixed(2)} × ${hPlano.toFixed(2)} m`}
                                                                    </p>
                                                                )}
                                                                <div className="mt-2 flex items-center gap-2 w-full">
                                                                    <span className="flex-1 min-w-0 text-[10px] font-bold text-zinc-400 bg-zinc-900/60 px-2 py-1 rounded border border-zinc-700/50 truncate flex items-center gap-1">
                                                                        <FileCode size={11} className="text-cyan-400/60 shrink-0" />{item.file.name}
                                                                    </span>
                                                                    <button type="button"
                                                                        onClick={() => document.getElementById(`cambiar-arte-${item.id}`)?.click()}
                                                                        className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded border border-cyan-500/30 hover:border-cyan-400 transition-colors shrink-0">
                                                                        Cambiar arte
                                                                    </button>
                                                                    <input id={`cambiar-arte-${item.id}`} type="file" className="hidden"
                                                                        accept="image/png, application/pdf, .png, .pdf, .jpg, .jpeg"
                                                                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFileUpload(item.id, 'file', f); }} />
                                                                </div>
                                                            </div>
                                                            {fueraMedida && (
                                                                <div className="mt-2 flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2">
                                                                    <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={14} />
                                                                    <p className="text-[10px] text-red-300 leading-snug">
                                                                        El arte mide <strong>{dimsIt.w.toFixed(2)} × {dimsIt.h.toFixed(2)} m</strong> y este producto
                                                                        necesita un arte de <strong>{medidaPTTexto(fichaPT)}</strong>.
                                                                    </p>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* ── TABS: impresión + una por terminación ── */}
                                                        <div className="md:col-span-7">
                                                            <div className="flex flex-wrap items-center gap-1 mb-2 border-b border-zinc-700/40 pb-2">
                                                                <button type="button" onClick={() => setTerminacionActiva(prev => ({ ...prev, [item.id]: 'impresion' }))}
                                                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${tab === 'impresion'
                                                                        ? 'bg-cyan-400/15 border-cyan-500/50 text-cyan-300'
                                                                        : 'bg-zinc-900/60 border-zinc-700/60 text-zinc-400 hover:border-zinc-600'}`}>
                                                                    Impresión
                                                                </button>
                                                                {/* Producto terminado: su ficha, solo lectura (el cliente no la edita) */}
                                                                {isEcouvPT && fichaPT && (
                                                                    <button type="button" onClick={() => setTerminacionActiva(prev => ({ ...prev, [item.id]: 'producto' }))}
                                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${tab === 'producto'
                                                                            ? 'bg-purple-500/20 border-purple-500/50 text-purple-200'
                                                                            : 'bg-zinc-900/60 border-zinc-700/60 text-zinc-400 hover:border-purple-500/40'}`}>
                                                                        Producto
                                                                    </button>
                                                                )}
                                                                {termsItem.map(t => {
                                                                    const sel = elegidas.find(x => x.terminacionId === t.TerminacionID);
                                                                    const idx = termsItem.findIndex(x => x.TerminacionID === t.TerminacionID);
                                                                    const color = COLOR_CAPA[idx % COLOR_CAPA.length];
                                                                    const precio = parseFloat(t.Precio) || 0;
                                                                    const mon = t.Moneda === 'USD' ? 'US$' : '$';
                                                                    if (!sel) {
                                                                        return (
                                                                            <button type="button" key={t.TerminacionID}
                                                                                onClick={() => { toggleItemTerminacion(item, t); setTerminacionActiva(prev => ({ ...prev, [item.id]: t.TerminacionID })); }}
                                                                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-dashed border-zinc-700 text-zinc-500 hover:border-amber-500/50 hover:text-zinc-300 transition-all">
                                                                                + {t.Nombre}
                                                                                {precio > 0 && <span className="ml-1 text-[9px] text-zinc-600">{mon}{precio}</span>}
                                                                            </button>
                                                                        );
                                                                    }
                                                                    return (
                                                                        <button type="button" key={t.TerminacionID}
                                                                            onClick={() => setTerminacionActiva(prev => ({ ...prev, [item.id]: t.TerminacionID }))}
                                                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border flex items-center gap-1.5 transition-all ${tab === t.TerminacionID
                                                                                ? 'bg-zinc-800 border-zinc-500 text-zinc-100'
                                                                                : 'bg-zinc-900/60 border-zinc-700/60 text-zinc-400 hover:border-zinc-600'}`}>
                                                                            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                                                                            {t.Nombre}
                                                                            <span onClick={(e) => { e.stopPropagation(); toggleItemTerminacion(item, t); setTerminacionActiva(prev => ({ ...prev, [item.id]: 'impresion' })); }}
                                                                                className="text-zinc-600 hover:text-red-400 pl-0.5" title="Quitar">×</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>

                                                            {/* Contenido de la pestaña */}
                                                            {tab === 'producto' && isEcouvPT && fichaPT ? (
                                                                <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 space-y-2">
                                                                    <p className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                                                                        Producto terminado — precio cerrado
                                                                    </p>
                                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                                                                        <div>
                                                                            <span className="block text-[9px] font-bold uppercase text-zinc-500">Medidas</span>
                                                                            <span className="text-zinc-200 font-bold">
                                                                                {fichaPT.anchoM ?? '—'} × {fichaPT.altoM ?? '—'} m
                                                                            </span>
                                                                            {bordePT > 0 && (
                                                                                <span className="block text-[10px] text-amber-300/90 font-bold">
                                                                                    El arte debe medir {wPlano.toFixed(2)} × {hPlano.toFixed(2)} m ({fichaPT.bordeCm} cm de borde por lado)
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <span className="block text-[9px] font-bold uppercase text-zinc-500">Se imprime en</span>
                                                                            <span className="text-zinc-200 font-bold">{fichaPT.materialDescripcion || '— a definir en producción —'}</span>
                                                                        </div>
                                                                        <div>
                                                                            <span className="block text-[9px] font-bold uppercase text-zinc-500">Tinta</span>
                                                                            <span className="text-zinc-200 font-bold">{tintaSeleccionada || fichaPT.tinta || '— la elegís vos —'}</span>
                                                                        </div>
                                                                    </div>
                                                                    {incluidas.length > 0 && (
                                                                        <div className="pt-1.5 border-t border-purple-500/20">
                                                                            <span className="block text-[9px] font-bold uppercase text-zinc-500 mb-1">Incluye (dentro del precio)</span>
                                                                            <div className="flex flex-wrap gap-1.5">
                                                                                {incluidas.map((t, i) => (
                                                                                    <span key={t.TerminacionID}
                                                                                        className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-200 text-[10px] font-bold flex items-center gap-1.5">
                                                                                        <span className="w-2 h-2 rounded-sm" style={{ background: COLOR_CAPA[i % COLOR_CAPA.length] }} />
                                                                                        {t.Nombre}{t.Cantidad > 1 ? ` ×${t.Cantidad}` : ''}{t.Ubicacion ? ` · ${labelUbicacion(t.Ubicacion)}` : ''}
                                                                                    </span>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    <p className="text-[10px] text-zinc-500 pt-1">
                                                                        Lo define la ficha del producto: solo elegís la cantidad en la pestaña Impresión.
                                                                    </p>
                                                                </div>
                                                            ) : tab === 'impresion' ? (
                                                                item.file.width ? (
                                                                    <PrintSettingsPanel
                                                                        originalWidthM={item.file.unit === 'meters' ? item.file.width : (item.file.width / 300) * 0.0254}
                                                                        originalHeightM={item.file.unit === 'meters' ? item.file.height : (item.file.height / 300) * 0.0254}
                                                                        // Producto terminado: el "material" es el PRODUCTO (1,00 no es un rollo);
                                                                        // la medida exacta ya la valida la ficha, acá no se topea el ancho.
                                                                        materialMaxWidthM={isEcouvPT ? 0 : itemMatInfo(item).ancho}
                                                                        medidaFija={itemMatInfo(item).largoFijo > 0}
                                                                        values={item.printSettings || {}} copies={item.copies}
                                                                        onCopiesChange={(v) => actions.updateItem(item.id, 'copies', v)}
                                                                        onChange={(s) => actions.updateItem(item.id, 'printSettings', s)}
                                                                        disableScaling={itemMatInfo(item).largoFijo > 0 || isEcouvPT}
                                                                        unidadTotal={config.unidadTotal || 'm'}
                                                                        hideRaport hideHeader hideScale
                                                                    />
                                                                ) : (
                                                                    <p className="text-[11px] text-zinc-500 p-3">No se pudieron leer las medidas del archivo.</p>
                                                                )
                                                            ) : (termTab && selTab) ? (() => {
                                                                const esOjal = tipoCapa(termTab) === 'ojales';
                                                                const esBolsillo = tipoCapa(termTab) === 'bolsillo';
                                                                const eligeBordes = usaBordes(termTab);
                                                                const paramVal = selTab.param ?? termTab.ParamCantidad ?? (esOjal ? 50 : 5);
                                                                const ladosSel = ladosDeUbicacion(selTab.ubicacion);
                                                                const precio = parseFloat(termTab.Precio) || 0;
                                                                const mon = termTab.Moneda === 'USD' ? 'US$' : '$';
                                                                const subtotal = precio * (parseFloat(selTab.cantidad) || 0);
                                                                return (
                                                                    <div className="bg-zinc-900/40 border border-zinc-700/50 rounded-xl p-3 space-y-3">
                                                                        {eligeBordes ? (
                                                                            <div>
                                                                                <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: capaTab?.color }}>
                                                                                    ¿Dónde va?
                                                                                </p>
                                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                                    {PRESETS_BORDE.map(p => {
                                                                                        const igual = p.lados.length === ladosSel.length && p.lados.every(l => ladosSel.includes(l));
                                                                                        return (
                                                                                            <button type="button" key={p.label} title={p.label}
                                                                                                onClick={() => setItemTerminacionUbicacion(item, termTab, ubicacionDeLados(p.lados))}
                                                                                                className={`p-1 rounded-md border transition-all ${igual ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'}`}>
                                                                                                <IconoBordes lados={p.lados} color={capaTab?.color || '#fbbf24'} size={18} />
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                    <span className="text-[10px] text-zinc-500 ml-1">
                                                                                        {ladosSel.length ? labelUbicacion(selTab.ubicacion) : 'tocá un borde en el arte'}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <p className="text-[10px] text-zinc-500">
                                                                                Va en los extremos de la pieza: no hay que elegir lado.
                                                                            </p>
                                                                        )}

                                                                        <div className="flex flex-wrap items-center gap-3">
                                                                            {esOjal && (() => {
                                                                                // La separación no puede superar el lado más corto
                                                                                const maxPaso = pasoMaxCm(selTab.ubicacion, dimsIt.w, dimsIt.h);
                                                                                return (
                                                                                    <span className="flex items-center gap-1.5">
                                                                                        <span className="text-[10px] text-zinc-500">Uno cada</span>
                                                                                        <input type="number" min="1" step="1" max={maxPaso || undefined} value={paramVal}
                                                                                            onChange={e => setItemTerminacionParam(item, termTab, e.target.value)}
                                                                                            className="w-14 px-1 py-0.5 text-[11px] font-bold text-zinc-100 bg-zinc-900 border border-zinc-600 rounded outline-none text-center" />
                                                                                        <span className="text-[10px] text-zinc-500">cm{maxPaso > 0 ? ` (máx ${maxPaso})` : ''}</span>
                                                                                    </span>
                                                                                );
                                                                            })()}
                                                                            {esBolsillo && (
                                                                                <span className="flex items-center gap-1.5">
                                                                                    <span className="text-[10px] text-zinc-500">Tamaño del bolsillo</span>
                                                                                    <input type="number" min="1" step="1" value={paramVal}
                                                                                        onChange={e => setItemTerminacionParam(item, termTab, e.target.value)}
                                                                                        className="w-14 px-1 py-0.5 text-[11px] font-bold text-zinc-100 bg-zinc-900 border border-zinc-600 rounded outline-none text-center" />
                                                                                    <span className="text-[10px] text-zinc-500">cm</span>
                                                                                </span>
                                                                            )}
                                                                            {/* La cantidad la calcula el sistema por las medidas: el cliente no la toca */}
                                                                            <span className="flex items-center gap-1.5 ml-auto">
                                                                                <span className="text-[10px] text-zinc-500">Cantidad</span>
                                                                                <span className="px-2 py-0.5 text-[11px] font-black text-amber-200 bg-zinc-900/80 border border-zinc-700 rounded"
                                                                                    title="Calculada por las medidas de la pieza">
                                                                                    {selTab.cantidad} {unidadLabel(termTab.UnidadCobro)}
                                                                                </span>
                                                                                {precio > 0 && (
                                                                                    <span className="text-[11px] font-black text-amber-300 ml-2">{mon} {Math.round(subtotal * 100) / 100}</span>
                                                                                )}
                                                                            </span>
                                                                        </div>

                                                                        {/* Descripción de lo que se va a hacer — misma info que viaja
                                                                            en la nota de la orden para que producción la lea igual. */}
                                                                        {esBolsillo && (
                                                                            <p className="text-[10px] text-zinc-500 leading-snug">
                                                                                El borde consume {paramVal}×2 (doblez) + {SOLDADURA_CM} cm de soldadura
                                                                                = <b className="text-zinc-300">{profundidadBolsilloCm(paramVal)} cm</b> por lado.
                                                                            </p>
                                                                        )}
                                                                        {esOjal && selTab.ubicacion && (
                                                                            <p className="text-[10px] text-zinc-500 leading-snug">
                                                                                {textoReparto({ ...termTab, ParamCantidad: paramVal }, selTab.ubicacion, dimsIt)}
                                                                                {' · '}se colocan a {capaTab?.insets && Object.values(capaTab.insets).some(v => v > 2.5)
                                                                                    ? `${SOLDADURA_CM + 2.5} cm del borde en los lados con soldadura (5 + 2,5), a 2,5 cm en el resto`
                                                                                    : '2,5 cm del borde'}
                                                                            </p>
                                                                        )}
                                                                        {!esOjal && !esBolsillo && /soldadura/i.test(termTab.Nombre || '') && (
                                                                            <p className="text-[10px] text-zinc-500 leading-snug">
                                                                                La soldadura toma <b className="text-zinc-300">{SOLDADURA_CM} cm</b> del borde
                                                                                en cada lado elegido; los metros se calculan por el largo de esos lados.
                                                                            </p>
                                                                        )}
                                                                        {!esOjal && !esBolsillo && !/soldadura/i.test(termTab.Nombre || '') && (
                                                                            <p className="text-[10px] text-zinc-500 leading-snug">
                                                                                {tipoCapa(termTab) === 'palos' ? 'Los palos van en los extremos superior e inferior de la pieza.'
                                                                                    : tipoCapa(termTab) === 'rollup' ? 'El roll up lleva el estuche abajo y la varilla arriba; la pieza va armada en el mecanismo.'
                                                                                        : 'La cantidad se calcula por las medidas de la pieza.'}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })() : null}
                                                        </div>
                                                    </div>
                                                    );
                                                })()}

                                                <div className={`grid grid-cols-1 md:grid-cols-12 gap-6 ${(isEcouvMaterial || isEcouvPT) && item.file ? 'hidden' : ''}`}>
                                                    <div className={isBlackoutSelected ? "md:col-span-4" : "md:col-span-6"}>
                                                        {/* modoBandera: solo en materiales de medida fija (Bandera Confeccionada) se muestra
                                                            la miniatura con la guía de 2,5 cm y el modal de la bandera terminada. */}
                                                        {/* quitarFondoPdf: en DTF el arte se imprime sobre film transparente, así que
                                                            el fondo blanco del PDF no representa el resultado. Los PNG ya vienen con
                                                            transparencia y se muestran tal cual. */}
                                                        <FileUploadZone id={item.id} label={isBlackoutSelected ? "Frente" : (config.productionFileLabel || "Archivo")} selectedFile={item.file} onFileSelected={(f) => handleFileUpload(item.id, 'file', f)} modoBandera={itemMatInfo(item).largoFijo > 0} quitarFondoPdf={serviceId?.toUpperCase() === 'DF'} />
                                                        {item.file && (
                                                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                                <div className="text-[10px] font-bold text-zinc-400 bg-zinc-900/60 p-1 px-2 rounded border border-zinc-700/50 w-fit flex items-center gap-1"><FileCode size={12} className="text-cyan-400/60" /> {item.file.name}</div>
                                                                {itemMatInfo(item).largoFijo > 0 && (
                                                                    <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400/90 bg-emerald-500/10 p-1 px-2 rounded border border-emerald-500/30 w-fit flex items-center gap-1"><CheckCircle size={11} /> Listo para procesar</div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {item.file && item.file.pageCount != null && (
                                                            <div className="mt-1 text-[10px] font-bold text-zinc-500 bg-zinc-900/40 px-2 py-0.5 rounded border border-zinc-700/40 w-fit flex items-center gap-1">
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                                                {item.file.pageCount} {item.file.pageCount === 1 ? 'página' : 'páginas'}
                                                            </div>
                                                        )}

                                                        {isDirectaTwinface && (
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={twinfaceSame}
                                                                    onChange={(e) => setTwinfaceSame(e.target.checked)}
                                                                    id={`twinface-${index}`}
                                                                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                                />
                                                                <label htmlFor={`twinface-${index}`} className="text-[10px] font-bold uppercase text-zinc-500 cursor-pointer">
                                                                    Misma imagen Frente y Dorso
                                                                </label>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {isBlackoutSelected && (!isDirectaTwinface || !twinfaceSame) && (
                                                        <div className="md:col-span-4">
                                                            <FileUploadZone id={item.id} label="Dorso" selectedFile={item.fileBack} onFileSelected={(f) => handleFileUpload(item.id, 'fileBack', f)} color="purple" />
                                                        </div>
                                                    )}
                                                    <div className={isBlackoutSelected ? "md:col-span-4" : "md:col-span-6"}>
                                                        {/* Aviso por archivo: el arte no mide lo que el producto elegido */}
                                                        {itemsFueraDeMedida.some(m => m.id === item.id) && (
                                                            <div className="mb-3 flex items-start gap-2 bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2">
                                                                <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                                                                <p className="text-[11px] text-red-300 leading-snug">
                                                                    Este arte mide <strong>{dimsDeItem(item).w.toFixed(2)} x {dimsDeItem(item).h.toFixed(2)} m</strong> y
                                                                    “{globalMaterial}” necesita un arte de <strong>{medidaPTTexto(fichaPT)}</strong>.
                                                                    Subí el arte en la medida del producto para poder confirmar el pedido.
                                                                </p>
                                                            </div>
                                                        )}
                                                        {item.file && item.file.width && (
                                                            <PrintSettingsPanel
                                                                originalWidthM={item.file.unit === 'meters' ? item.file.width : (item.file.width / 300) * 0.0254}
                                                                originalHeightM={item.file.unit === 'meters' ? item.file.height : (item.file.height / 300) * 0.0254}
                                                                materialMaxWidthM={isEcouvPT ? 0 : itemMatInfo(item).ancho}
                                                                medidaFija={itemMatInfo(item).largoFijo > 0}
                                                                values={item.printSettings || {}} copies={item.copies}
                                                                onCopiesChange={(v) => actions.updateItem(item.id, 'copies', v)}
                                                                onChange={(s) => actions.updateItem(item.id, 'printSettings', s)}
                                                                // Medida fija: escalar o raportar cambiaría el tamaño final y rompería la medida exigida.
                                                                disableScaling={serviceId === 'tpu' || serviceId?.toUpperCase() === 'DF' || itemMatInfo(item).largoFijo > 0 || isEcouvPT}
                                                                unidadTotal={config.unidadTotal || 'm'}
                                                                hideRaport={!!config.hideRaport || serviceId === 'directa_320'}
                                                                hideScale={serviceId === 'directa_320'}
                                                            />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* TWINFACE (Tela Doble Cara): boceto OBLIGATORIO por CADA juego de archivo.
                                                    Muestra cómo se arma frente/dorso de ESTE archivo. Viaja como REFERENCIA (BOCETO), no producción. */}
                                                {isDirectaTwinface && (
                                                    <div className="mt-4 pt-3 border-t border-zinc-700/30">
                                                        <p className="block text-xs font-bold uppercase text-purple-300 mb-1">Boceto Frente/Dorso de este archivo (obligatorio) *</p>
                                                        <p className="text-[11px] text-zinc-500 mb-2">Subí un boceto que muestre cómo se arma el frente y el dorso de este archivo.</p>
                                                        <FileUploadZone
                                                            id={`boceto-${item.id}`}
                                                            label="Boceto"
                                                            selectedFile={item.boceto}
                                                            onFileSelected={(f) => { if (f) { actions.updateItem(item.id, 'boceto', f); addToast('Boceto adjunto (Pendiente de envío con el pedido)'); } }}
                                                            color="purple"
                                                        />
                                                    </div>
                                                )}

                                                {/* ECOUV sin archivo todavía: los chips para ir eligiendo terminaciones.
                                                    Con archivo cargado, todo esto vive en las pestañas de arriba,
                                                    al lado del arte. */}
                                                {isEcouvMaterial && !item.file && (() => {
                                                    const termsItem = termsDeMaterial(item.material || globalMaterial);
                                                    if (termsItem.length === 0) return null;
                                                    const dims = dimsDeItem(item);
                                                    const elegidas = item.terminaciones || [];
                                                    // Capas del plano: una por terminación elegida. Cada una con su
                                                    // color y su símbolo (ojales, bolsillo, palos, roll up...) para
                                                    // verlas TODAS dibujadas sobre la MISMA pieza.
                                                    const capas = elegidas.map((sel) => {
                                                        const t = termsItem.find(x => x.TerminacionID === sel.terminacionId);
                                                        if (!t) return null;
                                                        const idx = termsItem.findIndex(x => x.TerminacionID === sel.terminacionId);
                                                        const param = parseFloat(sel.param ?? t.ParamCantidad);
                                                        return {
                                                            id: sel.terminacionId, nombre: t.Nombre,
                                                            color: COLOR_CAPA[idx % COLOR_CAPA.length],
                                                            ubicacion: sel.ubicacion,
                                                            tipo: tipoCapa(t),
                                                            pasoM: (param || 50) / 100,
                                                            anchoCm: param || 8,
                                                        };
                                                    }).filter(Boolean);
                                                    // La que se está marcando: solo cuentan las que usan bordes
                                                    const conBordes = capas.filter(c => usaBordes(termsItem.find(x => x.TerminacionID === c.id)));
                                                    const activa = conBordes.find(c => c.id === terminacionActiva[item.id]) || conBordes[0] || null;
                                                    const termActiva = activa ? termsItem.find(x => x.TerminacionID === activa.id) : null;
                                                    const selActiva = activa ? elegidas.find(x => x.terminacionId === activa.id) : null;
                                                    return (
                                                    <div className="mt-4 pt-3 border-t border-zinc-700/30">
                                                        <p className="text-[9px] uppercase font-black tracking-wider text-amber-400/90 mb-2">
                                                            Terminaciones para este archivo <span className="text-zinc-500 normal-case font-bold">(opcionales, se cobran aparte)</span>
                                                        </p>

                                                        {/* TABS: una por terminación elegida + las disponibles para agregar */}
                                                        <div className="flex flex-wrap items-center gap-1 mb-2 border-b border-zinc-700/40 pb-2">
                                                            {termsItem.map(t => {
                                                                const sel = elegidas.find(x => x.terminacionId === t.TerminacionID);
                                                                const idx = termsItem.findIndex(x => x.TerminacionID === t.TerminacionID);
                                                                const color = COLOR_CAPA[idx % COLOR_CAPA.length];
                                                                const precio = parseFloat(t.Precio) || 0;
                                                                const mon = t.Moneda === 'USD' ? 'US$' : '$';
                                                                if (!sel) {
                                                                    return (
                                                                        <button type="button" key={t.TerminacionID} onClick={() => toggleItemTerminacion(item, t)}
                                                                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-dashed border-zinc-700 text-zinc-500 hover:border-amber-500/50 hover:text-zinc-300 transition-all">
                                                                            + {t.Nombre}
                                                                            {precio > 0 && <span className="ml-1 text-[9px] text-zinc-600">{mon}{precio}</span>}
                                                                        </button>
                                                                    );
                                                                }
                                                                const esActiva = activa?.id === t.TerminacionID;
                                                                return (
                                                                    <button type="button" key={t.TerminacionID}
                                                                        onClick={() => setTerminacionActiva(prev => ({ ...prev, [item.id]: t.TerminacionID }))}
                                                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border flex items-center gap-1.5 transition-all ${esActiva
                                                                            ? 'bg-zinc-800 border-zinc-500 text-zinc-100'
                                                                            : 'bg-zinc-900/60 border-zinc-700/60 text-zinc-400 hover:border-zinc-600'}`}>
                                                                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                                                                        {t.Nombre}
                                                                        <span onClick={(e) => { e.stopPropagation(); toggleItemTerminacion(item, t); }}
                                                                            className="text-zinc-600 hover:text-red-400 pl-0.5" title="Quitar">×</span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>

                                                        {elegidas.length > 0 && (
                                                        <div className="flex gap-3 items-start flex-wrap md:flex-nowrap">
                                                            {/* UN SOLO PLANO: el arte con todas las terminaciones encima */}
                                                            {dims.w > 0 && dims.h > 0 && (
                                                                <div className="shrink-0 bg-zinc-900/50 border border-zinc-700/50 rounded-xl p-2 text-zinc-400">
                                                                    <PlanoPieza
                                                                        anchoM={dims.w} altoM={dims.h} size="sm"
                                                                        capas={capas} arteUrl={arteDeItem(item)}
                                                                        interactivo={!!activa}
                                                                        capaActivaId={activa?.id}
                                                                        onToggleLado={(lado) => {
                                                                            if (termActiva && selActiva) toggleLadoTerminacion(item, termActiva, selActiva, lado);
                                                                        }}
                                                                    />
                                                                </div>
                                                            )}

                                                            {/* Panel de la terminación activa */}
                                                            <div className="flex-1 min-w-0 space-y-2">
                                                                {activa && termActiva && selActiva && (() => {
                                                                    const esOjal = tipoCapa(termActiva) === 'ojales';
                                                                    const esBolsillo = tipoCapa(termActiva) === 'bolsillo';
                                                                    const paramVal = selActiva.param ?? termActiva.ParamCantidad ?? (esOjal ? 50 : 8);
                                                                    const ladosSel = ladosDeUbicacion(selActiva.ubicacion);
                                                                    return (
                                                                        <div className="bg-zinc-900/40 border border-zinc-700/50 rounded-lg p-2.5">
                                                                            <p className="text-[10px] font-black uppercase tracking-wide mb-1.5" style={{ color: activa.color }}>
                                                                                {activa.nombre} — ¿dónde va?
                                                                            </p>
                                                                            {/* Atajos de borde, simbología tipo Word */}
                                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                                {PRESETS_BORDE.map(p => {
                                                                                    const igual = p.lados.length === ladosSel.length && p.lados.every(l => ladosSel.includes(l));
                                                                                    return (
                                                                                        <button type="button" key={p.label} title={p.label}
                                                                                            onClick={() => setItemTerminacionUbicacion(item, termActiva, ubicacionDeLados(p.lados))}
                                                                                            className={`p-1 rounded-md border transition-all ${igual
                                                                                                ? 'border-zinc-400 bg-zinc-800'
                                                                                                : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'}`}>
                                                                                            <IconoBordes lados={p.lados} color={activa.color} size={18} />
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                                <span className="text-[10px] text-zinc-500 ml-1">
                                                                                    {ladosSel.length ? labelUbicacion(selActiva.ubicacion) : 'tocá un borde en el plano'}
                                                                                </span>
                                                                            </div>

                                                                            {(esOjal || esBolsillo) && (
                                                                                <div className="flex items-center gap-1.5 mt-2">
                                                                                    <span className="text-[10px] text-zinc-500">{esOjal ? 'Uno cada' : 'A'}</span>
                                                                                    <input type="number" min="1" step="1" value={paramVal}
                                                                                        onChange={e => setItemTerminacionParam(item, termActiva, e.target.value)}
                                                                                        className="w-14 px-1 py-0.5 text-[11px] font-bold text-zinc-100 bg-zinc-900 border border-zinc-600 rounded outline-none text-center" />
                                                                                    <span className="text-[10px] text-zinc-500">{esOjal ? 'cm' : 'cm del borde'}</span>
                                                                                </div>
                                                                            )}
                                                                            {esOjal && selActiva.ubicacion && (
                                                                                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                                                                    {textoReparto({ ...termActiva, ParamCantidad: paramVal }, selActiva.ubicacion, dims)}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })()}

                                                                {/* Resumen de todo lo elegido, con cantidad y precio */}
                                                                <div className="space-y-1">
                                                                    {elegidas.map(sel => {
                                                                        const t = termsItem.find(x => x.TerminacionID === sel.terminacionId);
                                                                        if (!t) return null;
                                                                        const idx = termsItem.findIndex(x => x.TerminacionID === sel.terminacionId);
                                                                        const color = COLOR_CAPA[idx % COLOR_CAPA.length];
                                                                        const precio = parseFloat(t.Precio) || 0;
                                                                        const mon = t.Moneda === 'USD' ? 'US$' : '$';
                                                                        const subtotal = precio * (parseFloat(sel.cantidad) || 0);
                                                                        return (
                                                                            <div key={sel.terminacionId} className="flex items-center gap-2 text-[11px]">
                                                                                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                                                                                <span className="font-bold text-zinc-300 truncate">{t.Nombre}</span>
                                                                                {sel.ubicacion && <span className="text-[9px] uppercase text-zinc-600 truncate">{labelUbicacion(sel.ubicacion)}</span>}
                                                                                <span className="flex items-center gap-1 ml-auto shrink-0">
                                                                                    {/* La cantidad la calcula el sistema por las medidas: el cliente no la edita */}
                                                                                    <span className="px-2 py-0.5 text-[11px] font-black text-amber-200 bg-zinc-900/80 border border-zinc-700 rounded"
                                                                                        title="Calculada por las medidas de la pieza">
                                                                                        {sel.cantidad}
                                                                                    </span>
                                                                                    <span className="text-[9px] font-black text-zinc-500 w-3">{unidadLabel(t.UnidadCobro)}</span>
                                                                                </span>
                                                                                {precio > 0 && (
                                                                                    <span className="text-[10px] font-black text-amber-300 min-w-[52px] text-right shrink-0">
                                                                                        {mon} {Math.round(subtotal * 100) / 100}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        )}
                                                    </div>
                                                    );
                                                })()}
                                            </div>
                                        ))}

                                        {/* Hidden file input for direct dialog */}
                                        <input
                                            type="file"
                                            id="add-item-file-input"
                                            className="hidden"
                                            accept={(svcId === 'sublimacion' || svcId === 'ecouv') ? 'image/png, image/jpeg, application/pdf, .png, .jpg, .jpeg, .pdf' : 'image/png, application/pdf, .png, .pdf'}
                                            onChange={async (e) => {
                                                const file = e.target.files[0];
                                                if (!file) return;
                                                e.target.value = ''; // Reset para poder elegir el mismo archivo
                                                const newId = Date.now();
                                                const lastItem = items[items.length - 1];
                                                // El archivo nuevo HEREDA el material (igual que addItem del hook):
                                                // en modo material-por-archivo `globalMaterial` queda SIEMPRE vacío a
                                                // propósito (no se autocompleta), así que soltando archivos acá nacían
                                                // todos sin material. Con "Aplicar a todo el pedido" tildado el select
                                                // queda oculto en los archivos siguientes: el cliente veía "Global" con
                                                // el material del primero, pero el dato estaba vacío y al confirmar lo
                                                // frenaba "Seleccioná el material de cada archivo" SIN poder corregirlo.
                                                const newMaterial = applyMaterialToAll
                                                    ? (items[0]?.material || globalMaterial)
                                                    : (lastItem?.material || globalMaterial);
                                                const newItem = { id: newId, file: null, fileBack: null, copies: 1, material: newMaterial, note: '', doubleSided: false, printSettings: {} };
                                                actions.setItems([...items, newItem]);
                                                const success = await handleFileUpload(newId, 'file', file);
                                                if (!success) {
                                                    actions.removeItem(newId);
                                                }
                                            }}
                                        />
                                        {/* Add Item Button at Bottom */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (items.length >= 15) return;
                                                document.getElementById('add-item-file-input').click();
                                            }}
                                            disabled={items.length >= 15}
                                            className={`w-full py-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 transition-all ${items.length >= 15 ? 'border-zinc-700 text-zinc-600 cursor-not-allowed' : 'border-zinc-600 text-zinc-400 bg-brand-dark hover:border-cyan-500 hover:text-cyan-400 hover:bg-cyan-400/5'}`}
                                        >
                                            {items.length >= 15 ? (
                                                <span className="text-xs font-bold uppercase">Límite de 15 archivos alcanzado</span>
                                            ) : (
                                                <>
                                                    <Plus size={16} />
                                                    <span className="text-xs font-bold uppercase">AGREGAR ARCHIVO</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}


                        </div>
                    </ServiceAccordion>

                    {/* Corte (Complementario) - Ocultar si es Principal o si está OCULTO en Servicios Web */}
                    {config.hasCuttingWorkflow && serviceId !== 'corte' && corteServicioVisible && (
                        <ServiceAccordion
                            title="Servicio de Corte"
                            isActive={enableCorte}
                            onToggle={() => actions.setEnableCorte(!enableCorte)}
                            icon={Zap}
                            optional={true}
                        >
                            <CorteTechnicalUI
                                serviceId={serviceId} moldType={moldType} setMoldType={actions.setMoldType}
                                fabricOrigin={fabricOrigin} setFabricOrigin={actions.setFabricOrigin}
                                clientFabricName={clientFabricName} setClientFabricName={actions.setClientFabricName}
                                selectedSubOrderId={selectedSubOrderId} setSelectedSubOrderId={actions.setSelectedSubOrderId}
                                activeSubOrders={activeSubOrders} tizadaFiles={tizadaFiles} setTizadaFiles={actions.setTizadaFiles}
                                handleMultipleSpecializedFileUpload={(files) => handleMultipleSpecializedFileUpload(actions.addTizadaFiles, files)}
                                compact={true}
                                bobinasDisponibles={bobinasDisponibles} selectedBobinaId={selectedBobinaId} setSelectedBobina={actions.setSelectedBobina}
                            />
                            {/* Documentation Moved to Corte */}
                            {(config.templateButtons || pedidoExcelFile || bocetoFile) && (
                                <div className="mt-6 pt-6 border-t border-zinc-700/50">
                                    <h4 className="text-[10px] font-black uppercase text-zinc-500 mb-4 tracking-widest">Documentación de Corte/Confección</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {config.templateButtons?.map(btn => (
                                            <a key={btn.label} href={btn.url} download className="flex items-center justify-between bg-zinc-800/40 p-4 rounded-xl border border-zinc-700/50 hover:border-cyan-500/50 hover:bg-zinc-800/60 transition-all group">
                                                <span className="text-[10px] font-black uppercase text-zinc-300 group-hover:text-cyan-400 transition-colors">{btn.label}</span>
                                                <Download size={16} className="text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                                            </a>
                                        ))}
                                        <FileUploadZone id="pedido-upload-corte" label="EXCEL DETALLE" selectedFile={pedidoExcelFile} onFileSelected={(f) => handleSpecializedFileUpload(actions.setPedidoExcelFile, f)} color="emerald" compact={true} />
                                        <FileUploadZone id="boceto-upload-corte" label="MOCKUP / CROQUIS" selectedFile={bocetoFile} onFileSelected={(f) => handleSpecializedFileUpload(actions.setBocetoFile, f)} color="blue" compact={true} />
                                    </div>
                                </div>
                            )}
                        </ServiceAccordion>
                    )}

                    {/* Costura - Ocultar si está OCULTO en Servicios Web */}
                    {config.hasCuttingWorkflow && costuraServicioVisible && (
                        <ServiceAccordion
                            title="Servicio de Costura"
                            isActive={enableCostura}
                            onToggle={() => actions.setEnableCostura(!enableCostura)}
                            icon={Scissors}
                            optional={true}
                        >
                            <CosturaTechnicalUI isCorteActive={enableCorte} costuraNote={costuraNote} setCosturaNote={actions.setCosturaNote} compact={true} />
                        </ServiceAccordion>
                    )}

                    {/* Complementary Options */}
                    {visibleComplementaryOptions.map(opt => (
                        <ServiceAccordion
                            key={opt.id}
                            title={opt.label}
                            subtitle={opt.subtitle}
                            isActive={!!selectedComplementary[opt.id]}
                            onToggle={() => {
                                // Logic: Costura (TWT) depends on Corte (TWC)
                                if (opt.id === 'TWT') {
                                    if (!selectedComplementary['TWC']) {
                                        addToast('Para seleccionar Confección/Costura, primero debe activar Corte/Tizada.', { error: true });
                                        return;
                                    }
                                }

                                // Atomic State Update
                                const newSelection = { ...selectedComplementary };
                                if (newSelection[opt.id]) {
                                    delete newSelection[opt.id];
                                    if (opt.id === 'TWC' && newSelection['TWT']) {
                                        delete newSelection['TWT'];
                                        addToast('Costura desactivada por dependencia.', { duration: 2000 });
                                    }
                                } else {
                                    newSelection[opt.id] = { active: true };
                                }
                                actions.setSelectedComplementary(newSelection);
                            }}
                            icon={Plus}
                            optional={true}
                        >
                            {/* Content for Complementary */}
                            <div className="space-y-4">
                                {opt.hasFile && opt.id !== 'EMB' && opt.id !== 'EST' && (
                                    <div>
                                        <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2 tracking-widest">Cargar Croquis / Archivo</label>
                                        <div className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-3 text-zinc-300">
                                            <UploadCloud size={16} className="text-zinc-500" />
                                            <input type="file" className="text-xs w-full file:bg-zinc-700 file:text-zinc-300 file:border-none file:rounded-md file:px-2 file:py-1 file:mr-2 file:cursor-pointer" onChange={(e) => handleSpecializedFileUpload((res) => actions.updateComplementaryFile(opt.id, res), e.target.files[0])} />
                                        </div>
                                    </div>
                                )}
                                {opt.hasInput && !opt.fields && opt.id !== 'EST' && <textarea rows="2" className="w-full p-2 text-xs border rounded-lg" placeholder="Notas..." value={selectedComplementary[opt.id]?.text || ''} onChange={(e) => actions.updateComplementaryText(opt.id, e.target.value)} />}

                                {opt.fields && (
                                    <div className={`grid grid-cols-1 ${opt.fullWidth ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-2'} gap-4`}>
                                        {opt.fields.map((f) => (
                                            <div key={f.name} className={f.type === 'text' ? 'md:col-span-2' : ''}>
                                                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2 tracking-widest">{f.label}</label>
                                                {f.type === 'select' ? (
                                                    <CustomSelect
                                                        value={selectedComplementary[opt.id]?.fields?.[f.name] || ''}
                                                        onChange={(val) => actions.updateComplementaryField(opt.id, f.name, val)}
                                                        options={f.options.map(o => ({ value: o, label: o }))}
                                                        placeholder="Seleccionar..."
                                                        variant="black"
                                                        size="small"
                                                    />
                                                ) : (
                                                    <input
                                                        type={f.type || 'text'}
                                                        placeholder={f.placeholder}
                                                        className="w-full p-3 text-xs border border-zinc-700/50 rounded-xl bg-zinc-800/50 text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all placeholder:text-zinc-600"
                                                        value={selectedComplementary[opt.id]?.fields?.[f.name] || ''}
                                                        onChange={(e) => actions.updateComplementaryField(opt.id, f.name, e.target.value)}
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Estampado UI as Complement */}
                                {opt.id === 'EST' && (
                                    <EstampadoTechnicalUI
                                        file={estampadoFile} setFile={actions.setEstampadoFile}
                                        quantity={estampadoQuantity} setQuantity={actions.setEstampadoQuantity}
                                        printsPerGarment={estampadoPrints} setPrintsPerGarment={actions.setEstampadoPrints}
                                        origin={estampadoOrigin} setOrigin={actions.setEstampadoOrigin}
                                        handleSpecializedFileUpload={(file) => handleSpecializedFileUpload(actions.setEstampadoFile, file)}
                                    />
                                )}

                                {/* ECOUV Terminaciones */}
                                {opt.id === 'terminaciones_ecouv' && (
                                    <EcouvTerminacionesUI
                                        serviceInfo={serviceInfo}
                                        value={selectedComplementary[opt.id]?.fields?.items || []}
                                        onChange={(items) => actions.updateComplementaryField(opt.id, 'items', items)}
                                    />
                                )}

                                {/* Embroidery Special UI */}
                                {opt.id === 'EMB' && (
                                    <BordadoTechnicalUI
                                        garmentQuantity={garmentQuantity} setGarmentQuantity={actions.setGarmentQuantity}
                                        bocetoFile={bordadoBocetoFile} setBocetoFile={actions.setBordadoBocetoFile}
                                        ponchadoFiles={ponchadoFiles} setPonchadoFiles={actions.setPonchadoFiles}
                                        globalMaterial={globalMaterial} handleGlobalMaterialChange={actions.setGlobalMaterial}
                                        serviceInfo={serviceInfo} userStock={userStock}
                                        handleSpecializedFileUpload={(f) => handleSpecializedFileUpload(actions.setBordadoBocetoFile, f)}
                                        handleMultipleSpecializedFileUpload={(fs) => handleMultipleSpecializedFileUpload(actions.addPonchadoFiles, fs)}
                                        compact={true} isComplement={true}
                                        compMaterial={bordadoMaterial} setCompMaterial={actions.setBordadoMaterial}
                                        compVariant={bordadoVariant} setCompVariant={(v) => actions.handleEmbroideryVariantChange(v)}
                                        compVariants={embroideryVariants} compMaterials={embroideryMaterials}
                                    />
                                )}
                            </div>
                        </ServiceAccordion>
                    ))}
                </div>


                {/* Observaciones Finales */}
                <div className="mt-8">
                    <p className="block text-lg font-black text-zinc-200 mb-4 px-2">OBSERVACIONES GENERALES</p>
                    <textarea id="observaciones-generales" name="observaciones" rows="3" className="w-full p-4 border border-zinc-700 rounded-2xl text-sm bg-custom-dark text-zinc-200 placeholder-zinc-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 outline-none transition-all resize-none" placeholder="Detalles importantes, instrucciones de entrega o notas adicionales..." value={generalNote} onChange={(e) => actions.setGeneralNote(e.target.value)} />
                </div>

                {/* Footer */}
                <div className="mt-8">
                    <div className="bg-custom-dark text-white p-8 md:rounded-3xl rounded-none shadow-2xl shadow-black/30 flex flex-col md:flex-row items-center justify-between gap-8 border-y border-x-0 md:border-x border-zinc-700/50 -mx-4 md:mx-0">
                        <div className="flex gap-10 flex-wrap">
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">Servicio</p><p className="text-xl font-bold text-zinc-100">{serviceInfo?.label}</p></div>
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">Prioridad</p><p className={`text-xl font-bold ${urgency?.toLowerCase() === 'urgente' ? 'text-custom-magenta' : 'text-cyan-400'}`}>{urgency}</p></div>
                            {/* TPU se pide por UNIDADES: el total es la cantidad (copies del único
                                item), y el largo en metros no existe — el boceto no tiene medida.
                                CORTE: el total son las PIEZAS de las tizadas (lo que se controla en
                                producción) + los metros de corte del láser (lo que se cotiza). */}
                            {serviceId === 'corte' ? (
                                <>
                                    <div><p className="text-[11px] uppercase font-bold text-zinc-500">Piezas</p><p className="text-2xl font-black text-zinc-100">{(tizadaFiles || []).reduce((a, f) => a + ((f.medicion?.piezas || 0) * (f.copias || 1)), 0)}</p></div>
                                    <div><p className="text-[11px] uppercase font-bold text-zinc-500">Corte Láser</p><p className="text-2xl font-black text-cyan-400">{(tizadaFiles || []).reduce((a, f) => a + ((f.medicion?.metrosCorte || 0) * (f.copias || 1)), 0).toFixed(2)}m</p></div>
                                    <div><p className="text-[11px] uppercase font-bold text-zinc-500">Tela</p><p className="text-2xl font-black text-amber-400">{(tizadaFiles || []).reduce((a, f) => a + ((f.medicion?.largoTelaM || 0) * (f.copias || 1)), 0).toFixed(2)}m</p></div>
                                </>
                            ) : (
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">{serviceId === 'tpu' ? 'Cantidad' : 'Items (Total)'}</p><p className="text-2xl font-black text-zinc-100">{serviceId === 'tpu' ? items.reduce((acc, it) => acc + (parseInt(it.copies) || 0), 0) : items.length}</p></div>
                            )}
                            {/* Total del pedido: superficie en gran formato (EcoUV cotiza por m²),
                                metros lineales de rollo en el resto. */}
                            {serviceId !== 'tpu' && serviceId !== 'corte' && (
                            <div><p className="text-[11px] uppercase font-bold text-zinc-500">{config.unidadTotal === 'm2' ? 'Área Total' : 'Largo Total'}</p><p className="text-2xl font-black text-cyan-400">{items.reduce((acc, it) => {
                                const h = it.printSettings?.finalHeightM || (it.file?.unit === 'meters' ? it.file?.height : (it.file?.height ? (it.file.height / 300) * 0.0254 : 0)) || 0;
                                const w = it.printSettings?.finalWidthM || (it.file?.unit === 'meters' ? it.file?.width : (it.file?.width ? (it.file.width / 300) * 0.0254 : 0)) || 0;
                                // Raport no multiplica por copias (su largo total ya es el resultado); escala/normal sí.
                                const factorCopias = (it.printSettings?.mode === 'raport') ? 1 : (it.copies || 1);
                                return acc + ((config.unidadTotal === 'm2' ? (w * h) : h) * factorCopias);
                            }, 0).toFixed(2)}{config.unidadTotal === 'm2' ? ' m²' : 'm'}</p></div>
                            )}
                        </div>
                        <CustomButton type="submit" variant="primary" className="w-full md:w-auto px-14 py-5 !bg-cyan-400 !text-zinc-900 hover:!bg-cyan-300 font-black text-lg rounded-2xl shadow-lg shadow-cyan-500/20" isLoading={loading} icon={Save}>Confirmar Pedido</CustomButton>
                    </div>
                </div>

            </form>

            <UploadProgressModal isOpen={uploading || uploadError} progress={uploadProgress} isError={uploadError} errorMsg={uploadErrorMsg} onRetry={() => actions.handleUploadProcess(state.pendingManifest, state.localFileMap)} />
            <ErrorModal isOpen={errorModalOpen} onClose={() => actions.setErrorModalOpen(false)} message={errorModalMessage} />

            {showSuccessModal && createPortal(
                <div 
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 animate-in fade-in duration-300"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            actions.setShowSuccessModal(false);
                            setTimeout(() => navigate('/portal/factory'), 50);
                        }
                    }}
                >
                    <div className="bg-zinc-900/90 rounded-[3rem] shadow-2xl p-10 max-w-md w-full mx-4 border border-zinc-700/50 relative overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        {/* Background Decoration */}
                        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 animate-gradient-x" />

                        <div className="flex flex-col items-center text-center gap-6 relative z-10">
                            {/* Icono con halo cyan */}
                            <div className="w-24 h-24 bg-cyan-500/10 rounded-full flex items-center justify-center text-cyan-400 mb-2 border border-cyan-500/20 shadow-lg shadow-cyan-500/10 relative">
                                <CheckCircle size={48} className="drop-shadow-[0_0_12px_rgba(34,211,238,0.5)]" />
                                <div className="absolute inset-0 rounded-full border-4 border-cyan-400/30 animate-pulse" style={{ animationDuration: '2s' }} />
                            </div>

                            <div>
                                <h2 className="text-3xl font-black text-zinc-100 tracking-widest uppercase mb-3">¡Genial!</h2>
                                <p className="text-xs text-zinc-400 font-bold leading-relaxed px-4 tracking-widest uppercase">
                                    Pedido recibido y sincronizado
                                </p>
                            </div>

                            {/* Órdenes generadas */}
                            <div className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-2xl p-5 mb-2">
                                <p className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-black mb-4">Órdenes Generadas</p>
                                <div className="flex flex-wrap justify-center gap-2">
                                    {createdOrderIds.map(id => (
                                        <span key={id} className="bg-zinc-900 border border-cyan-500/30 text-cyan-300 rounded-xl py-2 px-4 font-mono font-bold text-sm shadow-inner shadow-cyan-500/5">
                                            {id}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {reusoRegen && (
                                <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 -mt-2 mb-2">
                                    <p className="text-[11px] text-amber-200 font-bold leading-relaxed">
                                        Pediste una cantidad distinta a la de la matriz, así que <b>regeneramos el arte</b> con esa cantidad.
                                        No necesitás aprobar nada: el pedido ya entró y arranca apenas esté el arte listo.
                                    </p>
                                </div>
                            )}

                            {/* Acciones */}
                            <div className="w-full space-y-3">
                                <button
                                    className="w-full py-5 bg-cyan-400 hover:bg-cyan-300 text-zinc-900 font-black rounded-[2rem] transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_25px_rgba(34,211,238,0.5)] active:scale-95 flex items-center justify-center gap-3 uppercase tracking-widest"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        actions.setShowSuccessModal(false);
                                        setTimeout(() => navigate('/portal/factory'), 50);
                                    }}
                                >
                                    Ver mis pedidos
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        actions.setShowSuccessModal(false);
                                        setTimeout(() => window.location.reload(), 50);
                                    }}
                                    className="w-full text-zinc-500 hover:text-cyan-400 text-[10px] font-black uppercase tracking-[0.2em] transition-colors py-3"
                                >
                                    + Crear otro pedido
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Modal anuncio DTF UV 57cm — solo para serviceId DF, una vez por sesión */}
            {showDFAnnouncement && createPortal(
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/70">
                    <div className="relative bg-zinc-900 border border-zinc-700 rounded-3xl shadow-2xl max-w-sm w-full p-8 flex flex-col items-center gap-5 animate-[fadeInScale_0.25s_ease]">
                        {/* Ícono */}
                        <div className="w-16 h-16 rounded-2xl bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center">
                            <span className="text-3xl">🎉</span>
                        </div>

                        {/* Texto */}
                        <div className="text-center space-y-2">
                            <h2 className="text-xl font-black text-white leading-tight">
                                ¡Volvió el DTF UV de 57&nbsp;cm!
                            </h2>
                            <p className="text-zinc-400 text-sm leading-relaxed">
                                Ya podés realizar pedidos de DTF UV en ancho de <span className="text-cyan-400 font-semibold">57&nbsp;cm</span> nuevamente.
                            </p>
                        </div>

                        {/* Botón */}
                        <button
                            onClick={closeDFAnnouncement}
                            className="w-full py-3 rounded-2xl bg-cyan-400 text-zinc-900 font-black text-sm tracking-wide hover:bg-cyan-300 active:scale-95 transition-all"
                        >
                            ¡Entendido!
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default OrderForm;
