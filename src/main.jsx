import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';           // Tus estilos base
import './styles/custom.css';   // Tus estilos personalizados
import App from './App.jsx';    // El componente principal (la lógica nueva)

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);