import { useEffect, useState } from 'react';
import { Clock, MapPin } from 'lucide-react';
import Swal from 'sweetalert2';
import LandingNavbar from '../shared/LandingNavbar';
import Footer from '../Footer';
import ParticlesCanvas from '../ui/ParticlesCanvas';
import waWhite from '../../assets/images/social/whatsappwhite.svg';
import waColor from '../../assets/images/social/whatsapp.svg';
const CONTACTS = [
    { label: 'Atención al cliente', href: 'https://wa.me/59899503501' },
    /*
    { label: 'Asesores', divider: true },
    { label: 'Matías', boldLabel: 'Siri',      href: 'https://wa.me/59892284262' },
    { label: 'Soledad', boldLabel: 'Ferreri',   href: 'https://wa.me/59899182920' },
    { label: 'Fabiana',                          href: 'https://wa.me/59892698543' },
    { label: 'Lucas',   boldLabel: 'Fernandez', href: 'https://wa.me/59892713902' },
    { label: 'Roly',    boldLabel: 'Majenski',  href: 'https://wa.me/59891612909' },
    { label: 'Agustín', boldLabel: 'Palmero',   href: 'https://wa.me/59898284114' },
    */
];



const Toast = Swal.mixin({
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 4000,
    timerProgressBar: true,
    background: '#18181b',
    color: '#e4e4e7',
    customClass: { popup: 'rounded-xl border border-zinc-700' }
});

