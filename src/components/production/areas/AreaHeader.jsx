import React from "react";

const AreaHeader = ({ areaConfig, processCounts, currentProcess, onProcessChange }) => {
  return (
    <div className="area-header">
      <div className="area-title-section">
        <h1 className="area-title">{areaConfig.name}</h1>
        <div className="process-tabs">
          {areaConfig.processes?.map((process) => (
            <button
              key={process.id}
              className={`process-tab ${currentProcess === process.id ? "active" : ""}`}
              onClick={() => onProcessChange(process.id)}
            >
              <span className="process-name">{process.name}</span>
              <span className="process-count">
                {processCounts[process.id] || 0}
              </span>
            </button>
          ))}
        </div>
      </div>
      
      <div className="area-actions">
        <button className="btn-primary">Nueva Orden</button>
        <button className="btn-secondary">Filtrar</button>
      </div>
    </div>
  );
};

export default AreaHeader;