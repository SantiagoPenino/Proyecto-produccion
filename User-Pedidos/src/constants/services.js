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
        id: 'DF',
        label: 'DTF (Direct to Film)',
        desc: 'Impresión digital directa sobre film.',
        icon: Layers,
        // Removed hardcoded subtypes/materials to rely on DB
        subtypes: [],
        materials: [],
        config: {
            singleMaterial: true,
            disableItemNote: true,
            requiresProductionFiles: true,
        },
        complementaryOptions: [
            {
                id: 'EST',
                label: 'Estampado (Planchado en USER)',
                hasFile: true,
                fullWidth: true,
                fields: [
                    { name: 'cantidadPrendas', label: 'Cantidad de Prendas', type: 'number', placeholder: '0' },
                    { name: 'cantidadEstampados', label: 'Cantidad de estampados por Prenda', type: 'number', placeholder: '1' },
                    { name: 'origenPrendas', label: 'Origen de las Prendas', type: 'select', options: ['Prendas del Cliente', 'Stock User'] },


                ]
            },
        ]
    },
    {
        id: 'sublimacion',
        label: 'Sublimación x Metro',
        desc: 'Transferencia de tinta por calor.',
        icon: Palette,
        subtypes: ['Papel', 'Tela Sublimada'],
        // Agregamos 'Tela Cliente' para activar lógica de stock
        materials: ['Tela Deportiva (Set)', 'Tela Modal', 'Tela Spun', 'Papel Transfer Premium', 'Tela Cliente'],
        config: {
            singleMaterial: false,
            disableItemNote: true,
            requiresProductionFiles: true,
            hasCuttingWorkflow: true, // Integrar flujo de moldes/costura
            stockTriggerMaterial: 'Tela Cliente',
            templateButtons: [
                { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
                { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
            ]
        },
        complementaryOptions: [
            {
                id: 'TWC', // Corte Laser
                label: 'Corte Láser / Tizada',
                hasFile: false, // We'll use the specialized UI instead
                fullWidth: true
            },
            {
                id: 'TWT', // Costura
                label: 'Confección / Costura',
                hasInput: false, // We'll use the specialized UI instead
                fullWidth: true
            },
            {
                id: 'EMB', // Bordado
                label: 'Servicio de Bordado',
                hasFile: true,
                fullWidth: true,
                inputLabel: 'Adjuntar Ponchado/Logo'
            },
            {
                id: 'EST',
                label: 'Estampado (Planchado en USER)',
                hasFile: true,
                fullWidth: true,
                fields: [
                    { name: 'cantidadPrendas', label: 'Cantidad de Prendas', type: 'number', placeholder: '0' },
                    { name: 'cantidadEstampados', label: 'Cantidad de estampados por Prenda', type: 'number', placeholder: '1' },
                    { name: 'origenPrendas', label: 'Origen de las Prendas', type: 'select', options: ['Prendas del Cliente', 'Stock User'] },
                ]
            }
        ]
    },
    {
        id: 'ecouv',
        label: 'Impresión Digital (EcoUV)',
        desc: 'Alta resolución y durabilidad.',
        icon: ImageIcon,
        subtypes: ['Etiquetas y Calcomanías', 'Cartelería Rígida', 'Lonas y Pendones'],
        materials: ['Vinilo Brillante', 'Vinilo Mate', 'Lona Front', 'Lona Blackout', 'PVC Rígido 3mm'],
        config: {
            singleMaterial: true,
            disableItemNote: true,
            requiresProductionFiles: true
        },
        complementaryOptions: [
            { id: 'ojales', label: 'Colocación de Ojales', hasInput: true, inputLabel: 'Cant. / Distancia' },
            { id: 'refuerzo', label: 'Refuerzo Perimetral' }
        ]
    },
    {
        id: 'directa_320',
        label: 'Impresión Directa 3.20m',
        desc: 'Gigantografía y gran formato.',
        icon: Printer,
        materials: ['Lona Front', 'Lona Blackout', 'Mesh', 'Vinilo'],
        config: {
            singleMaterial: true,
            disableItemNote: true,
            requiresProductionFiles: true,
        },
        complementaryOptions: [
            { id: 'soldadura', label: 'Soldadura de Paños' },
            { id: 'bolsillo', label: 'Bolsillos para Caño' }
        ]
    },
    {
        id: 'directa_algodon',
        label: 'Impresión Directa Algodón',
        desc: 'Similar a sublimación pero en algodón.',
        icon: Printer,
        materials: ['Algodón Peinado', 'Algodón Cardado', 'Lienzo'],
        config: {
            singleMaterial: false,
            disableItemNote: true,
            requiresProductionFiles: true,
        },
        complementaryOptions: []
    },
    {
        id: 'bordado',
        label: 'Bordado',
        desc: 'Personalización con hilos.',
        icon: Scissors,
        config: {
            singleMaterial: true, // Filosofía de sublimación: Material global
            hideMaterial: false,
            useClientStock: true,
            materialLabel: 'Seleccionar Prenda (Stock)',
            requiresProductionFiles: false, // Fusionado en sección técnica
            disableItemNote: true,
            filesAtEnd: true,
            features: ['sample_check'],
        },
        complementaryOptions: []
    },
    {
        id: 'corte-confeccion',
        label: 'Corte y Confección',
        desc: 'Servicio integral de corte laser, moldes y armado de prendas.',
        icon: Scissors,
        materials: ['Material Cliente', 'Tela Stock User', 'MDF 3mm', 'Acrílico'],
        config: {
            requiresProductionFiles: false,
            areaID: 'TWT',
            disableItemNote: true,
            filesAtEnd: true,
            hasCuttingWorkflow: true,
            templateButtons: [
                { label: 'DESCARGAR PLANILLA DE PEDIDO ROPA', url: 'https://drive.google.com/uc?export=download&id=1_u6vdtCQJZxjM-DgH6RhsamqV4EhtoHw' },
                { label: 'DESCARGAR PLANILLA DE PEDIDO VARIOS', url: 'https://drive.google.com/uc?export=download&id=1yKe8DbrUyGKm2_Je6dOc3or67BDotnjl' }
            ],
            extraFiles: [
                { key: 'boceto', label: 'Cargar Archivo del Boceto', type: 'BOCETO' },
                { key: 'tizada', label: 'Cargar Archivo Tizada (Si aplica)', type: 'TIZADA' }
            ]
        },
        complementaryOptions: [
            {
                id: 'EST',
                label: 'Estampado (Planchado en USER)',
                hasFile: true,
                fullWidth: true,
                fields: [
                    { name: 'cantidadPrendas', label: 'Cantidad de Prendas', type: 'number', placeholder: '0' },
                    { name: 'cantidadEstampados', label: 'Cantidad de estampados por Prenda', type: 'number', placeholder: '1' },
                    { name: 'origenPrendas', label: 'Origen de las Prendas', type: 'select', options: ['Prendas del Cliente', 'Stock User'] },
                ]
            },
            {
                id: 'EMB',
                label: 'Servicio de Bordado',
                hasFile: true,
                fullWidth: true,
                inputLabel: 'Adjuntar Ponchado/Logo'
            }
        ]
    },
    {
        id: 'tpu',
        label: 'TPU',
        desc: 'Aplicaciones en poliuretano.',
        icon: Box,
        materials: ['TPU Standard', 'TPU Relieve 3D', 'TPU Metalizado', 'TPU Holográfico', 'TPU Mate'],
        materialLabel: 'Tipo de TPU',
        config: {
            disableItemNote: true,
            requiresProductionFiles: true
        },
        complementaryOptions: [
            // CAMBIO: hasFile: true para carga de boceto
            { id: 'estampado', label: 'Servicio de Estampado', hasFile: true, inputLabel: 'Cargar Boceto de Ubicación' },
            // Estampado con plancha es complementario de TPU
            { id: 'plancha', label: 'Estampado con Plancha', hasInput: true, inputLabel: 'Ubicación' }
        ]
    },
];
