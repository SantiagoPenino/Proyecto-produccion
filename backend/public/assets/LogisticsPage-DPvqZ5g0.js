import{j as e}from"./vendor-motion-Cmx6-7-E.js";import{a as l}from"./vendor-react-Cpt8uITe.js";import{u as G,ag as g}from"./index--jJ3GfxL.js";import{l as L}from"./logisticsService-Dbc7SBbW.js";import{C as B}from"./CreateDispatchModal-CuNMUbdr.js";import{F as T,n as c}from"./index-1QMNUyLS.js";import"./vendor-icons-DItzl4kW.js";import"./vendor-ui-yKSdWTrU.js";import"./authService-CZPRAVdp.js";import"./index-CxzcqSCL.js";const X=()=>{const{user:n}=G(),[o,N]=l.useState("INGRESO"),[p,v]=l.useState(""),[r,x]=l.useState([]),[h,w]=l.useState(""),[j,m]=l.useState(!1),[E,u]=l.useState(!1),[C,S]=l.useState([]),[P,R]=l.useState([]),f=l.useRef(null);l.useEffect(()=>{g.get("/areas?productive=true").then(t=>{R(t.data),n&&n.areaId?v(n.areaId):t.data.length>0&&v(t.data[0].Nombre)}).catch(t=>{})},[n]),l.useEffect(()=>{f.current&&f.current.focus()},[r,o]);const I=t=>{if(t.key==="Enter"&&h.trim()){const s=h.trim().toUpperCase();r.find(a=>a.code===s)||O(s),w("")}},O=async t=>{m(!0);try{const a=(await g.post("/logistics/validate-batch",{codes:[t],areaId:p,type:o})).data.results[0];x(d=>[...d,{code:t,isValid:a.isValid,message:a.message,nextService:a.nextService,isNew:a.isNew,id:t,desc:a.entity?.Descripcion||"Sin descripción",client:a.entity?.Cliente||"Cliente General"}]),a.isValid?c.success(`Bulto ${t} agregado.`):c.error(`Alerta en ${t}: ${a.message}`)}catch{c.error("Error validando código")}finally{m(!1)}},A=async()=>{const t=r.filter(s=>s.isValid);if(t.length!==0)if(o==="EGRESO")try{const a=(await Promise.all(t.map(async b=>{try{const i=await L.getBultoByLabel(b.code);return{id:i.BultoID,code:i.CodigoEtiqueta,...i}}catch{return null}}))).filter(Boolean);if(a.length===0){c.error("No se encontraron bultos válidos en sistema WMS para generar remito.");return}S([{id:"MANUAL_SCAN",code:"SELECCIÓN MANUAL",client:"Varios / Manual",mode:"MANUAL",bultos:a}]),u(!0)}catch{c.error("Error preparando datos para remito.")}else confirm(`¿Confirmar recepción de ${t.length} bultos? Esto generará un comprobante.`)&&await D(t)},D=async t=>{m(!0);try{const s={movements:t.map(d=>({orden:d.code,isNew:d.isNew})),areaId:p,type:"INGRESO",usuarioId:n?n.id:1};(await g.post("/logistics/process-batch",s)).data.success&&(c.success("Recepción procesada exitosamente."),k(t,p),x([]))}catch(s){c.error("Error al procesar recepción: "+s.message)}finally{m(!1)}},k=(t,s)=>{const a=new Date().toLocaleString(),d=t[0]?.client||"Consumidor Final",b=`
        <!DOCTYPE html>
        <html>
        <head>
            <title>COMPROBANTE DE RECEPCIÓN</title>
            <style>
                body { font-family: 'Helvetica', sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
                .logo { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
                .info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 14px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                th { background-color: #f4f4f4; }
                .footer { margin-top: 40px; font-size: 10px; text-align: center; border-top: 1px solid #ccc; padding-top: 10px; }
                .signature { margin-top: 50px; display: flex; justify-content: space-between; }
                .sig-box { border-top: 1px solid #000; width: 40%; text-align: center; padding-top: 5px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">MACROSOFT TEXTIL</div>
                <div>Comprobante de Recepción de Mercadería</div>
                <div>Sucursal: ${s}</div>
            </div>

            <div class="info">
                <div>
                    <strong>Fecha:</strong> ${a}<br>
                    <strong>Usuario:</strong> ${n?.usuario||"Sistema"}
                </div>
                <div style="text-align: right;">
                    <strong>Cliente Referencia:</strong> ${d}<br>
                    <strong>Total Bultos:</strong> ${t.length}
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Código / Etiqueta</th>
                        <th>Descripción / Detalle</th>
                        <th>Estado Inicial</th>
                    </tr>
                </thead>
                <tbody>
                    ${t.map((y,$)=>`
                        <tr>
                            <td>${$+1}</td>
                            <td><strong>${y.code}</strong></td>
                            <td>${y.message||"-"}</td>
                            <td>RECIBIDO EN PLANTA</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>

            <div class="signature">
                <div class="sig-box">Firma y Aclaración Cliente</div>
                <div class="sig-box">Firma Responsable Recepción</div>
            </div>

            <div class="footer">
                Este documento certifica la recepción de los bultos detallados para su procesamiento.
                Conserve este comprobante para cualquier reclamo.
            </div>

            <script>window.onload = () => window.print();<\/script>
        </body>
        </html>
        `,i=document.createElement("iframe");i.style.display="none",document.body.appendChild(i),i.contentDocument.write(b),i.contentDocument.close()},M=t=>{x(r.filter((s,a)=>a!==t))};return e.jsxs("div",{className:"p-6 bg-slate-50 min-h-screen font-sans",children:[e.jsx(T,{position:"top-right"}),e.jsxs("div",{className:"bg-[#1e293b] text-white p-6 rounded-2xl shadow-lg mb-8 flex justify-between items-center flex-wrap gap-4",children:[e.jsxs("div",{children:[e.jsxs("h1",{className:"text-2xl font-black flex items-center gap-3",children:[e.jsx("span",{className:"bg-blue-500 p-2 rounded-lg text-white text-lg",children:e.jsx("i",{className:"fa-solid fa-boxes-stacked"})}),"Modulo de Atención"]}),e.jsx("p",{className:"text-slate-400 text-sm font-medium mt-1 ml-1",children:"Ingreso y Egreso de Mercadería"})]}),e.jsxs("div",{className:"flex bg-white/5 rounded-xl p-1 gap-1",children:[e.jsxs("button",{onClick:()=>N("INGRESO"),className:`px-6 py-2 rounded-lg font-bold text-sm transition-all ${o==="INGRESO"?"bg-emerald-500 text-white shadow-lg":"text-slate-400 hover:text-white hover:bg-white/10"}`,children:[e.jsx("i",{className:"fa-solid fa-download mr-2"})," RECEPCIÓN"]}),e.jsxs("button",{onClick:()=>N("EGRESO"),className:`px-6 py-2 rounded-lg font-bold text-sm transition-all ${o==="EGRESO"?"bg-blue-500 text-white shadow-lg":"text-slate-400 hover:text-white hover:bg-white/10"}`,children:[e.jsx("i",{className:"fa-solid fa-upload mr-2"})," DESPACHO"]})]})]}),e.jsxs("div",{className:"flex flex-col md:flex-row gap-6 items-start",children:[e.jsxs("div",{className:"w-full md:w-1/3 bg-white p-6 rounded-2xl shadow-sm border border-slate-200",children:[e.jsx("label",{className:"block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2",children:o==="INGRESO"?"Escanear para Recibir":"Escanear para Despachar"}),e.jsxs("div",{className:"relative mb-4",children:[e.jsx("i",{className:"fa-solid fa-barcode absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl"}),e.jsx("input",{ref:f,type:"text",value:h,onChange:t=>w(t.target.value),onKeyDown:I,placeholder:"Escanear etiqueta...",className:"w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-200 rounded-xl font-mono text-lg font-bold text-slate-800 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none",autoFocus:!0})]}),e.jsxs("div",{className:"text-center p-4 bg-blue-50 rounded-xl border border-blue-100 mb-4",children:[e.jsx("div",{className:"text-blue-800 font-black text-3xl",children:r.length}),e.jsx("div",{className:"text-blue-600 text-[10px] font-bold uppercase tracking-wider",children:"Bultos en Cola"})]}),e.jsxs("div",{className:"flex flex-col gap-2",children:[e.jsxs("button",{onClick:A,disabled:r.length===0||j,className:`w-full py-4 rounded-xl font-bold text-sm shadow-lg active:scale-95 transition-all text-white flex items-center justify-center gap-2
                                ${r.length===0?"bg-slate-300 cursor-not-allowed shadow-none":o==="INGRESO"?"bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200":"bg-blue-500 hover:bg-blue-600 shadow-blue-200"}
                            `,children:[j?e.jsx("i",{className:"fa-solid fa-circle-notch fa-spin"}):o==="INGRESO"?e.jsx("i",{className:"fa-solid fa-print"}):e.jsx("i",{className:"fa-solid fa-truck-fast"}),o==="INGRESO"?"CONFIRMAR Y GENERAR COMPROBANTE":"GENERAR REMITO DE SALIDA"]}),e.jsx("button",{onClick:()=>x([]),disabled:r.length===0,className:"w-full py-3 rounded-xl border border-slate-200 text-slate-500 font-bold text-xs hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors",children:"LIMPIAR TODO"})]})]}),e.jsxs("div",{className:"w-full md:w-2/3 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[500px]",children:[e.jsxs("div",{className:"px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center",children:[e.jsx("span",{className:"text-xs font-black text-slate-500 uppercase tracking-widest",children:"Detalle de items escaneados"}),e.jsx("span",{className:"text-xs font-bold text-slate-400",children:new Date().toLocaleDateString()})]}),e.jsx("div",{className:"flex-1 overflow-auto p-0",children:r.length===0?e.jsxs("div",{className:"h-full flex flex-col items-center justify-center text-slate-300 p-10 opacity-70",children:[e.jsx("i",{className:"fa-solid fa-basket-shopping text-6xl mb-4"}),e.jsx("span",{className:"font-bold text-sm",children:"Esperando lectura de etiquetas..."})]}):e.jsxs("table",{className:"w-full text-left border-collapse",children:[e.jsx("thead",{className:"bg-white sticky top-0 z-10 text-[10px] font-black uppercase text-slate-400",children:e.jsxs("tr",{children:[e.jsx("th",{className:"px-6 py-3 border-b border-slate-100 w-10",children:"#"}),e.jsx("th",{className:"px-6 py-3 border-b border-slate-100",children:"Código"}),e.jsx("th",{className:"px-6 py-3 border-b border-slate-100",children:"Info Sistema"}),e.jsx("th",{className:"px-6 py-3 border-b border-slate-100 w-10"})]})}),e.jsx("tbody",{className:"divide-y divide-slate-50 text-sm",children:r.map((t,s)=>e.jsxs("tr",{className:"hover:bg-slate-50 transition-colors group",children:[e.jsx("td",{className:"px-6 py-3 text-slate-400 font-mono text-xs",children:s+1}),e.jsx("td",{className:"px-6 py-3 font-bold text-slate-700",children:t.code}),e.jsx("td",{className:"px-6 py-3",children:e.jsxs("div",{className:"flex flex-col",children:[e.jsx("span",{className:`text-xs font-bold ${t.isValid?"text-emerald-600":"text-red-500"}`,children:t.message}),t.nextService&&e.jsxs("span",{className:"text-[10px] text-slate-400 mt-0.5",children:["Destino Sugerido: ",t.nextService]})]})}),e.jsx("td",{className:"px-6 py-3 text-right",children:e.jsx("button",{onClick:()=>M(s),className:"w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors",children:e.jsx("i",{className:"fa-solid fa-trash-can"})})})]},s))})]})})]})]}),e.jsx(B,{isOpen:E,onClose:()=>u(!1),selectedOrders:C,originArea:p||n?.areaId||"ATENCION",onSuccess:()=>{x([]),u(!1)}})]})};export{X as default};
