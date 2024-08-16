const express = require('express');
const sql = require('mssql/msnodesqlv8'); // Updated
const cors = require('cors');

const config1 = require('./config1');
const config2 = require('./config2');
// app.use(express.static('public'))
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.post('/register', async (req, res) => {
  const { empl_code, employee_name, empl_pwd, designation } = req.body;

  // Simple validation
  if (!empl_code || !employee_name || !empl_pwd || !designation) {
      return res.status(400).json({ message: 'All fields are required.' });
  }

  try {
      // Connect to the database
      let pool = await sql.connect(config1);

      // Check if the employee already exists
      const checkUserQuery = `
          SELECT * FROM USER_PASSWORD WHERE empl_code = @empl_code
      `;
      let checkUserRequest = pool.request();
      checkUserRequest.input('empl_code', sql.VarChar, empl_code);
      const userResult = await checkUserRequest.query(checkUserQuery);

      if (userResult.recordset.length > 0) {
          return res.status(400).json({ message: 'Employee already exists.' });
      }

      // Insert new employee into the USER_PASSWORD table
      const insertUserQuery = `
          INSERT INTO USER_PASSWORD (empl_code, employee_name, empl_pwd, designation)
          VALUES (@empl_code, @employee_name, @empl_pwd, @designation)
      `;
      let insertUserRequest = pool.request();
      insertUserRequest.input('empl_code', sql.VarChar, empl_code);
      insertUserRequest.input('employee_name', sql.VarChar, employee_name);
      insertUserRequest.input('empl_pwd', sql.VarChar, empl_pwd); // Storing plain text password for now
      insertUserRequest.input('designation', sql.VarChar, designation);

      await insertUserRequest.query(insertUserQuery);

      res.status(201).json({ message: 'Employee registered successfully.' });
  } catch (error) {
      console.error('Error registering employee:', error);
      res.status(500).json({ message: 'Internal server error.' });
  } finally {
      sql.close(); // Close the database connection
  }
});

// Login endpoint
const jwt = require('jsonwebtoken');
const jwtSecret = 'your_jwt_secret'; // Replace with your actual secret key

