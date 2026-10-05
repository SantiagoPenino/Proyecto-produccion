'use strict';
// TIZADA PRO → nosotros: aviso firmado cuando un pedido termina (listo / rechazado / error).
// POST /api/integracion/tizadapro/aviso  — sin JWT: lo autentica la FIRMA (X-Tizada-Firma, HMAC con la llave).
// Necesita el cuerpo CRUDO para comprobar la firma: por eso se monta en server.js ANTES de express.json().
const express = require('express');
const router = express.Router();
const tz = require('../services/solicitudesVendedorTizadaPro');

router.post('/aviso', express.raw({ type: '*/*', limit: '20mb' }), tz.recibirAviso);
// Para comprobar desde afuera que la dirección llega (no pide llave, no devuelve datos)
router.get('/aviso', (req, res) => res.json({ ok: true, servicio: 'aviso de TIZADA PRO', activo: process.env.TIZADAPRO_AVISO_ACTIVO !== '0' }));

// Si TIZADA no puede llamarnos: preguntamos nosotros cada TIZADAPRO_SONDEO_SEGUNDOS
tz.iniciarSondeo();

module.exports = router;
