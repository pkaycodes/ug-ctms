const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
require('dotenv').config();

/**
 * Signing key for session tokens.
 *
 * There is deliberately no hardcoded fallback here. A secret committed to a
 * public repository is not a secret - anyone reading the repo could mint an
 * admin token with it. In development an ephemeral key is generated instead,
 * so the app still starts; the only cost is that tokens do not survive a
 * restart.
 */
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn(
    '[auth] JWT_SECRET is not set - using an ephemeral key for this run. ' +
      'Set it in .env before deploying.'
  );
}

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ctms_ug',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
});

// Test Database Connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Connected to PostgreSQL database (ctms_ug)');
  }
});

// Helper: Authentication Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (ex) {
    res.status(400).json({ error: 'Invalid token.' });
  }
};

// ----------------------------------------------------
// 1. AUTHENTICATION
// ----------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];
    
    // Compare against the stored bcrypt hash. There is deliberately no
    // "magic password" shortcut here: a constant that satisfies every account
    // is a backdoor, not a convenience.
    const validPassword = await bcrypt.compare(password, user.password).catch(() => false);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Fetch role-specific details
    let roleDetails = {};
    if (user.role === 'student') {
      const s = await pool.query('SELECT id, student_id, programme, level FROM students WHERE user_id = $1', [user.id]);
      roleDetails = s.rows[0] || {};
    } else if (user.role === 'lecturer') {
      const l = await pool.query('SELECT id, lecturer_id, department FROM lecturers WHERE user_id = $1', [user.id]);
      roleDetails = l.rows[0] || {};
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name, email: user.email, ...roleDetails },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        ...roleDetails
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ----------------------------------------------------
// 2. STUDENT WORKFLOW
// ----------------------------------------------------

// Get tutorials for courses the student is enrolled in
app.get('/api/student/tutorials', authenticate, async (req, res) => {
  try {
    const student = await pool.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    if (student.rows.length === 0) return res.status(404).json({ error: 'Student profile not found.' });

    const studentId = student.rows[0].id;
    const query = `
      SELECT t.id, t.date, t.start_time, t.end_time, t.teams_link, t.status,
             c.course_code, c.course_name, u.name AS lecturer_name,
             EXISTS(SELECT 1 FROM student_attendance sa WHERE sa.tutorial_id = t.id AND sa.student_id = $1) AS has_attended,
             EXISTS(SELECT 1 FROM feedback f WHERE f.tutorial_id = t.id AND f.student_id = $1) AS has_feedback
      FROM tutorials t
      JOIN courses c ON t.course_id = c.id
      JOIN course_enrollments ce ON ce.course_id = c.id
      JOIN lecturers l ON t.lecturer_id = l.id
      JOIN users u ON l.user_id = u.id
      WHERE ce.student_id = $1
      ORDER BY t.date DESC, t.start_time ASC;
    `;
    const result = await pool.query(query, [studentId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch student tutorials.' });
  }
});

// Join Tutorial: records attendance and returns the Teams URL
app.post('/api/tutorials/:id/join', authenticate, async (req, res) => {
  const tutorialId = req.params.id;
  try {
    const studentRes = await pool.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    if (studentRes.rows.length === 0) return res.status(403).json({ error: 'Only students can join as attendees.' });
    const studentId = studentRes.rows[0].id;

    // Verify tutorial exists
    const tutRes = await pool.query('SELECT teams_link, status FROM tutorials WHERE id = $1', [tutorialId]);
    if (tutRes.rows.length === 0) return res.status(404).json({ error: 'Tutorial not found.' });

    // Record attendance (duplicate entries ignored by UNIQUE constraint)
    await pool.query(
      `INSERT INTO student_attendance (tutorial_id, student_id) 
       VALUES ($1, $2) ON CONFLICT (tutorial_id, student_id) DO NOTHING`,
      [tutorialId, studentId]
    );

    res.json({ success: true, teams_link: tutRes.rows[0].teams_link });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join tutorial.' });
  }
});

// Submit Feedback (Rule 11: Attended students only; Rule 12: 1 submission max)
app.post('/api/tutorials/:id/feedback', authenticate, async (req, res) => {
  const tutorialId = req.params.id;
  const { rating, comment } = req.body;

  try {
    const studentRes = await pool.query('SELECT id FROM students WHERE user_id = $1', [req.user.id]);
    if (studentRes.rows.length === 0) return res.status(403).json({ error: 'Unauthorized.' });
    const studentId = studentRes.rows[0].id;

    // Check attendance
    const attended = await pool.query(
      'SELECT 1 FROM student_attendance WHERE tutorial_id = $1 AND student_id = $2',
      [tutorialId, studentId]
    );
    if (attended.rows.length === 0) {
      return res.status(400).json({ error: 'You must attend the tutorial before submitting feedback.' });
    }

    // Basic NLP Sentiment Classification
    let sentiment = 'neutral';
    const lowerComment = (comment || '').toLowerCase();
    const positiveWords = ['great', 'clear', 'good', 'excellent', 'helpful', 'well', 'best', 'enjoyed'];
    const negativeWords = ['poor', 'bad', 'late', 'confusing', 'difficult', 'worst', 'terrible'];
    
    const posHits = positiveWords.filter(w => lowerComment.includes(w)).length;
    const negHits = negativeWords.filter(w => lowerComment.includes(w)).length;

    if (posHits > negHits || rating >= 4) sentiment = 'positive';
    else if (negHits > posHits || rating <= 2) sentiment = 'negative';

    await pool.query(
      `INSERT INTO feedback (tutorial_id, student_id, rating, comment, sentiment)
       VALUES ($1, $2, $3, $4, $5)`,
      [tutorialId, studentId, rating, comment, sentiment]
    );

    res.json({ success: true, message: 'Feedback submitted successfully.', sentiment });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'You have already submitted feedback for this tutorial.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to submit feedback.' });
  }
});

