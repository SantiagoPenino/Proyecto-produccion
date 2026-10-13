# Contexto de la auditoría de limpieza — leer antes de empezar

Proyecto: `C:/Users/Santiago/Desktop/proyecto/Proyecto-produccion` (Windows, git, rama main).
Frontend: React 18 + Vite 7 en `src/` (entry `src/main.jsx` → `src/App.jsx`). Backend: Node/Express CJS en `backend/` (entry `backend/server.js`; `backend/scheduler.js` es el otro proceso). SQL Server. Python para TPU/DTF en `backend/python/` (se invocan con `execFile`, NO con require).
Sin ESLint ni TypeScript en el repo. Sin tests en el front; 4 tests Jest en `backend/__tests__`.

## Datos ya calculados (NO recalcular, sí verificar)

- `grafo.json` (misma carpeta que este archivo): grafo de imports. Claves útiles: `frontend.unreachable`, `backend.unreachable`, `frontend.edges` / `backend.edges` (archivo → archivos locales que importa), `frontend.inDegree`, `frontend.sizes` (líneas por archivo), `frontend.unusedExports` (BAJA confianza: no detecta `export { x } from './y'`, así que los `services/modules/*Service` que lista están re-exportados por `src/services/api.js` y SÍ se usan), `frontend.depsNotImported`, `backend.depsNotImported`, `frontend.unresolved`, `backend.unresolved`, `*.stringRefsToUnreachable` (ruidoso: busca el nombre base del archivo como string en otros archivos; "Card", "Input", "check" dan falsos positivos).
- `extras.json`: `feUnreachable`/`beUnreachable` con fecha de último commit, `duplicateBasenames`, `publicUnreferenced`, `backendScripts` (con fecha), `trackedIgnored` (74 archivos trackeados que el `.gitignore` actual ignora).

Resumen del grafo:
- `src`: 544 archivos, 493 de código, 443 alcanzables desde `main.jsx`, **101 NO alcanzables** (26 son assets/imágenes).
- `backend`: 437 archivos, 345 alcanzables desde `server.js`+`scheduler.js`, **92 NO alcanzables** (65 en `backend/scripts/`, 4 tests, 5 python que se invocan por execFile y SÍ se usan, 3 controllers, 7 services, 2 utils, 1 js suelto en la raíz del backend).
- Las rutas del front están en código (`src/App.jsx` y `src/components/layout/MainAppContent.jsx` con `lazyWithRetry(() => import(...))`, 81 `<Route>`), NO vienen de la base de datos. Por lo tanto un componente no alcanzable por imports es realmente inalcanzable salvo referencia dinámica rara.
- `backend/server.js` monta todas las rutas con `app.use('/api/...', require('./routes/x'))` (literal). `scheduler.js` requiere jobs con literales. Los únicos `require` dinámicos son `require(path.resolve(__dirname, '../config/db.js'))` en scripts.

## Hallazgos ya confirmados (no repetir el trabajo, sí ampliar)

Basura en raíz del repo (trackeada en git):
- `temp_layout.jsx` (216 líneas, un fragmento JSX suelto, no es módulo válido).
- `.bak` (4207 líneas): copia vieja de `backend/controllers/cajaController.js` (hoy 4425 líneas; 324 líneas de diff).
- `nul` (317 KB): salida CSS de Tailwind generada por un redirect a `nul` en Windows. Está en .gitignore pero no trackeado; existe local.
- `start-ngrok.bat`, `ANALISIS_APPSCRIPT_BORDADO.md` (análisis de una app externa de Apps Script).
- `src/patch_ui.cjs`, `src/fix_empty_state.cjs`, `src/fix_empty_state_robust.cjs`, `src/catch_browser_error.cjs`: scripts de parcheo de un día (01/07/2026) dentro de `src/`.
- `src/components/logistics/TransportView.bak`, `src/components/pages/customer-service/EntregaPedidosView.bak`, `src/components/production/components/ProductionTable.backup.jsx`, `src/components/layout/Sidebarborrar.jsx` (importa un `.module.css` que no existe).
- `backend/scripts/__pycache__/*.pyc` y `backend/scripts/preflight/__pycache__/*.pyc` trackeados.
- `.claude/skills/ui-ux-pro-max/**` (55 archivos) trackeado: es tooling del asistente, no del proyecto.
- `muestras/` (43 PDFs/PNGs/XLSX de un pedido de prueba TizadaPro GOES 2026), `sql/` (4 CSV/TXT de julio 2026), `scripts/` raíz (2 md + 1 cjs + 1 xlsx), `docs/` (planes, PDFs de deploy, SQL de fixes; mezcla de vigente y cerrado), `specs/` (39 md de especificación funcional).
- `.gitignore` tiene `*.md`, `*.sql`, `*.json`, `*.bat` globales → 74 archivos trackeados quedaron ignorados (CHANGELOG.md incluido: los cambios locales ya no se ven con `git status`? OJO: sí aparece como M porque ya está trackeado, pero archivos nuevos .md/.sql/.json no entran). `!src/assets/animations/` no re-incluye los `.json` de adentro (la negación es del directorio, no de `*.json`).

