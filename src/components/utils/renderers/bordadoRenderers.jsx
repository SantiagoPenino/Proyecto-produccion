// bordadoRenderers.js
const bordadoRenderers = {
  // Example: define custom rendering logic
  status: (value) => value?.toUpperCase?.() || "--",
  operator: (value) => value || "Sin operador",
  notes: (value) => value || "--",
};

export default bordadoRenderers;

