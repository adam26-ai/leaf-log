param(
    [switch]$StopDockerWhenDone
)

# Run from any directory: powershell -ExecutionPolicy Bypass -File .\scripts\dev-local.ps1
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Test-DockerEngine {
    & docker info --format '{{.ServerVersion}}' *> $null
    return $LASTEXITCODE -eq 0
}

function Invoke-DockerDesktopCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $dockerExecutable = (Get-Command docker -ErrorAction Stop).Source
    $process = Start-Process -FilePath $dockerExecutable -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill()
        $process.WaitForExit()
        return $false
    }

    return $process.ExitCode -eq 0
}

function Test-KnownStaleDockerSocket {
    $knownSockets = @(
        (Join-Path $env:LOCALAPPDATA "Docker\run\dockerInference"),
        (Join-Path $env:LOCALAPPDATA "Docker\run\sailor-ingest.sock"),
        (Join-Path $env:LOCALAPPDATA "Docker\run\userAnalyticsOtlpHttp.sock"),
        (Join-Path $env:LOCALAPPDATA "docker-secrets-engine\engine.sock")
    )

    foreach ($socket in $knownSockets) {
        if (Test-Path -LiteralPath $socket) {
            $item = Get-Item -LiteralPath $socket -Force -ErrorAction SilentlyContinue
            if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                return $true
            }
        }
    }

    return $false
}

function Test-KnownDockerSocketFailure {
    $dockerLog = Join-Path $env:LOCALAPPDATA "Docker\log\host\com.docker.backend.exe.log"
    if (-not (Test-Path -LiteralPath $dockerLog)) {
        return $false
    }

    $recentLog = Get-Content -LiteralPath $dockerLog -Tail 300 -ErrorAction SilentlyContinue | Out-String
    $hasKnownSocket = $recentLog -match '(dockerInference|sailor-ingest\.sock|userAnalyticsOtlpHttp\.sock|docker-secrets-engine[/\\]engine\.sock)'
    $hasKnownError = $recentLog -match 'The file cannot be accessed by the system'
    return $hasKnownSocket -and $hasKnownError
}

function Stop-DockerDesktopForRecovery {
    Write-Host "Stopping the failed Docker Desktop startup before recovery..."
    $null = Invoke-DockerDesktopCommand -Arguments @("desktop", "stop", "--timeout", "15") -TimeoutSeconds 20

    $dockerProcesses = Get-Process -Name "docker", "docker-compose", "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue
    if ($dockerProcesses) {
        $null = Invoke-DockerDesktopCommand -Arguments @("desktop", "stop", "--force", "--timeout", "15") -TimeoutSeconds 20
        Start-Sleep -Seconds 2
        $dockerProcesses = Get-Process -Name "docker", "docker-compose", "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue
    }

    if ($dockerProcesses) {
        # The backend crash can leave its own UI and CLI processes orphaned. They
        # must be gone before the parent runtime directories can be renamed.
        $dockerProcesses | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
}

function Move-StaleDockerRuntimeDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath
    )

    $resolvedSource = [IO.Path]::GetFullPath($SourcePath)
    $allowedSources = @(
        [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Docker\run")),
        [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "docker-secrets-engine"))
    )

    if ($resolvedSource -notin $allowedSources) {
        throw "Refusing to move unexpected Docker path: $resolvedSource"
    }
    if (-not (Test-Path -LiteralPath $resolvedSource)) {
        return
    }

    $parent = Split-Path -Parent $resolvedSource
    $leaf = Split-Path -Leaf $resolvedSource
    $suffix = Get-Date -Format "yyyyMMdd-HHmmss"
    $destination = Join-Path $parent "$leaf.stale-$suffix"
    $counter = 1
    while (Test-Path -LiteralPath $destination) {
        $destination = Join-Path $parent "$leaf.stale-$suffix-$counter"
        $counter += 1
    }

    $resolvedDestination = [IO.Path]::GetFullPath($destination)
    if ((Split-Path -Parent $resolvedDestination) -ne $parent -or
        -not (Split-Path -Leaf $resolvedDestination).StartsWith("$leaf.stale-")) {
        throw "Refusing to use unexpected Docker recovery path: $resolvedDestination"
    }

    Move-Item -LiteralPath $resolvedSource -Destination $resolvedDestination
    Write-Warning "Preserved the stale Docker runtime directory at $resolvedDestination"
}

function Repair-KnownDockerSocketFailure {
    Stop-DockerDesktopForRecovery
    Move-StaleDockerRuntimeDirectory -SourcePath (Join-Path $env:LOCALAPPDATA "Docker\run")
    Move-StaleDockerRuntimeDirectory -SourcePath (Join-Path $env:LOCALAPPDATA "docker-secrets-engine")
}

