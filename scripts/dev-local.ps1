# Run from any directory: powershell -ExecutionPolicy Bypass -File .\scripts\dev-local.ps1
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        $nodeExecutable = $nodeCommand.Source
    } else {
        # Codex bundles Node on this machine; a normal Node installation also works.
        $nodeExecutable = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        if (-not (Test-Path -LiteralPath $nodeExecutable)) {
            throw "Install Node.js 20.9+ and pnpm, then run pnpm install."
        }
    }
    $env:PATH = "$(Split-Path -Parent $nodeExecutable);$env:PATH"

    if (-not (Test-Path -LiteralPath "node_modules/next/dist/bin/next")) {
        throw "Dependencies are missing. Run pnpm install first."
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Install Docker Desktop and start it before running this script."
    }

    if (-not (Test-Path -LiteralPath ".env.local")) {
        $secret = & $nodeExecutable -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
        if ($LASTEXITCODE -ne 0) { throw "Could not generate the local auth secret." }
        $template = [IO.File]::ReadAllText((Join-Path $projectRoot ".env.example"))
        $localEnv = $template.Replace('AUTH_SECRET=""', ('AUTH_SECRET="' + $secret + '"'))
        [IO.File]::WriteAllText((Join-Path $projectRoot ".env.local"), $localEnv)
        Write-Host "Created .env.local with a fresh local auth secret."
    }

    # Load only this file, and refuse non-local database/email settings before migrations.
    @'
const fs = require('node:fs');
const { parse } = require('dotenv');
const env = parse(fs.readFileSync('.env.local'));
const db = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(db.hostname) || db.port !== '5437' || db.pathname !== '/leaf_log_dev') {
  throw new Error('This launcher requires the local Docker database on localhost:5437/leaf_log_dev.');
}
if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error('Set AUTH_SECRET to at least 32 characters in .env.local.');
for (const name of ['AUTH_URL', 'NEXTAUTH_URL']) {
  if (env[name] !== 'http://localhost:3000') throw new Error(`${name} must be http://localhost:3000 in .env.local.`);
}
if (env.RESEND_API_KEY) throw new Error('Leave RESEND_API_KEY empty for local development.');
'@ | & $nodeExecutable
    if ($LASTEXITCODE -ne 0) { throw "Check the local environment settings above." }

    # Parent-shell values must not override the local configuration.
    "DATABASE_URL", "AUTH_SECRET", "AUTH_URL", "NEXTAUTH_URL", "AUTH_EMAIL_FROM", "RESEND_API_KEY", "NODE_ENV" | ForEach-Object {
        Remove-Item "Env:$_" -ErrorAction SilentlyContinue
    }

    & docker compose up -d --wait
    if ($LASTEXITCODE -ne 0) { throw "Start Docker Desktop, wait until its engine is running, and retry." }

    & $nodeExecutable node_modules/prisma/build/index.js generate
    if ($LASTEXITCODE -ne 0) { throw "Prisma client generation failed." }
    & $nodeExecutable node_modules/prisma/build/index.js migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "Local database migrations failed." }

    Write-Host "`nLeaf Log: http://localhost:3000 (Ctrl+C stops the website)."
    Write-Host "Sign-in links appear below and in $([IO.Path]::GetTempPath())leaf-magic-link.txt.`n"
    & $nodeExecutable node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000
    if ($LASTEXITCODE -ne 0) { throw "The local website stopped with an error." }
} finally {
    Pop-Location
}