app.post('/login', async (req, res) => {
  const { empl_code, empl_pwd } = req.body;

  try {
    const pool = await sql.connect(config1);
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('empl_pwd', sql.VarChar, empl_pwd)
      .query('SELECT * FROM [dbo].[USER_PASSWORD] WHERE [empl_code] = @empl_code AND [empl_pwd] = @empl_pwd');

    if (result.recordset.length > 0) {
      const user = result.recordset[0];

      // Generate JWT token
      const token = jwt.sign(
        { empl_code: user.empl_code, designation: user.designation },
        jwtSecret,
        { expiresIn: '1h' }
      );

      // Respond with token and user info
      res.status(200).json({ message: 'Login successful', token, user });
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


const authenticate = async (req, res, next) => {
  const { empl_code, empl_pwd } = req.body;

  if (!empl_code || !empl_pwd) {
    return res.status(400).json({ error: 'Employee code and password are required' });
  }

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('empl_pwd', sql.VarChar, empl_pwd)
      .query('SELECT * FROM [dbo].[USER_PASSWORD] WHERE [EMPL_CODE] = @empl_code AND [EMPL_PWD] = @empl_pwd');
    
    if (result.recordset.length > 0) {
      req.user = result.recordset[0]; // Save user info in the request
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  } catch (err) {
    console.error('Authentication error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    sql.close();
  }
};

// API for leave types
app.get('/leave-types', async (req, res) => {
  try {
    const pool = await sql.connect(config1);
    const result = await pool.request().query('SELECT * FROM LEAVE_TYPE');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching leave types:', err);
    res.status(500).json({ error: 'Failed to fetch leave types' });
  } finally {
    sql.close();
  }
});

// API for submitting leave requests (requires authentication)
app.post('/request-leave', async (req, res) => {
  const { empl_code, leave_type_id, start_date, end_date, reason } = req.body;

  // Check if any required field is missing or empty
  if (
    !empl_code?.trim() ||
    !leave_type_id ||
    !start_date?.trim() ||
    !end_date?.trim() ||
    !reason?.trim()
  ) {
    return res.status(400).json({ error: "All fields are required." });
  }

  // Check if start_date is before end_date
  if (new Date(start_date) > new Date(end_date)) {
    return res.status(400).json({ error: "End date must be after start date." });
  }

  const durationDays = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;

  try {
    const pool = await sql.connect(config1);

    // Check if the leave type exists
    const leaveTypeResult = await pool.request()
      .input('leave_type_id', sql.Int, leave_type_id)
      .query('SELECT [NAME] FROM [dbo].[LEAVE_TYPE] WHERE [ID] = @leave_type_id');

    if (leaveTypeResult.recordset.length === 0) {
      return res.status(400).json({ error: "Invalid leave type ID." });
    }

    const leaveTypeName = leaveTypeResult.recordset[0].NAME;

    // Determine if HR approval is needed based on leave type and duration
    const needsHRApproval = leaveTypeName === 'SL' && durationDays > 3;

    // Insert leave request into the database
    await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('leave_type_id', sql.Int, leave_type_id)
      .input('start_date', sql.Date, start_date)
      .input('end_date', sql.Date, end_date)
      .input('reason', sql.NVarChar, reason)
      .input('status', sql.VarChar,  'Pending' )
      .input('duration', sql.VarChar, `${durationDays} days`)
      .input('approved_by_manager', sql.Bit, false)
      .input('approved_by_hr', sql.Bit, needsHRApproval)
      .query(`
        INSERT INTO [dbo].[LEAVE_REQUEST] 
        ([EMPL_CODE], [LEAVE_TYPE_ID], [START_DATE], [END_DATE], [REASON], [STATUS], [DURATION], [APPROVED_BY_MANAGER], [APPROVED_BY_HR])
        VALUES (@empl_code, @leave_type_id, @start_date, @end_date, @reason, @status, @duration, @approved_by_manager, @approved_by_hr)
      `);

    res.status(201).json({ message: "Leave request submitted successfully." });
  } catch (err) {
    console.error('Error submitting leave request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/approve-leave/:id', async (req, res) => {
  const leaveRequestId = parseInt(req.params.id, 10);
  const { approve_by, manager_name, hr_name } = req.body;

  if (!leaveRequestId || !approve_by) {
    return res.status(400).json({ error: 'Leave request ID and approver role are required.' });
  }

  try {
    const pool = await sql.connect(config1);

    // Retrieve leave request
    const leaveRequestResult = await pool.request()
      .input('id', sql.Int, leaveRequestId)
      .query('SELECT * FROM [dbo].[LEAVE_REQUEST] WHERE [ID] = @id');

    if (leaveRequestResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Leave request not found.' });
    }

    const leaveRequest = leaveRequestResult.recordset[0];
    let updateFields = {};
    
    if (approve_by === 'manager') {
      if (!manager_name) {
        return res.status(400).json({ error: 'Manager name is required.' });
      }

      const managerResult = await pool.request()
        .input('name', sql.NVarChar, manager_name)
        .query('SELECT [id] FROM [dbo].[MANAGER] WHERE [name] = @name');

      if (managerResult.recordset.length === 0) {
        return res.status(400).json({ error: 'Manager not found.' });
      }

      const managerId = managerResult.recordset[0].id;
      updateFields = {
        approved_by_manager: true,
        manager_id: managerId,
        approved_by_manager_name: manager_name
      };
      
    } else if (approve_by === 'hr') {
      if (!hr_name) {
        return res.status(400).json({ error: 'HR name is required.' });
      }

      const hrResult = await pool.request()
        .input('name', sql.NVarChar, hr_name)
        .query('SELECT [id] FROM [dbo].[HR] WHERE [name] = @name');

      if (hrResult.recordset.length === 0) {
        return res.status(400).json({ error: 'HR not found.' });
      }

      const hrId = hrResult.recordset[0].id;
      updateFields = {
        approved_by_hr: true,
        hr_id: hrId,
        approved_by_hr_name: hr_name
      };

    } else {
      return res.status(400).json({ error: 'Invalid approver role.' });
    }

    // Update leave request
    await pool.request()
      .input('id', sql.Int, leaveRequestId)
      .input('status', sql.VarChar, (updateFields.approved_by_manager && updateFields.approved_by_hr) ? 'Approved' : 'Pending')
      .input('approved_by_manager', sql.Bit, updateFields.approved_by_manager || false)
      .input('approved_by_hr', sql.Bit, updateFields.approved_by_hr || false)
      .input('manager_id', sql.Int, updateFields.manager_id || null)
      .input('hr_id', sql.Int, updateFields.hr_id || null)
      .input('approved_by_manager_name', sql.NVarChar, updateFields.approved_by_manager_name || null)
      .input('approved_by_hr_name', sql.NVarChar, updateFields.approved_by_hr_name || null)
      .query(`UPDATE [dbo].[LEAVE_REQUEST]
              SET [STATUS] = @status,
                  [APPROVED_BY_MANAGER] = @approved_by_manager,
                  [APPROVED_BY_HR] = @approved_by_hr,
                  [manager_id] = @manager_id,
                  [hr_id] = @hr_id,
                  [approved_by_manager_name] = @approved_by_manager_name,
                  [approved_by_hr_name] = @approved_by_hr_name
              WHERE [ID] = @id`);

    res.status(200).json({ message: 'Leave request updated successfully.' });
  } catch (err) {
    console.error('Error approving leave request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set the port and start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;
