const express = require('express');
const sql = require('mssql/msnodesqlv8'); // Updated
const cors = require('cors');
const jwt = require('jsonwebtoken');

const config1 = require('./config1');
const config2 = require('./config2');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const jwtSecret = 'your_jwt_secret'; 

// Middleware for authenticating JWT tokens
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT verification error:', err);
    res.status(400).json({ message: 'Invalid token.' });
  }
};

// Middleware to authorize employee with various designations
const authorizeEmployee = (req, res, next) => {
  const validDesignations = [
    'Employee', 
    'Software Engineer', 
    'SDE', 
    'Developer', 
    'QA Engineer', 
    'Support Engineer',
    'Manager',
    'Hr'
  ];

  if (!validDesignations.includes(req.user.designation)) {
    return res.status(403).json({ message: 'Access denied. Not an authorized employee.' });
  }

  next();
};

// Middleware to authorize Manager role
const authorizeManager = (req, res, next) => {
  if (req.user.designation !== 'Manager') {
    return res.status(403).json({ message: 'Access denied. Not a manager.' });
  }
  next();
};

// Middleware to authorize HR role
const authorizeHR = (req, res, next) => {
  if (req.user.designation !== 'HR') {
    return res.status(403).json({ message: 'Access denied. Not HR.' });
  }
  next();
};

