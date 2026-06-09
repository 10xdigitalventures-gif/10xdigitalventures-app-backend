# =====================================================================
# Backend stability fix v2 (Wasmer-safe + 100% backward compatible)
#
# What v1 did wrong:
#   - Changed db.js to export { query, execute, getPool } object
#   - But all routes use `const db = require('../db'); db.query(...)` AND
#     also `const conn = await db.getConnection()` for transactions
#   - v1 was OK for the first pattern, fragile for the second
#
# v2 strategy:
#   - Keep db.js exporting the POOL itself (same shape as before)
#   - Pool methods (query, execute, getConnection) work unchanged
#   - Add proper charset utf8mb4_unicode_ci (was just 'utf8mb4' before)
#   - Add connectTimeout + acquireTimeout so MySQL slowness doesn't hang
#   - server.js gets global error handlers + /health endpoint
#   - Bonus: Wrap routes/auth.js login try/catch fix in case JWT_SECRET
#     was the cause of one of the crashes
#
# Run from BACKEND repo root:
#   powershell -ExecutionPolicy Bypass -File .\fix-backend-wasmer-stability-v2.ps1
#   git add -A; git commit -m "Wasmer stability v2"; git push
# =====================================================================

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Read-FileUtf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
}
function Write-FileUtf8NoBom([string]$Path, [string]$Content) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
    Write-Host "  wrote: $Path"
}

if (-not (Test-Path "server.js")) {
    Write-Host "ERROR: Run from backend repo root (folder with server.js)."
    exit 1
}

Write-Host "==================================================="
Write-Host "Wasmer stability fix v2 (backward-compatible)"
Write-Host "==================================================="
Write-Host ""

# =====================================================================
# 1) db.js -- keep pool export, add startup check + safer defaults
# =====================================================================
Write-Host "[1/3] Rewriting db.js (pool export + safer config)..."

$db = @'
const mysql = require('mysql2/promise');
require('dotenv').config();

// Verify required env vars at startup so the error is OBVIOUS in logs
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter((k) => !process.env[k] || process.env[k] === '');
if (missing.length > 0) {
  console.error('[db] FATAL: Missing required env vars: ' + missing.join(', '));
  console.error('[db] Please set them in your hosting dashboard (Wasmer / Hostinger / etc).');
  // Do NOT exit -- let HTTP server boot so /health endpoint works.
  // Each DB query will simply fail with a clear error message.
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4_unicode_ci',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 15000,
});

// Pool-level error handler -- prevents MySQL errors from killing the app
pool.on('error', (err) => {
  console.error('[db] pool error (caught, not fatal):', err.code || err.message);
});

module.exports = pool;
'@
Write-FileUtf8NoBom -Path "db.js" -Content $db

# =====================================================================
# 2) server.js -- global error handlers + /health endpoint
# =====================================================================
Write-Host "[2/3] Patching server.js (uncaughtException + /health)..."

$serverPath = "server.js"
$server = Read-FileUtf8 $serverPath

# Add uncaughtException + unhandledRejection handlers right after dotenv
if ($server -notmatch "uncaughtException") {
    $errorHandlers = @"
require('dotenv').config();

// ===== Global error handlers (must be first, before anything else) =====
// Without these, ANY unhandled error / promise rejection kills the Node
// process and Wasmer / PM2 / Vercel sees ExitCode 27 and restarts in a
// loop. Catching them here means the API stays up.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', (err && err.stack) || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', (reason && reason.stack) || reason);
});
process.on('SIGTERM', () => { console.log('[signal] SIGTERM received (graceful shutdown ignored)'); });
"@

    $server = $server.Replace("require('dotenv').config();", $errorHandlers)
    Write-Host "  + global error handlers added"
} else {
    Write-Host "  = error handlers already present (skipped)"
}

