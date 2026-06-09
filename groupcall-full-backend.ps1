# =====================================================================
# Backend: Group call mesh signalling (gcall:*)
#
# Adds these socket events to socket/index.js:
#   gcall:join     -> client joins channel call room
#   gcall:leave    -> client leaves
#   gcall:peers    -> server -> joiner with current peer list
#   gcall:joined   -> server -> existing peers when a new one joins
#   gcall:left     -> server -> remaining peers when one leaves
#   gcall:offer    -> peer -> peer SDP offer relay
#   gcall:answer   -> peer -> peer SDP answer relay
#   gcall:ice      -> peer -> peer ICE candidate relay
#   gcall:state    -> mute/cam state broadcast
#   gcall:ring     -> server -> all channel members when call starts
#
# Run:
#   cd path\to\10xdigitalventures-app-backend
#   powershell -ExecutionPolicy Bypass -File .\groupcall-full-backend.ps1
#   pm2 restart all
# =====================================================================

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Read-FileUtf8([string]$Path) {
    $abs = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
    return [System.IO.File]::ReadAllText($abs, [System.Text.UTF8Encoding]::new($false))
}
function Write-FileUtf8NoBom([string]$Path, [string]$Content) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $abs = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
    [System.IO.File]::WriteAllText($abs, $Content, $utf8NoBom)
    Write-Host "  wrote: $Path"
}

Write-Host "[1/1] Adding group call signalling to socket/index.js..."

$path = "socket/index.js"
$sock = Read-FileUtf8 $path

if ($sock -match "gcall:join") {
    Write-Host "  = gcall handlers already present (skipped)"
} else {
    $gcallBlock = @'

  // ============== GROUP CALL MESH SIGNALLING ==============
  // Per-channel call rooms tracked in memory (Map<channelId, Map<userId, {name, type}>>)
  if (!io.__groupCalls) io.__groupCalls = new Map();
  const gcRooms = io.__groupCalls;

  socket.on('gcall:join', ({ channel_id, name, type }) => {
    if (!channel_id) return;
    let room = gcRooms.get(channel_id);
    const wasEmpty = !room || room.size === 0;
    if (!room) { room = new Map(); gcRooms.set(channel_id, room); }
    room.set(userId, { name: name || 'User', type: type || 'audio' });
    socket.join('gcall:' + channel_id);

    // Send the joiner the current peer list (excluding self)
    const peers = [];
    room.forEach((info, uid) => { if (uid !== userId) peers.push({ user_id: uid, ...info }); });
    socket.emit('gcall:peers', { channel_id, peers });

    // Notify peers already in the room
    socket.to('gcall:' + channel_id).emit('gcall:joined', { channel_id, user_id: userId, name: name || 'User', type: type || 'audio' });

    // If this is the FIRST joiner, ring all other channel members
    if (wasEmpty) {
      db.query('SELECT user_id FROM channel_members WHERE channel_id = ? AND user_id != ?', [channel_id, userId])
        .then(([rows]) => {
          rows.forEach(r => io.to('user:' + r.user_id).emit('gcall:ring', { channel_id, from: userId, fromName: name || 'User', type: type || 'audio' }));
        })
        .catch(() => {});
    }
  });

  socket.on('gcall:leave', ({ channel_id }) => {
    if (!channel_id) return;
    const room = gcRooms.get(channel_id);
    if (room) {
      room.delete(userId);
      if (room.size === 0) gcRooms.delete(channel_id);
    }
    socket.leave('gcall:' + channel_id);
    socket.to('gcall:' + channel_id).emit('gcall:left', { channel_id, user_id: userId });
  });

  socket.on('gcall:offer',  ({ channel_id, to, sdp })       => { io.to('user:' + to).emit('gcall:offer',  { channel_id, from: userId, sdp }); });
  socket.on('gcall:answer', ({ channel_id, to, sdp })       => { io.to('user:' + to).emit('gcall:answer', { channel_id, from: userId, sdp }); });
  socket.on('gcall:ice',    ({ channel_id, to, candidate }) => { io.to('user:' + to).emit('gcall:ice',    { channel_id, from: userId, candidate }); });
  socket.on('gcall:state',  ({ channel_id, muted, camOff }) => { socket.to('gcall:' + channel_id).emit('gcall:state', { channel_id, user_id: userId, muted: !!muted, camOff: !!camOff }); });

'@

    # Insert gcallBlock just before the `socket.on('disconnect'` handler
    $needle = "socket.on('disconnect'"
    $idx = $sock.IndexOf($needle)
    if ($idx -lt 0) { throw "Could not find 'disconnect' handler in socket/index.js" }
    $sock = $sock.Substring(0, $idx) + $gcallBlock + "`r`n  " + $sock.Substring($idx)

    # Insert group call cleanup inside the disconnect handler
    $disconnectExtra = @"

      // Group call cleanup
      try {
        if (io.__groupCalls) {
          io.__groupCalls.forEach((room, channel_id) => {
            if (room.has(userId)) {
              room.delete(userId);
              io.to('gcall:' + channel_id).emit('gcall:left', { channel_id, user_id: userId });
              if (room.size === 0) io.__groupCalls.delete(channel_id);
            }
          });
        }
      } catch (e) {}
"@
    $marker = "io.emit('user:offline', { user_id: userId });"
    if ($sock.Contains($marker)) {
        $sock = $sock.Replace($marker, $disconnectExtra.Trim() + "`r`n        " + $marker)
    }

    Write-FileUtf8NoBom -Path $path -Content $sock
    Write-Host "  + added gcall:* signalling"
}

Write-Host ""
Write-Host "================================================================="
Write-Host "BACKEND DONE. Next: pm2 restart all"
Write-Host "================================================================="
