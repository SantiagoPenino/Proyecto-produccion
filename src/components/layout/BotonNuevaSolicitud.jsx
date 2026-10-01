import { useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';

// Botón de la navbar (al lado de la campanita) para pedir Servicio Técnico desde cualquier pantalla.
// El formulario se carga recién al primer clic.
const NuevaSolicitudModal = lazy(() => import('../servicio-tecnico/NuevaSolicitudModal'));

const BotonNuevaSolicitud = ({ className = '' }) => {
    const [abierta, setAbierta] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    return (
        <>
            <button type="button" onClick={() => setAbierta(true)} title="Reportar falla a Servicio Técnico"
                className={`flex w-9 h-9 items-center justify-center rounded-full bg-zinc-700 text-brand-gold hover:bg-zinc-600 transition-colors shrink-0 ${className}`}>
                <TriangleAlert size={20} />
            </button>
            {abierta && (
                <Suspense fallback={null}>
                    <NuevaSolicitudModal abierta onCerrar={() => setAbierta(false)}
                        // En la pantalla de Servicio Técnico se abre la solicitud recién creada.
                        onCreada={(sol) => { if (location.pathname.startsWith('/servicio-tecnico')) navigate(`/servicio-tecnico?sol=${sol.SolId}`); }} />
                </Suspense>
            )}
        </>
    );
};

export default BotonNuevaSolicitud;
