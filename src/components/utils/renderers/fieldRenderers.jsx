import { dtfRenderers } from "./dtfRenderers.jsx";
import bordadoRenderers from "./bordadoRenderers.jsx";
import commonRenderers from "./commonRenderers.jsx";
import dtfRowRenderer from "./dtfRowRenderer.jsx";


export function getFieldRenderer(areaKey) {
  switch (areaKey) {
    case "DTF":
      return dtfRenderers;
    case "BORD":
      return bordadoRenderers;
    default:
      return commonRenderers;
  }
}

export { dtfRenderers, bordadoRenderers, commonRenderers };
