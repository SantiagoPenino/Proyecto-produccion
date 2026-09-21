'use strict';
// Baja a un temporal el archivo de un pedido ingresado por sistema.
//  · Enlace de Google Drive → por la API autenticada (driveService), igual que el resto del sistema.
//  · Cualquier otro enlace → solo https, nunca a direcciones internas de la red, con tope de tamaño y de tiempo.
const fs = require('fs');
const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');

const MAX_BYTES = (parseInt(process.env.PEDIDOS_EXTERNOS_MAX_MB, 10) || 500) * 1024 * 1024;
const TIMEOUT_MS = 5 * 60 * 1000;

const idDeDrive = (url) => (/drive\.google\.com|docs\.google\.com/i.test(String(url)) ? (String(url).match(/(?:id=|\/d\/)([\w-]+)/) || [])[1] : null);

// Direcciones a las que un enlace externo NO puede apuntar: el propio servidor y la red interna.
function esIpPrivada(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && esIpPrivada(v.replace('::ffff:', ''));
  }
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function exigirEnlacePublico(url) {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error(`El enlace no es válido: ${url}`); }
  if (u.protocol !== 'https:') throw new Error(`Solo se aceptan enlaces https: ${url}`);
  const dirs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
  if (!dirs.length || dirs.some(d => esIpPrivada(d.address))) throw new Error(`El enlace apunta a una dirección interna y no se puede bajar: ${u.hostname}`);
}

function aDisco(stream, destino) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const w = fs.createWriteStream(destino);
    stream.on('data', (c) => { bytes += c.length; if (bytes > MAX_BYTES) { stream.destroy(new Error(`El archivo supera el máximo de ${Math.round(MAX_BYTES / 1048576)} MB.`)); } });
    stream.on('error', reject); w.on('error', reject); w.on('finish', () => resolve(bytes));
    stream.pipe(w);
  });
}

/** @returns {Promise<{mime: string}>} */
async function bajar(url, destino) {
  const fileId = idDeDrive(url);
  if (fileId) {
    const { stream, mimeType } = await require('../driveService').getFileStream(fileId);
    await aDisco(stream, destino);
    return { mime: mimeType || '' };
  }
  await exigirEnlacePublico(url);
  const r = await axios({ url, method: 'GET', responseType: 'stream', timeout: TIMEOUT_MS, maxRedirects: 0, validateStatus: s => s === 200 });
  await aDisco(r.data, destino);
  return { mime: String(r.headers['content-type'] || '') };
}

module.exports = { bajar };
