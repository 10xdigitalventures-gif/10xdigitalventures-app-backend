const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const { body, query, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.get('/:channelId', auth, [
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isISO8601()
], validate, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before;

  try {
    const [membership] = await db.query(
      'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [req.params.channelId, req.user.id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this channel' });
    }

    let sql = `
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('emoji', r.emoji, 'user_id', r.user_id))
         FROM reactions r WHERE r.message_id = m.id) as reactions,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', ms.user_id, 'delivered_at', ms.delivered_at, 'read_at', ms.read_at))
         FROM message_status ms WHERE ms.message_id = m.id) as status
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.channel_id = ? AND m.is_deleted = 0
    `;
    const params = [req.params.channelId];

    if (before) {
      sql += ' AND m.created_at < ?';
      params.push(before);
    }

    sql += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(limit);

    const [messages] = await db.query(sql, params);
    res.json({ data: messages.reverse() });
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:channelId', auth, [
  body('content').notEmpty().trim(),
  body('type').optional().isIn(['text', 'file', 'image', 'audio', 'video', 'voice']),
  body('reply_to').optional().isUUID()
], validate, async (req, res) => {
  const { content, type = 'text', reply_to } = req.body;

  try {
    const [membership] = await db.query(
      'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [req.params.channelId, req.user.id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this channel' });
    }

    const msgId = uuidv4();
    await db.query(
      'INSERT INTO messages (id, channel_id, sender_id, content, type, reply_to) VALUES (?, ?, ?, ?, ?, ?)',
      [msgId, req.params.channelId, req.user.id, content, type, reply_to || null]
    );
    res.json({ data: { id: msgId, content, type } });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', auth, [
  body('content').notEmpty().trim()
], validate, async (req, res) => {
  const { content } = req.body;
  try {
    const [msg] = await db.query('SELECT sender_id FROM messages WHERE id = ?', [req.params.id]);
    if (!msg.length || msg[0].sender_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await db.query(
      'UPDATE messages SET content = ?, is_edited = 1 WHERE id = ?',
      [content, req.params.id]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const [msg] = await db.query('SELECT sender_id FROM messages WHERE id = ?', [req.params.id]);
    if (!msg.length || msg[0].sender_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await db.query(
      'UPDATE messages SET is_deleted = 1 WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/react', auth, [
  body('emoji').notEmpty()
], validate, async (req, res) => {
  const { emoji } = req.body;
  try {
    const [msg] = await db.query('SELECT channel_id FROM messages WHERE id = ?', [req.params.id]);
    if (!msg.length) return res.status(404).json({ message: 'Message not found' });

    const [membership] = await db.query(
      'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [msg[0].channel_id, req.user.id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this channel' });
    }

    const [existing] = await db.query(
      'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [req.params.id, req.user.id, emoji]
    );
    if (existing.length > 0) {
      await db.query('DELETE FROM reactions WHERE id = ?', [existing[0].id]);
      return res.json({ action: 'removed' });
    }
    await db.query(
      'INSERT INTO reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user.id, emoji]
    );
    res.json({ action: 'added' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
