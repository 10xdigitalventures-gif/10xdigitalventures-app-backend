const jwt = require('jsonwebtoken');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { sendPushNotification } = require('../lib/notifications');

module.exports = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    console.log(`User connected: ${userId}`); socket.join('user:' + userId);

    try {
      await db.query('UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?', [userId]);
      io.emit('user:online', { user_id: userId });
    } catch (err) {
      console.error('Error updating presence:', err);
    }

    socket.on('join:channels', async () => {
      try {
        const [channels] = await db.query(
          'SELECT channel_id FROM channel_members WHERE user_id = ?',
          [userId]
        );
        channels.forEach(c => socket.join(c.channel_id));
      } catch (err) {
        socket.emit('error', { message: 'Failed to join channels' });
      }
    });

    socket.on('message:send', async (data) => {
      const { channel_id, content, type = 'text', reply_to } = data;
      try {
        const [membership] = await db.query(
          'SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?',
          [channel_id, userId]
        );
        if (membership.length === 0) {
          return socket.emit('error', { message: 'Not a member of this channel' });
        }

        const msgId = uuidv4();
        await db.query(
          'INSERT INTO messages (id, channel_id, sender_id, content, type, reply_to) VALUES (?, ?, ?, ?, ?, ?)',
          [msgId, channel_id, userId, content, type, reply_to || null]
        );

        const [senderInfo] = await db.query('SELECT name, avatar FROM users WHERE id = ?', [userId]);
        const msg = {
          id: msgId,
          channel_id,
          content,
          type,
          reply_to,
          sender_id: userId,
          sender_name: senderInfo[0].name,
          sender_avatar: senderInfo[0].avatar,
          created_at: new Date(),
          reactions: [],
          status: []
        };

        io.to(channel_id).emit('message:new', msg);

        const [members] = await db.query(
          'SELECT user_id, muted FROM channel_members WHERE channel_id = ? AND user_id != ?',
          [channel_id, userId]
        );

        for (const member of members) {
          const sockets = await io.in(channel_id).fetchSockets();
          const isRecipientInRoom = sockets.some(s => s.user.id === member.user_id);

          if (!isRecipientInRoom && !member.muted) {
            sendPushNotification(
              member.user_id,
              `New message from ${msg.sender_name}`,
              type === 'text' ? content : `Sent a ${type}`,
              { channel_id, message_id: msgId }
            );
          }

          await db.query(
            'INSERT INTO message_status (message_id, user_id) VALUES (?, ?)',
            [msgId, member.user_id]
          );
        }
      } catch (err) {
        console.error('Message send error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('message:delivered', async (data) => {
      const { message_id } = data;
      try {
        await db.query(
          'UPDATE message_status SET delivered_at = NOW() WHERE message_id = ? AND user_id = ? AND delivered_at IS NULL',
          [message_id, userId]
        );
        const [msg] = await db.query('SELECT sender_id, channel_id FROM messages WHERE id = ?', [message_id]);
        if (msg.length) {
          io.to(msg[0].channel_id).emit('message:status', { message_id, user_id: userId, status: 'delivered' });
        }
      } catch (err) {}
    });

    socket.on('message:read', async (data) => {
      const { channel_id, message_ids } = data;
      try {
        if (!message_ids || !message_ids.length) return;
        await db.query(
          'UPDATE message_status SET read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW()) WHERE user_id = ? AND message_id IN (?) AND read_at IS NULL',
          [userId, message_ids]
        );
        message_ids.forEach(id => {
          io.to(channel_id).emit('message:status', { message_id: id, user_id: userId, status: 'read' });
        });
      } catch (err) {}
    });

    socket.on('typing:start', async (data) => {
      const { channel_id } = data;
      socket.to(channel_id).emit('typing:start', { user_id: userId, channel_id });
    });

    socket.on('typing:stop', async (data) => {
      const { channel_id } = data;
      socket.to(channel_id).emit('typing:stop', { user_id: userId, channel_id });
    });

    socket.on('message:edit', async (data) => {
      const { message_id, content, channel_id } = data;
      try {
        const [msg] = await db.query('SELECT sender_id FROM messages WHERE id = ?', [message_id]);
        if (!msg.length || msg[0].sender_id !== userId) return;
        await db.query('UPDATE messages SET content = ?, is_edited = 1 WHERE id = ?', [content, message_id]);
        io.to(channel_id).emit('message:edited', { message_id, content });
      } catch (err) {}
    });

    socket.on('message:delete', async (data) => {
      const { message_id, channel_id } = data;
      try {
        const [msg] = await db.query('SELECT sender_id FROM messages WHERE id = ?', [message_id]);
        if (!msg.length || msg[0].sender_id !== userId) return;
        await db.query('UPDATE messages SET is_deleted = 1 WHERE id = ?', [message_id]);
        io.to(channel_id).emit('message:deleted', { message_id, channel_id });
      } catch (err) {}
    });

    socket.on('reaction:toggle', async (data) => {
      const { message_id, channel_id, emoji } = data;
      try {
        const [existing] = await db.query(
          'SELECT id FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
          [message_id, userId, emoji]
        );
        if (existing.length > 0) {
          await db.query('DELETE FROM reactions WHERE id = ?', [existing[0].id]);
          io.to(channel_id).emit('reaction:updated', { message_id, user_id: userId, emoji, action: 'removed' });
        } else {
          await db.query(
            'INSERT INTO reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)',
            [uuidv4(), message_id, userId, emoji]
          );
          io.to(channel_id).emit('reaction:updated', { message_id, user_id: userId, emoji, action: 'added' });
        }
      } catch (err) {}
    });

    
  socket.on('call:offer', (d) => {
    io.to('user:' + d.to).emit('call:offer', {
      from: userId,
      fromName: d.fromName,
      type: d.type,
      sdp: d.sdp,
    });
  });

  socket.on('call:answer', (d) => {
    io.to('user:' + d.to).emit('call:answer', {
      from: userId,
      sdp: d.sdp,
    });
  });

  socket.on('call:ice', (d) => {
    io.to('user:' + d.to).emit('call:ice', {
      from: userId,
      candidate: d.candidate,
    });
  });

  socket.on('call:reject', (d) => {
    io.to('user:' + d.to).emit('call:reject', {
      from: userId,
    });
  });

  socket.on('call:end', (d) => {
    io.to('user:' + d.to).emit('call:end', {
      from: userId,
    });
  });


  // ============== GROUP CALL MESH SIGNALLING ==============
  if (!io.__groupCalls) io.__groupCalls = new Map();
  const gcRooms = io.__groupCalls;

  socket.on('gcall:join', ({ channel_id, name, type }) => {
    if (!channel_id) return;

    let room = gcRooms.get(channel_id);
    if (!room) {
      room = new Map();
      gcRooms.set(channel_id, room);
    }

    room.set(userId, {
      name: name || 'User',
      type: type || 'audio',
    });

    socket.join('gcall:' + channel_id);

    const peers = [];
    room.forEach((info, uid) => {
      if (uid !== userId) {
        peers.push({ user_id: uid, ...info });
      }
    });

    socket.emit('gcall:peers', { channel_id, peers });

    socket.to('gcall:' + channel_id).emit('gcall:joined', {
      channel_id,
      user_id: userId,
      name: name || 'User',
      type: type || 'audio',
    });

    db.query(
      'SELECT user_id FROM channel_members WHERE channel_id = ? AND user_id != ?',
      [channel_id, userId]
    )
      .then(([rows]) => {
        rows.forEach((r) => {
          io.to('user:' + r.user_id).emit('gcall:ring', {
            channel_id,
            from: userId,
            fromName: name || 'User',
            type: type || 'audio',
          });
        });
      })
      .catch(() => {});
  });

  socket.on('gcall:leave', ({ channel_id }) => {
    if (!channel_id) return;

    const room = gcRooms.get(channel_id);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        gcRooms.delete(channel_id);
      }
    }

    socket.leave('gcall:' + channel_id);

    socket.to('gcall:' + channel_id).emit('gcall:left', {
      channel_id,
      user_id: userId,
    });
  });

  socket.on('gcall:offer', ({ channel_id, to, sdp }) => {
    io.to('user:' + to).emit('gcall:offer', {
      channel_id,
      from: userId,
      sdp,
    });
  });

  socket.on('gcall:answer', ({ channel_id, to, sdp }) => {
    io.to('user:' + to).emit('gcall:answer', {
      channel_id,
      from: userId,
      sdp,
    });
  });

  socket.on('gcall:ice', ({ channel_id, to, candidate }) => {
    io.to('user:' + to).emit('gcall:ice', {
      channel_id,
      from: userId,
      candidate,
    });
  });

  socket.on('gcall:state', ({ channel_id, muted, camOff }) => {
    socket.to('gcall:' + channel_id).emit('gcall:state', {
      channel_id,
      user_id: userId,
      muted: !!muted,
      camOff: !!camOff,
    });
  });


  socket.on('disconnect', async () => {
      // Group call cleanup
      try {
        if (io.__groupCalls) {
          io.__groupCalls.forEach((room, channel_id) => {
            if (room.has(userId)) {
              room.delete(userId);
              io.to('gcall:' + channel_id).emit('gcall:left', {
                channel_id,
                user_id: userId,
              });

              if (room.size === 0) {
                io.__groupCalls.delete(channel_id);
              }
            }
          });
        }
      } catch (e) {}


      try {
        await db.query('UPDATE users SET is_online = 0, last_seen = NOW() WHERE id = ?', [userId]);
        io.emit('user:offline', { user_id: userId });
        console.log(`User disconnected: ${userId}`);
      } catch (err) {
        console.error('Error on disconnect:', err);
      }
    });
  });
};
