# ============================================================================
#  10x Chat BACKEND — show real peer name for DMs + richer chat list
#  Run from the BACKEND repo root (10xdigitalventures-app-backend):
#      cd path\to\10xdigitalventures-app-backend
#      powershell -ExecutionPolicy Bypass -File .\fix-dm-name.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
if (-not (Test-Path ".\routes\channels.js")) {
  Write-Host "ERROR: routes\channels.js not found. Run from the backend repo root." -ForegroundColor Red
  exit 1
}

function Patch($Path, $Find, $Replace) {
  $full = Join-Path (Get-Location) $Path
  $c = [System.IO.File]::ReadAllText($full)
  if ($c.Contains($Replace)) { Write-Host "  already patched: $Path" -ForegroundColor DarkGray; return }
  if (-not $c.Contains($Find)) { Write-Host "  pattern NOT found in $Path (already changed?)" -ForegroundColor Yellow; return }
  if (-not (Test-Path "$full.bak")) { Copy-Item $full "$full.bak" -Force }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($full, $c.Replace($Find, $Replace), $enc)
  Write-Host "  patched: $Path" -ForegroundColor Green
}

Write-Host "`nEnriching GET /channels (DM names, last message, unread)..." -ForegroundColor Cyan

$getFind = @'
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
'@

$getRepl = @'
router.get('/', auth, async (req, res) => {
  try {
    const uid = req.user.id;
    const [channels] = await db.query(
      `SELECT c.*, cm.role,
        (SELECT u.name   FROM channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = c.id AND m.user_id <> ? LIMIT 1) AS peer_name,
        (SELECT u.avatar FROM channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = c.id AND m.user_id <> ? LIMIT 1) AS peer_avatar,
        (SELECT m.user_id FROM channel_members m WHERE m.channel_id = c.id AND m.user_id <> ? LIMIT 1) AS peer_id,
        (SELECT u.is_online FROM channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = c.id AND m.user_id <> ? LIMIT 1) AS peer_online,
        (SELECT msg.content   FROM messages msg WHERE msg.channel_id = c.id AND msg.is_deleted = 0 ORDER BY msg.created_at DESC LIMIT 1) AS lm_content,
        (SELECT msg.type      FROM messages msg WHERE msg.channel_id = c.id AND msg.is_deleted = 0 ORDER BY msg.created_at DESC LIMIT 1) AS lm_type,
        (SELECT msg.sender_id FROM messages msg WHERE msg.channel_id = c.id AND msg.is_deleted = 0 ORDER BY msg.created_at DESC LIMIT 1) AS lm_sender_id,
        (SELECT su.name FROM messages msg JOIN users su ON su.id = msg.sender_id WHERE msg.channel_id = c.id AND msg.is_deleted = 0 ORDER BY msg.created_at DESC LIMIT 1) AS lm_sender_name,
        (SELECT msg.created_at FROM messages msg WHERE msg.channel_id = c.id AND msg.is_deleted = 0 ORDER BY msg.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT COUNT(*) FROM messages msg LEFT JOIN message_status ms ON ms.message_id = msg.id AND ms.user_id = ?
           WHERE msg.channel_id = c.id AND msg.sender_id <> ? AND msg.is_deleted = 0 AND ms.read_at IS NULL) AS unread_count
       FROM channels c JOIN channel_members cm ON c.id = cm.channel_id
       WHERE cm.user_id = ?
       ORDER BY (last_message_at IS NULL), last_message_at DESC`,
      [uid, uid, uid, uid, uid, uid, uid]
    );

    const data = channels.map((c) => {
      const isDM = c.type === 'dm';
      return {
        ...c,
        name: isDM && c.peer_name ? c.peer_name : c.name,
        avatar: isDM ? (c.peer_avatar || null) : c.avatar,
        last_message: (c.lm_content !== null && c.lm_content !== undefined)
          ? { content: c.lm_content, type: c.lm_type, sender_id: c.lm_sender_id, sender_name: c.lm_sender_name }
          : null,
        unread_count: Number(c.unread_count) || 0,
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('channels list error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
'@
Patch "routes\channels.js" $getFind $getRepl

Write-Host "`nReturning peer name when a DM is opened/created..." -ForegroundColor Cyan

$dmFind = @'
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
'@

$dmRepl = @'
router.post('/dm/:userId', auth, async (req, res) => {
  const targetUserId = req.params.userId;
  const currentUserId = req.user.id;
  if (targetUserId === currentUserId) return res.status(400).json({ message: 'Cannot chat with yourself' });

  try {
    const [peerRows] = await db.query('SELECT id, name, avatar FROM users WHERE id = ?', [targetUserId]);
    const peer = peerRows[0] || {};

    const [existing] = await db.query(
      'SELECT c.id FROM channels c JOIN channel_members cm1 ON c.id = cm1.channel_id JOIN channel_members cm2 ON c.id = cm2.channel_id WHERE c.type = "dm" AND cm1.user_id = ? AND cm2.user_id = ?',
      [currentUserId, targetUserId]
    );

    if (existing.length > 0) {
      return res.json({ data: { id: existing[0].id, type: 'dm', name: peer.name, avatar: peer.avatar, peer_id: targetUserId } });
    }

    const channelId = uuidv4();
    await db.query('INSERT INTO channels (id, workspace_id, name, type, created_by) VALUES (?, ?, ?, ?, ?)', [channelId, req.user.workspace_id, 'Direct Message', 'dm', currentUserId]);
    await db.query('INSERT INTO channel_members (id, channel_id, user_id) VALUES (?, ?, ?), (?, ?, ?)', [uuidv4(), channelId, currentUserId, uuidv4(), channelId, targetUserId]);

    res.json({ data: { id: channelId, type: 'dm', name: peer.name, avatar: peer.avatar, peer_id: targetUserId } });
  } catch (err) {
    console.error('Error creating DM:', err);
    res.status(500).json({ message: 'Server error creating DM' });
  }
});
'@
Patch "routes\channels.js" $dmFind $dmRepl

Write-Host "`nDone." -ForegroundColor Cyan
$doGit = Read-Host "Commit and push backend? (y/n)"
if ($doGit -eq 'y') {
  git add "routes/channels.js"
  git commit -m "feat(api): DM channels return peer name/avatar; channel list returns last message + unread count"
  $push = Read-Host "Push now? (y/n)"
  if ($push -eq 'y') { git push; Write-Host "`nPushed. Restart the API (pm2 restart) to apply." -ForegroundColor Green }
  else { Write-Host "`nCommitted locally. Push later with: git push" -ForegroundColor Yellow }
} else {
  Write-Host "`nSkipped git. Review with: git diff" -ForegroundColor Yellow
}
Write-Host "After deploy, restart the Node process (e.g. pm2 restart <app>) so the route reloads." -ForegroundColor Yellow