import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow/800.css';
import '@fontsource/barlow/900.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import './index.css';
import './styles/design-system.css'; // <-- IMPORTAR AQUÍ
import App from './App.jsx';
import ChunkErrorBoundary from './components/common/ChunkErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx'; // 👈 Importamos el proveedor
import { BrowserRouter } from 'react-router-dom';      // 👈 Importamos el enrutador

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import './utils/errorReporter'; // Global frontend error reporter → /api/client-error
import { applyDeviceClass, enableTabletWakeLock } from './utils/device';
import { registerServiceWorker, initInstallPromptCapture } from './utils/pwa';

// Capturar beforeinstallprompt LO ANTES POSIBLE (el navegador lo dispara una sola vez);
// el banner "Instalá la app" del portal lo usa después.
initInstallPromptCapture();

// Tablets de planta (ej. 1200x800): estampa `is-tablet` en <html> → habilita la variante Tailwind `tablet:`
applyDeviceClass();
// En tablets: la pantalla no se apaga mientras la app está visible
enableTabletWakeLock();

// FORCE REFRESH TIMESTAMP
console.log(`🚀 APP VERSION REFRESH: ${new Date().toLocaleString()}`);

// Service Worker PWA: registro + banner "Hay una nueva versión" + chequeo periódico de updates
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ChunkErrorBoundary>
            <App />
          </ChunkErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
