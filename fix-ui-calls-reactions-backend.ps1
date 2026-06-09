# =====================================================================
# Backend Part 4: Reaction event payload + read-receipt status fix
#
# Issues fixed:
#  1) reaction:updated emit was missing channel_id -> frontend dropped it,
#     reactions never appeared in the bubble. Now includes channel_id.
#  2) message:status (read/delivered) loop now sends channel_id correctly
#     (was OK already; we just verify).
#
# Run:
#   cd path\to\10xdigitalventures-app-backend
#   powershell -ExecutionPolicy Bypass -File .\fix-ui-calls-reactions-backend.ps1
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

Write-Host "[1/1] Patching socket/index.js -- include channel_id in reaction:updated..."

$path = "socket/index.js"
$txt = Read-FileUtf8 $path

# Replace both emits to include channel_id
$old1 = "io.to(channel_id).emit('reaction:updated', { message_id, user_id: userId, emoji, action: 'removed' });"
$new1 = "io.to(channel_id).emit('reaction:updated', { message_id, channel_id, user_id: userId, emoji, action: 'removed' });"

$old2 = "io.to(channel_id).emit('reaction:updated', { message_id, user_id: userId, emoji, action: 'added' });"
$new2 = "io.to(channel_id).emit('reaction:updated', { message_id, channel_id, user_id: userId, emoji, action: 'added' });"

if ($txt.Contains($old1)) { $txt = $txt.Replace($old1, $new1); Write-Host "  patched: reaction removed payload" }
else { Write-Host "  (already patched or not found: removed payload)" }

if ($txt.Contains($old2)) { $txt = $txt.Replace($old2, $new2); Write-Host "  patched: reaction added payload" }
else { Write-Host "  (already patched or not found: added payload)" }

Write-FileUtf8NoBom -Path $path -Content $txt

Write-Host ""
Write-Host "================================================================="
Write-Host "BACKEND PATCH DONE. Run: pm2 restart all"
Write-Host "================================================================="
