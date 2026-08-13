[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$FirefoxPath,
    [string]$ProfilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'lib\HostTabs.Common.ps1')

$firefox = Resolve-FirefoxInstallation -FirefoxPath $FirefoxPath
if ($ProfilePath) {
    $profile = Resolve-FirefoxProfile -ProfilePath $ProfilePath -Firefox $firefox
} else {
    $installedProfiles = @(Get-FirefoxProfiles | Where-Object {
        $_.Exists -and (Test-Path -LiteralPath (Get-HostTabsManifestPath -ProfilePath $_.Path))
    })
    if ($installedProfiles.Count -eq 1) {
        $profile = $installedProfiles[0].Path
    } elseif ($installedProfiles.Count -gt 1) {
        $choices = ($installedProfiles | ForEach-Object { "  $($_.Name): $($_.Path)" }) -join [Environment]::NewLine
        throw "HostTabs is installed in multiple profiles. Re-run with -ProfilePath:`n$choices"
    } else {
        $profile = Resolve-FirefoxProfile -Firefox $firefox
    }
}

$manifestPath = Get-HostTabsManifestPath -ProfilePath $profile
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "HostTabs installation manifest was not found: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$allowedRoots = @([string]$manifest.firefoxInstallDir, [string]$manifest.profilePath)
if (-not (Test-PathWithin -Path $manifestPath -Roots $allowedRoots)) {
    throw 'The installation manifest resolved outside its recorded Firefox/profile roots.'
}

Write-Host "HostTabs version   : $($manifest.hostTabsVersion)"
Write-Host "Firefox install    : $($manifest.firefoxInstallDir)"
Write-Host "Firefox profile    : $($manifest.profilePath)"

if (-not $PSCmdlet.ShouldProcess($profile, 'Remove HostTabs and restore recorded shared-file backups')) {
    return
}

$removed = [System.Collections.Generic.List[string]]::new()
$restored = [System.Collections.Generic.List[string]]::new()

# Restore newest-to-oldest so the first-install backup wins if a shared file was
# updated more than once. The current architecture normally creates dedicated
# files and therefore has no shared-file restore entries.
$restoreBackups = @($manifest.backups | Where-Object restoreOnUninstall)
[array]::Reverse($restoreBackups)
foreach ($entry in $restoreBackups) {
    $original = [string]$entry.original
    $backup = [string]$entry.backup
    if (-not (Test-PathWithin -Path $original -Roots $allowedRoots) -or
        -not (Test-PathWithin -Path $backup -Roots $allowedRoots)) {
        throw "Refusing to restore a path outside the recorded roots: $original"
    }
    if (Test-Path -LiteralPath $backup -PathType Leaf) {
        Copy-Item -LiteralPath $backup -Destination $original -Force
        $restored.Add($original)
    }
}

$createdFiles = @($manifest.createdFiles)
[array]::Reverse($createdFiles)
foreach ($pathValue in $createdFiles) {
    $path = [string]$pathValue
    if (-not (Test-PathWithin -Path $path -Roots $allowedRoots)) {
        throw "Refusing to remove a path outside the recorded roots: $path"
    }
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
        $removed.Add($path)
    }
}

foreach ($entry in @($manifest.backups)) {
    $backup = [string]$entry.backup
    if ((Test-PathWithin -Path $backup -Roots $allowedRoots) -and
        (Test-Path -LiteralPath $backup -PathType Leaf)) {
        Remove-Item -LiteralPath $backup -Force
        $removed.Add($backup)
    }
}

$directories = @($manifest.directoriesCreated | Sort-Object { $_.Length } -Descending)
foreach ($pathValue in $directories) {
    $path = [string]$pathValue
    if (-not (Test-PathWithin -Path $path -Roots $allowedRoots)) { continue }
    if (Test-Path -LiteralPath $path -PathType Container) {
        $children = @(Get-ChildItem -LiteralPath $path -Force)
        if ($children.Count -eq 0) {
            Remove-Item -LiteralPath $path -Force
        }
    }
}

Write-Host ''
Write-Host "Removed $($removed.Count) HostTabs file(s); restored $($restored.Count) shared file(s)." -ForegroundColor Green
Write-Host 'Fully exit and restart Firefox to return to the normal tab strip.'
