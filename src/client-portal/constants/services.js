import {
    Layers,
    Palette,
    Image as ImageIcon,
    Printer,
    Scissors,
    Zap,
    Box
} from 'lucide-react';

export const SERVICES_LIST = [
    {
        // 1.1 SB - Sublimacion
        id: 'sublimacion',
        dbId: '1.1',
        areaId: 'SB',
        codOrden: 'SB',
        label: 'Sublimación x Metro',
        desc: 'Transferencia de tinta por calor en telas poliéster.',
        icon: Palette,

        // Configuration
        config: {
            // Variant Config
            variantMode: 'select', // User selects from dropdown (fetched from DB: SB)
            defaultVariant: 'Tela Sublimada', // Default selection if available

            // Material Config
            materialMode: 'multiple', // multiple = per item, single = global
            allowClientStock: true,   // Enables "Tela Cliente" logic
            stockTriggerMaterial: 'Tela Cliente', // Specific material that triggers stock logic

            // Workflow Config
            hasCuttingWorkflow: true, // Enables Corte (TWC) and Costura (TWT) accordions
            requiresProductionFiles: true, // Show "Archivos de Producción" section
            disableItemNote: true, // Hide individual note per item

            // UI Helpers
            templateButtons: [
                { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
                { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
            ]
        },

        complementaryOptions: [
            // These are logically handled by workflows if active, but kept for reference
            { id: 'TWC', label: 'Corte Láser / Tizada', hasFile: false, fullWidth: true },
            { id: 'TWT', label: 'Confección / Costura', hasInput: false, fullWidth: true },
            // Extra services
            { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' },
            { id: 'EST', label: 'Estampado (Planchado en USER)', fullWidth: true }
        ]
    },
    {
        // 1.2 DF - DTF
        id: 'DF',
        dbId: '1.2',
        areaId: 'DF',
        codOrden: 'DF',
        label: 'DTF (Direct to Film)',
        desc: 'Impresión digital directa sobre film para transferencia.',
        icon: Layers,

        config: {
            variantMode: 'select', // User selects from dropdown (fetched from DF: DF)
            materialMode: 'single', // Usually one material (Film) for the whole order
            requiresProductionFiles: true,
            disableItemNote: true,
            hasCuttingWorkflow: false,
        },

        complementaryOptions: [
            { id: 'EST', label: 'Estampado (Planchado en USER)', fullWidth: true },
        ]
    },
    {
        // 1.3 ECOUV - ECOUV (VisibleWeb: False in table, but we keep config here just in case)
        id: 'ecouv',
        dbId: '1.3',
        areaId: 'ECOUV',
        codOrden: 'ECOUV',
        label: 'Impresión Digital (EcoUV)',
        desc: 'Alta resolución y durabilidad UV.',
        icon: ImageIcon,

        config: {
            variantMode: 'fixed',
            fixedVariant: 'Impresion Gran Formato',
            materialMode: 'single', // Material de impresión
            requiresProductionFiles: true,
            disableItemNote: false, // Permitir notas por archivo
        },

        complementaryOptions: [
            {
                id: 'terminaciones_ecouv',
                label: 'Terminaciones ECOUV (Materiales Extra)',
                fullWidth: true,
                // Custom UI logic will be handled in OrderForm based on this ID
            }
        ]
    },
    {
        // 1.4 EMB - Bordado
        id: 'bordado',
        dbId: '1.4',
        areaId: 'EMB',
        codOrden: 'EMB',
        label: 'Bordado',
        desc: 'Personalización con hilos.',
        icon: Scissors,

        config: {
            variantMode: 'select', // Enable variant fetch
            materialMode: 'single', // Enable material fetch
            allowClientStock: true, // Use client stock logic

            requiresProductionFiles: false, // Uses specialized UI instead or integrated files
            filesAtEnd: true,
            features: ['sample_check'], // Special flag for sample checkbox
        },

        complementaryOptions: [
            { id: 'EST', label: 'Servicio de Estampado' }
        ]
    },
    {
        // 1.5 EST - Estampado
        id: 'estampado',
        dbId: '1.5',
        areaId: 'EST',
        codOrden: 'EST',
        label: 'Servicio de Estampado',
        desc: 'Aplicación de estampas con plancha.',
        icon: Layers,

        config: {
            variantMode: 'select', // Enable variant fetch
            materialMode: 'single', // Enable material fetch
            requiresProductionFiles: false, // Uses custom specialized UI
            defaultCodArt: '110',      // <--- CENTRALIZADO AQUÍ
            defaultCodStock: '1.1.5.1' // <--- CENTRALIZADO AQUÍ
        },
        complementaryOptions: [
            { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' }
        ]
    },
    {
        // 1.6 TWC - Corte (Usually a complementary service but can be standalone?)
        // Table says visible: True. Mapped as 'corte' usually.
        id: 'corte', // Standalone Corte Page
        dbId: '1.6',
        areaId: 'TWC', // Group Internal: TWC
        codOrden: 'TWC', // Corrected per user feedback
        label: 'Servicio de Corte',
        desc: 'Corte láser o tizada manual.',
        icon: Zap,

        config: {
            variantMode: 'fixed', // Fixed to Corte
            fixedVariant: 'Corte',
            materialMode: 'fixed', // Generic
            requiresProductionFiles: false, // Specialized UI
            hasCuttingWorkflow: true, // Its own workflow
            templateButtons: [
                { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
                { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
            ]
        },
        complementaryOptions: [
            { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' },
            { id: 'EST', label: 'Servicio de Estampado' }
        ]
    },
    {
        // 1.10 TPU
        id: 'tpu',
        dbId: '1.10',
        areaId: 'TPU',
        codOrden: 'TPU',
        label: 'TPU',
        desc: 'Aplicaciones en poliuretano.',
        icon: Box,

        config: {
            variantMode: 'fixed',
            fixedVariant: 'TPU',
            materialMode: 'single',
            materialLabel: 'Tipo de TPU',
            requiresProductionFiles: true,
            disableItemNote: true,
            minCopies: 30,
        },
        materials: [
            { Material: 'ETIQUETAS OFICIALES HASTA 4X4' },
            { Material: 'TPU STANDARD' }
        ],

        complementaryOptions: [
            { id: 'EST', label: 'Servicio de Estampado' }
        ]
    },
    {
        // 1.11 DIRECTA 3.20
        id: 'directa_320',
        dbId: '1.11',
        areaId: 'DIRECTA',
        codOrden: 'IMD',
        label: 'Impresión Directa 3.20m',
        desc: 'Gigantografía y gran formato.',
        icon: Printer,

        config: {
            variantMode: 'fixed',
            fixedVariant: '1.1.11.1',
            materialMode: 'single',
            requiresProductionFiles: true,
            disableItemNote: true,
            hasCuttingWorkflow: true,
            templateButtons: [
                { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
                { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
            ]
        },

        complementaryOptions: [
            { id: 'TWC', label: 'Corte Láser / Tizada', hasFile: false, fullWidth: true },
            { id: 'TWT', label: 'Confección / Costura', hasInput: false, fullWidth: true },
            { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' },
            { id: 'EST', label: 'Estampado (Planchado en USER)', fullWidth: true }
        ]
    },
    {
        // 1.12 DIRECTA ALGODON
        id: 'directa_algodon',
        dbId: '1.12',
        areaId: 'DIRECTA',
        codOrden: 'IMD',
        label: 'Impresión Directa Algodón',
        desc: 'Impresión sobre tela de algodón.',
        icon: Printer,

        config: {
            variantMode: 'fixed',
            fixedVariant: '1.1.12.1',
            materialMode: 'single',
            requiresProductionFiles: true,
            disableItemNote: true,
            hasCuttingWorkflow: true,
            templateButtons: [
                { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
                { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
            ]
        },
        complementaryOptions: [
            { id: 'TWC', label: 'Corte Láser / Tizada', hasFile: false, fullWidth: true },
            { id: 'TWT', label: 'Confección / Costura', hasInput: false, fullWidth: true },
            { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' },
            { id: 'EST', label: 'Estampado (Planchado en USER)', fullWidth: true }
        ]
    }
];
