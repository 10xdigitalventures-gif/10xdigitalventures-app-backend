const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
};

router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    const [users] = await db.query('SELECT id, name, email, status FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/users/:id', auth, isAdmin, async (req, res) => {
  const { role, status } = req.body;
  try {
    await db.query('UPDATE users SET role = ?, status = ? WHERE id = ?', [role, status, req.params.id]);
    res.json({ message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
