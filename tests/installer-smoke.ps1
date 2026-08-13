[CmdletBinding()]
param([string]$FirefoxPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $repositoryRoot 'scripts\lib\HostTabs.Common.ps1')

$detected = Resolve-FirefoxInstallation -FirefoxPath $FirefoxPath
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("hosttabs-installer-test-" + [guid]::NewGuid().ToString('N'))
$testRoot = [IO.Path]::GetFullPath($testRoot)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if (-not $testRoot.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unsafe test directory: $testRoot"
}

$fakeInstall = Join-Path $testRoot 'Firefox'
$fakeProfile = Join-Path $testRoot 'profile'
$fakeExe = Join-Path $fakeInstall 'firefox.exe'

try {
    New-Item -ItemType Directory -Path $fakeInstall, $fakeProfile | Out-Null
    Copy-Item -LiteralPath $detected.Exe -Destination $fakeExe

    & (Join-Path $repositoryRoot 'scripts\install.ps1') `
        -FirefoxPath $fakeExe -ProfilePath $fakeProfile -Confirm:$false

    $required = @(
        (Join-Path $fakeInstall 'defaults\pref\hosttabs-autoconfig.js'),
        (Join-Path $fakeInstall 'hosttabs.cfg'),
        (Join-Path $fakeProfile 'chrome\hosttabs\bootstrap.js'),
        (Join-Path $fakeProfile 'chrome\hosttabs\hosttabs.css'),
        (Join-Path $fakeProfile 'chrome\hosttabs\install-manifest.json')
    )
    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Installer smoke test missing file: $path"
        }
    }

    # A second install exercises update backups and manifest preservation.
    & (Join-Path $repositoryRoot 'scripts\install.ps1') `
        -FirefoxPath $fakeExe -ProfilePath $fakeProfile -Confirm:$false

    & (Join-Path $repositoryRoot 'scripts\diagnose.ps1') `
        -FirefoxPath $fakeExe -ProfilePath $fakeProfile | Out-Null

    $repairTarget = Join-Path $fakeProfile 'chrome\hosttabs\model.js'
    Remove-Item -LiteralPath $repairTarget -Force
    & (Join-Path $repositoryRoot 'scripts\repair.ps1') `
        -FirefoxPath $fakeExe -ProfilePath $fakeProfile -Confirm:$false
    if (-not (Test-Path -LiteralPath $repairTarget -PathType Leaf)) {
        throw 'Repair smoke test did not restore model.js.'
    }

    & (Join-Path $repositoryRoot 'scripts\uninstall.ps1') `
        -FirefoxPath $fakeExe -ProfilePath $fakeProfile -Confirm:$false

    foreach ($path in $required) {
        if (Test-Path -LiteralPath $path) {
            throw "Uninstaller smoke test left a HostTabs file: $path"
        }
    }

    $foreignPrefDir = Join-Path $fakeInstall 'defaults\pref'
    New-Item -ItemType Directory -Path $foreignPrefDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $foreignPrefDir 'foreign-autoconfig.js') `
        -Value 'pref("general.config.filename", "firefox.cfg");'
    Set-Content -LiteralPath (Join-Path $fakeInstall 'firefox.cfg') -Value '// foreign config'
    $conflictStopped = $false
    try {
        & (Join-Path $repositoryRoot 'scripts\install.ps1') `
            -FirefoxPath $fakeExe -ProfilePath $fakeProfile -Confirm:$false
    } catch {
        $conflictStopped = $true
    }
    if (-not $conflictStopped) {
        throw 'Installer smoke test did not stop for a foreign AutoConfig.'
    }
    if (Test-Path -LiteralPath (Join-Path $fakeInstall 'hosttabs.cfg')) {
        throw 'Installer wrote HostTabs despite a foreign AutoConfig conflict.'
    }
    Write-Host 'Installer/update/diagnose/uninstaller smoke test passed.' -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $testRoot -PathType Container) {
        $verified = [IO.Path]::GetFullPath($testRoot)
        if (-not $verified.StartsWith($tempRoot + '\hosttabs-installer-test-', [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing unsafe cleanup directory: $verified"
        }
        Remove-Item -LiteralPath $verified -Recurse -Force
    }
}
