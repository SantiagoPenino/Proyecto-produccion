// Código único de cuenta de cliente — se FORMA solo, no se guarda en la base:
//   Plata:    CTA-USD-2338  /  CTA-UYU-2337   (tipo CTA + moneda + id interno)
//   Recursos: REC-109                          (bolsa de material, unidad mts u otra)
// El id interno (CueIdCuenta) es único e inmutable, así que el código también.
// Acepta tanto las filas crudas de CuentasCliente/getSaldoCliente (CueTipo,
// MonIdMoneda, MonSimbolo, ProIdProducto) como las del portal ({ moneda: 'USD'|'UYU' }).

const TIPOS_MONETARIOS = ['USD', 'UYU', 'ARS', 'EUR', 'PYG', 'BRL', 'CORRIENTE', 'CREDITO', 'DEBITO', 'CAJA', 'DINERO_USD', 'DINERO_UYU'];

export const codigoCuenta = (c) => {
  if (!c || c.CueIdCuenta == null) return '';
  const tipo = String(c.CueTipo || '').toUpperCase();
  const esRecurso = c.ProIdProducto != null || (tipo !== '' && !TIPOS_MONETARIOS.includes(tipo));
  if (esRecurso) return `REC-${c.CueIdCuenta}`;
  const esUSD = tipo.includes('USD') || Number(c.MonIdMoneda) === 2 || c.MonSimbolo === 'US$' || c.moneda === 'USD';
  return `CTA-${esUSD ? 'USD' : 'UYU'}-${c.CueIdCuenta}`;
};

export default codigoCuenta;
