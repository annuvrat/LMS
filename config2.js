require('dotenv').config();

const config2 = {
  user: process.env.sa,
  password: process.env.annuvrat,
  server: process.env.ANNUVRAT,
  database: process.env.DHN_MASTER,
  options: {
    instanceName: 'SQLEXPRESS',
    trustedServerCertificate: true,
    enableArithAbort: true,
    trustedConnection: false,
  },
  port: 1433 // Default port for SQL Server
};

module.exports = config2;
