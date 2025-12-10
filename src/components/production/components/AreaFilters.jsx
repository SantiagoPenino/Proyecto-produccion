import React from "react";

export default function AreaFilters({ filters, updateFilter, areaConfig }) {
  if (!areaConfig?.filters) return null;

  const common = areaConfig.filters.common || [];
  const unique = areaConfig.filters.unique || [];
  
  const allFilters = [
    ...common.map(key => ({ key, label: key, options: ['Todos', 'Pendiente', 'Proceso', 'Falla'] })), 
    ...unique
  ];

  return (
    <div style={{ display: "flex", gap: "15px", alignItems: "center" }}>
      {allFilters.map((f) => (
        <div key={f.key} style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <label style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'capitalize' }}>
                {f.label}:
            </label>
            <select
                value={filters[f.key] || ""}
                onChange={(e) => updateFilter(f.key, e.target.value)}
                style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "0.85rem",
                    color: "#334155", /* Color corregido aquí también */
                    backgroundColor: "white",
                    fontWeight: 600,
                    cursor: "pointer",
                    outline: "none"
                }}
            >
                <option value="">Todos</option>
                {f.options && f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
                ))}
            </select>
        </div>
      ))}
    </div>
  );
}