// Sample login endpoint
app.post('/login', async (req, res) => {
  const { empl_code, empl_pwd } = req.body;

  if (!empl_code || !empl_pwd) {
    return res.status(400).json({ message: 'Employee code and password are required.' });
  }

  try {
    const pool = await sql.connect(config1);
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('empl_pwd', sql.VarChar, empl_pwd)
      .query('SELECT * FROM [dbo].[USER_PASSWORD] WHERE [empl_code] = @empl_code AND [empl_pwd] = @empl_pwd');

    if (result.recordset.length > 0) {
      const user = result.recordset[0];

      // Debug: log the user object to ensure it contains the expected data
      console.log('Retrieved User:', user);

      const token = jwt.sign(
        { empl_code: user.EMPL_CODE, designation: user.designation },
        jwtSecret,
        { expiresIn: '1h' }
      );

      // Debug: log the generated token
      console.log('Generated Token:', token);

      res.status(200).json({ message: 'Login successful', token, user });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    sql.close();
  }
});



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

// Register endpoint
app.post('/register', async (req, res) => {
  const { empl_code, employee_name, empl_pwd, designation } = req.body;

  if (!empl_code || !employee_name || !empl_pwd || !designation) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  try {
    let pool = await sql.connect(config1);

    const checkUserQuery = `SELECT * FROM USER_PASSWORD WHERE empl_code = @empl_code`;
    let checkUserRequest = pool.request();
    checkUserRequest.input('empl_code', sql.VarChar, empl_code);
    const userResult = await checkUserRequest.query(checkUserQuery);

    if (userResult.recordset.length > 0) {
      return res.status(400).json({ message: 'Employee already exists.' });
    }

    const insertUserQuery = `
      INSERT INTO USER_PASSWORD (empl_code, employee_name, empl_pwd, designation)
      VALUES (@empl_code, @employee_name, @empl_pwd, @designation)
    `;
    let insertUserRequest = pool.request();
    insertUserRequest.input('empl_code', sql.VarChar, empl_code);
    insertUserRequest.input('employee_name', sql.VarChar, employee_name);
    insertUserRequest.input('empl_pwd', sql.VarChar, empl_pwd);
    insertUserRequest.input('designation', sql.VarChar, designation);

    await insertUserRequest.query(insertUserQuery);
    res.status(201).json({ message: 'Employee registered successfully.' });
  } catch (error) {
    console.error('Error registering employee:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    sql.close();
  }
});

// Login endpoint
// app.post('/login', async (req, res) => {
//   const { empl_code, empl_pwd } = req.body;

//   if (!empl_code || !empl_pwd) {
//     return res.status(400).json({ message: 'Employee code and password are required.' });
//   }

//   try {
//     const pool = await sql.connect(config1);
//     const result = await pool.request()
//       .input('empl_code', sql.VarChar, empl_code)
//       .input('empl_pwd', sql.VarChar, empl_pwd)
//       .query('SELECT * FROM [dbo].[USER_PASSWORD] WHERE [empl_code] = @empl_code AND [empl_pwd] = @empl_pwd');

//     if (result.recordset.length > 0) {
//       const user = result.recordset[0];

//       // Debugging logs
//       console.log('Retrieved User:', user);

//       const token = jwt.sign(
//         { empl_code: user.EMPL_CODE , designation: user.designation },
//         jwtSecret,
//         { expiresIn: '1h' }
//       );

//       // Debugging logs
//       console.log('Generated Token:', token);

//       // Decode the token locally for verification
//       const decoded = jwt.verify(token, jwtSecret);
//       console.log('Decoded Token Payload:', decoded);

//       res.status(200).json({ message: 'Login successful', token, user });
//     } else {
//       res.status(401).json({ message: 'Invalid credentials' });
//     }
//   } catch (err) {
//     console.error('Error during login:', err);
//     res.status(500).json({ message: 'Internal server error' });
//   } finally {
//     await sql.close();
//   }
// });
// API for leave types
app.get('/leave-types', authenticateJWT, authorizeEmployee, async (req, res) => {
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
app.post('/request-leave', authenticateJWT, authorizeEmployee, async (req, res) => {
  const { empl_code, leave_type_id, start_date, end_date, reason } = req.body;

  if (!empl_code || !leave_type_id || !start_date || !end_date || !reason) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (new Date(start_date) > new Date(end_date)) {
    return res.status(400).json({ error: 'End date must be after start date.' });
  }

  const durationDays = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;

  try {
    const pool = await sql.connect(config1);

    const leaveTypeResult = await pool.request()
      .input('leave_type_id', sql.Int, leave_type_id)
      .query('SELECT [NAME] FROM [dbo].[LEAVE_TYPE] WHERE [ID] = @leave_type_id');

    if (leaveTypeResult.recordset.length === 0) {
      return res.status(400).json({ error: 'Invalid leave type ID.' });
    }

    const leaveTypeName = leaveTypeResult.recordset[0].NAME;
    const needsHRApproval = leaveTypeName === 'SL' && durationDays > 3;

    await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('leave_type_id', sql.Int, leave_type_id)
      .input('start_date', sql.Date, start_date)
      .input('end_date', sql.Date, end_date)
      .input('reason', sql.NVarChar, reason)
      .input('status', sql.VarChar, 'Pending')
      .input('duration', sql.VarChar, `${durationDays} days`)
      .input('approved_by_manager', sql.Bit, false)
      .input('approved_by_hr', sql.Bit, needsHRApproval)
      .query(`
        INSERT INTO [dbo].[LEAVE_REQUEST] 
        ([EMPL_CODE], [LEAVE_TYPE_ID], [START_DATE], [END_DATE], [REASON], [STATUS], [DURATION], [APPROVED_BY_MANAGER], [APPROVED_BY_HR])
        VALUES (@empl_code, @leave_type_id, @start_date, @end_date, @reason, @status, @duration, @approved_by_manager, @approved_by_hr)
      `);

    res.status(201).json({ message: 'Leave request submitted successfully.' });
  } catch (err) {
    console.error('Error submitting leave request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API for approving leave requests by Manager or HR
app.post('/approve-leave/:id', authenticateJWT, async (req, res) => {
  const leaveRequestId = parseInt(req.params.id, 10);
  const { approve_by } = req.body;
  const approverId = req.user.empl_code; // Use empl_code from JWT
  const approverRole = req.user.designation; // Get role from JWT

  // Debugging Logs
  console.log(`Leave Request ID: ${leaveRequestId}`);
  console.log(`Approve By: ${approve_by}`);
  console.log(`Approver ID: ${approverId}`);
  console.log(`Approver Role: ${approverRole}`);

  // Validate input
  if (!leaveRequestId || !approve_by) {
    return res.status(400).json({ error: 'Leave request ID and approver role are required.' });
  }

  if (approve_by !== 'Manager' && approve_by !== 'HR') {
    return res.status(400).json({ error: 'Invalid approver role. Use "Manager" or "HR".' });
  }

  try {
    const pool = await sql.connect(config1);

    // Check if the leave request exists and validate details
    const leaveRequestResult = await pool.request()
      .input('leaveRequestId', sql.Int, leaveRequestId)
      .query('SELECT * FROM [dbo].[LEAVE_REQUEST] WHERE [ID] = @leaveRequestId');

    if (leaveRequestResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Leave request not found.' });
    }

    const leaveRequest = leaveRequestResult.recordset[0];
    if (!leaveRequest.START_DATE || !leaveRequest.END_DATE || !leaveRequest.REASON) {
      return res.status(400).json({ error: 'Improper details. Please resubmit the leave request.' });
    }

    let approverName = '';
    let updateQuery = '';

    if (approve_by === 'Manager') {
      if (approverRole !== 'Manager') {
        return res.status(403).json({ error: 'Access denied. Not a manager.' });
      }

      // Fetch manager name using approverId from the USER_PASSWORD table
      const managerResult = await pool.request()
        .input('emplCode', sql.VarChar, approverId)
        .query('SELECT employee_name FROM [dbo].[USER_PASSWORD] WHERE [empl_code] = @emplCode');

      if (managerResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Manager not found.' });
      }
      approverName = managerResult.recordset[0].employee_name;

      updateQuery = `
        UPDATE [dbo].[LEAVE_REQUEST]
        SET [APPROVED_BY_MANAGER] = 1, [approved_by_manager_name] = @approverName, [STATUS] = 'Approved by Manager', [manager_id] = @approverId
        WHERE [ID] = @leaveRequestId
      `;
    } else if (approve_by === 'HR') {
      if (approverRole !== 'HR') {
        return res.status(403).json({ error: 'Access denied. Not HR.' });
      }

      // Fetch HR name using approverId from the USER_PASSWORD table
      const hrResult = await pool.request()
        .input('emplCode', sql.VarChar, approverId)
        .query('SELECT employee_name FROM [dbo].[USER_PASSWORD] WHERE [empl_code] = @emplCode');

      if (hrResult.recordset.length === 0) {
        return res.status(404).json({ error: 'HR not found.' });
      }
      approverName = hrResult.recordset[0].employee_name;

      updateQuery = `
        UPDATE [dbo].[LEAVE_REQUEST]
        SET [APPROVED_BY_HR] = 1, [approved_by_hr_name] = @approverName, [STATUS] = 'Approved by HR', [hr_id] = @approverId
        WHERE [ID] = @leaveRequestId
      `;
    }

    // Update the leave request approval status, approver name, and approver ID
    await pool.request()
      .input('leaveRequestId', sql.Int, leaveRequestId)
      .input('approverName', sql.NVarChar, approverName)
      .input('approverId', sql.VarChar, approverId)
      .query(updateQuery);

    res.status(200).json({ message: `Leave request approved by ${approve_by}.` });
  } catch (err) {
    console.error('Error approving leave request:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
