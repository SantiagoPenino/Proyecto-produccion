import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import CierreCicloPreviewModal from './CierreCicloPreviewModal';
import api from '../../services/api';

/**
 * PreFacturaPage
 * Página completa de pre-facturación — renderiza dentro del layout normal
 * de la app (respeta sidebar y navbar sin pisarlos).
 */
export default function PreFacturaPage() {
  const { state } = useLocation();
  const navigate  = useNavigate();

  useEffect(() => {
    if (!state?.movsOriginales) {
      navigate('/contabilidad/cuentas', { replace: true });
    }
  }, [state, navigate]);

  if (!state?.movsOriginales) return null;

  const { ciclo, cliente, cuenta, movsOriginales, returnTo } = state;

  const handleClose = () => {
    navigate(returnTo || '/contabilidad/cuentas', {
      replace: true,
      state: { selectedClienteId: cliente?.CliIdCliente },
    });
  };

  const handleConfirm = async (cicloId, payload) => {
    try {
      await api.post(
        `/contabilidad/clientes/${cliente.CliIdCliente}/emitir-factura-anticipo`,
        payload,
      );
      navigate(returnTo || '/contabilidad/cuentas', {
        replace: true,
        state: {
          selectedClienteId: cliente?.CliIdCliente,
          facturaEmitida: true,
        },
      });
    } catch (err) {
      throw err;
    }
  };

  return (
    // Ocupa todo el área de contenido disponible (sin fixed, respeta sidebar y navbar)
    <div className="flex flex-col bg-slate-50" style={{ minHeight: '100%' }}>
      {/* Banda superior decorativa */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-600" />

      <div className="flex-1 flex flex-col p-4 gap-0 overflow-hidden" style={{ height: 'calc(100vh - 125px)' }}>
        <CierreCicloPreviewModal
          ciclo={ciclo}
          cliente={cliente}
          cuenta={cuenta}
          movsOriginales={movsOriginales}
          onClose={handleClose}
          onConfirm={handleConfirm}
          pageMode
        />
      </div>
    </div>
  );
}
