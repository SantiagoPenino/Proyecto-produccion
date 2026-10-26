import { useState } from 'react';
import { Tab } from '@headlessui/react';
import { Palette, Camera, Pipette, LayoutGrid } from 'lucide-react';
import Selector from '../ui/Selector';
import PhotoMatchTab from './color/PhotoMatchTab';
import ManualMatchTab from './color/ManualMatchTab';
import ChartSetupTab from './color/ChartSetupTab';

// Estética nueva (22/10/2026, como Reportes y Logística): ícono Lucide en brand-cyan sin fondo, título en mayúsculas,
// pestañas con la elegida en negro (en el celular, un selector) y el ancho completo de la pantalla.
const TABS = [
    { name: 'Desde foto', Icon: Camera, Comp: PhotoMatchTab },
    { name: 'Manual (LAB → CMYK)', Icon: Pipette, Comp: ManualMatchTab },
    { name: 'Chart / Referencia', Icon: LayoutGrid, Comp: ChartSetupTab },
];

export default function ColorMatcherPage() {
    const [pestana, setPestana] = useState(0);

    return (
        <div className="min-h-full p-3 md:p-6 bg-slate-50 font-sans text-zinc-800">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                    <Palette size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Igualador de color</h1>
                        <p className="text-sm text-zinc-400">Capturá desde foto calibrada o ingresá LAB manual</p>
                    </div>
                </div>

                {/* Celular: selector */}
                <div className="w-full sm:hidden">
                    <Selector value={pestana} onChange={e => setPestana(Number(e.target.value))} aria-label="Modo" className="font-semibold">
                        {TABS.map(({ name, Icon }, i) => (
                            <option key={name} value={i}>
                                <span className="inline-flex items-center gap-2"><Icon size={15} className="shrink-0 text-brand-cyan" />{name}</span>
                            </option>
                        ))}
                    </Selector>
                </div>
            </div>

            <Tab.Group selectedIndex={pestana} onChange={setPestana}>
                {/* Escritorio: pestañas */}
                <Tab.List className="hidden sm:inline-flex items-center gap-0.5 p-0.5 mb-4 rounded-xl border border-zinc-200 bg-white">
                    {TABS.map(({ name, Icon }) => (
                        <Tab
                            key={name}
                            className={({ selected }) =>
                                `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap focus:outline-none transition-colors ${
                                    selected ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'
                                }`
                            }
                        >
                            {({ selected }) => (<><Icon size={14} className={selected ? '' : 'text-brand-cyan'} />{name}</>)}
                        </Tab>
                    ))}
                </Tab.List>
                <Tab.Panels>
                    {TABS.map(({ name, Comp }) => (
                        <Tab.Panel key={name} className="focus:outline-none">
                            <Comp />
                        </Tab.Panel>
                    ))}
                </Tab.Panels>
            </Tab.Group>
        </div>
    );
}
