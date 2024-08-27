const express = require('express');
const sql = require('mssql/msnodesqlv8'); 
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const ExcelJS = require('exceljs');
// const upload = require('./LMS/uploadMiddleware')
const config1 = require('./config1');
const config2 = require('./config2');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


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
app.post('/approve-leave/:id', authenticateJWT, authorizeManagerOrHR,async (req, res) => {
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



app.post('/adjust-leave-balance', authenticateJWT, authorizeManager, async (req, res) => {
  const { emplCode, leaveTypeId, adjustment, reason } = req.body;

  try {
    const pool = await sql.connect(config1);

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
    const pool = await sql.connect(config1);

    // Fetch past and future leaves
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

    const holidays = holidayResult.recordset.map(row => ({
      type: 'holiday',
      holidayName: row.holiday_name,
      date: row.holiday_date,
      description: row.holiday_description
    }));

    // Combine and sort the results
    const calendar = [...leaves, ...holidays].sort((a, b) => new Date(a.startDate || a.date) - new Date(b.startDate || b.date));

    res.json(calendar);
  } catch (err) {
    console.error('Error fetching leave calendar:', err);
    res.status(500).json({ error: 'Internal server error' });
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



// Start the server

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
