const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const ffmpeg = require('fluent-ffmpeg');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 }
});

router.post('/upload/:channelId', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

  try {
    const [membership] = await db.query(
      'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [req.params.channelId, req.user.id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this channel' });
    }

    const publicBaseUrl = process.env.PUBLIC_API_URL || process.env.APP_URL || process.env.CLIENT_URL || '';
    const fileUrl = `${publicBaseUrl.replace(/\/$/, '')}/uploads/${req.file.filename}`;
    const mime = req.file.mimetype;

    let msgType = 'file';
    if (mime.startsWith('image/')) msgType = 'image';
    else if (mime.startsWith('audio/')) msgType = 'audio';
    else if (mime.startsWith('video/')) msgType = 'video';

    // Check if it's a voice note (often sent as audio/m4a or similar with a flag)
    if (req.body.is_voice === 'true') msgType = 'voice';

    const msgId = uuidv4();

    // Extract metadata for audio/video if possible
    let duration = null, width = null, height = null;
    if (msgType === 'audio' || msgType === 'video' || msgType === 'voice') {
      try {
        // Attempt to probe with ffmpeg (requires ffmpeg binary on system)
        // For now, we'll also accept these as body params from the client for better reliability
        duration = req.body.duration ? parseFloat(req.body.duration) : null;
        width = req.body.width ? parseInt(req.body.width) : null;
        height = req.body.height ? parseInt(req.body.height) : null;
      } catch (e) {}
    }

    await db.query(
      'INSERT INTO messages (id, channel_id, sender_id, content, type) VALUES (?, ?, ?, ?, ?)',
      [msgId, req.params.channelId, req.user.id, req.file.originalname, msgType]
    );

    await db.query(
      'INSERT INTO attachments (id, message_id, file_name, file_type, file_size, file_url, duration, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), msgId, req.file.originalname, req.file.mimetype, req.file.size, fileUrl, duration, width, height]
    );

    const [senderInfo] = await db.query('SELECT name, avatar FROM users WHERE id = ?', [req.user.id]);
    const msg = {
      id: msgId,
      channel_id: req.params.channelId,
      content: req.file.originalname,
      type: msgType,
      reply_to: null,
      sender_id: req.user.id,
      sender_name: senderInfo[0] ? senderInfo[0].name : null,
      sender_avatar: senderInfo[0] ? senderInfo[0].avatar : null,
      file_url: fileUrl,
      file_name: req.file.originalname,
      file_type: req.file.mimetype,
      file_size: req.file.size,
      duration, width, height,
      created_at: new Date(),
      reactions: [],
      status: []
    };

    try {
      const [members] = await db.query(
        'SELECT user_id FROM channel_members WHERE channel_id = ? AND user_id != ?',
        [req.params.channelId, req.user.id]
      );
      for (const mem of members) {
        await db.query('INSERT INTO message_status (message_id, user_id) VALUES (?, ?)', [msgId, mem.user_id]);
      }
    } catch (e) {}

    const io = req.app.get('io');
    if (io) io.to(req.params.channelId).emit('message:new', msg);

    res.json({
      data: {
        message_id: msgId,
        file_url: fileUrl,
        file_name: req.file.originalname,
        type: msgType,
        metadata: { duration, width, height }
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/channel/:channelId', auth, async (req, res) => {
  try {
    const [membership] = await db.query(
      'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?',
      [req.params.channelId, req.user.id]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this channel' });
    }

    const [files] = await db.query(
      `SELECT a.*, u.name as uploaded_by, m.created_at
       FROM attachments a
       JOIN messages m ON a.message_id = m.id
       JOIN users u ON m.sender_id = u.id
       WHERE m.channel_id = ? AND m.is_deleted = 0
       ORDER BY m.created_at DESC`,
      [req.params.channelId]
    );
    res.json({ data: files });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