function Start-DockerEngine {
    if (Test-DockerEngine) {
        Write-Host "Docker Desktop is already running."
        return
    }

    $dockerProcesses = Get-Process -Name "Docker Desktop", "com.docker.backend" -ErrorAction SilentlyContinue
    if ($dockerProcesses -and (Test-KnownDockerSocketFailure)) {
        Write-Warning "Found a failed Docker startup caused by stale AF_UNIX sockets."
        Repair-KnownDockerSocketFailure
    } elseif (-not $dockerProcesses -and (Test-KnownStaleDockerSocket)) {
        Write-Warning "Found stale Docker AF_UNIX sockets from an earlier shutdown."
        Move-StaleDockerRuntimeDirectory -SourcePath (Join-Path $env:LOCALAPPDATA "Docker\run")
        Move-StaleDockerRuntimeDirectory -SourcePath (Join-Path $env:LOCALAPPDATA "docker-secrets-engine")
    }

    Write-Host "Starting Docker Desktop..."
    $started = Invoke-DockerDesktopCommand -Arguments @("desktop", "start", "--timeout", "45") -TimeoutSeconds 50
    if ($started -and (Test-DockerEngine)) {
        return
    }

    if (-not (Test-KnownDockerSocketFailure)) {
        throw "Docker Desktop did not start. Open Docker Desktop for details, then retry."
    }

    Write-Warning "Docker hit the known Windows stale AF_UNIX socket failure. Recovering and retrying once."
    Repair-KnownDockerSocketFailure

    $started = Invoke-DockerDesktopCommand -Arguments @("desktop", "start", "--timeout", "90") -TimeoutSeconds 95
    if (-not $started -or -not (Test-DockerEngine)) {
        throw "Docker Desktop still did not start after the stale-socket recovery. No further recovery was attempted."
    }
}

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
        throw "Install Docker Desktop, then retry."
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
    $localConfigJson = @'
const fs = require('node:fs');
const { isIP } = require('node:net');
const { parse } = require('dotenv');
const env = parse(fs.readFileSync('.env.local'));
const db = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(db.hostname) || db.port !== '5437' || db.pathname !== '/leaf_log_dev') {
  throw new Error('This launcher requires the local Docker database on localhost:5437/leaf_log_dev.');
}
if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error('Set AUTH_SECRET to at least 32 characters in .env.local.');
if (!env.AUTH_URL || env.NEXTAUTH_URL !== env.AUTH_URL) {
  throw new Error('AUTH_URL and NEXTAUTH_URL must match in .env.local.');
}
const authUrl = new URL(env.AUTH_URL);
const parts = authUrl.hostname.split('.').map(Number);
const privateIpv4 = isIP(authUrl.hostname) === 4 && (
  parts[0] === 10 ||
  (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
  (parts[0] === 192 && parts[1] === 168) ||
  parts[0] === 127
);
const loopback = ['localhost', '127.0.0.1'].includes(authUrl.hostname);
if (authUrl.protocol !== 'http:' || authUrl.port !== '3000' || (!loopback && !privateIpv4)) {
  throw new Error('AUTH_URL must use http://localhost:3000 or an HTTP private-LAN address on port 3000.');
}
if (env.RESEND_API_KEY) throw new Error('Leave RESEND_API_KEY empty for local development.');
process.stdout.write(JSON.stringify({ siteUrl: authUrl.origin, bindHost: loopback ? '127.0.0.1' : '0.0.0.0' }));
'@ | & $nodeExecutable
    if ($LASTEXITCODE -ne 0) { throw "Check the local environment settings above." }
    $localConfig = $localConfigJson | ConvertFrom-Json

    # Parent-shell values must not override the local configuration.
    "DATABASE_URL", "AUTH_SECRET", "AUTH_URL", "NEXTAUTH_URL", "AUTH_EMAIL_FROM", "RESEND_API_KEY", "NODE_ENV" | ForEach-Object {
        Remove-Item "Env:$_" -ErrorAction SilentlyContinue
    }

    Start-DockerEngine

    & docker compose up -d --wait
    if ($LASTEXITCODE -ne 0) { throw "The local Postgres container did not become healthy." }

    & $nodeExecutable node_modules/prisma/build/index.js generate
    if ($LASTEXITCODE -ne 0) { throw "Prisma client generation failed." }
    & $nodeExecutable node_modules/prisma/build/index.js migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "Local database migrations failed." }

    Write-Host "`nLeaf Log: $($localConfig.siteUrl) (Ctrl+C stops the website)."
    Write-Host "Sign-in links appear below and in $([IO.Path]::GetTempPath())leaf-magic-link.txt."
    Write-Host "Docker Desktop stays running for a faster next launch. Pass -StopDockerWhenDone to request its supported stop sequence.`n"
    & $nodeExecutable node_modules/next/dist/bin/next dev --hostname $localConfig.bindHost --port 3000
    if ($LASTEXITCODE -ne 0) { throw "The local website stopped with an error." }
} finally {
    if ($StopDockerWhenDone -and (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "Stopping Docker Desktop cleanly..."
        $stopped = Invoke-DockerDesktopCommand -Arguments @("desktop", "stop", "--timeout", "60") -TimeoutSeconds 65
        if (-not $stopped) {
            Write-Warning "Docker Desktop did not finish its supported stop sequence within 65 seconds. It was not force-stopped."
        }
    }
    Pop-Location
}
