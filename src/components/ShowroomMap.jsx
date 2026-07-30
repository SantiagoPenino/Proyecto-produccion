import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon (Leaflet + Vite issue)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Lat/Lng del Showroom — Inca 2228, Montevideo
const POSITION = [-34.887420595051346, -56.17808573558224];
const ZOOM = 16;

// Reset view helper (útil si el mapa ya estaba montado)
function SetView({ center, zoom }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, []);
  return null;
}

export default function ShowroomMap() {
  return (
    <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
      <MapContainer
        center={POSITION}
        zoom={ZOOM}
        scrollWheelZoom={false}
        style={{ width: '100%', aspectRatio: '280/160' }}
        attributionControl={false}
      >
        <SetView center={POSITION} zoom={ZOOM} />

        {/* Tiles estilo Voyager de CartoDB (neutro, legible) */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />

        <Marker position={POSITION}>
          <Popup>
            <strong style={{ fontSize: 13 }}>Showroom User</strong><br />
            Inca 2228, Montevideo
          </Popup>
        </Marker>
      </MapContainer>

      {/* Botón para abrir Google Maps */}
      <a
        href="https://www.google.com/maps/search/Inca+2228+Montevideo"
        target="_blank"
        rel="noopener noreferrer"
        className="flex justify-center items-center gap-2 py-3 bg-[#0ea5e9]/10 text-[#0ea5e9] hover:bg-[#0ea5e9]/20 border-t border-[#0ea5e9]/20 font-bold text-[12px] uppercase tracking-widest transition-all cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        Abrir en Google Maps
      </a>
    </div>
  );
}
