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
$version = Get-HostTabsVersion -RepositoryRoot $repositoryRoot
$autoConfig = Get-AutoConfigState -InstallDir $firefox.InstallDir
$manifestPath = Get-HostTabsManifestPath -ProfilePath $profile
$existingManifest = $null
if (Test-Path -LiteralPath $manifestPath) {
    $existingManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}

Write-Host "Firefox executable : $($firefox.Exe)"
Write-Host "Firefox version    : $($firefox.Version)"
Write-Host "Installation dir   : $($firefox.InstallDir)"
Write-Host "Selected profile   : $profile"
Write-Host "HostTabs version   : $version"

if ($autoConfig.HasConflict) {
    throw (Format-AutoConfigConflictHelp -State $autoConfig)
}
if (($autoConfig.OwnPresent -or
    (Test-Path -LiteralPath $autoConfig.OwnPreference) -or
    (Test-Path -LiteralPath $autoConfig.OwnConfig)) -and -not $existingManifest) {
    throw 'HostTabs-named AutoConfig files exist without an installation manifest. Move or inspect them before installing; they will not be overwritten.'
}
if ($existingManifest) {
    if ([IO.Path]::GetFullPath($existingManifest.firefoxInstallDir).TrimEnd('\') -ne
        [IO.Path]::GetFullPath($firefox.InstallDir).TrimEnd('\')) {
        throw "The existing manifest belongs to a different Firefox installation: $($existingManifest.firefoxInstallDir)"
    }
}

$profileTarget = Join-Path $profile 'chrome\hosttabs'
$fileMappings = @(
    [pscustomobject]@{
        Source = Join-Path $repositoryRoot 'src\bootstrap\autoconfig.js'
        Target = $autoConfig.OwnPreference
    },
    [pscustomobject]@{
        Source = Join-Path $repositoryRoot 'src\bootstrap\hosttabs.cfg'
        Target = $autoConfig.OwnConfig
    }
)
foreach ($sourceFile in Get-HostTabsSourceFiles -RepositoryRoot $repositoryRoot) {
    $fileMappings += [pscustomobject]@{
        Source = $sourceFile.Source
        Target = Join-Path $profileTarget $sourceFile.Name
    }
}
foreach ($mapping in $fileMappings) {
    if (-not (Test-Path -LiteralPath $mapping.Source -PathType Leaf)) {
        throw "Project source file is missing: $($mapping.Source)"
    }
}
if (-not $existingManifest) {
    $collisions = @($fileMappings | Where-Object {
        Test-Path -LiteralPath $_.Target -PathType Leaf
    })
    if ($collisions.Count) {
        $paths = ($collisions | ForEach-Object { "  $($_.Target)" }) -join [Environment]::NewLine
        throw "HostTabs target files already exist without a manifest and will not be overwritten:`n$paths"
    }
}

if (-not $PSCmdlet.ShouldProcess("Firefox $($firefox.Version), profile $profile", "Install HostTabs $version")) {
    return
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupRoot = Join-Path $profile "chrome\hosttabs-install-backups\$timestamp"
$createdFiles = [System.Collections.Generic.List[string]]::new()
$modifiedFiles = [System.Collections.Generic.List[string]]::new()
$backups = [System.Collections.Generic.List[object]]::new()
$directoriesCreated = [System.Collections.Generic.List[string]]::new()
$operationBackups = [System.Collections.Generic.List[object]]::new()
$operationCreatedFiles = [System.Collections.Generic.List[string]]::new()

if ($existingManifest) {
    foreach ($path in @($existingManifest.createdFiles)) { $createdFiles.Add([string]$path) }
    foreach ($path in @($existingManifest.modifiedFiles)) { $modifiedFiles.Add([string]$path) }
    foreach ($backup in @($existingManifest.backups)) { $backups.Add($backup) }
    foreach ($path in @($existingManifest.directoriesCreated)) { $directoriesCreated.Add([string]$path) }
}
$trackedFiles = @($createdFiles + $modifiedFiles)

function Ensure-InstallDirectory {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
        if (-not $directoriesCreated.Contains($Path)) { $directoriesCreated.Add($Path) }
    }
}

function Backup-InstallFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][bool]$RestoreOnUninstall
    )
    Ensure-InstallDirectory -Path (Split-Path -Parent $backupRoot)
    Ensure-InstallDirectory -Path $backupRoot
    $number = $backups.Count + 1
    $backupPath = Join-Path $backupRoot ("{0:D3}-{1}" -f $number, (Split-Path -Leaf $Path))
    Copy-Item -LiteralPath $Path -Destination $backupPath
    $backups.Add([pscustomobject]@{
        original = $Path
        backup = $backupPath
        restoreOnUninstall = $RestoreOnUninstall
        createdAt = (Get-Date).ToString('o')
    })
    $operationBackups.Add([pscustomobject]@{
        original = $Path
        backup = $backupPath
    })
}

try {
    Ensure-InstallDirectory -Path $autoConfig.PreferenceDirectory
    Ensure-InstallDirectory -Path (Join-Path $profile 'chrome')
    Ensure-InstallDirectory -Path $profileTarget

    foreach ($mapping in $fileMappings) {
        $target = [IO.Path]::GetFullPath($mapping.Target)
        if (Test-Path -LiteralPath $target) {
            if ($existingManifest -and $trackedFiles -notcontains $target) {
                throw "Refusing to overwrite an untracked file: $target"
            }
            $restore = $modifiedFiles -contains $target
            Backup-InstallFile -Path $target -RestoreOnUninstall $restore
        } else {
            $createdFiles.Add($target)
            $operationCreatedFiles.Add($target)
        }
        Copy-Item -LiteralPath $mapping.Source -Destination $target -Force
    }

    if (Test-Path -LiteralPath $manifestPath) {
        Backup-InstallFile -Path $manifestPath -RestoreOnUninstall $false
    } elseif (-not $createdFiles.Contains($manifestPath)) {
        $createdFiles.Add($manifestPath)
        $operationCreatedFiles.Add($manifestPath)
    }

    $manifest = [ordered]@{
        schemaVersion      = 1
        hostTabsVersion    = $version
        installedAt        = (Get-Date).ToString('o')
        firefoxExecutable  = $firefox.Exe
        firefoxVersion     = $firefox.Version
        firefoxInstallDir  = $firefox.InstallDir
        profilePath        = $profile
        createdFiles       = @($createdFiles | Select-Object -Unique)
        modifiedFiles      = @($modifiedFiles | Select-Object -Unique)
        backups            = @($backups)
        directoriesCreated = @($directoriesCreated | Select-Object -Unique)
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
} catch {
    $installError = $_
    # Roll back only writes from this invocation. Existing files are restored
    # from the fresh timestamped copies; newly created files are removed.
    $rollbackBackups = @($operationBackups)
    [array]::Reverse($rollbackBackups)
    foreach ($entry in $rollbackBackups) {
        if (Test-Path -LiteralPath $entry.backup -PathType Leaf) {
            Copy-Item -LiteralPath $entry.backup -Destination $entry.original -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $entry.backup -Force -ErrorAction SilentlyContinue
        }
    }
    $rollbackCreated = @($operationCreatedFiles)
    [array]::Reverse($rollbackCreated)
    foreach ($path in $rollbackCreated) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Warning "HostTabs installation did not complete and current-operation writes were rolled back: $($installError.Exception.Message)"
    throw $installError
}

Write-Host ''
Write-Host 'HostTabs installation files were written successfully.' -ForegroundColor Green
Write-Host 'Fully exit and restart Firefox. Existing Firefox windows cannot pick up a new AutoConfig bootstrap.'
