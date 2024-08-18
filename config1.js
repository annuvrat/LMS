const config1 = {
  user: 'sa',
  password: 'annuvrat',
  server: 'ANNUVRAT',
  database: 'LeaveAnalysisDashboard',
  options: {
    instanceName: 'SQLEXPRESS',
    trustedServerCertificate: true,
    enableArithAbort: true,
    trustedConnection: false,
  },
  port: 1433 // Default port for SQL Server
};

module.exports = config1;
