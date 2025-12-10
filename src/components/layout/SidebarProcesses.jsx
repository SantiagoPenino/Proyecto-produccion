import React from "react";
import styles from "./SidebarProcesses.module.css"; // Crearemos este archivo abajo

const SidebarProcesses = ({ 
  allAreaConfigs, // Recibe TODAS las configs para listar las áreas
  currentArea, 
  onAreaChange 
}) => {
  return (
    <div className="sidebar-processes">
      <div className="sidebar-header">
        <h3>Menu General</h3>
      </div>
      
      <div className="processes-list">
        {Object.entries(allAreaConfigs).map(([areaKey, config]) => {
            // Solo mostramos si tiene nombre definido
            if (!config.name) return null;

            return (
              <div
                key={areaKey}
                className={`area-section ${currentArea === areaKey ? "active" : ""}`}
                onClick={() => onAreaChange(areaKey)}
              >
                <div className="area-item-content">
                  {/* Icono simulado, puedes agregarlo a tu config */}
                  <span className="area-icon">🏭</span> 
                  <span className="area-name">{config.name}</span>
                </div>
                {currentArea === areaKey && <span className="active-indicator"></span>}
              </div>
            );
        })}
      </div>
    </div>
  );
};

export default SidebarProcesses;