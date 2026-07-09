import { useState, useEffect } from 'react';
import { isTabletDevice } from '../utils/device';

// Detección de dispositivo: constante durante toda la sesión (no depende del resize)
const IS_TABLET_DEVICE = isTabletDevice();

export function useViewport() {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, []);

  return {
    width,
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024,
    // Tablet FÍSICA (táctil, ej. las 1200x800 de planta) — independiente del ancho de ventana.
    // Ojo: NO es lo mismo que isTablet (que es solo un rango de ancho 768-1024).
    isTabletDevice: IS_TABLET_DEVICE,
  };
}
