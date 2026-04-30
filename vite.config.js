import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [
    react(),
    basicSsl()
  ],
  build: {
    outDir: 'backend/public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendors que nunca cambian entre deploys → el browser los cachea
          'vendor-react':  ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-icons':  ['lucide-react'],
          'vendor-ui':     ['sonner'],
        },
      },
    },
  },
  esbuild: {
    drop: ['console', 'debugger'],
  },
  optimizeDeps: {
    include: ['ag-grid-community', 'ag-grid-react', 'jspdf', 'jspdf-autotable']
  },
  server: {
    host: true,  // Permite conexiones externas (celular en red local)
    port: 5173,
    https: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
        secure: false
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  // CONFIGURACIÓN PARA PRODUCCIÓN (PREVIEW)
  preview: {
    port: 5173, // Usar el mismo puerto
    https: true, // Mantener HTTPS
    proxy: {     // Mantener el Proxy
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
        secure: false
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      }
    }
  }
})