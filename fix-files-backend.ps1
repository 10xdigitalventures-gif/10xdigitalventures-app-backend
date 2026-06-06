# ============================================================================
#  10x Chat BACKEND — fix file/image messages
#   - GET /messages returns file_url/file_name/file_type (joined from attachments)
#   - file upload now BROADCASTS the message over socket (message:new) and
#     creates message_status rows  => images/files appear in realtime
#   - exposes io to routes (app.set('io', io))
#  Run from the BACKEND repo root:
#      cd path\to\10xdigitalventures-app-backend
#      powershell -ExecutionPolicy Bypass -File .\fix-files-backend.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
if (-not (Test-Path ".\routes\files.js")) {
  Write-Host "ERROR: routes\files.js not found. Run from the backend repo root." -ForegroundColor Red
  exit 1
}

function Patch($Path, $Find, $Replace) {
  $full = Join-Path (Get-Location) $Path
  $c = [System.IO.File]::ReadAllText($full)
  if ($c.Contains($Replace)) { Write-Host "  already patched: $Path" -ForegroundColor DarkGray; return }
  if (-not $c.Contains($Find)) { Write-Host "  pattern NOT found in $Path" -ForegroundColor Yellow; return }
  if (-not (Test-Path "$full.bak")) { Copy-Item $full "$full.bak" -Force }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($full, $c.Replace($Find, $Replace), $enc)
  Write-Host "  patched: $Path" -ForegroundColor Green
}

Write-Host "`n[1/3] server.js: expose io to routes..." -ForegroundColor Cyan
$srvFind = @'
require('./socket')(io);
'@
$srvRepl = @'
app.set('io', io);
require('./socket')(io);
'@
Patch "server.js" $srvFind $srvRepl

Write-Host "`n[2/3] routes/messages.js: return file info..." -ForegroundColor Cyan
$msgFind = @'
         FROM message_status ms WHERE ms.message_id = m.id) as status
      FROM messages m
'@
$msgRepl = @'
         FROM message_status ms WHERE ms.message_id = m.id) as status,
        (SELECT a.file_url  FROM attachments a WHERE a.message_id = m.id LIMIT 1) as file_url,
        (SELECT a.file_name FROM attachments a WHERE a.message_id = m.id LIMIT 1) as file_name,
        (SELECT a.file_type FROM attachments a WHERE a.message_id = m.id LIMIT 1) as file_type,
        (SELECT a.duration  FROM attachments a WHERE a.message_id = m.id LIMIT 1) as duration
      FROM messages m
'@
Patch "routes\messages.js" $msgFind $msgRepl

Write-Host "`n[3/3] routes/files.js: broadcast uploaded message over socket..." -ForegroundColor Cyan
$filesFind = @'
    res.json({
      data: {
        message_id: msgId,
        file_url: fileUrl,
        file_name: req.file.originalname,
        type: msgType,
        metadata: { duration, width, height }
      }
    });
'@
$filesRepl = @'
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
'@
Patch "routes\files.js" $filesFind $filesRepl

Write-Host "`nDone." -ForegroundColor Cyan
$doGit = Read-Host "Commit and push backend? (y/n)"
if ($doGit -eq 'y') {
  git add "server.js" "routes/messages.js" "routes/files.js"
  git commit -m "fix(api): return file_url for messages; broadcast uploaded file as message:new"
  $push = Read-Host "Push now? (y/n)"
  if ($push -eq 'y') { git push; Write-Host "`nPushed. Restart the API (pm2 restart) to apply." -ForegroundColor Green }
  else { Write-Host "`nCommitted locally. Push later with: git push" -ForegroundColor Yellow }
} else {
  Write-Host "`nSkipped git. Review with: git diff" -ForegroundColor Yellow
}
Write-Host "Tip: set PUBLIC_API_URL=https://api.10xdigitalventures.com in backend .env for absolute file links (optional)." -ForegroundColor Yellow