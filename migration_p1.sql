-- Phase P1: WhatsApp Features Migration

-- 3.1 Delivery & Read Receipts
CREATE TABLE IF NOT EXISTS message_status (
  message_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  delivered_at TIMESTAMP NULL,
  read_at TIMESTAMP NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 3.2 Richer Media
-- Update messages.type ENUM
ALTER TABLE messages MODIFY COLUMN type ENUM('text', 'file', 'image', 'audio', 'video', 'voice') DEFAULT 'text';

-- Update attachments with metadata
ALTER TABLE attachments ADD COLUMN duration FLOAT DEFAULT NULL;
ALTER TABLE attachments ADD COLUMN width INT DEFAULT NULL;
ALTER TABLE attachments ADD COLUMN height INT DEFAULT NULL;
ALTER TABLE attachments ADD COLUMN thumbnail_url VARCHAR(500) DEFAULT NULL;

-- 3.3 Push Notifications
CREATE TABLE IF NOT EXISTS device_tokens (
  user_id VARCHAR(36) NOT NULL,
  token VARCHAR(255) NOT NULL,
  platform ENUM('ios', 'android', 'web') DEFAULT 'android',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, token),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Mute setting
ALTER TABLE channel_members ADD COLUMN muted TINYINT(1) DEFAULT 0;
