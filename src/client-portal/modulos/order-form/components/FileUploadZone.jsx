import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UploadCloud, CheckCircle } from 'lucide-react';
import { rasterizarPdf } from '../../../api/pdfPreview';

// Guía de margen de seguridad dibujada sobre la vista previa: 2,5 cm hacia adentro del arte.
const MARGEN_SEGURIDAD_M = 0.025;

// Resolución del rasterizado del PDF. 600px es la misma medida que usa el croquis del plano, así
// los dos comparten un único render (ver api/pdfPreview). Los 1600px solo cuando el cliente amplía.
const MINIATURA_PX = 600;
const AMPLIADO_PX = 1600;

// Fondo tipo damero (como Photoshop) para que se vea qué partes del arte son TRANSPARENTES.
// Se usa en DTF, donde el arte va sobre film transparente. No toca los píxeles del archivo.
const DAMERO = {
    backgroundColor: '#6b7280',
    backgroundImage:
        'linear-gradient(45deg, #9ca3af 25%, transparent 25%), linear-gradient(-45deg, #9ca3af 25%, transparent 25%), ' +
        'linear-gradient(45deg, transparent 75%, #9ca3af 75%), linear-gradient(-45deg, transparent 75%, #9ca3af 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

/**
 * Vista de la bandera terminada: muestra SOLO el área útil del arte (lo de adentro de la guía
 * punteada) y, con `flamear`, la ondula como tela con un shader WebGL propio (sin librerías).
 * La imagen se deforma POR PÍXEL con dos ondas viajeras (nada de tiras) y se ilumina según la
 * pendiente de la onda: crestas con luz, valles en sombra — eso es lo que la hace ver tela.
 * Si WebGL no está disponible, cae a un recorte estático en canvas 2D.
 */
const VistaBandera = ({ src, fx, fy, utilW, utilH, flamear }) => {
    const canvasRef = useRef(null);
    const flamearRef = useRef(flamear);
    const arrancarRef = useRef(null); // reanuda el loop cuando se enciende "Flamear"
    const [img, setImg] = useState(null);

    // Resolución del canvas: ancho fijo y alto según la proporción real del área útil.
    const W = 1280;
    const H = Math.max(1, Math.round(W * (utilH / utilW)));

    // Al encender el flameo hay que reanudar el loop, que se detiene solo cuando la tela queda quieta.
    useEffect(() => {
        flamearRef.current = flamear;
        if (flamear && arrancarRef.current) arrancarRef.current();
    }, [flamear]);

    useEffect(() => {
        let vivo = true;
        const i = new Image();
        i.onload = () => { if (vivo) setImg(i); };
        i.src = src;
        return () => { vivo = false; };
    }, [src]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !img) return;

        const dibujarEstatico2D = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, W, H);
            ctx.drawImage(img, img.width * fx, img.height * fy,
                img.width * (1 - 2 * fx), img.height * (1 - 2 * fy), 0, 0, W, H);
        };

        const gl = canvas.getContext('webgl', { premultipliedAlpha: false });
        if (!gl) { dibujarEstatico2D(); return; }

        const VS = `
            attribute vec2 aPos;
            varying vec2 vUv;
            void main() {
                vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
                gl_Position = vec4(aPos, 0.0, 1.0);
            }`;
        const FS = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uTex;
            uniform float uT;    // tiempo (s)
            uniform float uAmp;  // amplitud de la onda (0 = quieta)
            uniform vec2 uCrop;  // recorte del margen de seguridad (fx, fy)

            void main() {
                // margen vertical para que la tela suba y baje sin cortarse con el canvas
                float m = uAmp * 1.5;
                vec2 p = vec2(vUv.x, (vUv.y - m) / (1.0 - 2.0 * m));

                // dos ondas viajeras: la principal y una secundaria que rompe la rigidez
                float f1 = p.x * 9.0 - uT * 2.8;
                float f2 = p.x * 15.0 + p.y * 4.0 - uT * 4.1;
                float dy = sin(f1) * uAmp + sin(f2) * uAmp * 0.22;
                float dx = cos(f1) * uAmp * 0.16; // leve fruncido horizontal de la tela

                vec2 q = vec2(p.x + dx, p.y - dy);
                if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) discard;

                vec2 uv = vec2(mix(uCrop.x, 1.0 - uCrop.x, q.x),
                               mix(uCrop.y, 1.0 - uCrop.y, q.y));
                vec4 c = texture2D(uTex, uv);

                // luz según la pendiente de la onda (se apaga junto con la amplitud)
                float pend = cos(f1) + cos(f2) * 0.22;
                float k = clamp(uAmp / 0.045, 0.0, 1.0);
                c.rgb *= 1.0 + pend * 0.13 * k;
                gl_FragColor = c;
            }`;

        const compilar = (tipo, fuente) => {
            const s = gl.createShader(tipo);
            gl.shaderSource(s, fuente);
            gl.compileShader(s);
            return s;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.warn('[VistaBandera] Shader no compiló:', gl.getProgramInfoLog(prog));
            dibujarEstatico2D();
            return;
        }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        // Textura NPOT: clamp + linear, sin mipmaps
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

        const uT = gl.getUniformLocation(prog, 'uT');
        const uAmp = gl.getUniformLocation(prog, 'uAmp');
        gl.uniform2f(gl.getUniformLocation(prog, 'uCrop'), fx, fy);
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);

        // El toggle no recrea nada: la amplitud persigue suavemente su objetivo en cada frame.
        // El loop se DETIENE cuando la tela queda quieta (amp=0 y flamear apagado): antes seguía
        // redibujando a 60fps un canvas enorme (un arte de 0,90×4,00 m son ~1280×5700 px) para
        // mostrar una imagen estática, y se notaba en la fluidez del modal. Al encender "Flamear"
        // se reanuda desde el useEffect de abajo.
        let raf = 0;
        let amp = flamearRef.current ? 0.045 : 0;
        let inicio = performance.now();
        const frame = (now) => {
            const objetivo = flamearRef.current ? 0.045 : 0;
            amp += (objetivo - amp) * 0.08;
            if (Math.abs(objetivo - amp) < 0.0004) amp = objetivo;
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(uT, (now - inicio) / 1000);
            gl.uniform1f(uAmp, amp);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            if (amp === 0 && !flamearRef.current) { raf = 0; return; } // en reposo: no seguir animando
            raf = requestAnimationFrame(frame);
        };
        arrancarRef.current = () => {
            if (raf) return;             // ya está animando
            inicio = performance.now();
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            arrancarRef.current = null;
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        };
    }, [img, fx, fy, W, H]);

    // El canvas manda el tamaño del modal: w/h en auto, con tope de 90vh/90vw MENOS lo que ocupan
    // el header y los padding. Sin restar eso, en mobile (ej. 400x800) la imagen a 90vh + el título
    // superaban la pantalla y el modal se cortaba.
    return <canvas ref={canvasRef} width={W} height={H} className="w-auto h-auto max-h-[calc(94vh-5rem)] max-w-[calc(95vw-2.5rem)] object-contain block" />;
};

// `modoBandera`: EXCLUSIVO de materiales de medida fija (Bandera Confeccionada). Solo ahí tiene
// sentido la miniatura con la guía de 2,5 cm y el modal con la vista de la bandera terminada.
// En el resto de los servicios/archivos la zona se comporta como siempre (ícono + nombre).
export const FileUploadZone = ({ id, onFileSelected, selectedFile, label, icon: Icon = UploadCloud, color = "blue", multiple = false, modoBandera = false, quitarFondoPdf = false, accept = null }) => {
    const [isOver, setIsOver] = useState(false);
    const [modalAbierto, setModalAbierto] = useState(false);
    const [flamear, setFlamear] = useState(false);
    const uniqueId = `file-input-${id}-${label.replace(/\s+/g, '-')}`;

    // ── Vista previa del archivo ──────────────────────────────────────────────
    // `selectedFile` viene en dos formas:
    //   - el File crudo (bocetos, mockups, excel)
    //   - el objeto de fileService.uploadFile (archivos de producción), donde el File original
    //     está en `fileData`. OJO: ese objeto tiene un campo `preview` que NO sirve acá, porque
    //     está truncado a 500 caracteres (`previewData.substring(0, 500)`).
    // Imagen → objectURL directo. PDF → se rasteriza la 1ª página con el pdf.js que ya usa
    // fileService para medir. Si algo falla, queda el ícono de check de siempre.
    const [preview, setPreview] = useState(null);
    useEffect(() => {
        // La miniatura se genera para CUALQUIER material y área (antes solo en modoBandera, así que
        // fuera de Bandera Confeccionada el cliente no veía lo que estaba subiendo). Lo que sigue
        // siendo exclusivo de medida fija es la guía de margen (margenGuia), no la vista previa.
        const sel = multiple ? null : selectedFile;
        if (!sel) { setPreview(null); return; }

        // El File real: o es el propio `sel`, o viene adentro en `fileData`.
        const file = (typeof Blob !== 'undefined' && sel instanceof Blob)
            ? sel
            : ((sel.fileData instanceof Blob) ? sel.fileData : null);
        if (!file) { setPreview(null); return; }

        const nombre = String(sel.name || file.name || '').toLowerCase();
        const tipo = String(sel.type || file.type || '').toLowerCase();
        const esPdf = tipo === 'application/pdf' || nombre.endsWith('.pdf');
        const esImagen = !esPdf && (tipo.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(nombre));
        if (!esImagen && !esPdf) { setPreview(null); return; }

        let cancelado = false;
        const objectUrl = URL.createObjectURL(file);

        if (esImagen) {
            setPreview(objectUrl);
        } else {
            // El render se COMPARTE con el croquis del plano (ver api/pdfPreview). Antes cada uno
            // abría y rasterizaba el mismo PDF por su cuenta: medido con el profiler, `drawImage`
            // dentro de pdf.js era el 47,8% del tiempo del hilo y la mitad era trabajo repetido.
            rasterizarPdf(file, MINIATURA_PX).then((url) => {
                if (cancelado) return;
                setPreview(url || null);
            });
        }

        return () => {
            cancelado = true;
            URL.revokeObjectURL(objectUrl);
            // El objectURL del PDF NO se revoca acá: es del caché compartido y lo puede estar
            // usando el croquis. Se libera al salir del formulario (liberarPdfPreviews).
        };
    }, [selectedFile, multiple, quitarFondoPdf]);

    // ── Versión en alta, SOLO cuando el cliente amplía ────────────────────────────────
    // Mientras llega se muestra la miniatura, así el modal abre al instante. Antes esta
    // resolución se pagaba en cada archivo subido, lo ampliara alguien o no.
    const [previewGrande, setPreviewGrande] = useState(null);
    useEffect(() => { setPreviewGrande(null); }, [selectedFile, multiple]);
    useEffect(() => {
        if (!modalAbierto || previewGrande) return;
        const sel = multiple ? null : selectedFile;
        const file = (typeof Blob !== 'undefined' && sel instanceof Blob)
            ? sel
            : ((sel?.fileData instanceof Blob) ? sel.fileData : null);
        if (!file) return;
        const nombre = String(sel?.name || file.name || '').toLowerCase();
        const tipo = String(sel?.type || file.type || '').toLowerCase();
        if (!(tipo === 'application/pdf' || nombre.endsWith('.pdf'))) return; // las imágenes ya van completas

        let cancelado = false;
        rasterizarPdf(file, AMPLIADO_PX).then((url) => {
            if (!cancelado && url) setPreviewGrande(url);
        });
        return () => { cancelado = true; };
        // El objectURL sale del caché compartido, así que no se revoca acá.
    }, [modalAbierto, selectedFile, multiple, previewGrande]);

    const handleDrop = (e) => {
        e.preventDefault();
        setIsOver(false);
        if (multiple) {
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) onFileSelected(files);
        } else {
            const file = e.dataTransfer.files[0];
            if (file) onFileSelected(file);
        }
    };

    // Margen de seguridad en % del lado, calculado sobre la MEDIDA REAL del arte: 2,5 cm sobre
    // 1,55 m de ancho no es el mismo porcentaje que sobre 0,90 m de alto, por eso va por eje.
    // Sin medidas conocidas (o arte tan chico que el margen se comería la imagen) no se dibuja.
    const margenGuia = useMemo(() => {
        const f = (multiple || !modoBandera) ? null : selectedFile;
        if (!f || f.unit !== 'meters') return null;
        const anchoM = parseFloat(f.width), altoM = parseFloat(f.height);
        if (!(anchoM > 0) || !(altoM > 0)) return null;
        const x = (MARGEN_SEGURIDAD_M / anchoM) * 100;
        const y = (MARGEN_SEGURIDAD_M / altoM) * 100;
        if (x >= 45 || y >= 45) return null;
        return { x, y };
    }, [selectedFile, multiple, modoBandera]);

    // Cerrar el modal con Escape
    useEffect(() => {
        if (!modalAbierto) return;
        const onKey = (e) => { if (e.key === 'Escape') setModalAbierto(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [modalAbierto]);

    // Recorte para el modal: proporciones del área ÚTIL (lo de adentro de la guía). Sin medidas
    // conocidas se muestra el arte completo (fx/fy en 0).
    const recorte = useMemo(() => {
        const f = multiple ? null : selectedFile;
        const anchoM = parseFloat(f?.width), altoM = parseFloat(f?.height);
        // Sin medidas: se muestra el arte completo (proporción del propio archivo, si se conoce).
        if (!margenGuia || !(anchoM > 0) || !(altoM > 0)) {
            return { fx: 0, fy: 0, utilW: anchoM > 0 ? anchoM : 1, utilH: altoM > 0 ? altoM : 1 };
        }
        return {
            fx: margenGuia.x / 100,
            fy: margenGuia.y / 100,
            utilW: anchoM - 2 * MARGEN_SEGURIDAD_M,
            utilH: altoM - 2 * MARGEN_SEGURIDAD_M,
        };
    }, [selectedFile, multiple, margenGuia]);

    return (
        <>
        <div
            className={`relative group transition-all duration-500 border-2 border-dashed rounded-[1.5rem] p-4 flex flex-col items-center justify-center gap-3 cursor-pointer overflow-hidden
                ${selectedFile ? 'border-emerald-500/50 bg-emerald-500/10 shadow-lg shadow-emerald-500/5' : (isOver ? 'border-cyan-400 bg-cyan-400/20 shadow-xl shadow-cyan-400/10 scale-[1.02]' : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-500 hover:bg-zinc-800/60 hover:scale-[1.01]')}`}
            onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
            onDragLeave={() => setIsOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById(uniqueId).click()}
        >
            <input
                id={uniqueId}
                type="file"
                multiple={multiple}
                // Filtro del explorador de archivos (opcional): las áreas que aceptan
                // solo ciertos formatos lo pasan — ej. Corte: DXF / PLT / AI 3.
                {...(accept ? { accept } : {})}
                className="hidden"
                onChange={(e) => {
                    if (multiple) {
                        onFileSelected(Array.from(e.target.files));
                    } else {
                        onFileSelected(e.target.files[0]);
                    }
                }}
            />

            {selectedFile ? (
                preview ? (
                    // Solo la miniatura, completa y sin recortar. El nombre del archivo y el estado
                    // "Listo para procesar" se muestran en los chips de abajo (los arma OrderForm),
                    // así no se repite el nombre dos veces.
                    // El wrapper se ajusta al tamaño real de la imagen, así la guía punteada calza exacto.
                    <div
                        className="relative inline-block animate-in fade-in duration-500 cursor-zoom-in rounded overflow-hidden"
                        // stopPropagation: si no, el click burbujea al recuadro y abre el selector de archivo.
                        onClick={(e) => { e.stopPropagation(); setModalAbierto(true); }}
                        title={modoBandera ? "Ver cómo queda la bandera" : "Ampliar vista previa"}
                        // DTF: damero detrás del arte para ver la transparencia (el arte va sobre film).
                        style={quitarFondoPdf ? DAMERO : undefined}
                    >
                        <img
                            src={preview}
                            alt="Vista previa del archivo"
                            className="max-w-full max-h-32 w-auto h-auto object-contain block"
                        />
                        {margenGuia && (
                            <div
                                className="absolute pointer-events-none border-2 border-dashed border-white/85"
                                style={{
                                    left: `${margenGuia.x}%`, right: `${margenGuia.x}%`,
                                    top: `${margenGuia.y}%`, bottom: `${margenGuia.y}%`,
                                    // Contorno oscuro para que la guía se vea también sobre arte claro
                                    boxShadow: '0 0 0 1px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.45)',
                                }}
                                title={`Margen de seguridad: ${MARGEN_SEGURIDAD_M * 100} cm hacia adentro`}
                            />
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-500">
                        <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-400 mb-2 border border-emerald-500/30">
                            <CheckCircle size={28} />
                        </div>
                        <span className="text-[10px] font-black text-emerald-100 truncate max-w-[180px] uppercase tracking-widest">
                            {multiple ? 'Archivos listos' : selectedFile.name}
                        </span>
                        <p className="text-[9px] text-emerald-400/60 uppercase font-black tracking-tighter mt-1">
                            {multiple ? '+ Agregar más' : 'Listo para procesar'}
                        </p>
                    </div>
                )
            ) : (
                <>
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-500 ${isOver ? 'bg-cyan-400 text-zinc-900 rotate-12' : 'bg-zinc-700/50 text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-200'}`}>
                        <Icon size={28} />
                    </div>
                    <div className="text-center">
                        <span className="text-[10px] font-black text-zinc-400 block uppercase tracking-widest group-hover:text-zinc-200 transition-colors">{label}</span>
                        <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-tighter mt-1">Arrastra o haz click</p>
                    </div>
                </>
            )}
        </div>

        {/* Modal: el arte recortado a lo que queda DENTRO de la guía punteada (lo que se ve en la
            bandera terminada; los 2,5 cm del perímetro se los come la confección) + modo flameo. */}
        {modalAbierto && preview && createPortal(
            <div
                className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4 animate-in fade-in duration-200"
                onClick={() => setModalAbierto(false)}
            >
                <div
                    // El modal se ESTIRA lo que la imagen necesite: sin max-h propio (si lo tiene,
                    // comprime la imagen antes de que llegue a su tope y sobra espacio adentro).
                    // Quien pone el límite es la imagen (max-h/max-w abajo). El max-w acá es solo
                    // para que el nombre largo del archivo no estire el modal fuera de pantalla.
                    className="relative bg-zinc-900 border border-zinc-700 rounded-2xl p-3 w-auto h-auto max-w-[95vw] shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between gap-3 mb-3 shrink-0 max-w-full">
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/80">
                                {modoBandera ? 'Vista del arte terminado' : 'Vista previa del archivo'}
                            </p>
                            {/* min-w-0 + flex-1 + truncate: sin esto el nombre largo no se recorta y
                                empuja el ancho del modal (se veía en mobile). */}
                            <p className="text-xs font-bold text-zinc-300 truncate">{selectedFile?.name}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setModalAbierto(false)}
                            className="shrink-0 w-8 h-8 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center text-lg leading-none"
                            title="Cerrar"
                        >×</button>
                    </div>

                    {/* En DTF el arte va sobre film transparente: se muestra sobre damero (como
                        Photoshop) para distinguir qué es transparente y qué es tinta blanca.
                        El archivo NO se modifica. */}
                    <div
                        className="rounded-xl p-2 flex items-center justify-center"
                        style={quitarFondoPdf ? DAMERO : { backgroundColor: 'rgba(9,9,11,.6)' }}
                    >
                        {/* Solo bandera usa el canvas WebGL (necesario para el flameo y el recorte del
                            margen). Para el resto alcanza un <img>: el canvas redibuja a 60fps un
                            lienzo enorme (un arte de 0,90×4,00 m son ~1280×5700 px) y hacía que el
                            modal se sintiera lento sin ningún beneficio. */}
                        {modoBandera ? (
                            <VistaBandera
                                src={previewGrande || preview}
                                fx={recorte.fx}
                                fy={recorte.fy}
                                utilW={recorte.utilW}
                                utilH={recorte.utilH}
                                flamear={flamear}
                            />
                        ) : (
                            <img
                                src={previewGrande || preview}
                                alt="Vista previa del archivo"
                                className="w-auto h-auto max-h-[calc(94vh-5rem)] max-w-[calc(95vw-2.5rem)] object-contain block"
                            />
                        )}
                    </div>

                    {/* Pie: el aviso del margen y el flamear son EXCLUSIVOS de bandera confeccionada
                        (medida fija). En el resto de los materiales el modal es solo la vista previa. */}
                    {modoBandera && (
                    <div className="flex items-center justify-between gap-3 mt-3 shrink-0">
                        <p className="text-[10px] text-zinc-500 font-bold leading-tight">
                            {margenGuia
                                ? `Se ocultaron los ${MARGEN_SEGURIDAD_M * 100} cm del borde que se usan en la confección.`
                                : 'Sin medidas del archivo: se muestra el arte completo.'}
                        </p>
                        <button
                            type="button"
                            onClick={() => setFlamear(v => !v)}
                            className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-colors ${
                                flamear
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                            }`}
                        >
                            <span className={`w-8 h-4 rounded-full relative transition-colors ${flamear ? 'bg-emerald-500' : 'bg-zinc-600'}`}>
                                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${flamear ? 'left-4' : 'left-0.5'}`} />
                            </span>
                            Flamear
                        </button>
                    </div>
                    )}
                </div>
            </div>,
            document.body
        )}
        </>
    );
};

export default FileUploadZone;
