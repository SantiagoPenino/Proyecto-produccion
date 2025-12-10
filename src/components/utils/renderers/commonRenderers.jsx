// commonRenderers.js
const commonRenderers = {
  date: (value) => {
    if (!value) return "--";
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return value;
    }
  },
  text: (value) => value || "--",
  numeric: (value) => (typeof value === "number" ? value : "--"),
};

export default commonRenderers;
