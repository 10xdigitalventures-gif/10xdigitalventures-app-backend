const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post('/register', [
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('invite_code').notEmpty()
], validate, async (req, res) => {
  const { name, email, password, invite_code } = req.body;

  try {
    const [workspaces] = await db.query('SELECT * FROM workspaces WHERE invite_code = ?', [invite_code]);
    if (workspaces.length === 0) return res.status(400).json({ message: 'Invalid invite code' });
    const workspace = workspaces[0];

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) return res.status(400).json({ message: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    await db.query(
      'INSERT INTO users (id, workspace_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)',
      [userId, workspace.id, name, email, password_hash]
    );

    const [general] = await db.query(
      'SELECT id FROM channels WHERE workspace_id = ? AND name = "general" LIMIT 1',
      [workspace.id]
    );
    if (general.length > 0) {
      await db.query(
        'INSERT INTO channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, "member")',
        [uuidv4(), general[0].id, userId]
      );
    }

    const token = jwt.sign({ id: userId, email, workspace_id: workspace.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      data: {
        token,
        user: { id: userId, name, email, workspace_id: workspace.id }
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], validate, async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(400).json({ message: 'Invalid credentials' });
    const user = users[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ message: 'Invalid credentials' });

    await db.query('UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?', [user.id]);

    const token = jwt.sign(
      { id: user.id, email: user.email, workspace_id: user.workspace_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      data: {
        token,
        user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, workspace_id: user.workspace_id }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, avatar, bio, status, is_online, workspace_id FROM users WHERE id = ?',
      [req.user.id]
    );
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ data: users[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/profile', authMiddleware, [
  body('name').optional().notEmpty().trim(),
  body('bio').optional().trim(),
  body('status').optional().trim(),
  body('avatar').optional().trim()
], validate, async (req, res) => {
  const { name, bio, status, avatar } = req.body;
  try {
    await db.query(
      'UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio), status = COALESCE(?, status), avatar = COALESCE(?, avatar) WHERE id = ?',
      [name, bio, status, avatar, req.user.id]
    );
    const [user] = await db.query('SELECT id, name, email, avatar, bio, status, is_online FROM users WHERE id = ?', [req.user.id]);
    res.json({ data: user[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error updating profile' });
  }
});

module.exports = router;
