
/**
 * Utility to print standard 4x6 labels consistent across the application.
 * Used by Production Control and Logistics.
 */

export const printLabels = (labels) => {
    if (!labels || labels.length === 0) {
        alert("No labels provided to print.");
        return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Pop-up blocker prevented printing. Please enable pop-ups.");
        return;
    }

    const labelsHtml = labels.map(l => {
        // Normalize Data
        // l can come from DB (Logistics) or Frontend State (Control)
        // Expected Structure:
        // { 
        //   qrCode: string (raw content), 
        //   orderCode: string, 
        //   client: string, 
        //   job: string (material/description), 
        //   area: string, 
        //   bultoIndex: number, 
        //   totalBultos: number, 
        //   date: string (optional),
        //   services: array (optional) 
        // }

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(l.qrCode)}`;

        // Clean Codes
        const displayCode = l.orderCode ? l.orderCode.toString().split('(')[0].trim() : '---';
        const bultoStr = `(${l.bultoIndex}/${l.totalBultos})`;
        const client = l.client || 'Sin Cliente';
        const job = l.job || 'Sin Descripción';
        const area = l.area || 'GEN';
        const genDate = l.date || new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Services List Render
        // Deduplicate services
        const uniqueServices = [];
        const seenAreas = new Set();
        (l.services || [{ area: area, status: 'ACTUAL' }]).forEach(s => {
            const key = s.area || s.AreaID;
            if (!seenAreas.has(key)) {
                seenAreas.add(key);
                uniqueServices.push(s);
            }
        });

        const servicesHtml = uniqueServices.map(s => {
            // Simple check mark logic
            const sArea = s.area || s.AreaID || 'GEN';
            const isDone = ['PRONTO', 'FINALIZADO', 'OK', 'AGREGADO'].includes((s.status || '').toUpperCase()) || sArea === area;
            const icon = isDone ? '&#10004;' : '&minus;';
            return `<li style="list-style:none; margin-bottom:5px; font-weight:bold; font-size:14px;"><span style="display:inline-block; width:20px; font-weight:bold;">${icon}</span> ${sArea}</li>`;
        }).join('');

        // Determine title for display (avoid JSON dump)
        let displayTitle = l.qrCode;
        if (displayTitle && (displayTitle.startsWith('{') || displayTitle.length > 25)) {
            // Fallback to ID if present in extra data, or just generic
            displayTitle = l.displayTitle || `BULTO ${l.bultoIndex}`;
        }

        return `
        <div class="label-container">
          
          <!-- HEADER -->
          <div class="header">
            <div style="display:flex; justify-content: space-between; align-items: flex-start;">
                <div style="width: 65%;">
                    <div style="font-weight: bold; font-size: 14px;">CLIENTE: ${client.substring(0, 25)}</div>
                    <div style="font-size: 12px; margin-top:4px;">TRABAJO: ${job.substring(0, 35)}</div>
                </div>
                <div style="width: 35%; text-align: right;">
                    <div style="font-weight: bold; font-size: 14px;">ÁREA: ${area}</div>
                    <div style="font-size: 10px; margin-top:4px;">${genDate}</div>
                </div>
            </div>
          </div>

          <!-- BODY -->
          <div class="body">
            
            <!-- LEFT: QR & BULTOS -->
            <div class="left-panel">
                <img src="${qrUrl}" />
                
                <div class="order-code">${l.orderPrefix != null ? l.orderPrefix : 'ORDEN: '}${displayCode}</div>
                <div class="bulto-code">BULTO ${bultoStr}</div>
                <div class="ref-code" style="font-size: 14px; margin-top: 15px;">DESTINO: <strong>${(l.nextService || 'LOGISTICA').toUpperCase()}</strong></div>
                ${l.retiroCode ? `<div class="ref-code" style="font-size: 14px; margin-top: 6px;">RETIRO: <strong>${l.retiroCode}</strong></div>` : ''}
            </div>

            <!-- RIGHT: SERVICES LIST -->
            <div class="right-panel">
                <div class="services-title">ESTADO</div>
                <ul style="padding: 0; margin: 0;">
                    ${servicesHtml}
                </ul>
            </div>

          </div>
        </div>
        `;
    }).join('');

    printWindow.document.write(`
        <html>
          <head>
            <title>Imprimir Etiquetas</title>
            <style>
              @page { size: 4in 6in; margin: 0; }
              body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #fff; }
              
              .label-container { 
                  width: 4in; height: 6in; 
                  padding: 15px; 
                  box-sizing: border-box; 
                  display: flex; flex-direction: column; 
                  page-break-after: always; 
                  position: relative; 
                  overflow: hidden; 
                  border: 2px solid black; /* For visibility in preview */
                  margin: 0;
              }

              .header { border-bottom: 2px solid black; padding: 10px; height: 15%; }
              .body { display: flex; height: 85%; }
              
              .left-panel { 
                  width: 60%; padding: 10px; 
                  text-align: center; 
                  display: flex; flex-direction: column; 
                  justify-content: center; align-items: center; 
              }
              .left-panel img { width: 180px; height: 180px; object-fit: contain; margin-bottom: 10px; }
              .order-code { font-size: 52px; font-weight: 900; line-height: 1; width: 80%; word-break: break-all; }
              .bulto-code { font-size: 24px; font-weight: bold; margin-top: 5px; }
              .ref-code { font-size: 12px; margin-top: 15px; }

              .right-panel { width: 40%; border-left: 2px solid black; padding: 10px; }
              .services-title { font-weight: 900; font-size: 14px; text-transform: uppercase; border-bottom: 1px solid black; padding-bottom: 5px; margin-bottom: 10px; }

              @media print { 
                  body { -webkit-print-color-adjust: exact; } 
                  .label-container { border: none; } /* Remove border on print if preferred, or keep for label bounds */
              }
            </style>
          </head>
          <body>
            ${labelsHtml}
            <script>
               window.onload = function() { setTimeout(() => { window.print(); }, 1000); }
            </script>
          </body>
        </html>
    `);

    printWindow.document.close();
};
