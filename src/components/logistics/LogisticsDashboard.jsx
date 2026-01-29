import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { areasService } from '../../services/modules/areasService';
import LogisticsLayout from './LogisticsLayout';
import PackingView from './PackingView';
import DispatchView from './DispatchView';
import TransportView from './TransportView';
import ReceptionView from './ReceptionView';
import StockView from './StockView';
import LostView from './LostView';

const LogisticsDashboard = () => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('dispatch');

    // Global Area Filter
    const [globalArea, setGlobalArea] = useState('TODOS');
    const [areasList, setAreasList] = useState(['TODOS']);

    // 1. Fetch Dynamic Areas
    useEffect(() => {
        const loadAreas = async () => {
            try {
                const allAreas = await areasService.getAll();
                // Filter areas that have Logistic capabilities enabled
                const logisticsAreas = allAreas
                    .filter(a => a.TieneLogisticaBultos)
                    .map(a => a.code)
                    .sort();

                setAreasList(['TODOS', ...logisticsAreas]);

                // Once loaded, validate if current globalFilter is still valid? 
                // Not strictly necessary if we trust user.areaId
            } catch (err) {
                console.error("Error loading areas:", err);
            }
        };
        loadAreas();
    }, []);

    // 2. Set Default Area based on User
    useEffect(() => {
        if (user) {
            const userArea = user.areaKey || user.areaId;

            // If Admin/Supervisor, stay on TODOS (or last selection)
            if (user.rol === 'ADMIN' || user.rol === 'SUPERVISOR') {
                // Keep default
            } else if (userArea) {
                // For normal users, force their area
                setGlobalArea(userArea);
            }
        }
    }, [user]);

    const renderContent = () => {
        // Pass the area filter to all views
        const commonProps = { areaFilter: globalArea === 'TODOS' ? null : globalArea };

        switch (activeTab) {
            // case 'packing': return <PackingView {...commonProps} />;
            case 'dispatch':
                return <DispatchView {...commonProps} mode="create" />;
            case 'history':
                return <DispatchView {...commonProps} mode="history" />;
            case 'transport':
                return <TransportView {...commonProps} />;
            case 'reception':
                return <ReceptionView {...commonProps} />;
            case 'stock':
                return <StockView {...commonProps} />;
            case 'lost':
                return <LostView {...commonProps} />;
            default:
                return <DispatchView {...commonProps} mode="create" />;
        }
    };

    return (
        <LogisticsLayout
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            globalArea={globalArea}
            setGlobalArea={setGlobalArea}
            areasList={areasList}
        >
            {renderContent()}
        </LogisticsLayout>
    );
};

export default LogisticsDashboard;
