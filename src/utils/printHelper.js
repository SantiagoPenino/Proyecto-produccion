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
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

  // Usamos el endpoint del backend para centralizar el diseño y la lógica
  const printUrl = `${apiUrl}/production-file-control/orden/${orderId}/etiquetas/print`;

  const printWindow = window.open(printUrl, '_blank', 'width=1000,height=800');

  if (!printWindow) {
    alert("El navegador bloqueó la ventana emergente. Por favor permite popups.");
  }
};
