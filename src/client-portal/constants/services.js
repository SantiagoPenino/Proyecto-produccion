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
        // externalUrl deshabilitado: Sublimación ahora usa el form interno /portal/order/sublimacion.
        // Se deja el link del Google Form comentado por si hay que revertir.
        // externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSemmGLC_EfGOGmj4kTfl3ciB53GY62R57EmKuJNh8nDtKvQNA/viewform',
        formEntries: {
            clienteId: 'entry.262281569',
            terminos: { id: 'entry.36260443', value: 'Acepto' }
        },


        // Configuration
        config: {
            // Variant Config
            variantMode: 'select', // User selects from dropdown (fetched from DB: SB)
            defaultVariant: 'Sublimacion Tela', // Default selection if available

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
        // 1.3 ECOUV - ECOUV
        id: 'ecouv',
        dbId: '1.3',
        areaId: 'ECOUV',
        codOrden: 'ECOUV',
        label: 'EcoUV',
        desc: 'Impresión UV alta resolución.',
        icon: ImageIcon,
        // EcoUV redirige al Google Form correspondiente (en vez del form interno /portal/order/ecouv).
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSciNCn6SjH57kR-QeRmXqLK4pOnRrk9PaKZyiiKOqc_kkCvPw/viewform',
        formEntries: {
            clienteId: 'entry.1901865367',
            terminos: { id: 'entry.261786299', value: 'Acepto' }
        },


        config: {
            // Variantes VIRTUALES (pedido del negocio): no salen de StockArt porque
            // "Material Impreso" y "Personalizado" comparten los mismos materiales.
            // La clasificación física (Lonas/Canvas/Vinilos/Cuadros...) sigue en
            // StockArt como organización interna del catálogo.
            //  - MATERIAL sin terminaciones  → impresión simple por m2
            //  - MATERIAL con terminaciones  → chips por archivo (solo materiales
            //    que tienen terminaciones asignadas en MaterialTerminaciones)
            //  - PRODUCTO_TERMINADO          → ficha con precio cerrado
            variantMode: 'virtual',
            virtualVariants: [
                { label: 'Material Impreso', tipo: 'MATERIAL', terminaciones: false },
                { label: 'Productos Personalizados (Armar a Medida)', tipo: 'MATERIAL', terminaciones: true, soloConTerminaciones: true },
                { label: 'Productos Terminados', tipo: 'PRODUCTO_TERMINADO', terminaciones: false },
            ],
            defaultVariant: 'Material Impreso',
            materialMode: 'single', // Material global (default para archivos nuevos)
            allowItemMaterialOverride: true, // MULTIMATERIAL: cada archivo puede cambiar su material (como Sublimación)
            // Tinta de impresión: rutea el lote a la máquina (magic sort ECOUV agrupa por Tinta)
            tintaOptions: ['Ecosolvente', 'UV'],
            hideRaport: true, // EcoUV no usa el modo Raport (repeticiones de patrón textil)
            requiresProductionFiles: true,
            disableItemNote: false, // Permitir notas por archivo
        },

        // Las terminaciones dejaron de ser un servicio complementario global
        // (generaban una ORDEN aparte): ahora van por archivo dentro de la misma orden.
        complementaryOptions: []
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
            requiresProductionFiles: false, // el cliente NO sube arte final: sube un boceto
            bocetoMode: true,               // TPU: 1 boceto obligatorio + cantidad
            disableItemNote: true,
            minCopies: 15,
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
        // externalUrl deshabilitado: Directa 3.20 ahora usa el form interno /portal/order/directa_320.
        // Se deja el link del Google Form comentado por si hay que revertir.
        // externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScVwNflx459s7Tk6EyfittLRwkzGhjTIu4FakV5NU72QOCAgQ/viewform',
        formEntries: {
            clienteId: 'entry.262281569',
            terminos: { id: 'entry.36260443', value: 'Acepto' }
        },


        config: {
            variantMode: 'fixed',
            // Nombre real en StockArt (antes iba el CodStock '1.1.11.1'; el endpoint resuelve
            // ambos, pero este queda como Variante legible en la orden de producción).
            fixedVariant: 'Impresión Directa 3.20',
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
            // Bordado deshabilitado como complementario en Impresión Directa (a pedido)
            // { id: 'EMB', label: 'Servicio de Bordado', hasFile: true, fullWidth: true, inputLabel: 'Adjuntar Ponchado/Logo' },
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
