const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const [calls] = await db.query(
      'SELECT * FROM calls WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );

    res.json({ data: calls });
  } catch (err) {
    console.error('calls list error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', auth, async (req, res) => {
  const {
    peer_id = null,
    peer_name = null,
    type = 'audio',
    direction = 'out',
    status = 'answered',
    duration = 0,
  } = req.body || {};

  try {
    const id = uuidv4();

    await db.query(
      'INSERT INTO calls (id, user_id, peer_id, peer_name, type, direction, status, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.id, peer_id, peer_name, type, direction, status, parseInt(duration) || 0]
    );

    res.json({ data: { id } });
  } catch (err) {
    console.error('log call error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
