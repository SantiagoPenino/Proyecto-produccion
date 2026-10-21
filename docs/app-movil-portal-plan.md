# App móvil del portal de cliente (Android + iPhone) — plan

30/09/2026. Solo el portal de cliente (nada de la gestión interna). Sin Mac → iPhone se compila en la nube.

## Decisión: Capacitor, con el portal empaquetado adentro

Capacitor envuelve el mismo React del portal en una app nativa. No se reescriben pantallas.

- **Empaquetado** (el build va dentro de la app): Apple lo acepta mejor que "un sitio cargado en un marco". Contra: cada cambio del portal requiere subir versión a las tiendas. Más adelante se puede sumar actualización en vivo (Capgo / Capawesome) para cambios solo de JS.
- Alternativa descartada por ahora: `server.url` apuntando a user.com.uy (se actualiza sola, pero riesgo alto de rechazo de Apple por guía 4.2).

## Lo que ya está a favor (verificado en el código)

- Sesión por token en `localStorage` (`auth_token`, `src/client-portal/auth/AuthContext.jsx`), no cookies → funciona en el WebView.
- `VITE_API_URL` configurable (`src/client-portal/api/apiClient.js`) → la app apunta a `https://user.com.uy/api`.
- CORS abierto: `app.use(cors())` en `backend/server.js:68` y socket.io con `origin: "*"` (línea 359). No hace falta tocar el backend por CORS.
- Política de privacidad ya publicada (`/privacidad`), la piden ambas tiendas.

## Lo que hay que cambiar

