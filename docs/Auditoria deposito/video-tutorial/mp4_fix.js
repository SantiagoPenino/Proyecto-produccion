// Arregla la duración de un MP4 fragmentado (salida de MediaRecorder): suma los trun de todos los moof,
// escribe la duración real en mvhd / tkhd / mdhd e inserta un mehd en mvex. No recodifica: copia los fragmentos tal cual
// (los tfhd usan default-base-is-moof, así que cambiar el tamaño del moov no rompe offsets).
const fs = require('fs');

function fixDuration(inPath, outPath) {
  const fd = fs.openSync(inPath, 'r'); const size = fs.fstatSync(fd).size;
  const rd = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
  const boxes = (pos, end) => { const out = []; while (pos + 8 <= end) { const h = rd(pos, 16); let sz = h.readUInt32BE(0); const type = h.toString('latin1', 4, 8); let hdr = 8; if (sz === 1) { sz = Number(h.readBigUInt64BE(8)); hdr = 16; } if (sz < 8) break; out.push({ type, pos, size: sz, hdr }); pos += sz; } return out; };
  const top = boxes(0, size);
  const moov = top.find(b => b.type === 'moov'); if (!moov) throw new Error('sin moov');
  const moofs = top.filter(b => b.type === 'moof');
  // duración real por track (en la escala de tiempo de cada track)
  const durTrack = {};
  for (const mf of moofs) for (const traf of boxes(mf.pos + mf.hdr, mf.pos + mf.size).filter(b => b.type === 'traf')) {
    const tk = boxes(traf.pos + traf.hdr, traf.pos + traf.size);
    const tfhdB = tk.find(b => b.type === 'tfhd'); const tfhd = rd(tfhdB.pos, tfhdB.size); const tflags = tfhd.readUInt32BE(8) & 0xffffff; const track = tfhd.readUInt32BE(12);
    let p = 16; if (tflags & 1) p += 8; if (tflags & 2) p += 4; let defDur = 0; if (tflags & 8) defDur = tfhd.readUInt32BE(p);
    for (const tr of tk.filter(b => b.type === 'trun')) {
      const b = rd(tr.pos, tr.size); const flags = b.readUInt32BE(8) & 0xffffff; const n = b.readUInt32BE(12); let q = 16; if (flags & 1) q += 4; if (flags & 4) q += 4;
      const per = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
      let d = 0; for (let i = 0; i < n; i++) { d += (flags & 0x100) ? b.readUInt32BE(q) : defDur; q += per; }
      durTrack[track] = (durTrack[track] || 0) + d;
    }
  }
  // moov en memoria
  const mb = rd(moov.pos, moov.size);
  const kidsOf = (buf, from, to) => { const out = []; let p = from; while (p + 8 <= to) { let sz = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8); let hdr = 8; if (sz === 1) { sz = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } if (sz < 8) break; out.push({ type, pos: p, size: sz, hdr }); p += sz; } return out; };
  const kids = kidsOf(mb, moov.hdr, mb.length);
  const mvhd = kids.find(b => b.type === 'mvhd'); const mv = mvhd.pos; const v = mb[mv + 8];
  const movieTs = v === 1 ? mb.readUInt32BE(mv + 28) : mb.readUInt32BE(mv + 20);
  // segundos por track (timescale del mdhd) y máximo
  const seg = {};
  for (const t of kids.filter(b => b.type === 'trak')) {
    const tk = kidsOf(mb, t.pos + t.hdr, t.pos + t.size); const tkhd = tk.find(b => b.type === 'tkhd'); const mdia = tk.find(b => b.type === 'mdia'); const md = kidsOf(mb, mdia.pos + mdia.hdr, mdia.pos + mdia.size); const mdhd = md.find(b => b.type === 'mdhd');
    const tv = mb[tkhd.pos + 8]; const trackId = tv === 1 ? mb.readUInt32BE(tkhd.pos + 28) : mb.readUInt32BE(tkhd.pos + 20);
    const mvv = mb[mdhd.pos + 8]; const mts = mvv === 1 ? mb.readUInt32BE(mdhd.pos + 28) : mb.readUInt32BE(mdhd.pos + 20);
    const d = durTrack[trackId] || 0; seg[trackId] = d / mts;
    // mdhd.duration
    if (mvv === 1) mb.writeBigUInt64BE(BigInt(d), mdhd.pos + 32); else mb.writeUInt32BE(Math.min(d, 0xffffffff), mdhd.pos + 24);
    // tkhd.duration (escala de la película)
    const dm = Math.round(seg[trackId] * movieTs);
    if (tv === 1) mb.writeBigUInt64BE(BigInt(dm), tkhd.pos + 36); else mb.writeUInt32BE(Math.min(dm, 0xffffffff), tkhd.pos + 28);
  }
  const maxSeg = Math.max(...Object.values(seg)); const durMovie = Math.round(maxSeg * movieTs);
  if (v === 1) mb.writeBigUInt64BE(BigInt(durMovie), mv + 32); else mb.writeUInt32BE(durMovie, mv + 24);
  // mvex con mehd (v1) al principio
  const mvex = kids.find(b => b.type === 'mvex'); if (!mvex) throw new Error('sin mvex');
  const mehd = Buffer.alloc(20); mehd.writeUInt32BE(20, 0); mehd.write('mehd', 4, 'latin1'); mehd[8] = 1; mehd.writeBigUInt64BE(BigInt(durMovie), 12);
  const mvexKids = mb.subarray(mvex.pos + mvex.hdr, mvex.pos + mvex.size).filter ? mb.subarray(mvex.pos + mvex.hdr, mvex.pos + mvex.size) : null;
  const yaTieneMehd = kidsOf(mb, mvex.pos + mvex.hdr, mvex.pos + mvex.size).some(b => b.type === 'mehd');
  const mvexNuevo = yaTieneMehd ? mb.subarray(mvex.pos, mvex.pos + mvex.size) : Buffer.concat([Buffer.alloc(8), mehd, mvexKids]);
  if (!yaTieneMehd) { mvexNuevo.writeUInt32BE(mvexNuevo.length, 0); mvexNuevo.write('mvex', 4, 'latin1'); }
  const antes = mb.subarray(0, mvex.pos), despues = mb.subarray(mvex.pos + mvex.size);
  const moovNuevo = Buffer.concat([antes, mvexNuevo, despues]); moovNuevo.writeUInt32BE(moovNuevo.length, 0);
  // escribir: [todo antes del moov] + moovNuevo + [todo después del moov]
  const out = fs.openSync(outPath, 'w');
  const copiar = (from, to) => { const CH = 8 * 1024 * 1024; let p = from; while (p < to) { const n = Math.min(CH, to - p); fs.writeSync(out, rd(p, n)); p += n; } };
  copiar(0, moov.pos); fs.writeSync(out, moovNuevo); copiar(moov.pos + moov.size, size);
  fs.closeSync(out); fs.closeSync(fd);
  return { segundos: maxSeg, porTrack: seg, fragmentos: moofs.length, moovAntes: moov.size, moovDespues: moovNuevo.length };
}
module.exports = { fixDuration };
if (require.main === module) { const r = fixDuration(process.argv[2], process.argv[3]); console.log(JSON.stringify(r)); }
