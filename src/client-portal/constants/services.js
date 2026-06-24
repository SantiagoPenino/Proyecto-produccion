import {
    Layers,
    Palette,
    Image as ImageIcon,
    Printer,
    Scissors,
    Zap,
    Box,
    LifeBuoy
} from 'lucide-react';

export const SERVICES_LIST = [
    {
        // 1.1 SB - Sublimacion
        id: 'sublimacion',
        dbId: '1.1',
        areaId: 'SB',
        codOrden: 'SB',
        label: 'Sublimación',
        desc: 'Estampado por calor en poliéster.',
        icon: Palette,
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSemmGLC_EfGOGmj4kTfl3ciB53GY62R57EmKuJNh8nDtKvQNA/viewform',
        formEntries: {
            clienteId: 'entry.262281569',
            terminos: { id: 'entry.36260443', value: 'Acepto' }
        },


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
            hasCuttingWorkflow: true, // Enables Corte (TWC) and Costura (TWT) accordions with full UI
            requiresProductionFiles: true, // Show "Archivos de Producción" section
            disableItemNote: true, // Hide individual note per item

            // UI Helpers
            templateButtons: [
                { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
                { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
            ]
        },

        complementaryOptions: [
            // Bordado deshabilitado como complementario en Sublimación (a pedido)
            // { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' },
            { id: 'EST', label: 'Estampado', fullWidth: true }
        ]
    },
    {
        // 1.2 DF - DTF
        id: 'DF',
        dbId: '1.2',
        areaId: 'DF',
        codOrden: 'DF',
        label: 'DTF (Direct to Film)',
        desc: 'Transferencia digital sobre film.',
        icon: Layers,


        config: {
            variantMode: 'select', // User selects from dropdown (fetched from DF: DF)
            materialMode: 'single', // Usually one material (Film) for the whole order
            requiresProductionFiles: true,
            disableItemNote: true,
            hasCuttingWorkflow: false,
        },

        complementaryOptions: [
            { id: 'EST', label: 'Estampado', fullWidth: true },
        ]
    },
    {
        // 1.3 ECOUV - ECOUV (VisibleWeb: False in table, but we keep config here just in case)
        id: 'ecouv',
        dbId: '1.3',
        areaId: 'ECOUV',
        codOrden: 'ECOUV',
        label: 'EcoUV',
        desc: 'Impresión UV alta resolución.',
        icon: ImageIcon,
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSciNCn6SjH57kR-QeRmXqLK4pOnRrk9PaKZyiiKOqc_kkCvPw/viewform',
        formEntries: {
            clienteId: 'entry.1901865367',
            terminos: { id: 'entry.261786299', value: 'Acepto' }
        },


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
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScnxn6xsaMriuLadczeEoWJzQ4fmmeKaFwQutpJoBqi8vRI1A/viewform',
        formEntries: {
            clienteId: 'entry.217602422'
        },


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
    // {
    //     // 1.5 EST - Estampado
    //     id: 'estampado',
    //     dbId: '1.5',
    //     areaId: 'EST',
    //     codOrden: 'EST',
    //     label: 'Servicio de Estampado',
    //     desc: 'Aplicación de estampas con plancha.',
    //     icon: Layers,
    //
    //     config: {
    //         variantMode: 'select',
    //         materialMode: 'single',
    //         requiresProductionFiles: false,
    //         defaultCodArt: '110',
    //         defaultCodStock: '1.1.5.1'
    //     },
    //     complementaryOptions: [
    //         { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' }
    //     ]
    // },
    {
        // 1.6 TWC - Corte (Usually a complementary service but can be standalone?)
        // Table says visible: True. Mapped as 'corte' usually.
        id: 'corte', // Standalone Corte Page
        dbId: '1.6',
        areaId: 'TWC', // Group Internal: TWC
        codOrden: 'TWC', // Corrected per user feedback
        label: 'Corte',
        desc: 'Corte láser y tizada.',
        icon: Zap,
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc-WAW7vfEbCIzLQt7Ty18d4ckEdzvHz6Fnqk4xe0NTqmmHVA/viewform',
        formEntries: {
            clienteId: 'entry.217602422'
        },


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
        desc: 'Etiquetas y parches en PU.',
        icon: Box,
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfGsRWRkshDjsW5AsQD0oIJiKo_oR15x8mjSA0DnEhtsxv5AA/viewform',
        formEntries: {
            clienteId: 'entry.1683355647'
        },


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
        label: 'Directa 3.20m',
        desc: 'Gigantografía gran formato.',
        icon: Printer,
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScVwNflx459s7Tk6EyfittLRwkzGhjTIu4FakV5NU72QOCAgQ/viewform',
        formEntries: {
            clienteId: 'entry.262281569',
            terminos: { id: 'entry.36260443', value: 'Acepto' }
        },


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
            { id: 'EST', label: 'Estampado', fullWidth: true }
        ]
    },
    // {
    //     // 1.12 DIRECTA ALGODON
    //     id: 'directa_algodon',
    //     dbId: '1.12',
    //     areaId: 'DIRECTA',
    //     codOrden: 'IMD',
    //     label: 'Impresión Directa Algodón',
    //     desc: 'Impresión sobre tela de algodón.',
    //     icon: Printer,
    //
    //     config: {
    //         variantMode: 'fixed',
    //         fixedVariant: '1.1.12.1',
    //         materialMode: 'single',
    //         requiresProductionFiles: true,
    //         disableItemNote: true,
    //         hasCuttingWorkflow: true,
    //         templateButtons: [
    //             { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
    //             { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
    //         ]
    //     },
    //     complementaryOptions: [
    //         { id: 'TWC', label: 'Corte Láser / Tizada', hasFile: false, fullWidth: true },
    //         { id: 'TWT', label: 'Confección / Costura', hasInput: false, fullWidth: true },
    //         { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' },
    //         { id: 'EST', label: 'Estampado (Planchado en USER)', fullWidth: true }
    //     ]
    // }
    {
        id: 'soporte',
        dbId: '99',
        areaId: 'SOPORTE',
        codOrden: 'SOPORTE',
        label: 'Ayuda y Reclamos',
        desc: 'Centro de consultas y reclamos.',
        icon: LifeBuoy,
        isTicketSystem: true
    }
];
