[CmdletBinding()]
param(
    [string]$FirefoxPath,
    [string]$ProfilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'lib\HostTabs.Common.ps1')

$firefox = Resolve-FirefoxInstallation -FirefoxPath $FirefoxPath
$profile = Resolve-FirefoxProfile -ProfilePath $ProfilePath -Firefox $firefox
$autoConfig = Get-AutoConfigState -InstallDir $firefox.InstallDir
$hostTabsRoot = Join-Path $profile 'chrome\hosttabs'
$manifestPath = Get-HostTabsManifestPath -ProfilePath $profile
$expectedSources = @(
    'bootstrap.js',
    'url-groups.js',
    'model.js',
    'firefox-adapter.js',
    'hosttabs.uc.js'
)
$missingSources = @($expectedSources | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $hostTabsRoot $_) -PathType Leaf)
})
$cssPath = Join-Path $hostTabsRoot 'hosttabs.css'
$prefsPath = Join-Path $profile 'prefs.js'
$debugPreference = 'default (false)'
if (Test-Path -LiteralPath $prefsPath) {
    $debugLine = Select-String -LiteralPath $prefsPath -Pattern 'user_pref\("hosttabs\.debug",\s*(true|false)\)' -AllMatches
    if ($debugLine) {
        $debugPreference = $debugLine.Matches[-1].Groups[1].Value
    }
}
$manifest = $null
$manifestError = ''
if (Test-Path -LiteralPath $manifestPath) {
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    } catch {
        $manifestError = $_.Exception.Message
    }
}
$configFilenamePreference = '(missing)'
$sandboxPreference = '(missing)'
if (Test-Path -LiteralPath $autoConfig.OwnPreference -PathType Leaf) {
    $preferenceText = Get-Content -LiteralPath $autoConfig.OwnPreference -Raw
    if ($preferenceText -match 'general\.config\.filename"\s*,\s*"([^"]+)"') {
        $configFilenamePreference = $Matches[1]
    }
    if ($preferenceText -match 'general\.config\.sandbox_enabled"\s*,\s*(true|false)') {
        $sandboxPreference = $Matches[1]
    }
}

$report = [ordered]@{
    'Firefox executable'                 = $firefox.Exe
    'Firefox version'                    = $firefox.Version
    'Installation directory'             = $firefox.InstallDir
    'Profile directory'                  = $profile
    'AutoConfig preference present'      = Test-Path -LiteralPath $autoConfig.OwnPreference -PathType Leaf
    'AutoConfig bootstrap present'       = Test-Path -LiteralPath $autoConfig.OwnConfig -PathType Leaf
    'general.config.filename'             = $configFilenamePreference
    'general.config.sandbox_enabled'      = $sandboxPreference
    'HostTabs source present'            = ($missingSources.Count -eq 0)
    'HostTabs CSS present'               = Test-Path -LiteralPath $cssPath -PathType Leaf
    'hosttabs.debug preference'          = $debugPreference
    'Existing AutoConfig conflict'       = $autoConfig.HasConflict
    'Installation manifest present'      = [bool]$manifest
    'Installed HostTabs version'         = if ($manifest) { $manifest.hostTabsVersion } else { '(unknown)' }
    'Firefox version recorded at install'= if ($manifest) { $manifest.firefoxVersion } else { '(unknown)' }
}

Write-Host 'HostTabs diagnostic report'
Write-Host '=========================='
foreach ($entry in $report.GetEnumerator()) {
    Write-Host ('{0,-36}: {1}' -f $entry.Key, $entry.Value)
}
if ($missingSources.Count) {
    Write-Host "Missing source files                 : $($missingSources -join ', ')"
}
if ($manifestError) {
    Write-Host "Manifest parse error                  : $manifestError"
}
if ($autoConfig.Conflicts.Count) {
    Write-Host 'AutoConfig conflict files:'
    foreach ($path in $autoConfig.Conflicts) { Write-Host "  $path" }
}
Write-Host ''
Write-Host 'No diagnostic data was uploaded.'
Write-Host 'Runtime debugging: fully restart Firefox, press Ctrl+Shift+J for the Browser Console, and filter for [HostTabs].'
Write-Host 'In that console, HostTabsDev.destroy() restores native tabs and HostTabsDev.reinitialize() rebuilds the UI.'
