import React from "react";
import ProductionTable from "../tables/ProductionTable";
//import styles from "./css/DTFArea.module.css";

export default function DTFAreaView({
  areaKey,
  areaConfig,
  orders,
  filters,
  updateFilter,
  views,
  switchView
}) {
  return (
    <div className={styles.pageContainer}>
      
      {/* ============================================================
          HEADER PRINCIPAL
      ============================================================ */}
      <header className={styles.headerContainer}>
        <div className={styles.headerLeft}>
          <button className={styles.backButton}>
            <i className="fa-solid fa-chevron-left"></i>
          </button>

          <div>
            <h2 className={styles.areaTitle}>{areaConfig.name}</h2>
            <p className={styles.areaSubtitle}>Producción • DTF</p>
          </div>
        </div>

        <div className={styles.headerRight}>
          <button className={`${styles.actionButton} ${styles.buttonConfig}`}>
            <i className="fa-solid fa-gear"></i>
            Configuración
          </button>

          <button className={`${styles.actionButton} ${styles.buttonInsumos}`}>
            <i className="fa-solid fa-boxes-stacked"></i>
            Insumos
          </button>

          <button className={`${styles.actionButton} ${styles.buttonFalla}`}>
            <i className="fa-solid fa-circle-exclamation"></i>
            Reportar Falla
          </button>

          <button className={`${styles.actionButton} ${styles.buttonNuevaOrden}`}>
            <i className="fa-solid fa-plus"></i>
            Nueva Orden
          </button>
        </div>
      </header>

      {/* ============================================================
          SUBHEADER (TABS + FILTROS)
      ============================================================ */}
      <div className={styles.subHeader}>
        <div className={styles.tabButtons}>
          <button
            className={`${styles.tabButton} ${
              views.currentView === "table"
                ? styles.tabButtonActive
                : styles.tabButtonInactive
            }`}
            onClick={() => switchView("table")}
          >
            Tabla
          </button>

          <button
            className={`${styles.tabButton} ${
              views.currentView === "kanban"
                ? styles.tabButtonActive
                : styles.tabButtonInactive
            }`}
            onClick={() => switchView("kanban")}
          >
            Kanban
          </button>
        </div>

        {/* FILTROS ÚNICOS */}
        {areaConfig.filters?.unique?.map((f) => (
          <select
            key={f.key}
            className={styles.machineFilter}
            value={filters[f.key] || "ALL"}
            onChange={(e) => updateFilter(f.key, e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
      </div>

      {/* ============================================================
          CONTENIDO PRINCIPAL
      ============================================================ */}
      <main className={styles.mainContent}>
        {views.currentView === "table" ? (
          <ProductionTable areaConfig={areaConfig} orders={orders} />
        ) : (
          <div className={styles.kanbanPlaceholder}>
            🗂️ Vista Kanban (próximamente)
          </div>
        )}
      </main>
    </div>
  );
}