Duplicados por nombre que huelen a versión vieja + versión nueva: `src/client-portal/apiClient.js` vs `src/client-portal/api/apiClient.js`; `src/client-portal/fileService.js` vs `src/client-portal/api/fileService.js`; `src/client-portal/components/orders/**` (árbol viejo de OrderForm, último commit feb–may 2026) vs `src/client-portal/modulos/OrderForm.jsx` + `modulos/order-form/**` (vivo); `src/components/pages/RecursosView.jsx` vs `src/client-portal/modulos/RecursosView.jsx`; `src/client-portal/modulos/LoginPage.jsx` vs `src/components/pages/LoginPage.jsx`; `src/components/production/OrderCard.jsx` vs `production/components/OrderCard.jsx`; `src/client-portal/main.jsx` (entry viejo, importa `./App.jsx` que no existe).

Deps declaradas que nadie importa: raíz `package.json`: `@fortawesome/fontawesome-free` (index.html carga Font Awesome 6 por CDN), `clsx`, `cors`, `express`, `google-auth-library`, `pdf-lib`, `react-pdf`, `sharp`, `tailwind-merge`. Backend: `express-validator`, `node-fetch`, `node-unrar-js`, `pdfjs-dist` (hay un `import('/pdfjs/pdf.mjs')` en `backend/services/tizadaProEditables.js` que resuelve a algo fuera del grafo: verificar).

Conteos globales: `console.log/debug` 71 en src y 62 en backend (Vite los dropea en build con `esbuild.drop`); TODO/FIXME 421 en src y 359 en backend; `eslint-disable` 73; `catch {}` vacíos ~536 en todo el código; 73 archivos mencionan legacy/deprecated/obsoleto; 11 marcas "SIN USO".

## Reglas del dueño del proyecto (Santiago) que aplican al reporte

1. **Nunca afirmar sin fundamento.** Cada hallazgo lleva evidencia concreta: ruta, línea, qué grep se corrió, qué se leyó. Si algo es inferencia, decirlo ("inferido de X"). Si no se sabe, decir "no lo sé".
2. **Leer el código, no asumir.** Un grep vacío no prueba ausencia: probar con el nombre base, con el nombre de la función exportada, con el path, en `src`, `backend`, `index.html`, `public/sw.js`, `docs/`, `CHANGELOG.md`.
3. **Código sin uso: la regla de la casa es marcarlo "SIN USO" en un comentario de cabecera, no borrarlo**, salvo que sea basura evidente (backups `.bak`, `.backup.jsx`, scripts de parcheo, `__pycache__`, archivos generados). Clasificar siempre en: `BORRAR` (basura evidente, nadie lo va a extrañar), `SIN_USO` (código legítimo que ya nadie llama; se marca, se decide después), `ARCHIVAR` (scripts/docs de un episodio cerrado, mover a una carpeta de histórico fuera del código), `VIVO` (falso positivo: explicar cómo se alcanza).
4. **Solo reporte.** No modificar, borrar ni mover ningún archivo del proyecto. No instalar paquetes. No ejecutar nada que escriba en la base de datos.
5. Español rioplatense, directo, sin relleno.
