const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user) =>
  jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });

// Turns low-level errors into a message the frontend can show
function explainError(error, fallback) {
  if (!process.env.JWT_SECRET) return 'Server misconfigured: JWT_SECRET is missing in backend/.env';
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
    return 'Database is not reachable. Check MYSQL_URL in backend/.env';
  }
  if (error.code === 'ER_ACCESS_DENIED_ERROR') return 'Database login failed. Check DB username/password';
  if (error.code === 'ER_BAD_DB_ERROR') return 'Database name does not exist';
  if (error.code === 'ER_NO_SUCH_TABLE') return 'Database tables are missing. Restart the backend once';
  return fallback;
}

// ------------------------------ REGISTER ------------------------------
router.post('/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const [existing] = await pool.query('SELECT id, password FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      const msg = existing[0].password
        ? 'User already exists. Please log in'
        : 'This email is registered with Google. Use "Sign in with Google"';
      return res.status(409).json({ success: false, error: msg });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);

    const user = { id: result.insertId, email };
    res.status(201).json({ success: true, data: { token: signToken(user), user } });
  } catch (error) {
    console.error('[Register Error]', error);
    res.status(500).json({ success: false, error: explainError(error, 'Internal server error') });
  }
});

// -------------------------------- LOGIN --------------------------------
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const user = users[0];

    // Account created through Google has no password -> bcrypt.compare(…, null) used to crash
    if (!user.password) {
      return res.status(400).json({
        success: false,
        error: 'This account uses Google sign-in. Please click "Sign in with Google"',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    res.status(200).json({
      success: true,
      data: { token: signToken(user), user: { id: user.id, email: user.email, name: user.name } },
    });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({ success: false, error: explainError(error, 'Internal server error') });
  }
});

// ---------------------------- GOOGLE SIGN-IN ----------------------------
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, error: 'Google credential is required' });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Server misconfigured: GOOGLE_CLIENT_ID is missing in backend/.env' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload.email || !payload.email_verified) {
      return res.status(401).json({ success: false, error: 'Google email is not verified' });
    }
    const { email: rawEmail, name, sub: googleId } = payload;
    const email = String(rawEmail).toLowerCase();

    const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    let user;
    if (existing.length > 0) {
      user = existing[0];
      if (!user.google_id) {
        await pool.query('UPDATE users SET google_id = ?, name = COALESCE(name, ?) WHERE id = ?', [googleId, name, user.id]);
      }
    } else {
      const [result] = await pool.query('INSERT INTO users (email, google_id, name) VALUES (?, ?, ?)', [email, googleId, name]);
      user = { id: result.insertId, email, google_id: googleId, name };
    }

    res.status(200).json({
      success: true,
      data: { token: signToken(user), user: { id: user.id, email: user.email, name: user.name } },
    });
  } catch (error) {
    console.error('[Google Auth Error]', error);
    res.status(500).json({ success: false, error: explainError(error, 'Google authentication failed') });
  }
});

module.exports = router;
