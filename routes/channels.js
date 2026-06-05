const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
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
    const [channels] = await db.query(
      'SELECT c.*, cm.role FROM channels c JOIN channel_members cm ON c.id = cm.channel_id WHERE cm.user_id = ?',
      [req.user.id]
    );
    res.json({ data: channels });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', auth, [
  body('name').notEmpty().trim(),
  body('type').optional().isIn(['public', 'private', 'dm']),
  body('topic').optional().trim()
], validate, async (req, res) => {
  const { name, type = 'public', topic = '' } = req.body;

  try {
    const channelId = uuidv4();
    await db.query(
      'INSERT INTO channels (id, workspace_id, name, type, topic, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [channelId, req.user.workspace_id, name, type, topic, req.user.id]
    );
    await db.query(
      'INSERT INTO channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, "admin")',
      [uuidv4(), channelId, req.user.id]
    );
    res.json({ data: { id: channelId, name, type, topic } });
  } catch (err) {
    console.error('Error creating channel:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/:id', auth, [
  body('name').optional().notEmpty().trim(),
  body('topic').optional().trim()
], validate, async (req, res) => {
  const { name, topic } = req.body;
  try {
    const [member] = await db.query('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!member.length || member[0].role !== 'admin') return res.status(403).json({ message: 'Only admins can update channel' });

    await db.query('UPDATE channels SET name = COALESCE(?, name), topic = COALESCE(?, topic) WHERE id = ?', [name, topic, req.params.id]);
    res.json({ message: 'Channel updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/add-member', auth, [
  body('userId').isUUID()
], validate, async (req, res) => {
  const { userId } = req.body;
  try {
    const [member] = await db.query('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!member.length || member[0].role !== 'admin') return res.status(403).json({ message: 'Only admins can add members' });

    const [existing] = await db.query('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?', [req.params.id, userId]);
    if (existing.length > 0) return res.status(400).json({ message: 'User already a member' });

    await db.query('INSERT INTO channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, "member")', [uuidv4(), req.params.id, userId]);
    res.json({ message: 'User added successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/dm/:userId', auth, async (req, res) => {
  const targetUserId = req.params.userId;
  const currentUserId = req.user.id;
  if (targetUserId === currentUserId) return res.status(400).json({ message: 'Cannot chat with yourself' });

  try {
    const [existing] = await db.query(
      'SELECT c.id FROM channels c JOIN channel_members cm1 ON c.id = cm1.channel_id JOIN channel_members cm2 ON c.id = cm2.channel_id WHERE c.type = "dm" AND cm1.user_id = ? AND cm2.user_id = ?',
      [currentUserId, targetUserId]
    );

    if (existing.length > 0) return res.json({ data: { id: existing[0].id, type: 'dm' } });

    const channelId = uuidv4();
    await db.query('INSERT INTO channels (id, workspace_id, name, type, created_by) VALUES (?, ?, ?, ?, ?)', [channelId, req.user.workspace_id, 'Direct Message', 'dm', currentUserId]);
    await db.query('INSERT INTO channel_members (id, channel_id, user_id) VALUES (?, ?, ?), (?, ?, ?)', [uuidv4(), channelId, currentUserId, uuidv4(), channelId, targetUserId]);

    res.json({ data: { id: channelId, type: 'dm' } });
  } catch (err) {
    console.error('Error creating DM:', err);
    res.status(500).json({ message: 'Server error creating DM' });
  }
});

router.get('/:id/members', auth, async (req, res) => {
  try {
    const [members] = await db.query('SELECT u.id, u.name, u.avatar, u.is_online, u.status, cm.role FROM channel_members cm JOIN users u ON cm.user_id = u.id WHERE cm.channel_id = ?', [req.params.id]);
    res.json({ data: members });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/join', auth, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (existing.length > 0) return res.status(400).json({ message: 'Already a member' });
    await db.query('INSERT INTO channel_members (id, channel_id, user_id) VALUES (?, ?, ?)', [uuidv4(), req.params.id, req.user.id]);
    res.json({ message: 'Joined successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
