import React from 'react';
import Navbar from './Navbar';
import Sidebar from './Sidebar';

const Layout = ({ children, currentView, onViewChange }) => {
  return (
    <div className="flex flex-col h-screen bg-slate-100">
      <Navbar currentView={currentView} onViewChange={onViewChange} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar currentView={currentView} onAreaSelect={onViewChange} />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;