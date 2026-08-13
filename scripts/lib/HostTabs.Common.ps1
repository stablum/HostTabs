Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-IniData {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $result = [ordered]@{}
    $section = $null
    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith(';') -or $line.StartsWith('#')) {
            continue
        }
        if ($line -match '^\[(.+)\]$') {
            $section = $Matches[1]
            $result[$section] = [ordered]@{}
            continue
        }
        if ($section -and $line -match '^([^=]+)=(.*)$') {
            $result[$section][$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $result
}

function Resolve-FirefoxInstallation {
    [CmdletBinding()]
    param([string]$FirefoxPath)

    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($FirefoxPath) {
        $candidates.Add($FirefoxPath)
    } else {
        foreach ($process in Get-Process firefox -ErrorAction SilentlyContinue) {
            try { if ($process.Path) { $candidates.Add($process.Path) } } catch { }
        }
        foreach ($key in @(
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
            'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe'
        )) {
            if (Test-Path -LiteralPath $key) {
                $value = (Get-ItemProperty -LiteralPath $key).'(default)'
                if ($value) { $candidates.Add([string]$value) }
            }
        }
        $command = Get-Command firefox.exe -ErrorAction SilentlyContinue
        if ($command -and $command.Source) { $candidates.Add($command.Source) }
        $candidates.Add((Join-Path $env:USERPROFILE 'scoop\apps\firefox\current\firefox.exe'))
        $candidates.Add((Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe'))
        if (${env:ProgramFiles(x86)}) {
            $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox\firefox.exe'))
        }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not $candidate) { continue }
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded -PathType Container) {
            $expanded = Join-Path $expanded 'firefox.exe'
        }
        if (-not (Test-Path -LiteralPath $expanded -PathType Leaf)) { continue }
        $item = Get-Item -LiteralPath $expanded
        if (-not $item.VersionInfo.ProductVersion) { continue }
        $resolvedExe = $item.FullName
        return [pscustomobject]@{
            Exe        = $resolvedExe
            InstallDir = Split-Path -Parent $resolvedExe
            Version    = $item.VersionInfo.ProductVersion
            FileVersion = $item.VersionInfo.FileVersion
        }
    }
    throw 'Firefox could not be detected. Pass -FirefoxPath with firefox.exe or its installation directory.'
}

function Get-FirefoxProfiles {
    [CmdletBinding()]
    param()

    $firefoxRoot = Join-Path $env:APPDATA 'Mozilla\Firefox'
    $profilesIni = Join-Path $firefoxRoot 'profiles.ini'
    if (-not (Test-Path -LiteralPath $profilesIni)) {
        throw "Firefox profiles.ini was not found at $profilesIni"
    }
    $ini = Get-IniData -Path $profilesIni
    $installDefaults = @(
        foreach ($entry in $ini.GetEnumerator()) {
            if ($entry.Key -like 'Install*' -and $entry.Value.Contains('Default')) {
                $entry.Value['Default']
            }
        }
    )

    $profiles = @()
    foreach ($entry in $ini.GetEnumerator()) {
        if ($entry.Key -notlike 'Profile*') { continue }
        $values = $entry.Value
        if (-not $values.Contains('Path')) { continue }
        $pathValue = [string]$values['Path']
        $isRelative = -not $values.Contains('IsRelative') -or $values['IsRelative'] -eq '1'
        $fullPath = if ($isRelative) { Join-Path $firefoxRoot $pathValue } else { $pathValue }
        $fullPath = [IO.Path]::GetFullPath($fullPath)
        $compatibilityPath = Join-Path $fullPath 'compatibility.ini'
        $lastVersion = ''
        $lastPlatformDir = ''
        if (Test-Path -LiteralPath $compatibilityPath) {
            $compatibility = Get-IniData -Path $compatibilityPath
            if ($compatibility.Contains('Compatibility')) {
                $lastVersion = [string]$compatibility['Compatibility']['LastVersion']
                $lastPlatformDir = [string]$compatibility['Compatibility']['LastPlatformDir']
            }
        }
        $profiles += [pscustomobject]@{
            Section             = $entry.Key
            Name                = if ($values.Contains('Name')) { [string]$values['Name'] } else { $entry.Key }
            Path                = $fullPath
            Exists              = Test-Path -LiteralPath $fullPath -PathType Container
            Default             = $values.Contains('Default') -and $values['Default'] -eq '1'
            InstallationDefault = $installDefaults -contains $pathValue
            LastVersion         = $lastVersion
            LastPlatformDir     = $lastPlatformDir
        }
    }
    return $profiles
}

function Resolve-FirefoxProfile {
    [CmdletBinding()]
    param(
        [string]$ProfilePath,
        [Parameter(Mandatory)]$Firefox
    )

    if ($ProfilePath) {
        $resolved = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($ProfilePath))
        if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
            throw "Firefox profile directory does not exist: $resolved"
        }
        return $resolved
    }

    $profiles = @(Get-FirefoxProfiles | Where-Object Exists)
    $currentMatches = @($profiles | Where-Object {
        $_.LastPlatformDir -and
        ([IO.Path]::GetFullPath($_.LastPlatformDir).TrimEnd('\') -eq
            [IO.Path]::GetFullPath($Firefox.InstallDir).TrimEnd('\')) -and
        $_.LastVersion.StartsWith("$($Firefox.Version)_")
    })
    if ($currentMatches.Count -eq 1) {
        return $currentMatches[0].Path
    }
    if ($profiles.Count -eq 1) {
        return $profiles[0].Path
    }

    $lines = @('Multiple Firefox profiles are plausible. Re-run with -ProfilePath and choose one:')
    foreach ($profile in $profiles) {
        $markers = @()
        if ($profile.Default) { $markers += 'profile default' }
        if ($profile.InstallationDefault) { $markers += 'installation default' }
        if ($profile.LastVersion) { $markers += "last used by $($profile.LastVersion)" }
        $suffix = if ($markers) { ' [' + ($markers -join '; ') + ']' } else { '' }
        $lines += "  $($profile.Name): $($profile.Path)$suffix"
    }
    throw ($lines -join [Environment]::NewLine)
}

function Get-HostTabsVersion {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    return (Get-Content -LiteralPath (Join-Path $RepositoryRoot 'VERSION') -Raw).Trim()
}

function Get-AutoConfigState {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$InstallDir)

    $prefDir = Join-Path $InstallDir 'defaults\pref'
    $preferenceFiles = @()
    if (Test-Path -LiteralPath $prefDir) {
        $preferenceFiles = @(Get-ChildItem -LiteralPath $prefDir -File -Filter '*.js')
    }
    $configDeclarations = @()
    foreach ($file in $preferenceFiles) {
        $matches = Select-String -LiteralPath $file.FullName -Pattern 'general\.config\.filename' -ErrorAction SilentlyContinue
        if ($matches) { $configDeclarations += $file.FullName }
    }
    $rootConfigs = @(
        foreach ($name in @('firefox.cfg', 'mozilla.cfg', 'autoconfig.cfg', 'hosttabs.cfg')) {
            $path = Join-Path $InstallDir $name
            if (Test-Path -LiteralPath $path -PathType Leaf) { $path }
        }
    )
    $ownPref = Join-Path $prefDir 'hosttabs-autoconfig.js'
    $ownConfig = Join-Path $InstallDir 'hosttabs.cfg'
    $ownPresent = (Test-Path -LiteralPath $ownPref) -and (Test-Path -LiteralPath $ownConfig)
    $unknownDeclarations = @($configDeclarations | Where-Object { $_ -ne $ownPref })
    $unknownRootConfigs = @($rootConfigs | Where-Object { $_ -ne $ownConfig })
    return [pscustomobject]@{
        PreferenceDirectory = $prefDir
        ConfigDeclarations  = $configDeclarations
        RootConfigs         = $rootConfigs
        OwnPreference       = $ownPref
        OwnConfig           = $ownConfig
        OwnPresent          = $ownPresent
        HasConflict         = ($unknownDeclarations.Count -gt 0 -or $unknownRootConfigs.Count -gt 0)
        Conflicts           = @($unknownDeclarations + $unknownRootConfigs | Select-Object -Unique)
    }
}

function Test-PathWithin {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string[]]$Roots
    )
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    foreach ($root in $Roots) {
        $resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
        if ($candidate.Equals($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -or
            $candidate.StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Get-HostTabsManifestPath {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ProfilePath)
    return Join-Path $ProfilePath 'chrome\hosttabs\install-manifest.json'
}

function Get-HostTabsSourceFiles {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    return @(
        'bootstrap.js',
        'url-groups.js',
        'model.js',
        'firefox-adapter.js',
        'hosttabs.uc.js',
        'hosttabs.css'
    ) | ForEach-Object {
        [pscustomobject]@{
            Source = Join-Path $RepositoryRoot "src\chrome\$_"
            Name   = $_
        }
    }
}

function Format-AutoConfigConflictHelp {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$State)
    $found = if ($State.Conflicts.Count) { $State.Conflicts -join [Environment]::NewLine } else { '(unknown)' }
    return @"
An existing AutoConfig installation was detected and HostTabs will not overwrite or compose it automatically:
$found

Manual integration, if you own that configuration:
1. Keep its current defaults/pref loader and .cfg file.
2. Copy src/chrome/* to <selected-profile>\chrome\hosttabs\.
3. Add the guarded profile loader from src/bootstrap/hosttabs.cfg (the IIFE after its first comment line) to the existing .cfg.
4. Do not add a second general.config.filename preference.
"@
}
