/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // CMYK Inspired Palette for a Printing Company
                cyan: {
                    400: '#22d3ee', // Bright Cyan
                    500: '#06b6d4',
                    600: '#0891b2',
                },
                magenta: {
                    400: '#e879f9',
                    500: '#d946ef', // Fuchsia
                    600: '#c026d3',
                },
                yellow: {
                    400: '#facc15', // Bright Yellow
                    500: '#eab308',
                },
                // Rich "Black" replacements (Deep Navy/Slate)
                ink: {
                    800: '#1e293b',
                    900: '#0f172a',
                    950: '#020617', // Main dark text color
                },
                // Primary Brand Color (Digital Blue/Purple mix)
                brand: {
                    50: '#eef2ff',
                    100: '#e0e7ff',
                    500: '#6366f1', // Indigo
                    600: '#4f46e5',
                },
                'custom-dark': '#19181B',
                'custom-cyan': '#00AEEF',
                'custom-magenta': '#EC008C',
                'custom-yellow': '#FFF200',
                'brand-cyan': '#006E97',
                'brand-magenta': '#BD0C7E',
                'brand-gold': '#DCB308',
                'brand-dark': '#212121',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                archivo: ['Archivo', 'system-ui', 'sans-serif'],
                barlow: ['Barlow', 'sans-serif'],
            },
            boxShadow: {
                'glow-cyan': '0 0 20px -5px rgba(34, 211, 238, 0.4)',
                'glow-magenta': '0 0 20px -5px rgba(232, 121, 249, 0.4)',
                'card-hover': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            }
        },
    },
    plugins: [
        // Variante `tablet:` — activa cuando el DISPOSITIVO es una tablet física
        // (html.is-tablet, estampada en main.jsx vía utils/device.js), sin importar
        // el ancho de ventana ni la orientación. Ej: `tablet:text-sm tablet:grid-cols-2`.
        function ({ addVariant }) {
            addVariant('tablet', 'html.is-tablet &');
        },
    ],
}
