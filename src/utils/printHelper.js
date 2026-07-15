export const printLabelsHelper = (labels, orderInfo) => {
  if (!orderInfo || (!orderInfo.id && !orderInfo.OrdenID)) {
    // Fallback: Try to get OrderID from first label
    if (labels && labels.length > 0 && labels[0].OrdenID) {
      orderInfo = { id: labels[0].OrdenID };
    } else {
      alert("No se pudo identificar la orden para imprimir.");
      return;
    }
  }

  const orderId = orderInfo.id || orderInfo.OrdenID;
  const apiUrl = import.meta.env.VITE_API_URL || '/api';
  const printUrl = `${apiUrl}/production-file-control/orden/${orderId}/etiquetas/print`;

  // Impresión silenciosa: iframe oculto en lugar de ventana nueva.
  // El diálogo de impresión del sistema sigue apareciendo (requerimiento del browser),
  // pero el operador no pierde el foco de la pantalla actual.
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;border:none;';
  iframe.src = printUrl;

  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      // Si el iframe falla (ej: bloqueado por CORS), abrir ventana como fallback
      console.warn('[printLabelsHelper] iframe print falló, usando window.open:', e);
      window.open(printUrl, '_blank', 'width=1000,height=800');
    }
  };

  document.body.appendChild(iframe);

  // Limpiar el iframe después de 30s (tiempo suficiente para que la impresión termine)
  setTimeout(() => {
    if (document.body.contains(iframe)) document.body.removeChild(iframe);
  }, 30000);
};

// Imprime la etiqueta térmica de un LOTE finalizado (nombre, fecha/hora, metros, urgentes, fallas).
// Mismo patrón que printLabelsHelper: iframe oculto que carga el HTML del backend e imprime.
export const printEtiquetaLote = (rollId) => {
  if (!rollId) return;
  const apiUrl = import.meta.env.VITE_API_URL || '/api';
  const printUrl = `${apiUrl}/production/rollo/${rollId}/etiqueta-lote/print`;

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;border:none;';
  iframe.src = printUrl;
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.warn('[printEtiquetaLote] iframe print falló, usando window.open:', e);
      window.open(printUrl, '_blank', 'width=420,height=620');
    }
  };
  document.body.appendChild(iframe);
  setTimeout(() => {
    if (document.body.contains(iframe)) document.body.removeChild(iframe);
  }, 30000);
};

