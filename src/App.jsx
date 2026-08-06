import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from './context/AuthContext';
import LoginPage from './components/pages/LoginPage';
import RegisterPage from './components/pages/RegisterPage';
import ForgotPasswordPage from './components/pages/ForgotPasswordPage';
import ResetPasswordPage from './components/pages/ResetPasswordPage';
import PaymentResult from './components/pages/PaymentResult';
import PrintStationPage from './components/logistics/PrintStationPage';
import EncomiendaPrintStation from './components/logistics/EncomiendaPrintStation';
import WmsRemitoPrintStation from './components/logistics/WmsRemitoPrintStation';
import { FloatingDownloadPanel } from './components/common/FloatingDownloadPanel';
import { FallbackSpinner } from './components/common/ChunkErrorBoundary';

// ⚡ CODE SPLITTING: Se independiza la descarga para no atorar celulares. Solo se bajará el JS que se esté mirando.
const LandingPage = lazy(() => import('./components/pages/LandingPage'));
const ContactPage = lazy(() => import('./components/pages/ContactPage'));
const WorkWithUsPage = lazy(() => import('./components/pages/WorkWithUsPage'));
const ColorPalettesPage = lazy(() => import('./components/pages/ColorPalettesPage'));
const TermsPage = lazy(() => import('./components/pages/TermsPage'));
const PrivacyPage = lazy(() => import('./components/pages/PrivacyPage'));
const GuidesPage = lazy(() => import('./components/pages/GuidesPage'));
const TemplatesPage = lazy(() => import('./components/pages/TemplatesPage'));
const ClientPortalApp = lazy(() => import('./client-portal/ClientPortalApp').then(m => ({ default: m.ClientPortalApp })));
const DesignerRegister = lazy(() => import('./client-portal/modulos/DesignerRegister').then(m => ({ default: m.DesignerRegister })));
const MainAppContent = lazy(() => import('./components/layout/MainAppContent')); 
const TotemApp = lazy(() => import('./client-portal/modulos/totem/TotemApp').then(m => ({ default: m.TotemApp })));

const PageFallback = () => <FallbackSpinner />;
import { menuService } from './services/api';

function ClientLoginRedirect() {
  const location = useLocation();
  const redirect = new URLSearchParams(location.search).get('redirect') || '/portal/profile';
  return <Navigate to={redirect} replace />;
}

function App() {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const [menuItems, setMenuItems] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    const userId = user?.id || user?.IdUsuario;
    if (userId) {
      const loadMenu = async () => {
        setDataLoading(true);
        try {
          const menuData = await menuService.getByUser(userId);
          setMenuItems(menuData || []);
        } catch (error) {
          console.error("Error cargando menú:", error);
        } finally {
          setDataLoading(false);
        }
      };
      loadMenu();
    }
  }, [user]);

  if (authLoading) return <div>Cargando sesión...</div>;

  if (!user) {
    return (
      <main className="bg-custom-dark min-h-screen">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <Suspense fallback={<PageFallback />}>
              <Routes location={location}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/landing" element={<Navigate to="/" replace />} />
                <Route path="/contacto" element={<ContactPage />} />
                <Route path="/trabaja-con-nosotros" element={<WorkWithUsPage />} />
                <Route path="/paletas" element={<ColorPalettesPage />} />
                <Route path="/terminos" element={<TermsPage />} />
                <Route path="/privacidad" element={<PrivacyPage />} />
                <Route path="/guias" element={<GuidesPage />} />
                <Route path="/plantillas" element={<TemplatesPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/design" element={<DesignerRegister />} />
                <Route path="/portal/*" element={<ClientPortalApp />} />
                <Route path="/payment-status" element={<PaymentResult />} />
                <Route path="/totem/*" element={<TotemApp />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
    );
  }
  // CHECK USER TYPE FOR ROUTING
  const isClient = user?.userType === 'CLIENT' || user?.role === 'WEB_CLIENT';

  if (isClient) {
    return (
      <main>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/landing" element={<Navigate to="/" replace />} />
            <Route path="/contacto" element={<ContactPage />} />
            <Route path="/trabaja-con-nosotros" element={<WorkWithUsPage />} />
            <Route path="/paletas" element={<ColorPalettesPage />} />
            <Route path="/terminos" element={<TermsPage />} />
            <Route path="/privacidad" element={<PrivacyPage />} />
            <Route path="/guias" element={<GuidesPage />} />
            <Route path="/plantillas" element={<TemplatesPage />} />
            <Route path="/design" element={<DesignerRegister />} />
            <Route path="/portal/*" element={<ClientPortalApp />} />
            <Route path="/payment-status" element={<PaymentResult />} />
            <Route path="/totem/*" element={<TotemApp />} />
            <Route path="/login" element={<ClientLoginRedirect />} />
            <Route path="/register" element={<Navigate to="/portal/profile" replace />} />
            <Route path="*" element={<Navigate to="/portal/profile" replace />} />
          </Routes>
        </Suspense>
        <FloatingDownloadPanel />
      </main>
    );
  }
  // ADMIN / INTERNAL ROUTING
  return (
    <main>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/totem/*" element={<TotemApp />} />
          <Route path="/print-station" element={<PrintStationPage />} />
          <Route path="/encomienda-station" element={<EncomiendaPrintStation />} />
          <Route path="/wms-remito-station" element={<WmsRemitoPrintStation />} />
          {/* /portal pertenece al portal cliente — si un admin llega aquí, redirigir al dashboard */}
          <Route path="/portal/*" element={<Navigate to="/" replace />} />
          <Route path="*" element={<MainAppContent menuItems={menuItems} />} />
        </Routes>
      </Suspense>
      <FloatingDownloadPanel />
    </main>
  );
}
// 🚀 ESTA LÍNEA ES LA QUE TE FALTA Y CAUSA EL ERROR
export default App;
