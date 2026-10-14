import React from 'react';

/**
 * Logo USER (marca 2026, versión reducida: wordmark + Barra de Proceso, sin bajada).
 * Original: public/assets/images/logo/user-logo-reducido-sobre-claro.svg / -sobre-oscuro.svg.
 * Los colores de la barra (cian · magenta · amarillo) son fijos. Las letras y el último tramo
 * de la barra usan currentColor: negro sobre fondo claro, blanco sobre oscuro.
 *
 * Uso:
 *   <Logo className="h-20 text-white" />   // fondo oscuro
 *   <Logo className="h-20 text-black" />   // fondo claro
 *
 * El viewBox deja el mismo margen arriba y abajo que el logo anterior (el dibujo ocupa ~76 % del
 * alto), así las pantallas que lo dimensionan con h-* no cambian de tamaño.
 */
export const Logo = ({ className = '', ...props }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 -15.2 240.08 127.15"
        className={className}
        {...props}
    >
        {/* "user" */}
        <path fill="currentColor" d="M0.66 6.54L14.09 6.54L14.09 47.37C14.09 56.81 20.47 63.86 30.05 63.86C39.76 63.86 46.67 56.81 46.67 46.84L46.67 6.54L60.11 6.54L60.11 74.37L46.67 74.37L46.67 66.79C42.02 72.38 34.84 75.7 26.72 75.7C11.16 75.7 0.66 64.4 0.66 49.9L0.66 6.54Z" />
        <path fill="currentColor" d="M67.36 53.2L80.26 53.23C81.84 60.94 88.48 64.95 96.86 64.97C104.18 64.98 108.7 61.53 108.72 56.35C108.72 52.22 105.8 49.29 99.42 47.55L86.93 44.46C74.83 41.38 68.59 34.98 68.61 25.27C68.64 12.9 78.63 4.94 92.33 4.97C108.16 5.01 118.51 14.74 120.35 27.51L107.45 27.48C105.87 19.76 99.09 15.76 92.18 15.75C85.66 15.73 81.79 19.18 81.78 23.97C81.78 28.23 85.09 31.16 91.47 32.77L103.17 35.85C115.67 39.07 121.91 45.6 121.88 55.31C121.86 67.01 112.13 75.77 96.97 75.74C80.48 75.7 69.73 66.11 67.36 53.2Z" />
        <path fill="currentColor" d="M234.49 18.51C225.71 18.51 219.33 25.29 219.33 35.8L219.33 74.37L205.89 74.37L205.89 6.54L219.19 6.54L219.19 14.92C222.52 9.47 227.97 6.01 235.42 6.01L240.07 6.01L240.07 18.51L234.49 18.51Z" />
        <path fill="currentColor" d="M142.09 41.6C142.09 41.6 142.37 19.83 163.14 17.22C173.68 15.89 181.65 23.18 184.19 29.29L142.09 41.6ZM185.17 54.89C182.58 58.34 179.16 60.78 175.81 62.42C173.02 63.77 170.29 64.58 167.13 64.77C162.55 65.14 158.11 64.1 153.86 61.78C149.6 59.44 146.42 56 144.44 52L198.64 36.14C198.37 32.55 197.53 29.06 196.14 25.79C193.31 19.14 188.23 13.41 181.11 9.52C163.73 0 142.82 6.9 133.62 23.71C129.78 30.71 128.47 38.21 129.4 45.31C129.86 48.85 130.87 52.28 132.4 55.51C132.84 56.44 133.32 57.36 133.85 58.25C137.1 63.8 142.04 68.21 148.31 71.65C151.21 73.24 156.41 75.74 165.89 75.74C171.15 75.74 176.31 74.99 180.88 72.97C186.42 70.53 191.13 67.04 194.86 62.1L185.17 54.89Z" />
        {/* Barra de Proceso: cian · magenta · amarillo · (negro o blanco) */}
        <path fill="#FF009D" d="M122.22 86.24L117.87 96.75L57.85 96.75L62.19 86.24L122.22 86.24Z" />
        <path fill="#FFFF00" d="M182.24 86.24L177.89 96.75L117.87 96.75L122.22 86.24L182.24 86.24Z" />
        <path fill="currentColor" d="M240.08 91.49C240.08 94.39 237.73 96.75 234.83 96.75L177.89 96.75L182.24 86.24L234.83 86.24C237.73 86.24 240.08 88.59 240.08 91.49Z" />
        <path fill="#00ABFF" d="M62.2 86.24L57.85 96.75L5.26 96.75C2.35 96.75 0 94.39 0 91.49C0 88.59 2.35 86.24 5.26 86.24L62.2 86.24Z" />
    </svg>
);