### 1. Build solo del portal
Hoy `src/main.jsx` + `App.jsx` sirven landing, gestión, tótem y portal en un solo build. Crear una entrada aparte (ej. `src/app-movil/main.jsx` + `vite.config.movil.js`, salida `dist-movil/`) con solo: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/portal/*`, `/payment-status`. Sin service worker ni banner "Instalá la app" (`InstallAppBanner`, `registerServiceWorker`).

### 2. URLs relativas a archivos
Dentro de la app el origen es `https://localhost` (Android) / `capacitor://localhost` (iOS), así que `/thumbnails/...` no resuelve. Casos encontrados:
- `FactoryView.jsx:1002`, `OrderForm.jsx:2804`, `PrendaOrderForm.jsx:3169` (`src={`/thumbnails/...`}`) + 2 más en el portal.
- Redirecciones con `window.location.href = '/login'` o `'/'` (`AuthContext.jsx:160`, `ProtectedRoute.jsx:9`, `MainLayout.jsx:68`): recargan la app entera; pasar a `navigate()`.

Solución: un helper `urlArchivo(path)` que antepone el host del backend cuando corre en la app.

### 3. Login con Google (lo más delicado)
El login usa Google Identity Services en el navegador (`LoginPage.jsx`, script `accounts.google.com/gsi/client`). **Google bloquea OAuth dentro de WebViews** (error `disallowed_useragent`), así que en la app hay que usar el login nativo (plugin `@capgo/capacitor-social-login` o similar), que devuelve un ID token que el backend ya sabe verificar (`authController.googleLogin`).
- El backend valida `audience: process.env.GOOGLE_CLIENT_ID` (uno solo). Con login nativo el token viene con el client ID de Android/iOS → aceptar una lista de audiences.
- **Apple (guía 4.8): si la app ofrece login con Google, tiene que ofrecer también "Iniciar sesión con Apple"**. Opciones: (a) agregar Sign in with Apple (endpoint nuevo + vincular por email), o (b) en la app mostrar solo usuario/contraseña. La (b) es más rápida para salir.

### 4. Pagos (MercadoPago / Handy)
`PickupView.jsx:404`, `TiendaView.jsx:416` hacen `window.location.href = res.url` y `RecursosView` / `UnpaidPickupsView` abren `window.open('about:blank')`. En la app eso saca al cliente de la app o no abre nada.
- Abrir el checkout con `@capacitor/browser` (navegador del sistema dentro de la app).
- Volver: `back_urls` de `mercadoPagoService.js:52` apuntan a `${siteUrl}/portal/payment-status`. Configurar App Links / Universal Links de `user.com.uy/portal/payment-status` para que abra la app, o más simple: al cerrar el navegador, la app consulta el estado del `txId` que ya tiene.
- Apple no exige su sistema de cobro: son bienes físicos y servicios.

### 5. Notificaciones push
`usePushNotifications.js` usa Web Push (service worker + VAPID) y `pushNotificationService.js` usa `web-push` con la tabla `PushSubscriptions`. En la app no funciona.
- Front: `@capacitor/push-notifications` → token FCM (Firebase entrega también a iPhone vía APNs).
- Back: tabla nueva `PushDispositivos (ClienteWebID, Token, Plataforma, CreatedAt)` + envío con `firebase-admin`. Los envíos actuales (`sendToClient` o equivalente) mandan a ambos canales.
- Proyecto de Firebase + clave APNs (.p8) desde la cuenta de Apple.

### 6. Requisitos de Apple
- **Borrar la cuenta desde la app** (guía 5.1.1(v)): obligatorio si la app permite registrarse. No encontré esa opción en el portal → pantalla en Perfil + endpoint (baja lógica).
- Permisos con texto en `Info.plist`: cámara/fotos (subida de archivos, consultas), notificaciones.
- Cuenta de prueba para el revisor de Apple (cliente de prueba con datos).

### 7. Detalles
- Zona segura (notch / barra inferior): `viewport-fit=cover` + `env(safe-area-inset-*)` en el layout del portal.
- Botón "atrás" de Android: `@capacitor/app` → `navigate(-1)`.
- Íconos y splash: generar desde `public/web-app-manifest-512x512.png` con `@capacitor/assets`.
- Subida de archivos grandes: probar en dispositivo real (el `<input type=file>` funciona en WebView, pero hay que confirmarlo con PDFs pesados).

## Compilar sin Mac

- **Android**: Android Studio en Windows. Genera el `.aab` para Play Store.
- **iPhone**: **Codemagic** (plan gratis: 500 min/mes en Mac M2). Se conecta al repo de GitHub, compila, firma con una API key de App Store Connect y sube directo a TestFlight. Se prueba instalando TestFlight en un iPhone.

## Cuentas y costos

| Qué | Costo |
|---|---|
| Apple Developer Program | US$ 99 / año (si es a nombre de la empresa pide D-U-N-S, trámite gratis de ~1-2 semanas) |
| Google Play Console | US$ 25 una vez (cuenta de empresa: verificación de identidad) |
| Firebase (push) | gratis |
| Codemagic | gratis dentro de 500 min/mes |

Google Play, para cuentas personales nuevas, exige 12 testers durante 14 días seguidos antes de publicar (eran 20 hasta dic. 2024). Con cuenta de empresa (D-U-N-S) no.

## Paquetes a instalar (pedir OK antes)

Front: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/app`, `@capacitor/browser`, `@capacitor/push-notifications`, `@capacitor/splash-screen`, `@capacitor/status-bar`, plugin de login con Google (si se mantiene).
Back: `firebase-admin`.

## Etapas

1. **Esqueleto Android**: build separado del portal + Capacitor + URLs de archivos + atrás/zona segura. Probar en un Android real con usuario/contraseña. *(se puede empezar ya, sin cuentas)*
2. **Pagos**: checkout en `@capacitor/browser` + vuelta a la app.
3. **Push nativo**: Firebase + tabla + envío doble.
4. **Login**: decidir Google nativo + Apple, o solo usuario/contraseña en la app. Borrar cuenta.
5. **iPhone**: Codemagic + TestFlight (requiere cuenta Apple aprobada → conviene iniciar el trámite al arrancar la etapa 1).
6. **Publicación**: fichas de tienda, capturas, cuenta de prueba, revisión.

## Pendiente de decidir

- Cuentas a nombre de la empresa o personal (afecta D-U-N-S y los 12 testers de Google).
- Login con Google en la app: agregar Apple, o dejar solo usuario/contraseña.
- Nombre de la app en tiendas e ID de paquete (ej. `uy.com.user.portal`).
