const express = require('express');
const sql = require('mssql/msnodesqlv8');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const ExcelJS = require('exceljs');
const moment = require('moment-timezone');

// const upload = require('./LMS/uploadMiddleware')
const config1 = require('./config1');
const config2 = require('./config2');
const currentTime = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



console.log(currentTime); // Outputs the current time in 'Asia/Kolkata' time zone


const jwtSecret = 'annuvrat#1';

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

const authorizeManagerOrHR = (req, res, next) => {
  if (req.user.designation !== 'Manager' && req.user.designation !== 'HR') {
    return res.status(403).json({ message: 'Access denied. Not authorized.' });
  }
  next();
};

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


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
        { expiresIn: '3h' }
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


// API for leave types
app.get('/leave-types', authenticateJWT, authorizeEmployee, async (req, res) => {
  try {
    console.log('Fetching leave types...');

    const pool = await sql.connect(config1);
    console.log('Connected to database.');

    const result = await pool.request().query('SELECT  [ID], [NAME] FROM dbo.LEAVE_TYPE');
    console.log('Leave types fetched successfully.');

    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching leave types:', err);
    res.status(500).json({ error: 'Failed to fetch leave types', details: err.message });
  } finally {
    try {
      await sql.close();
    } catch (closeErr) {
      console.error('Error closing SQL connection:', closeErr);
    }
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
app.get('/leave-requests', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
  try {
    const pool = await sql.connect(config1);

    const query = `
          SELECT 
              lr.ID,
              lr.EMPL_CODE,
              lt.NAME,
              lr.START_DATE,
              lr.END_DATE,
              lr.REASON
          FROM [dbo].[LEAVE_REQUEST] lr
          JOIN [dbo].[LEAVE_TYPE] lt ON lr.LEAVE_TYPE_ID = lt.ID
          WHERE lr.STATUS = 'Pending'
      `;

    const request = pool.request();
    const result = await request.query(query);
    const leaveRequests = result.recordset;

    res.json({ leaveRequests });
  } catch (err) {
    console.error('Error fetching leave requests:', err);  // Log the full error for debugging
    res.status(500).json({ error: 'Internal server error' });
  }
})
// API for approving leave requests by Manager or HR
app.post('/approve-leave/:id', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
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

const leaveEntitlements = {
  'SL': 12, // Sick Leave
  'CL': 15, // Casual Leave
  'EL': 20, // Earned Leave
  'PL': 20, // Privilege Leave (example)
  'WP': 12  // Work from Home (example)
};

app.post('/handle-leave/:id', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
  const leaveRequestId = parseInt(req.params.id, 10);
  const { action, reason } = req.body; // action can be 'approve', 'reject', or 'resubmit'
  const approverId = req.user.empl_code;
  const approverRole = req.user.designation;

  console.log(`Leave Request ID: ${leaveRequestId}`);
  console.log(`Action: ${action}`);
  console.log(`Approver ID: ${approverId}`);
  console.log(`Approver Role: ${approverRole}`);

  if (!leaveRequestId || !action) {
    return res.status(400).json({ error: 'Leave request ID and action are required.' });
  }

  if (!['approve', 'reject', 'resubmit'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Use "approve", "reject", or "resubmit".' });
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

    let updateQuery = '';
    let updateParams = [];

    switch (action) {
      case 'approve':
        if (approverRole === 'Manager') {
          updateQuery = `
            UPDATE [dbo].[LEAVE_REQUEST]
            SET [APPROVED_BY_MANAGER] = 1, [approved_by_manager_name] = @approverName, [STATUS] = 'Approved by Manager', [manager_id] = @approverId
            WHERE [ID] = @leaveRequestId
          `;
          updateParams = [
            { name: 'approverName', type: sql.NVarChar, value: approverRole },
            { name: 'approverId', type: sql.Int, value: approverId }
          ];
        } else if (approverRole === 'HR') {
          updateQuery = `
            UPDATE [dbo].[LEAVE_REQUEST]
            SET [APPROVED_BY_HR] = 1, [approved_by_hr_name] = @approverName, [STATUS] = 'Approved by HR', [hr_id] = @approverId
            WHERE [ID] = @leaveRequestId
          `;
          updateParams = [
            { name: 'approverName', type: sql.NVarChar, value: approverRole },
            { name: 'approverId', type: sql.Int, value: approverId }
          ];
        } else {
          return res.status(403).json({ error: 'Access denied. Not authorized to approve.' });
        }
        break;

      case 'reject':
      case 'resubmit':
        updateQuery = `
          UPDATE [dbo].[LEAVE_REQUEST]
          SET [STATUS] = @status, [REASON] = @reason
          WHERE [ID] = @leaveRequestId
        `;
        updateParams = [
          { name: 'status', type: sql.VarChar, value: action === 'reject' ? 'Rejected' : 'Resubmit' },
          { name: 'reason', type: sql.NVarChar, value: reason }
        ];
        break;

      default:
        return res.status(400).json({ error: 'Invalid action.' });
    }

    // Execute the update query
    const request = pool.request()
      .input('leaveRequestId', sql.Int, leaveRequestId);

    updateParams.forEach(param => request.input(param.name, param.type, param.value));

    await request.query(updateQuery);

    res.status(200).json({ message: `Leave request ${action}ed successfully.` });
  } catch (err) {
    console.error('Error handling leave request:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

app.get('/leave-balance', authenticateJWT, async (req, res) => {
  const emplCode = req.user.empl_code;

  try {
    const leaveTakenQuery = `
          SELECT lt.NAME AS leaveTypeName, SUM(CAST(PARSENAME(REPLACE(lr.DURATION, ' days', ''), 1) AS int)) AS leavesTaken
          FROM LEAVE_REQUEST lr
          INNER JOIN LEAVE_TYPE lt ON lr.LEAVE_TYPE_ID = lt.ID
          WHERE lr.EMPL_CODE = @emplCode 
          AND lr.STATUS IN ('Approved', 'Approved by Manager', 'Approved by HR')
          GROUP BY lt.NAME;
      `;

    const leaveBalanceQuery = `
          SELECT lt.NAME AS leaveTypeName, ISNULL(lb.BALANCE, 0) AS balance
          FROM LEAVE_TYPE lt
          LEFT JOIN LEAVE_BALANCE lb ON lt.ID = lb.LEAVE_TYPE_ID AND lb.EMPL_CODE = @emplCode;
      `;

    const pool = await sql.connect(config1);

    // Fetch leave taken data
    const leaveTakenResult = await pool.request()
      .input('emplCode', sql.VarChar, emplCode)
      .query(leaveTakenQuery);
    const leaveTakenData = leaveTakenResult.recordset;

    // Fetch leave balance data
    const leaveBalanceResult = await pool.request()
      .input('emplCode', sql.VarChar, emplCode)
      .query(leaveBalanceQuery);
    const leaveBalanceData = leaveBalanceResult.recordset;

    // Calculate remaining leaves
    const leaveBalance = leaveBalanceData.map(balance => {
      const taken = leaveTakenData.find(l => l.leaveTypeName === balance.leaveTypeName);
      const leavesTaken = taken ? taken.leavesTaken : 0;
      const totalLeaves = leaveEntitlements[balance.leaveTypeName] || 0;
      return {
        leaveType: balance.leaveTypeName,
        totalLeaves,
        leavesTaken: leavesTaken, // from LEAVE_REQUEST table
        remainingLeaves: balance.balance - leavesTaken // Adjust based on balance and taken
      };
    });

    res.json(leaveBalance);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});



app.post('/adjust-leave-balance', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
  const { emplCode, leaveTypeName, adjustment } = req.body;

  try {
    const pool = await sql.connect(config1);

    // Look up the leave type ID based on the leave type name
    const getLeaveTypeIdQuery = `
      SELECT ID FROM LEAVE_TYPE WHERE NAME = @leaveTypeName
    `;
    const leaveTypeResult = await pool.request()
      .input('leaveTypeName', sql.VarChar, leaveTypeName)
      .query(getLeaveTypeIdQuery);

    if (leaveTypeResult.recordset.length === 0) {
      return res.status(404).json({ error: "Leave type not found." });
    }

    const leaveTypeId = leaveTypeResult.recordset[0].ID;

    // Check if leave balance record exists
    const checkBalanceQuery = `
      SELECT * FROM LEAVE_BALANCE 
      WHERE EMPL_CODE = @emplCode AND LEAVE_TYPE_ID = @leaveTypeId
    `;
    const checkBalanceResult = await pool.request()
      .input('emplCode', sql.VarChar, emplCode)
      .input('leaveTypeId', sql.Int, leaveTypeId)
      .query(checkBalanceQuery);

    if (checkBalanceResult.recordset.length === 0) {
      return res.status(404).json({ error: "Leave balance record not found." });
    }

    // Adjust leave balance and leaves taken
    const adjustLeaveBalanceQuery = `
      UPDATE LEAVE_BALANCE
      SET BALANCE = BALANCE + @adjustment,
          LEAVES_TAKEN = LEAVES_TAKEN + @adjustment
      WHERE EMPL_CODE = @emplCode AND LEAVE_TYPE_ID = @leaveTypeId
    `;
    await pool.request()
      .input('adjustment', sql.Int, adjustment)
      .input('emplCode', sql.VarChar, emplCode)
      .input('leaveTypeId', sql.Int, leaveTypeId)
      .query(adjustLeaveBalanceQuery);

    res.status(200).json({ message: 'Leave balance adjusted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

app.post('/bulk-upload-leave', authenticateJWT, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);

    const worksheet = workbook.worksheets[0];
    const rows = worksheet.getSheetValues(); // This gets all rows as an array

    const leaveData = rows.slice(1).map(row => ({
      empl_code: row[1], // Adjust indices based on your sheet
      leave_type: row[2],
      leave_duration: row[3],
    }));

    // Connect to your database
    const pool = await sql.connect(config1);

    // Start a transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Loop through the leave data and update the database
      for (const leave of leaveData) {
        const { empl_code, leave_type, leave_duration } = leave;

        // Fetch the leave type ID
        const leaveTypeResult = await transaction.request()
          .input('name', sql.VarChar, leave_type)
          .query('SELECT ID FROM LEAVE_TYPE WHERE NAME = @name');
        const leaveTypeId = leaveTypeResult.recordset[0]?.ID;

        if (!leaveTypeId) {
          throw new Error(`Leave type ${leave_type} not found`);
        }

        // Update the leave balance
        await transaction.request()
          .input('empl_code', sql.VarChar, empl_code)
          .input('leave_type_id', sql.Int, leaveTypeId)
          .input('leave_duration', sql.Int, leave_duration)
          .query(`
                      IF EXISTS (SELECT 1 FROM LEAVE_BALANCE WHERE EMPL_CODE = @empl_code AND LEAVE_TYPE_ID = @leave_type_id)
                      BEGIN
                          UPDATE LEAVE_BALANCE
                          SET BALANCE = BALANCE + @leave_duration
                          WHERE EMPL_CODE = @empl_code AND LEAVE_TYPE_ID = @leave_type_id
                      END
                      ELSE
                      BEGIN
                          INSERT INTO LEAVE_BALANCE (EMPL_CODE, LEAVE_TYPE_ID, BALANCE)
                          VALUES (@empl_code, @leave_type_id, @leave_duration)
                      END
                  `);
      }

      // Commit the transaction
      await transaction.commit();
      res.json({ message: 'Bulk upload successful' });
    } catch (err) {
      await transaction.rollback();
      res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to process the Excel file', details: err.message });
  }
});

app.get('/calendar', authenticateJWT, authorizeEmployee, async (req, res) => {
  const { empl_code } = req.user;  // Extracting empl_code from the JWT token

  try {
    console.log('Starting calendar API...');

    // Connect to the database for leaves, holidays, meetings, and attendance
    const pool = await sql.connect(config1);
    console.log('Connected to the database.');

    // Fetch employee leaves
    const leaveResult = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .query(`
        SELECT 
          LT.NAME AS leave_type,
          LR.START_DATE,
          LR.END_DATE,
          LR.STATUS,
          DATEDIFF(DAY, LR.START_DATE, LR.END_DATE) + 1 AS duration
        FROM [dbo].[LEAVE_REQUEST] LR
        JOIN [dbo].[LEAVE_TYPE] LT ON LR.LEAVE_TYPE_ID = LT.ID
        WHERE LR.EMPL_CODE = @empl_code
        ORDER BY LR.START_DATE ASC;
      `);

    console.log('Fetched leaves:', leaveResult.recordset);

    const leaves = leaveResult.recordset.map(row => ({
      type: 'leave',
      leaveType: row.leave_type,
      startDate: row.START_DATE,
      endDate: row.END_DATE,
      status: row.STATUS,
      duration: row.duration
    }));

    // Fetch upcoming holidays/events
    const holidayResult = await pool.request()
      .query(`
        SELECT 
          NAME AS holiday_name,
          DATE AS holiday_date,
          DESCRIPTION AS holiday_description
        FROM [dbo].[HOLIDAYS]
        WHERE DATE >= GETDATE()
        ORDER BY DATE ASC;
      `);

    console.log('Fetched holidays:', holidayResult.recordset);

    const holidays = holidayResult.recordset.map(row => ({
      type: 'holiday',
      holidayName: row.holiday_name,
      date: row.holiday_date,
      description: row.holiday_description
    }));

    // Fetch meetings for the employee
    const meetingResult = await pool.request()
      .input('empl_code', sql.VarChar, `%${empl_code}%`)
      .query(`
        SELECT 
          M.TITLE AS meeting_title,
          M.START_DATETIME AS startTime,
          M.END_DATETIME AS endTime,
          M.DESCRIPTION AS meeting_description,
          M.ATTENDEES
        FROM [dbo].[MEETING] M
        WHERE M.ATTENDEES LIKE @empl_code
        ORDER BY M.START_DATETIME ASC;
      `);

    console.log('Fetched meetings:', meetingResult.recordset);

    const meetings = meetingResult.recordset.map(row => ({
      type: 'meeting',
      title: row.meeting_title,
      startTime: row.startTime,
      endTime: row.endTime,
      description: row.meeting_description,
      attendees: row.ATTENDEES.split(',')
    }));

    // Fetch attendance records
    const attendanceResult = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .query(`
        SELECT 
          ATTENDANCE_DATE,
          STATUS
        FROM [dbo].[ATTENDANCE]
        WHERE EMPL_CODE = @empl_code
        ORDER BY ATTENDANCE_DATE ASC;
      `);

    console.log('Fetched attendance:', attendanceResult.recordset);

    const attendance = attendanceResult.recordset.map(row => ({
      type: 'attendance',
      date: row.ATTENDANCE_DATE,
      status: row.STATUS
    }));

    // Combine and sort all calendar entries
    const calendar = [...leaves, ...holidays, ...meetings, ...attendance].sort((a, b) =>
      new Date(a.startDate || a.date || a.startTime) - new Date(b.startDate || b.date || b.startTime)
    );

    console.log('Combined calendar:', calendar);

    res.json(calendar);
  } catch (err) {
    console.error('Error fetching calendar data:', err.message);
    res.status(500).json({ error: err.message });
  }
});



app.get('/attendance-summary', authenticateJWT, authorizeEmployee, async (req, res) => {
  const { empl_code } = req.user;  // Extracting empl_code from the JWT token

  try {
    const pool = await sql.connect(config1);

    console.log('empl_code:', empl_code);  // Debugging log

    // Query to calculate the attendance summary
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .query(`
        SELECT 
          LT.NAME AS leave_type,
          COUNT(LR.ID) AS leave_count,
          SUM(DATEDIFF(DAY, LR.START_DATE, LR.END_DATE) + 1) AS total_days
        FROM [dbo].[LEAVE_REQUEST] LR
        JOIN [dbo].[LEAVE_TYPE] LT ON LR.LEAVE_TYPE_ID = LT.ID
        WHERE LR.EMPL_CODE = @empl_code AND LR.STATUS = 'Approved'
        GROUP BY LT.NAME
      `);

    console.log('Query Result:', result.recordset);  // Debugging log

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'No leave records found for this employee.' });
    }

    // Format the result
    const attendanceSummary = result.recordset.map(row => ({
      leaveType: row.leave_type,
      leaveCount: row.leave_count,
      totalDays: row.total_days
    }));

    res.json(attendanceSummary);
  } catch (err) {
    console.error('Error fetching attendance summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.post('/request-leave-correction', authenticateJWT, authorizeEmployee, async (req, res) => {
  const { emplCode, leaveRequestId, message } = req.body;

  try {
    const pool = await sql.connect(config1);

    // Insert the correction request into the database
    const insertCorrectionRequestQuery = `
          INSERT INTO LEAVE_CORRECTION (EMPL_CODE, LEAVE_REQUEST_ID, MESSAGE)
          VALUES (@emplCode, @leaveRequestId, @message)
      `;
    await pool.request()
      .input('emplCode', sql.VarChar, emplCode)
      .input('leaveRequestId', sql.Int, leaveRequestId)
      .input('message', sql.Text, message)
      .query(insertCorrectionRequestQuery);

    res.status(201).json({ message: 'Leave correction request submitted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});


app.get('/employee-details', authenticateJWT, authorizeEmployee, async (req, res) => {
  try {
    // Extract empl_code from JWT payload
    const { empl_code } = req.user; // assuming req.user contains the decoded JWT payload

    if (!empl_code) {
      return res.status(400).json({ message: "EMPL_CODE is required." });
    }

    // Connect to the database
    const pool = await sql.connect(config2);

    // Query to get employee details
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .query(`
        SELECT 
          EMPL_CODE, 
          EMPL_NAME, 
          SEX, 
          FAT_HUS_NAME, 
          BRTH_DATE, 
          BLD_GRP, 
          CASTE, 
          RELIGION, 
          MRTL_STAT, 
          MRGE_DATE, 
          PRSNT_ADDR, 
          PRSNT_CITY, 
          PRSNT_STATE, 
          PRSNT_PNCD, 
          PRSNT_LNMK, 
          PRSNT_TEL_NO, 
          PRMNT_ADDR, 
          PRMNT_CITY, 
          PRMNT_STATE, 
          PRMNT_PNCD, 
          PRMNT_LNMK, 
          PRMNT_TEL_NO, 
          EMAIL_ID, 
          CELL_NO, 
          DRV_LIC_NO, 
          PSPRT_NO, 
          MARK_ID, 
          HNDCPD_FLAG, 
          REF_NAME 
        FROM [dbo].[M_EMPL_PERS]
        WHERE EMPL_CODE = @empl_code
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Employee not found." });
    }

    // Return the employee details
    res.status(200).json(result.recordset[0]);
  } catch (error) {
    console.error('Error fetching employee details:', error.message);
    res.status(500).json({ message: "Internal server error." });
  }
});

app.put('/update-employee-details/:empl_code', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
  const empl_code = req.params.empl_code;
  const {
    EMPL_NAME,
    SEX,
    FAT_HUS_NAME,
    BRTH_DATE,
    BLD_GRP,
    CASTE,
    RELIGION,
    MRTL_STAT, // Adjust this based on your database schema
    MRGE_DATE,
    PRSNT_ADDR,
    PRSNT_CITY,
    PRSNT_STATE,
    PRSNT_PNCD,
    PRSNT_LNMK,
    PRSNT_TEL_NO,
    PRMNT_ADDR,
    PRMNT_CITY,
    PRMNT_STATE,
    PRMNT_PNCD,
    PRMNT_LNMK,
    PRMNT_TEL_NO,
    EMAIL_ID,
    CELL_NO,
    DRV_LIC_NO,
    PSPRT_NO,
    MARK_ID,
    HNDCPD_FLAG,
    REF_NAME
  } = req.body;

  try {
    // Ensure MRTL_STAT is within the allowed length
    const formattedMRTL_STAT = MRTL_STAT ? MRTL_STAT.slice(0, 1) : null;

    // Connect to the database
    const pool = await sql.connect(config2);

    // Update employee details query
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('EMPL_NAME', sql.VarChar, EMPL_NAME)
      .input('SEX', sql.VarChar, SEX)
      .input('FAT_HUS_NAME', sql.VarChar, FAT_HUS_NAME)
      .input('BRTH_DATE', sql.Date, BRTH_DATE)
      .input('BLD_GRP', sql.VarChar, BLD_GRP)
      .input('CASTE', sql.VarChar, CASTE)
      .input('RELIGION', sql.VarChar, RELIGION)
      .input('MRTL_STAT', sql.VarChar, formattedMRTL_STAT) // Adjusted for truncation
      .input('MRGE_DATE', sql.Date, MRGE_DATE)
      .input('PRSNT_ADDR', sql.VarChar, PRSNT_ADDR)
      .input('PRSNT_CITY', sql.VarChar, PRSNT_CITY)
      .input('PRSNT_STATE', sql.VarChar, PRSNT_STATE)
      .input('PRSNT_PNCD', sql.VarChar, PRSNT_PNCD)
      .input('PRSNT_LNMK', sql.VarChar, PRSNT_LNMK)
      .input('PRSNT_TEL_NO', sql.VarChar, PRSNT_TEL_NO)
      .input('PRMNT_ADDR', sql.VarChar, PRMNT_ADDR)
      .input('PRMNT_CITY', sql.VarChar, PRMNT_CITY)
      .input('PRMNT_STATE', sql.VarChar, PRMNT_STATE)
      .input('PRMNT_PNCD', sql.VarChar, PRMNT_PNCD)
      .input('PRMNT_LNMK', sql.VarChar, PRMNT_LNMK)
      .input('PRMNT_TEL_NO', sql.VarChar, PRMNT_TEL_NO)
      .input('EMAIL_ID', sql.VarChar, EMAIL_ID)
      .input('CELL_NO', sql.VarChar, CELL_NO)
      .input('DRV_LIC_NO', sql.VarChar, DRV_LIC_NO)
      .input('PSPRT_NO', sql.VarChar, PSPRT_NO)
      .input('MARK_ID', sql.VarChar, MARK_ID)
      .input('HNDCPD_FLAG', sql.Bit, HNDCPD_FLAG)
      .input('REF_NAME', sql.VarChar, REF_NAME)
      .query(`
              UPDATE [dbo].[M_EMPL_PERS]
              SET 
                  EMPL_NAME = @EMPL_NAME,
                  SEX = @SEX,
                  FAT_HUS_NAME = @FAT_HUS_NAME,
                  BRTH_DATE = @BRTH_DATE,
                  BLD_GRP = @BLD_GRP,
                  CASTE = @CASTE,
                  RELIGION = @RELIGION,
                  MRTL_STAT = @MRTL_STAT,
                  MRGE_DATE = @MRGE_DATE,
                  PRSNT_ADDR = @PRSNT_ADDR,
                  PRSNT_CITY = @PRSNT_CITY,
                  PRSNT_STATE = @PRSNT_STATE,
                  PRSNT_PNCD = @PRSNT_PNCD,
                  PRSNT_LNMK = @PRSNT_LNMK,
                  PRSNT_TEL_NO = @PRSNT_TEL_NO,
                  PRMNT_ADDR = @PRMNT_ADDR,
                  PRMNT_CITY = @PRMNT_CITY,
                  PRMNT_STATE = @PRMNT_STATE,
                  PRMNT_PNCD = @PRMNT_PNCD,
                  PRMNT_LNMK = @PRMNT_LNMK,
                  PRMNT_TEL_NO = @PRMNT_TEL_NO,
                  EMAIL_ID = @EMAIL_ID,
                  CELL_NO = @CELL_NO,
                  DRV_LIC_NO = @DRV_LIC_NO,
                  PSPRT_NO = @PSPRT_NO,
                  MARK_ID = @MARK_ID,
                  HNDCPD_FLAG = @HNDCPD_FLAG,
                  REF_NAME = @REF_NAME
              WHERE EMPL_CODE = @empl_code
          `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: "Employee not found." });
    }

    res.status(200).json({ message: "Employee details updated successfully." });
  } catch (error) {
    console.error('Error updating employee details:', error.message);
    res.status(500).json({ message: "Internal server error." });
  }
});



// Punch-In Endpoint
app.post('/punch-in', authenticateJWT, authorizeEmployee, async (req, res) => {
  const { empl_code } = req.user;  // Extract employee code from JWT token

  try {
    // Set punch-in time using the 'Asia/Kolkata' time zone
    const punchInTime = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

    const pool = await sql.connect(config2);

    // Get the current date in 'YYYY-MM-DD' format
    const date = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

    // Check if employee has already punched in today
    const checkResult = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('date', sql.Date, date)
      .query(`SELECT * FROM dbo.PunchRecords WHERE EMPL_CODE = @empl_code AND DATE = @date`);

    if (checkResult.recordset.length > 0) {
      return res.status(400).json({ message: "Already punched in today." });
    }

    // Insert punch-in record with the correct time zone
    await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('punch_in', sql.DateTime, punchInTime)  // Use the punchInTime from moment
      .input('date', sql.Date, date)
      .query(`INSERT INTO dbo.PunchRecords (EMPL_CODE, PUNCH_IN, DATE) VALUES (@empl_code, @punch_in, @date)`);

    res.status(200).json({ message: "Successfully punched in.", punchInTime });
  } catch (error) {
    console.error('Error during punch-in:', error.message);
    res.status(500).json({ message: "Internal server error.", error: error.message });
  }
});

// Punch-Out Endpoint
app.post('/punch-out', authenticateJWT, authorizeEmployee, async (req, res) => {
  const { empl_code } = req.user;  // Extract employee code from JWT token

  try {
    // Set punch-out time using the 'Asia/Kolkata' time zone
    const punchOutTime = moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

    const pool = await sql.connect(config2);

    // Get the current date in 'YYYY-MM-DD' format
    const date = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

    // Check if employee has punched in today and hasn't punched out yet
    const checkResult = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('date', sql.Date, date)
      .query(`SELECT * FROM dbo.PunchRecords WHERE EMPL_CODE = @empl_code AND DATE = @date AND PUNCH_OUT IS NULL`);

    if (checkResult.recordset.length === 0) {
      return res.status(400).json({ message: "No punch-in record found or already punched out." });
    }

    // Update punch-out time for the existing record
    await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('punch_out', sql.DateTime, punchOutTime)  // Use the punchOutTime from moment
      .input('date', sql.Date, date)
      .query(`UPDATE dbo.PunchRecords SET PUNCH_OUT = @punch_out WHERE EMPL_CODE = @empl_code AND DATE = @date`);

    res.status(200).json({ message: "Successfully punched out.", punchOutTime });
  } catch (error) {
    console.error('Error during punch-out:', error.message);
    res.status(500).json({ message: "Internal server error.", error: error.message });
  }
});


app.get('/punch-records', authenticateJWT, authorizeEmployee, async (req, res) => {
  const { empl_code } = req.user; // Extract employee code from JWT token

  try {
    const pool = await sql.connect(config1);

    // Get the current date in 'YYYY-MM-DD' format
    const date = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

    // Query to retrieve punch-in and punch-out records for the employee on the current date
    const result = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('date', sql.Date, date)
      .query(`SELECT * FROM dbo.PunchRecords WHERE EMPL_CODE = @empl_code AND DATE = @date`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "No punch records found for today." });
    }

    const punchRecord = result.recordset[0];
    const punchInTime = punchRecord.PUNCH_IN ? moment(punchRecord.PUNCH_IN).tz('Asia/Kolkata') : null;
    const punchOutTime = punchRecord.PUNCH_OUT ? moment(punchRecord.PUNCH_OUT).tz('Asia/Kolkata') : null;

    let totalTime = null;
    if (punchInTime && punchOutTime) {
      totalTime = moment.duration(punchOutTime.diff(punchInTime)).humanize();
    }


    const managerResult = await pool.request()
      .input('empl_code', sql.VarChar, empl_code)
      .input('date', sql.Date, date)
      .query(`SELECT DISTINCT MANAGER FROM dbo.PunchRecords WHERE EMPL_CODE = @empl_code AND DATE = @date`);

    const manager = managerResult.recordset[0] || {};

    res.status(200).json({
      punchInTime: punchInTime ? punchInTime.format('YYYY-MM-DD HH:mm:ss') : null,
      punchOutTime: punchOutTime ? punchOutTime.format('YYYY-MM-DD HH:mm:ss') : null,
      totalTime,
      manager: manager.MANAGER || 'No manager assigned'
    });
  } catch (error) {
    console.error('Error fetching punch records:', error.message);
    res.status(500).json({ message: "Internal server error.", error: error.message });
  }
});







app.post('/post-announcements', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
  const { title, content } = req.body;
  const author_id = req.user.empl_code; // Assuming JWT contains employee code

  try {
    const pool = await sql.connect(config2);
    await pool.request()
      .input('title', sql.VarChar, title)
      .input('content', sql.Text, content)
      .input('author_id', sql.VarChar, author_id)
      .input('created_at', sql.DateTime, new Date())
      .input('updated_at', sql.DateTime, new Date())
      .query(`INSERT INTO Announcements (title, content, author_id, created_at, updated_at) 
              VALUES (@title, @content, @author_id, @created_at, @updated_at)`);

    res.status(201).json({ message: "Announcement created successfully." });
  } catch (error) {
    console.error('Error creating announcement:', error.message);
    res.status(500).json({ message: "Internal server error." });
  }
});

// API to fetch all announcements
app.get('/announcements', authenticateJWT, async (req, res) => {
  try {
    const pool = await sql.connect(config1);
    const result = await pool.request()
      .query(`SELECT id, title, content, created_at, updated_at FROM dbo.Announcements ORDER BY created_at DESC`);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('Error fetching announcements:', error.message);
    res.status(500).json({ message: "Internal server error." });
  }
});

// API to update an existing announcement
app.put('/announcements/:id', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
  const { id } = req.params;
  const { title, content } = req.body;

  try {
    const pool = await sql.connect(config2);
    await pool.request()
      .input('id', sql.Int, id)
      .input('title', sql.VarChar, title)
      .input('content', sql.Text, content)
      .input('updated_at', sql.DateTime, new Date())
      .query(`UPDATE Announcements SET title = @title, content = @content, updated_at = @updated_at WHERE id = @id`);

    res.status(200).json({ message: "Announcement updated successfully." });
  } catch (error) {
    console.error('Error updating announcement:', error.message);
    res.status(500).json({ message: "Internal server error." });
  }
});

// API to delete an announcement
app.delete('/announcements/:id', authenticateJWT, authorizeManagerOrHR, async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await sql.connect(config2);
    await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM Announcements WHERE id = @id`);

    res.status(200).json({ message: "Announcement deleted successfully." });
  } catch (error) {
    console.error('Error deleting announcement:', error.message);
    res.status(500).json({ message: "Internal server error." });
  }
});
// 
app.get('/rejected-leavese', authenticateJWT, async (req, res) => {
  const { empl_code, designation } = req.user;  // extracted from JWT

  try {
    const pool = await sql.connect(config1);
    let query = '';
    let result = null;
    const request = pool.request();

    // If the user is a Manager, fetch the approved leaves for this manager
    if (designation === 'Manager') {
      query = `
        SELECT * FROM [dbo].[LEAVE_REQUEST]
        WHERE manager_id = (
          SELECT id FROM [dbo].[MANAGER]
          WHERE id = (
            SELECT manager_id FROM [dbo].[USER_PASSWORD] WHERE empl_code = @empl_code
          )
        )
        AND APPROVED_BY_MANAGER = 0
      `;
      request.input('empl_code', sql.VarChar, empl_code);

      // If the user is HR, fetch the approved leaves for this HR
    } else if (designation === 'HR') {
      query = `
        SELECT * FROM [dbo].[LEAVE_REQUEST]
        WHERE hr_id = (
          SELECT id FROM [dbo].[HR]
          WHERE id = (
            SELECT hr_id FROM [dbo].[USER_PASSWORD] WHERE empl_code = @empl_code
          )
        )
        AND APPROVED_BY_HR = 0
      `;
      request.input('empl_code', sql.VarChar, empl_code);

      // If the user is neither HR nor Manager, return unauthorized access
    } else {
      return res.status(403).json({ message: 'Unauthorized access. Only Managers or HR can view this resource.' });
    }

    // Execute the query and fetch results
    result = await request.query(query);

    if (result.recordset.length > 0) {
      res.status(200).json({ message: 'Rejected  leaves fetched successfully', approvedLeaves: result.recordset });
    } else {
      res.status(404).json({ message: 'No rejected leaves found.' });
    }
  } catch (err) {
    console.error('Error fetching approved leaves:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    sql.close();
  }
});
app.get('/approved-leaves-manager', authenticateJWT, async (req, res) => {
  try {
    // Open SQL connection
    const pool = await sql.connect(config1);
    const request = pool.request();

    // Query to fetch all leaves with status 'Approved by Manager'
    const query = `
      SELECT * FROM [dbo].[LEAVE_REQUEST]
      WHERE APPROVED_BY_MANAGER = 1 AND STATUS = 'Approved by Manager'
    `;

    // Execute the query
    const result = await request.query(query);

    if (result.recordset.length > 0) {
      // Return all the approved leaves by manager
      res.status(200).json({ message: 'Approved leaves fetched successfully', approvedLeaves: result.recordset });
    } else {
      // No approved leaves found
      res.status(404).json({ message: 'No approved leaves found.' });
    }
  } catch (err) {
    // Handle errors
    console.error('Error fetching approved leaves:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    // Close SQL connection
    sql.close();
  }
});




app.get('/rejected-leaves', authenticateJWT, async (req, res) => {
  const { designation } = req.user; // Extracted from JWT

  try {
    const pool = await sql.connect(config1);
    const request = pool.request();
    
    let query = '';

    // Fetch rejected leaves based on designation
    if (designation === 'Manager') {
      query = `
        SELECT * FROM [dbo].[LEAVE_REQUEST]
        WHERE APPROVED_BY_MANAGER = 0 AND STATUS = 'Rejected'
      `;
    } else if (designation === 'HR') {
      query = `
        SELECT * FROM [dbo].[LEAVE_REQUEST]
        WHERE APPROVED_BY_HR = 0 AND STATUS = 'Rejected'
      `;
    } else {
      return res.status(403).json({ message: 'Unauthorized access. Only Managers or HR can view this resource.' });
    }

    // Execute the query and fetch results
    const result = await request.query(query);

    if (result.recordset.length > 0) {
      res.status(200).json({ message: 'Rejected leaves fetched successfully', rejectedLeaves: result.recordset });
    } else {
      res.status(404).json({ message: 'No rejected leaves found.' });
    }
  } catch (err) {
    console.error('Error fetching rejected leaves:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } 
});




// GET: Fetch meeting attendees from USER_PASSWORD table
app.get('/attendees', async (req, res) => {
  try {
    await sql.connect(config1);
    const result = await sql.query('SELECT EMPL_CODE, employee_name FROM USER_PASSWORD');
    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching attendees:', error);
    res.status(500).json({ error: 'Failed to fetch meeting attendees.' });
  }
});

// POST: Schedule a meeting
app.post('/schedule-meeting', async (req, res) => {
  const { title, start_datetime, end_datetime, description, attendees } = req.body;

  try {
    await sql.connect(config1);
    const query = `
            INSERT INTO MEETING (TITLE, START_DATETIME, END_DATETIME, DESCRIPTION, ATTENDEES)
            VALUES (@title, @start_datetime, @end_datetime, @description, @attendees)
        `;
    const request = new sql.Request();
    request.input('title', sql.VarChar(255), title);
    request.input('start_datetime', sql.DateTime, start_datetime);
    request.input('end_datetime', sql.DateTime, end_datetime);
    request.input('description', sql.VarChar(1000), description);
    request.input('attendees', sql.VarChar(50), attendees.join(','));

    await request.query(query);
    res.json({ message: 'Meeting scheduled successfully!' });
  } catch (error) {
    console.error('Error scheduling meeting:', error);
    res.status(500).json({ error: 'Failed to schedule the meeting.' });
  }
});



// Start the server
console.log(Date);
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
