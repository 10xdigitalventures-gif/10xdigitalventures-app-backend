
## Phase P1 Updates
- Added `message_status` table for delivery/read receipts.
- Expanded `messages.type` to include audio, video, and voice.
- Added `device_tokens` for push notifications.
- Added `muted` column to `channel_members`.
- New dependencies: `expo-server-sdk`, `fluent-ffmpeg`.
- Note: FFmpeg binary should be installed on the system for best results with media metadata.