export default function ContactPage() {
    const [formData, setFormData] = useState({ name: '', email: '', message: '' });
    const [sending, setSending] = useState(false);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!formData.name || !formData.email || !formData.message) return;

        setSending(true);
        try {
            const res = await fetch('/api/web-content/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();

            if (data.success) {
                Toast.fire({ icon: 'success', title: '¡Mensaje enviado!', text: 'Nos contactaremos a la brevedad.' });
                setFormData({ name: '', email: '', message: '' });
            } else {
                Toast.fire({ icon: 'error', title: 'Error al enviar', text: 'Asegurate de rellenar todos los campos.' });
            }
        } catch (err) {
            Toast.fire({ icon: 'error', title: 'Error de conexión', text: 'Intentá nuevamente más tarde.' });
        } finally {
            setSending(false);
        }
    };

    useEffect(() => {
        document.body.style.overflow = 'auto';
        window.scrollTo(0, 0);
        return () => { document.body.style.overflow = 'hidden'; };
    }, []);

    return (
        <div className="flex flex-col min-h-screen bg-custom-dark relative overflow-x-hidden font-sans">
            <LandingNavbar />
            <ParticlesCanvas />

            <div className="flex-1 flex flex-col items-center p-6 text-center z-10 pt-[100px] md:pt-[120px] pb-6 md:pb-[80px] w-full max-w-4xl mx-auto">
                <h1 className="text-2xl font-black text-white tracking-tight mb-2 text-center">
                    Estamos para ayudarte
                </h1>
                <p className="text-sm font-medium text-zinc-400 max-w-lg mx-auto mb-8 text-center px-4">
                    Contactanos por WhatsApp para recibir atención personalizada, o pasá por el Showroom para ver nuestras soluciones gráficas.
                </p>

                {/* Formulario de Contacto Directo estilo Login */}
                <div className="relative w-full max-w-3xl rounded-3xl p-[2px] login-gradient-border mb-16 shadow-2xl shadow-black/50">
                    <form className="w-full text-left flex flex-col gap-5 bg-custom-dark p-6 md:p-10 rounded-[22px] overflow-hidden">
                        <h2 className="text-2xl font-bold text-white mb-2">Dejanos un mensaje</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider ml-1">Nombre</label>
                                <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Tu nombre..." className="w-full px-4 py-3 bg-[#111] border border-[#3f3f46] rounded-xl focus:border-[#00AEEF] focus:ring-1 focus:ring-[#00AEEF]/50 transition-all outline-none font-medium text-white placeholder-zinc-500" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider ml-1">Correo Electrónico</label>
                                <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="tu@email.com" className="w-full px-4 py-3 bg-[#111] border border-[#3f3f46] rounded-xl focus:border-[#00AEEF] focus:ring-1 focus:ring-[#00AEEF]/50 transition-all outline-none font-medium text-white placeholder-zinc-500" />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider ml-1">Mensaje</label>
                            <textarea placeholder="¿En qué te podemos ayudar?" value={formData.message} onChange={e => setFormData({ ...formData, message: e.target.value })} rows="4" className="w-full px-4 py-3 bg-[#111] border border-[#3f3f46] rounded-xl focus:border-[#00AEEF] focus:ring-1 focus:ring-[#00AEEF]/50 transition-all outline-none font-medium text-white placeholder-zinc-500 resize-none"></textarea>
                        </div>
                        <button disabled={sending || !formData.name || !formData.email || !formData.message} type="submit" onClick={handleSend} className="w-full py-[14px] px-4 bg-[#00AEEF]/[0.08] border border-[#00AEEF]/30 hover:bg-[#00AEEF]/20 text-[#00AEEF] rounded-xl font-bold active:scale-[0.98] transition-all flex justify-center items-center gap-2 mt-2 text-[15px] !shadow-none disabled:opacity-50 disabled:cursor-not-allowed">
                            {sending ? 'ENVIANDO...' : 'ENVIAR MENSAJE'}
                        </button>
                    </form>
                </div>


                {/* Botón de WhatsApp Centrado */}
                <div className="flex justify-center w-full max-w-md md:max-w-sm mx-auto mb-16">
                    {CONTACTS.filter(c => !c.divider).map((c, i) => (
                        <div key={i} className="relative w-full rounded-3xl z-10 group cursor-pointer">

                            {/* Efecto Glow Gradiente (Hover/Activo) */}
                            <div className="absolute -inset-1 bg-gradient-to-br from-[#00AEEF] via-[#EC008C] to-[#FFF200] opacity-80 md:opacity-30 group-hover:opacity-100 blur-xl transition-opacity duration-500 rounded-3xl -z-10"></div>

                            {/* Borde Estructura */}
                            <div className="relative w-full rounded-3xl p-[2px] bg-gradient-to-br from-[#00AEEF] via-[#EC008C] to-[#FFF200] transition-transform md:group-hover:-translate-y-1 duration-300">
                                <a
                                    href={c.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full relative flex items-center justify-between p-4 rounded-[22px] bg-custom-dark transition-all duration-300 overflow-hidden z-10"
                                >
                                    {/* Hover background fill effect */}
                                    <div className="absolute inset-0 bg-gradient-to-r from-[#25d366]/0 to-[#25d366]/10 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>

                                    <div className="flex items-center gap-4 relative z-10">
                                        <div className="w-10 h-10 relative transition-transform duration-300 scale-110 md:scale-100 group-hover:scale-110 flex-shrink-0">
                                            <img src={waWhite} alt="WhatsApp" className="absolute inset-0 w-full h-full transition-opacity duration-300 opacity-0 md:opacity-100 group-hover:opacity-0" />
                                            <img src={waColor} alt="WhatsApp" className="absolute inset-0 w-full h-full transition-opacity duration-300 opacity-100 md:opacity-0 group-hover:opacity-100 drop-shadow-[0_0_8px_rgba(37,211,102,0.4)]" />
                                        </div>
                                        <span className="font-bold text-base tracking-wide transition-colors text-[#25d366] md:text-white group-hover:text-[#25d366]">
                                            {c.label} {c.boldLabel && <strong className="font-black">{c.boldLabel}</strong>}
                                        </span>
                                    </div>
                                    <span className="transition-all ml-4 relative z-10 text-xl font-bold text-[#25d366] md:text-[#25d366]/50 translate-x-1 md:translate-x-0 group-hover:text-[#25d366] group-hover:translate-x-1">
                                        →
                                    </span>
                                </a>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex flex-col items-center max-w-lg mb-4 w-full">
                    <p className="text-zinc-400 mb-4 tracking-wide uppercase text-xs font-bold">Ubicación del Showroom</p>
                    <a
                        href="https://www.google.com/maps/search/Arenal+Grande+2667+Montevideo"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-8 py-4 bg-transparent hover:bg-white/5 border border-white/20 text-zinc-100 rounded-xl font-bold transition-all shadow-none active:scale-[0.98] w-full max-w-[300px] flex items-center justify-center gap-3"
                    >
                        <MapPin size={18} className="text-custom-magenta" />
                        Arenal Grande 2667
                    </a>
                    <p className="mt-4 text-zinc-400 font-semibold text-sm flex items-center gap-2">
                        <Clock size={16} className="text-zinc-500" />
                        Lunes a Viernes — 9:00 a 17:00 hs
                    </p>
                </div>
            </div>

            <div className="z-10 bg-[#111] relative">
                <Footer />
            </div>
        </div>
    );
}
