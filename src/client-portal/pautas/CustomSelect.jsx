import { Fragment } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { ChevronDown, Check } from 'lucide-react';

export function CustomSelect({ value, onChange, options, placeholder, disabled, size = 'normal', direction = 'down', className = '', variant = 'dark' }) {
    const selected = options.find(o => String(o.value) === String(value)) || null;

    const isLight = variant === 'light';
    const isBlack = variant === 'black';

    const sizeClasses = size === 'small'
        ? 'p-2.5 text-sm rounded-[10px]'
        : 'p-3 text-base rounded-[10px]';

    const buttonColors = isLight
        ? 'border-slate-200 bg-white hover:border-blue-400'
        : isBlack
        ? 'border-[#3f3f46] bg-[#111] hover:border-[#00AEEF]'
        : 'border-zinc-700 bg-brand-dark hover:border-zinc-500';

    const textColor = isLight
        ? (selected ? 'text-slate-700' : 'text-slate-400')
        : (selected ? 'text-zinc-200' : 'text-zinc-500');

    const focusRing = isLight
        ? 'focus:ring-blue-500/20 focus:border-blue-500'
        : isBlack
        ? 'focus:ring-[#00AEEF]/30 border-[#00AEEF]'
        : 'focus:ring-brand-cyan/30';

    const dropdownColors = isLight
        ? 'bg-white border-slate-200 shadow-xl shadow-black/10'
        : isBlack
        ? 'bg-[#111] border-[#3f3f46] shadow-xl shadow-black/40'
        : 'bg-brand-dark border-zinc-700 shadow-xl shadow-black/40';

    const optionColors = (active, sel) => isLight
        ? `${active ? 'bg-blue-50 text-slate-800' : 'text-slate-600'} ${sel ? 'font-semibold' : 'font-normal'}`
        : isBlack
        ? `${active ? 'bg-[#00AEEF]/20 text-zinc-100' : 'text-zinc-300'} ${sel ? 'font-semibold' : 'font-normal'}`
        : `${active ? 'bg-brand-cyan/10 text-zinc-100' : 'text-zinc-300'} ${sel ? 'font-semibold' : 'font-normal'}`;

    const checkColor = isLight ? 'text-blue-500' : 'text-[#00AEEF]';

    return (
        <Listbox value={value} onChange={onChange} disabled={disabled}>
            <div className="relative">
                <Listbox.Button
                    className={`relative w-full ${sizeClasses} pr-10 border ${buttonColors} text-left font-medium
                        focus:outline-none focus:ring-2 ${focusRing} cursor-pointer transition-all duration-200
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        ${textColor} ${className}`}
                >
                    <span className="block truncate">
                        {selected ? selected.label : (placeholder || 'Seleccionar...')}
                    </span>
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                        <ChevronDown size={16} className={`${isLight ? 'text-slate-400' : 'text-zinc-400'} transition-transform duration-200 ui-open:rotate-180`} />
                    </span>
                </Listbox.Button>

                <Transition
                    as={Fragment}
                    enter="transition duration-200 ease-out"
                    enterFrom={`opacity-0 scale-[0.98] ${direction === 'up' ? 'translate-y-1' : '-translate-y-1'}`}
                    enterTo="opacity-100 translate-y-0 scale-100"
                    leave="transition duration-150 ease-in"
                    leaveFrom="opacity-100 translate-y-0 scale-100"
                    leaveTo={`opacity-0 scale-[0.98] ${direction === 'up' ? 'translate-y-1' : '-translate-y-1'}`}
                >
                    <Listbox.Options className={`absolute z-50 max-h-80 w-full overflow-auto rounded-xl border ${dropdownColors} focus:outline-none scrollbar-thin ${direction === 'up' ? 'bottom-full mb-1.5' : 'mt-1.5'}`}>
                        {options.length === 0 ? (
                            <div className="py-3 px-4 text-sm text-zinc-500 text-center">
                                Sin opciones
                            </div>
                        ) : (
                            options.map((option) => (
                                <Listbox.Option
                                    key={option.value}
                                    value={option.value}
                                    className={({ active, selected }) =>
                                        `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors duration-100
                                        ${optionColors(active, selected)}`
                                    }
                                >
                                    {({ selected }) => (
                                        <>
                                            <span className="block truncate">{option.label}</span>
                                            {selected && (
                                                <span className={`absolute inset-y-0 left-0 flex items-center pl-3 ${checkColor}`}>
                                                    <Check size={16} />
                                                </span>
                                            )}
                                        </>
                                    )}
                                </Listbox.Option>
                            ))
                        )}
                    </Listbox.Options>
                </Transition>
            </div>
        </Listbox>
    );
}

