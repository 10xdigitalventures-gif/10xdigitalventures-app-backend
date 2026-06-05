const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.get('/', auth, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, avatar, bio, status, is_online, last_seen FROM users WHERE workspace_id = ?',
      [req.user.workspace_id]
    );
    res.json({ data: users });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/profile', auth, [
  body('name').optional().notEmpty().trim(),
  body('bio').optional().trim(),
  body('status').optional().trim()
], validate, async (req, res) => {
  const { name, bio, status } = req.body;
  try {
    await db.query(
      'UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio), status = COALESCE(?, status) WHERE id = ?',
      [name, bio, status, req.user.id]
    );
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

router.post('/device-token', auth, [
  body('token').notEmpty(),
  body('platform').optional().isIn(['ios', 'android', 'web'])
], validate, async (req, res) => {
  const { token, platform = 'android' } = req.body;
  try {
    await db.query(
      'INSERT INTO device_tokens (user_id, token, platform) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE platform = ?',
      [req.user.id, token, platform, platform]
    );
    res.json({ message: 'Token registered' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/device-token/:token', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM device_tokens WHERE user_id = ? AND token = ?',
      [req.user.id, req.params.token]
    );
    res.json({ message: 'Token removed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});
