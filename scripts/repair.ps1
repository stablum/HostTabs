[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [string]$FirefoxPath,
    [string]$ProfilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = Split-Path -Parent $scriptRoot
. (Join-Path $scriptRoot 'lib\HostTabs.Common.ps1')

$firefox = Resolve-FirefoxInstallation -FirefoxPath $FirefoxPath
$profile = Resolve-FirefoxProfile -ProfilePath $ProfilePath -Firefox $firefox
$autoConfig = Get-AutoConfigState -InstallDir $firefox.InstallDir
$manifestPath = Get-HostTabsManifestPath -ProfilePath $profile
$projectVersion = Get-HostTabsVersion -RepositoryRoot $repositoryRoot

Write-Host "Firefox executable : $($firefox.Exe)"
Write-Host "Firefox version    : $($firefox.Version)"
Write-Host "Installation dir   : $($firefox.InstallDir)"
Write-Host "Selected profile   : $profile"

if ($autoConfig.HasConflict) {
    throw (Format-AutoConfigConflictHelp -State $autoConfig)
}

$expected = @($autoConfig.OwnPreference, $autoConfig.OwnConfig)
$profileRoot = Join-Path $profile 'chrome\hosttabs'
foreach ($sourceFile in Get-HostTabsSourceFiles -RepositoryRoot $repositoryRoot) {
    $expected += Join-Path $profileRoot $sourceFile.Name
}
$missing = @($expected | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
$manifest = $null
if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}
$versionMismatch = -not $manifest -or $manifest.hostTabsVersion -ne $projectVersion
$needsRepair = $missing.Count -gt 0 -or $versionMismatch

if ($missing.Count) {
    Write-Host "Missing files       : $($missing.Count)"
    foreach ($path in $missing) { Write-Host "  $path" }
}
if ($versionMismatch) {
    Write-Host "Version update      : $(if ($manifest) { $manifest.hostTabsVersion } else { '(no manifest)' }) -> $projectVersion"
}

if ($needsRepair) {
    if ($PSCmdlet.ShouldProcess($profile, "Repair/update HostTabs to $projectVersion")) {
        & (Join-Path $scriptRoot 'install.ps1') `
            -FirefoxPath $firefox.Exe `
            -ProfilePath $profile `
            -Confirm:$false
    }
} else {
    Write-Host 'All HostTabs bootstrap and profile files are present and current.' -ForegroundColor Green
}

if ($manifest -and $manifest.firefoxVersion -ne $firefox.Version) {
    Write-Warning "Firefox changed from $($manifest.firefoxVersion) to $($firefox.Version). Files are repaired, but privileged browser-chrome compatibility still requires a live smoke test."
}
Write-Host 'Fully exit and restart Firefox after any repair.'