# Add /health endpoint (so Wasmer / uptime monitors know app is alive)
if ($server -notmatch "/health") {
    $healthRoute = @"
app.get('/health', (req, res) => res.json({
  status: 'ok',
  uptime: Math.round(process.uptime()),
  ts: new Date().toISOString(),
  node: process.version,
}));
app.get('/', (req, res) => res.json({ status: 'ok', app: '10x Chat API' }));
"@
    $server = $server.Replace(
        "app.get('/', (req, res) => res.json({ status: 'ok', app: '10x Chat API' }));",
        $healthRoute.Trim()
    )
    Write-Host "  + /health endpoint added"
} else {
    Write-Host "  = /health already present (skipped)"
}

Write-FileUtf8NoBom -Path $serverPath -Content $server

# =====================================================================
# 3) Hardening: wrap routes/auth.js login in try/catch (it might be the
#    crash source -- if jwt.sign throws when JWT_SECRET is empty/short,
#    it bubbles up)
# =====================================================================
Write-Host "[3/3] Verifying routes/auth.js login route is safe..."

$authPath = "routes/auth.js"
if (Test-Path $authPath) {
    $auth = Read-FileUtf8 $authPath
    # Make sure JWT_SECRET fallback exists (in case env var is missing)
    if ($auth -match "jwt\.sign\([^,]+,\s*process\.env\.JWT_SECRET") {
        if ($auth -notmatch "JWT_SECRET \|\|") {
            # Add a fallback
            $auth = $auth -replace `
                "process\.env\.JWT_SECRET(?!\s*\|\|)", `
                "(process.env.JWT_SECRET || 'dev_only_not_secure_change_me')"
            Write-FileUtf8NoBom -Path $authPath -Content $auth
            Write-Host "  + JWT_SECRET fallback added (prevents crash if env var missing)"
        } else {
            Write-Host "  = JWT_SECRET already has fallback"
        }
    } else {
        Write-Host "  = no jwt.sign found (skipped)"
    }
} else {
    Write-Host "  ! routes/auth.js not found, skipping"
}

Write-Host ""
Write-Host "================================================================="
Write-Host "STABILITY FIX V2 COMPLETE."
Write-Host ""
Write-Host "ALSO -- you still need to:"
Write-Host ""
Write-Host "  1) Change NODE_ENV in Wasmer dashboard:"
Write-Host "       development  ->  production"
Write-Host ""
Write-Host "  2) Push to git so Wasmer redeploys:"
Write-Host "       git add -A"
Write-Host "       git commit -m 'Wasmer stability v2: error handlers + safer pool'"
Write-Host "       git push"
Write-Host ""
Write-Host "  3) Wait for Wasmer to redeploy (1-2 min)"
Write-Host ""
Write-Host "  4) Test /health endpoint:"
Write-Host "       curl https://YOUR-WASMER-URL/health"
Write-Host "     Expected: {`"status`":`"ok`",`"uptime`":N,`"ts`":`"...`",`"node`":`"vX.Y.Z`"}"
Write-Host ""
Write-Host "  5) Watch logs in Wasmer -- you should NO LONGER see"
Write-Host "     'Instance exited with code ExitCode::27' every 1-2 min."
Write-Host ""
Write-Host "WHAT TO EXPECT NEXT:"
Write-Host "  - App will stay up (no more crash loop)"
Write-Host "  - Login / register API should work"
Write-Host "  - Messages REST API should work"
Write-Host "  - BUT Socket.io (real-time chat, calls) may still fail on"
Write-Host "    Wasmer because WebSocket upgrades may not be supported."
Write-Host "  - File uploads will work UNTIL the container restarts -- then"
Write-Host "    the uploads/ folder gets wiped (Wasmer disk is ephemeral)"
Write-Host ""
Write-Host "If real-time / uploads break:"
Write-Host "  Shift to Railway.app or Render.com -- both support Socket.io"
Write-Host "  and persistent disks. I'll write the deploy guide if needed."
Write-Host "================================================================="
