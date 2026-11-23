param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("start", "stop")]
    [string]$Action
)

$ErrorActionPreference = "Stop"

$widgetRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $widgetRoot "..\..")).Path
$manifestPath = Join-Path $widgetRoot "Cargo.toml"
$executablePath = Join-Path $widgetRoot "target\debug\ascent-focus-widget.exe"
$stateDirectory = Join-Path $env:APPDATA "AscentFocus"
$pidPath = Join-Path $stateDirectory "widget.pid"
$ucrtBin = "C:\msys64\ucrt64\bin"
$msysBin = "C:\msys64\usr\bin"
$linkerPath = Join-Path $ucrtBin "x86_64-w64-mingw32-gcc.exe"

function Get-WidgetProcess {
    $expectedPath = [System.IO.Path]::GetFullPath($executablePath)
    foreach ($candidate in @(Get-Process -Name "ascent-focus-widget" -ErrorAction SilentlyContinue)) {
        if (-not $candidate.Path) { continue }
        $candidatePath = [System.IO.Path]::GetFullPath($candidate.Path)
        if ([string]::Equals($candidatePath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $candidate
        }
    }
    return $null
}

if ($Action -eq "start") {
    New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null

    $runningProcess = Get-WidgetProcess
    if ($runningProcess) {
        Set-Content -LiteralPath $pidPath -Value $runningProcess.Id -NoNewline -Encoding ascii
        Write-Output "Ascent Focus is already running (PID $($runningProcess.Id)). You can close this terminal."
        exit 0
    }

    if (-not (Test-Path -LiteralPath $linkerPath)) {
        throw "MSYS2 UCRT64 GCC was not found at $linkerPath. Update manage-widget.ps1 if MSYS2 was installed elsewhere."
    }
    $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
    $cargoPath = if ($cargoCommand) { $cargoCommand.Source } else { Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe" }
    if (-not (Test-Path -LiteralPath $cargoPath)) {
        throw "cargo.exe was not found on PATH. Install Rust or add its bin directory to PATH."
    }

    $env:PATH = "$ucrtBin;$msysBin;$env:PATH"
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = $linkerPath

    Push-Location $repoRoot
    try {
        & $cargoPath +stable-x86_64-pc-windows-gnu build --manifest-path $manifestPath
        if ($LASTEXITCODE -ne 0) {
            throw "The widget build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }

    $process = Start-Process -FilePath $executablePath -WorkingDirectory $widgetRoot -PassThru
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) {
        throw "The widget exited during startup. Run the executable directly to inspect the error."
    }

    Set-Content -LiteralPath $pidPath -Value $process.Id -NoNewline -Encoding ascii
    Write-Output "Started Ascent Focus (PID $($process.Id)). You can close this terminal; use 'make stop' to stop it."
    exit 0
}

$runningProcess = Get-WidgetProcess
if (-not $runningProcess) {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Write-Output "Ascent Focus is not running."
    exit 0
}

Stop-Process -Id $runningProcess.Id
Wait-Process -Id $runningProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Write-Output "Stopped Ascent Focus (PID $($runningProcess.Id))."
