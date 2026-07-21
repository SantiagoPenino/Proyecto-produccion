'use strict';
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { resolverLineasDesdeMotor, generarAsientoCompleto } = require('../services/contabilidadCore');

exports.getBancos = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM TesoreriaBancos WHERE Activo = 1 ORDER BY NombreBanco');
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('Error getBancos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getCheques = async (req, res) => {
  try {
    const { estado, tipo } = req.query;
    const pool = await getPool();
    let query = `
      SELECT c.*, b.NombreBanco 
      FROM TesoreriaCheques c 
      JOIN TesoreriaBancos b ON c.IdBanco = b.IdBanco
      WHERE 1=1
    `;
    const request = pool.request();
    if (estado) {
      query += ` AND c.Estado = @estado`;
      request.input('estado', sql.VarChar, estado);
    }
    if (tipo) {
      query += ` AND c.Tipo = @tipo`;
      request.input('tipo', sql.VarChar, tipo);
    }
    query += ` ORDER BY c.FechaRegistro DESC`;
    
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    logger.error('Error getCheques:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.recibirCheque = async (req, res) => {
  const {
    NumeroCheque, IdBanco, Monto, FechaEmision, FechaVencimiento, IdClienteOrigen,
    Agencia, EmitidoPor, EndosadoPor, EsPagoParcial, CategoriaPropiedad, ClasificacionPlazo, RubroContableId,
    // false cuando el cheque se está dando de alta DESDE UN COBRO DE CAJA: ese cobro
    // genera su propio asiento (Valores a Depositar / Deudores). Si acá generáramos otro,
    // el mismo cheque se contabilizaría dos veces y la deuda del cliente se cancelaría doble.
    contabilizar = true,
    // El usuario ya confirmó que quiere cargar un cheque repetido.
    confirmarDuplicado = false,
  } = req.body;
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();
    const reqTx = transaction.request();

    // ── Duplicado: el mismo cheque cargado dos veces duplica el saldo en cartera y,
    // si se contabiliza, cancela deuda que el cliente no pagó. No hay UNIQUE que lo frene.
    const dupRes = await reqTx
      .input('DupNum', sql.VarChar(50), NumeroCheque)
      .input('DupBco', sql.Int, IdBanco)
      .query(`
        SELECT TOP 1 IdCheque, Monto, Estado, CONVERT(varchar(10), FechaVencimiento, 23) AS Vto
        FROM dbo.TesoreriaCheques WITH(UPDLOCK, HOLDLOCK)
        WHERE NumeroCheque = @DupNum AND IdBanco = @DupBco AND Tipo = 'TERCERO'
        ORDER BY IdCheque DESC
      `);
    if (dupRes.recordset.length && confirmarDuplicado !== true) {
      await transaction.rollback();
      const d = dupRes.recordset[0];
      return res.status(409).json({
        success: false,
        error: 'CHEQUE_DUPLICADO',
        requiereConfirmacion: true,
        existente: d,
        mensaje: `Ya hay un cheque N° ${NumeroCheque} de este banco cargado (${Number(d.Monto).toFixed(2)}, vto ${d.Vto}, ${d.Estado}). `
               + 'Si lo cargás de nuevo vas a tener el mismo cheque dos veces en cartera.'
      });
    }

    const insertRes = await reqTx
      .input('Num', sql.VarChar, NumeroCheque)
      .input('Bco', sql.Int, IdBanco)
      .input('Monto', sql.Decimal(18,2), Monto)
      .input('Fem', sql.Date, FechaEmision)
      .input('Fve', sql.Date, FechaVencimiento)
      .input('Cli', sql.Int, IdClienteOrigen || null)
      .input('Agencia', sql.VarChar, Agencia || null)
      .input('EmitidoPor', sql.VarChar, EmitidoPor || null)
      .input('EndosadoPor', sql.VarChar, EndosadoPor || null)
      .input('EsPagoParcial', sql.Bit, EsPagoParcial ? 1 : 0)
      .input('CatProp', sql.VarChar, CategoriaPropiedad || 'Tercero')
      .input('ClasPlazo', sql.VarChar, ClasificacionPlazo || 'Común')
      .input('Rubro', sql.Int, RubroContableId || null)
      .query(`
        INSERT INTO TesoreriaCheques (
          Tipo, NumeroCheque, IdBanco, Monto, IdMoneda, FechaEmision, FechaVencimiento, 
          Estado, IdClienteOrigen, Agencia, EmitidoPor, EndosadoPor, EsPagoParcial, 
          CategoriaPropiedad, ClasificacionPlazo, RubroContableId
        )
        OUTPUT INSERTED.IdCheque
        VALUES (
          'TERCERO', @Num, @Bco, @Monto, 1, @Fem, @Fve, 
          'EN_CARTERA', @Cli, @Agencia, @EmitidoPor, @EndosadoPor, @EsPagoParcial, 
          @CatProp, @ClasPlazo, @Rubro
        )
      `);
      
    const IdCheque = insertRes.recordset[0].IdCheque;

    // Asiento contable — se saltea si el cobro de caja ya lo va a contabilizar.
    if (contabilizar !== false) {
      const lineas = await resolverLineasDesdeMotor('TES_CHEQUE_REC', {
        totalNeto: Monto,
        clienteId: IdClienteOrigen
      });

      if (lineas.length > 0) {
        await generarAsientoCompleto({
          concepto: `Recepción Cheque Tercero #${NumeroCheque}`,
          usuarioId: req.user?.id || 1,
          origen: 'TESORERIA',
          lineas
        }, transaction);
      }
    } else {
      logger.info(`[TESORERIA] Cheque #${NumeroCheque} dado de alta desde caja — el asiento lo genera el cobro, acá no se duplica.`);
    }

    await transaction.commit();
    res.json({
      success: true,
      message: contabilizar !== false ? 'Cheque recibido y contabilizado' : 'Cheque registrado en cartera',
      data: { IdCheque }
    });
  } catch (err) {
    await transaction.rollback();
    logger.error('Error recibirCheque:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.emitirCheque = async (req, res) => {
  const { NumeroCheque, IdBanco, Monto, FechaEmision, FechaVencimiento, IdProveedorDestino } = req.body;
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  
  try {
    await transaction.begin();
    const reqTx = transaction.request();
    
    const insertRes = await reqTx
      .input('Num', sql.VarChar, NumeroCheque)
      .input('Bco', sql.Int, IdBanco)
      .input('Monto', sql.Decimal(18,2), Monto)
      .input('Fem', sql.Date, FechaEmision)
      .input('Fve', sql.Date, FechaVencimiento)
      .input('Prov', sql.Int, IdProveedorDestino || null)
      .query(`
        INSERT INTO TesoreriaCheques (Tipo, NumeroCheque, IdBanco, Monto, IdMoneda, FechaEmision, FechaVencimiento, Estado, IdProveedorDestino)
        OUTPUT INSERTED.IdCheque
        VALUES ('PROPIO', @Num, @Bco, @Monto, 1, @Fem, @Fve, 'EMITIDO', @Prov)
      `);
      
    const IdCheque = insertRes.recordset[0].IdCheque;

    // Asiento contable
    const lineas = await resolverLineasDesdeMotor('TES_CHEQUE_EMI', { 
      totalNeto: Monto 
    });
    
    if (lineas.length > 0) {
      await generarAsientoCompleto({
        concepto: `Emisión Cheque Propio #${NumeroCheque}`,
        usuarioId: req.user?.id || 1,
        origen: 'TESORERIA',
        lineas
      }, transaction);
    }

    await transaction.commit();
    res.json({ success: true, message: 'Cheque emitido y contabilizado', data: { IdCheque } });
  } catch (err) {
    await transaction.rollback();
    logger.error('Error emitirCheque:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * editarCheque — PUT /tesoreria/cheques/:id
 * Edita los datos de un cheque que está en cartera (o emitido). Sirve sobre todo
 * para completar datos que quedaron sin cargar — el cliente que lo depositó, el
 * librador, la agencia — sin tener que anular y recargar.
 *
 * NO toca el IMPORTE ni el ESTADO ni el TIPO:
 *  - El importe define el asiento contable ya generado; cambiarlo acá lo desalinearía
 *    en silencio. Si el monto está mal es OTRO cheque → anular y recargar.
 *  - El estado se maneja con las acciones (Depositar/Endosar/…), no editándolo a mano.
 * Solo se puede editar mientras el cheque sigue vivo (EN_CARTERA o EMITIDO).
 */
exports.editarCheque = async (req, res) => {
  const { id } = req.params;
  const {
    NumeroCheque, IdBanco, FechaEmision, FechaVencimiento,
    IdClienteOrigen, EmitidoPor, EndosadoPor, Agencia,
    ClasificacionPlazo, RubroContableId, Notas
  } = req.body;
  const pool = await getPool();

  try {
    const chqRes = await pool.request()
      .input('Id', sql.Int, id)
      .query(`SELECT Estado FROM dbo.TesoreriaCheques WHERE IdCheque = @Id`);
    if (!chqRes.recordset.length) return res.status(404).json({ success: false, error: 'Cheque no encontrado' });

    const estado = chqRes.recordset[0].Estado;
    if (estado !== 'EN_CARTERA' && estado !== 'EMITIDO') {
      return res.status(400).json({
        success: false,
        error: `Solo se puede editar un cheque en cartera o emitido. Este está ${estado}.`
      });
    }

    if (!NumeroCheque || !IdBanco) {
      return res.status(400).json({ success: false, error: 'El número de cheque y el banco son obligatorios.' });
    }

    await pool.request()
      .input('Id',       sql.Int,          id)
      .input('Num',      sql.VarChar(50),  NumeroCheque)
      .input('Bco',      sql.Int,          IdBanco)
      .input('Fem',      sql.Date,         FechaEmision || null)
      .input('Fve',      sql.Date,         FechaVencimiento || null)
      .input('Cli',      sql.Int,          IdClienteOrigen || null)
      .input('EmitPor',  sql.VarChar(200), EmitidoPor || null)
      .input('EndPor',   sql.VarChar(200), EndosadoPor || null)
      .input('Agencia',  sql.VarChar(200), Agencia || null)
      .input('ClasPlazo',sql.VarChar(50),  ClasificacionPlazo || null)
      .input('Rubro',    sql.Int,          RubroContableId || null)
      .input('Notas',    sql.VarChar(500), Notas || null)
      .query(`
        UPDATE dbo.TesoreriaCheques
        SET NumeroCheque = @Num,
            IdBanco = @Bco,
            FechaEmision = ISNULL(@Fem, FechaEmision),
            FechaVencimiento = ISNULL(@Fve, FechaVencimiento),
            IdClienteOrigen = @Cli,
            EmitidoPor = @EmitPor,
            EndosadoPor = @EndPor,
            Agencia = @Agencia,
            ClasificacionPlazo = @ClasPlazo,
            RubroContableId = @Rubro,
            Notas = @Notas
        WHERE IdCheque = @Id
      `);

    logger.info(`[TESORERIA] Cheque #${id} editado (usuario ${req.user?.id || '?'}).`);
    res.json({ success: true, message: 'Cheque actualizado' });
  } catch (err) {
    logger.error('Error editarCheque:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * anularCheque — DELETE /tesoreria/cheques/:id
 * Da de baja un cheque cargado por error y REVIERTE su asiento contable.
 *
 * No borra la fila: la marca ANULADO. Un cheque es un papel que existió; borrarlo
 * dejaría el asiento colgado sin nada que lo explique. Queda fuera de la cartera y
 * del historial activo, con el motivo escrito.
 *
 * Se bloquea si el cheque está vinculado a un cobro (Pagos.PagIdCheque): ahí hay que
 * revertir el cobro primero, no el cheque.
 */
exports.anularCheque = async (req, res) => {
  const { id } = req.params;
  const { Motivo } = req.body || {};
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const chqRes = await new sql.Request(transaction)
      .input('Id', sql.Int, id)
      .query(`SELECT * FROM dbo.TesoreriaCheques WHERE IdCheque = @Id`);
    if (!chqRes.recordset.length) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Cheque no encontrado' });
    }
    const cheque = chqRes.recordset[0];

    if (cheque.Estado === 'ANULADO') {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'El cheque ya está anulado.' });
    }

    // ¿Está vinculado a un cobro? Anularlo dejaría el pago apuntando a un cheque muerto.
    const pagoRes = await new sql.Request(transaction)
      .input('Id', sql.Int, id)
      .query(`
        SELECT TOP 1 p.PagIdPago, p.PagTcaIdTransaccion, p.PagMontoPago
        FROM dbo.Pagos p WHERE p.PagIdCheque = @Id
      `);
    if (pagoRes.recordset.length) {
      await transaction.rollback();
      const p = pagoRes.recordset[0];
      return res.status(409).json({
        success: false,
        error: 'CHEQUE_CON_COBRO',
        mensaje: `Este cheque está vinculado a un cobro (transacción ${p.PagTcaIdTransaccion}, ${Number(p.PagMontoPago).toFixed(2)}). `
               + 'Para darlo de baja hay que anular ese cobro primero.'
      });
    }

    await new sql.Request(transaction)
      .input('Id', sql.Int, id)
      .input('Notas', sql.VarChar(500), `ANULADO: ${Motivo || 'sin motivo'} (usuario ${req.user?.id || '?'})`)
      .query(`
        UPDATE dbo.TesoreriaCheques
        SET Estado = 'ANULADO', Notas = LEFT(ISNULL(Notas + ' | ', '') + @Notas, 500)
        WHERE IdCheque = @Id
      `);

    // ── Reversa del asiento ────────────────────────────────────────────────
    // Se busca el asiento original del cheque y se genera su contrapartida (mismas
    // cuentas, debe y haber invertidos). No se borra el original: la contabilidad no
    // se corrige borrando, se corrige con un asiento que la neutraliza.
    const asiRes = await new sql.Request(transaction)
      .input('Concepto', sql.NVarChar(200), `%#${cheque.NumeroCheque}%`)
      .query(`
        SELECT TOP 1 a.AsiId
        FROM dbo.Cont_AsientosCabecera a
        WHERE a.SysOrigen = 'TESORERIA' AND a.AsiConcepto LIKE @Concepto
          AND a.AsiConcepto NOT LIKE '%ANULACI%'
        ORDER BY a.AsiId DESC
      `);

    if (asiRes.recordset.length) {
      const asiId = asiRes.recordset[0].AsiId;
      const detRes = await new sql.Request(transaction)
        .input('AsiId', sql.Int, asiId)
        .query(`
          SELECT pc.CueCodigo, d.DetDebeUYU, d.DetHaberUYU, d.DetMonedaId, d.DetCotizacion,
                 d.DetEntidadId, d.DetEntidadTipo
          FROM dbo.Cont_AsientosDetalle d
          JOIN dbo.Cont_PlanCuentas pc ON pc.CueId = d.CueId
          WHERE d.AsiId = @AsiId
        `);

      // Debe ↔ Haber invertidos
      const lineasReversa = detRes.recordset.map(d => ({
        codigoCuenta: d.CueCodigo,
        debeBase:  Number(d.DetHaberUYU) || 0,
        haberBase: Number(d.DetDebeUYU)  || 0,
        monedaId:   d.DetMonedaId || 1,
        cotizacion: Number(d.DetCotizacion) || 1,
        entidadId:  d.DetEntidadId || null,
        entidadTipo: d.DetEntidadTipo || null,
      })).filter(l => l.debeBase > 0 || l.haberBase > 0);

      if (lineasReversa.length >= 2) {
        await generarAsientoCompleto({
          concepto: `ANULACIÓN Cheque #${cheque.NumeroCheque} (reversa asiento ${asiId})`,
          usuarioId: req.user?.id || 1,
          origen: 'TESORERIA',
          lineas: lineasReversa
        }, transaction);
        logger.info(`[TESORERIA] Cheque #${cheque.NumeroCheque} anulado — asiento ${asiId} revertido.`);
      } else {
        logger.warn(`[TESORERIA] Cheque #${cheque.NumeroCheque}: el asiento ${asiId} no tiene líneas reversibles.`);
      }
    } else {
      logger.warn(`[TESORERIA] Cheque #${cheque.NumeroCheque} anulado sin asiento que revertir (no se encontró el original).`);
    }

    await transaction.commit();
    res.json({ success: true, message: `Cheque #${cheque.NumeroCheque} anulado y asiento revertido` });
  } catch (err) {
    await transaction.rollback();
    logger.error('Error anularCheque:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.cambiarEstadoCheque = async (req, res) => {
  const { id } = req.params;
  const { Estado, Notas } = req.body;
  
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  
  try {
    await transaction.begin();
    const reqTx = transaction.request();
    
    const chq = await reqTx.input('Id', sql.Int, id).query(`SELECT * FROM TesoreriaCheques WHERE IdCheque = @Id`);
    if (chq.recordset.length === 0) throw new Error('Cheque no encontrado');
    const cheque = chq.recordset[0];

    // La columna Estado es un varchar sin CHECK: sin esto acepta cualquier cosa y deja
    // el cheque en un estado que ninguna pantalla sabe mostrar.
    const TRANSICIONES = {
      EN_CARTERA: ['DEPOSITADO', 'ENDOSADO', 'RECHAZADO'],
      EMITIDO:    ['COBRADO', 'RECHAZADO'],
      DEPOSITADO: ['RECHAZADO'],   // el banco lo puede rebotar después de depositado
      ENDOSADO:   ['RECHAZADO'],
    };
    const permitidos = TRANSICIONES[cheque.Estado] || [];
    if (!permitidos.includes(Estado)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: `No se puede pasar un cheque de ${cheque.Estado} a ${Estado}.`
             + (permitidos.length ? ` Desde ${cheque.Estado} solo se puede: ${permitidos.join(', ')}.`
                                  : ` ${cheque.Estado} es un estado final.`)
      });
    }

    await reqTx
      .input('Estado', sql.VarChar, Estado)
      .input('Notas', sql.VarChar, Notas || null)
      .query(`UPDATE TesoreriaCheques SET Estado = @Estado, Notas = ISNULL(@Notas, Notas) WHERE IdCheque = @Id`);

    // Asiento según el nuevo estado
    let evtCodigo = null;
    if (Estado === 'DEPOSITADO' && cheque.Tipo === 'TERCERO') evtCodigo = 'TES_CHEQUE_DEP';
    if (Estado === 'ENDOSADO' && cheque.Tipo === 'TERCERO') evtCodigo = 'TES_CHEQUE_END';
    if (Estado === 'RECHAZADO' && cheque.Tipo === 'TERCERO') evtCodigo = 'TES_CHEQUE_REB';
    if (Estado === 'COBRADO' && cheque.Tipo === 'PROPIO') evtCodigo = 'TES_CHEQUE_COB';
    
    if (evtCodigo) {
      const lineas = await resolverLineasDesdeMotor(evtCodigo, { totalNeto: cheque.Monto });
      if (lineas.length > 0) {
        await generarAsientoCompleto({
          concepto: `Cambio Estado Cheque #${cheque.NumeroCheque} -> ${Estado}`,
          usuarioId: req.user?.id || 1,
          origen: 'TESORERIA',
          lineas
        }, transaction);
      }
    }

    await transaction.commit();
    res.json({ success: true, message: `Cheque actualizado a ${Estado}` });
  } catch (err) {
    await transaction.rollback();
    logger.error('Error cambiarEstado:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
