CREATE TABLE IF NOT EXISTS calls (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  peer_id VARCHAR(36),
  peer_name VARCHAR(100),
  type VARCHAR(10) DEFAULT 'audio',
  direction VARCHAR(10) DEFAULT 'out',
  status VARCHAR(20) DEFAULT 'answered',
  duration INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_calls_user (user_id, created_at)
);