// ----------------------------------------------------
// 3. LECTURER WORKFLOW
// ----------------------------------------------------

// Get Lecturer's assigned tutorials
app.get('/api/lecturer/tutorials', authenticate, async (req, res) => {
  try {
    const lecturer = await pool.query('SELECT id FROM lecturers WHERE user_id = $1', [req.user.id]);
    if (lecturer.rows.length === 0) return res.status(404).json({ error: 'Lecturer profile not found.' });
    const lecturerId = lecturer.rows[0].id;

    const query = `
      SELECT t.id, t.date, t.start_time, t.end_time, t.teams_link, t.status,
             c.course_code, c.course_name,
             EXISTS(SELECT 1 FROM lecturer_attendance la WHERE la.tutorial_id = t.id AND la.lecturer_id = $1) AS lecturer_attended,
             (SELECT COUNT(*) FROM student_attendance sa WHERE sa.tutorial_id = t.id)::int AS student_attendance_count,
             (SELECT COUNT(*) FROM feedback f WHERE f.tutorial_id = t.id)::int AS feedback_count
      FROM tutorials t
      JOIN courses c ON t.course_id = c.id
      WHERE t.lecturer_id = $1
      ORDER BY t.date DESC, t.start_time ASC;
    `;
    const result = await pool.query(query, [lecturerId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lecturer tutorials.' });
  }
});

// Start Tutorial / Mark Lecturer Attendance
app.post('/api/tutorials/:id/start', authenticate, async (req, res) => {
  const tutorialId = req.params.id;
  try {
    const lecturer = await pool.query('SELECT id FROM lecturers WHERE user_id = $1', [req.user.id]);
    if (lecturer.rows.length === 0) return res.status(403).json({ error: 'Only lecturers can start tutorials.' });
    const lecturerId = lecturer.rows[0].id;

    // Verify tutorial belongs to lecturer
    const tutCheck = await pool.query('SELECT id, teams_link FROM tutorials WHERE id = $1 AND lecturer_id = $2', [tutorialId, lecturerId]);
    if (tutCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You can only start tutorials assigned to you.' });
    }

    // Record attendance
    await pool.query(
      `INSERT INTO lecturer_attendance (tutorial_id, lecturer_id)
       VALUES ($1, $2) ON CONFLICT (tutorial_id, lecturer_id) DO NOTHING`,
      [tutorialId, lecturerId]
    );

    res.json({ success: true, message: 'Tutorial started and attendance recorded.', teams_link: tutCheck.rows[0].teams_link });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record lecturer attendance.' });
  }
});

// Get Eligible Tutorials for Claiming (Rule 7, 8, 23)
app.get('/api/lecturer/claims/eligible', authenticate, async (req, res) => {
  try {
    const lecturer = await pool.query('SELECT id FROM lecturers WHERE user_id = $1', [req.user.id]);
    if (lecturer.rows.length === 0) return res.status(404).json({ error: 'Lecturer not found.' });
    const lecturerId = lecturer.rows[0].id;

    const query = `
      SELECT t.id, t.date, t.start_time, t.end_time, c.course_code, c.course_name,
             (SELECT COUNT(*) FROM student_attendance sa WHERE sa.tutorial_id = t.id)::int AS student_count,
             (SELECT COUNT(*) FROM feedback f WHERE f.tutorial_id = t.id)::int AS feedback_count
      FROM tutorials t
      JOIN courses c ON t.course_id = c.id
      JOIN lecturer_attendance la ON la.tutorial_id = t.id AND la.lecturer_id = $1
      WHERE t.lecturer_id = $1
        AND t.status != 'Cancelled'
        AND (SELECT COUNT(*) FROM student_attendance sa WHERE sa.tutorial_id = t.id) >= 1
        AND (SELECT COUNT(*) FROM feedback f WHERE f.tutorial_id = t.id) >= 1
        AND NOT EXISTS (
          SELECT 1 FROM claim_items ci
          JOIN claims cl ON ci.claim_id = cl.id
          WHERE ci.tutorial_id = t.id AND cl.status IN ('Pending', 'Approved')
        )
      ORDER BY t.date DESC;
    `;
    const result = await pool.query(query, [lecturerId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch eligible tutorials.' });
  }
});

// Submit Claim
app.post('/api/lecturer/claims', authenticate, async (req, res) => {
  const { tutorialIds } = req.body;
  if (!tutorialIds || !tutorialIds.length) {
    return res.status(400).json({ error: 'Please select at least one tutorial to claim.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lecturer = await client.query('SELECT id FROM lecturers WHERE user_id = $1', [req.user.id]);
    const lecturerId = lecturer.rows[0].id;

    // Create Claim record
    const claimRes = await client.query(
      `INSERT INTO claims (lecturer_id, status) VALUES ($1, 'Pending') RETURNING id`,
      [lecturerId]
    );
    const claimId = claimRes.rows[0].id;

    // Insert Claim Items
    for (const tutId of tutorialIds) {
      await client.query(
        `INSERT INTO claim_items (claim_id, tutorial_id) VALUES ($1, $2)`,
        [claimId, tutId]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `Claim #${claimId} submitted successfully with ${tutorialIds.length} tutorial(s).` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to submit claim. Make sure tutorials are not already claimed.' });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------
// 4. ADMINISTRATOR WORKFLOW
// ----------------------------------------------------

// List all claims for admin review
app.get('/api/admin/claims', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied.' });

    const query = `
      SELECT c.id, c.submitted_at, c.status, c.rejection_reason,
             u.name AS lecturer_name, l.department,
             COUNT(ci.id)::int AS session_count
      FROM claims c
      JOIN lecturers l ON c.lecturer_id = l.id
      JOIN users u ON l.user_id = u.id
      LEFT JOIN claim_items ci ON ci.claim_id = c.id
      GROUP BY c.id, u.name, l.department
      ORDER BY c.submitted_at DESC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch claims.' });
  }
});

// Review Claim (Approve or Reject with mandatory reason)
app.post('/api/admin/claims/:id/review', authenticate, async (req, res) => {
  const claimId = req.params.id;
  const { status, rejectionReason } = req.body;

  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can review claims.' });
  if (status === 'Rejected' && !rejectionReason?.trim()) {
    return res.status(400).json({ error: 'Please provide a reason for rejecting this claim.' });
  }

  try {
    await pool.query(
      `UPDATE claims 
       SET status = $1, rejection_reason = $2, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $3
       WHERE id = $4`,
      [status, status === 'Rejected' ? rejectionReason : null, req.user.id, claimId]
    );
    res.json({ success: true, message: `Claim #${claimId} marked as ${status}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update claim status.' });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 UG CTMS Server running on http://localhost:${PORT}`);
});