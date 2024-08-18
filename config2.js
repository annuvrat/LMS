const config2 = {
  user: 'sa',
  password: 'annuvrat',
  server: 'ANNUVRAT',
  database: 'DHN_MASTER',
  options: {
    instanceName: 'SQLEXPRESS',
    trustedServerCertificate: true,
    enableArithAbort: true,
    trustedConnection: false,
  },
  port: 1433 // Default port for SQL Server
};

module.exports = config2;
