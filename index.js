const express = require('express');
// const sql = require('mssql/msnodesqlv8'); // Updated
const cors = require('cors');

// const config1 = require('./config1');
// const config2 = require('./config2');
app.use(express.static('public'))
const app = express();
app.use(cors());
app.use(express.json());

// Basic route for testing
app.get('/', (req, res) => {
  res.json("Hi, I am backend");
});

// API endpoint
app.get('/API', async (req, res) => {
  try {
    const pool = await sql.connect(config2);
    const result = await pool.request().query('SELECT * FROM [dbo].[M_EMPL_PERS]');
    res.json(result.recordset);
  } catch (err) {
    console.error('Database connection or query failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { empl_code, empl_pwd } = req.body;
  try {
    const pool = await sql.connect(config1);
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('empl_pwd', sql.VarChar, empl_pwd)
      .query('SELECT * FROM [dbo].[USER_PASSWORD] WHERE [empl_code] = @empl_code AND [empl_pwd] = @empl_pwd');
    if (result.recordset.length > 0) {
      res.status(200).json({ message: 'Login successful', user: result.recordset[0] });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    sql.close();
  }
});



// Set the port and start the server
const port = process.env.PORT || 3000;
 // Use environment variable or default to 3000
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
