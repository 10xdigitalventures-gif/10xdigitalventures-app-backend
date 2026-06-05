const db = require('./db');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function seed() {
  try {
    console.log('Seeding database...');

    const workspaceId = uuidv4();
    const inviteCode = 'TENX2024';

    // Check if workspace exists
    const [existing] = await db.query('SELECT id FROM workspaces WHERE invite_code = ?', [inviteCode]);

    if (existing.length === 0) {
      await db.query(
        'INSERT INTO workspaces (id, name, invite_code) VALUES (?, ?, ?)',
        [workspaceId, '10x Digital Ventures', inviteCode]
      );
      console.log('Workspace created with invite code:', inviteCode);

      const channelId = uuidv4();
      await db.query(
        'INSERT INTO channels (id, workspace_id, name, type) VALUES (?, ?, ?, ?)',
        [channelId, workspaceId, 'general', 'public']
      );
      console.log('General channel created.');

      // Create an admin user
      const adminId = uuidv4();
      const passwordHash = await bcrypt.hash('admin123', 10);
      await db.query(
        'INSERT INTO users (id, workspace_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?)',
        [adminId, workspaceId, 'Admin User', 'admin@10x.chat', passwordHash]
      );
      console.log('Admin user created: admin@10x.chat / admin123');

      // Add admin to channel
      await db.query(
        'INSERT INTO channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)',
        [uuidv4(), channelId, adminId, 'admin']
      );
    } else {
      console.log('Workspace already exists.');
    }

    console.log('Seeding completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
