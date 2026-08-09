[CmdletBinding()]
param(
    [Parameter()]
    [switch]$BypassAdmin,

    [Parameter()]
    [string]$Repo = $(if ($env:MARKETPLACE_REPO) { $env:MARKETPLACE_REPO } else { '7xeh/SpicetifyMarketplace' }),

    [Parameter()]
    [string]$Branch = $(if ($env:MARKETPLACE_BRANCH) { $env:MARKETPLACE_BRANCH } else { 'main' }),

    [Parameter()]
    [string]$Tag,

    [Parameter()]
    [switch]$FromSource,

    [Parameter()]
    [switch]$KeepTheme,

    [Parameter()]
    [switch]$UninstallOnly
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Windows PowerShell renders a progress bar per chunk, which makes Invoke-WebRequest downloads crawl
$ProgressPreference = 'SilentlyContinue'

$legacyAppNames = @('marketplace', 'spicetify-marketplace')

function Invoke-Spicetify {
    param (
        [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $spicetifyArgs = @()
    if ($BypassAdmin) {
        $spicetifyArgs += "--bypass-admin"
    }
    $spicetifyArgs += $Arguments

    & spicetify $spicetifyArgs
    return $LASTEXITCODE
}

function Invoke-SpicetifyWithOutput {
    param (
        [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $spicetifyArgs = @()
    if ($BypassAdmin) {
        $spicetifyArgs += "--bypass-admin"
    }
    $spicetifyArgs += $Arguments

    $output = (& spicetify $spicetifyArgs 2>&1 | Out-String).Trim()
    return @{
        Output = $output
        ExitCode = $LASTEXITCODE
    }
}

function Remove-ExistingMarketplace {
    param (
        [Parameter(Mandatory = $true)]
        [string]$UserDataPath,

        [Parameter(Mandatory = $true)]
        [string]$CurrentTheme
    )

    $found = @()

    foreach ($appName in $legacyAppNames) {
        $appPath = Join-Path -Path $UserDataPath -ChildPath "CustomApps\$appName"
        if (Test-Path -Path $appPath) {
            $found += "CustomApps\$appName"
            Remove-Item -Path $appPath -Recurse -Force -ErrorAction 'SilentlyContinue'
        }
    }

    $configuredApps = (Invoke-SpicetifyWithOutput "config" "custom_apps").Output
    if ($configuredApps -match '=') {
        $configuredApps = $configuredApps.Substring($configuredApps.IndexOf('=') + 1)
    }
    $configuredAppList = @($configuredApps -split '[\|,]' | ForEach-Object { $_.Trim() })

    foreach ($appName in $legacyAppNames) {
        if ($configuredAppList -contains $appName) {
            $found += "config custom_apps -> $appName"
            Invoke-Spicetify "config" "custom_apps" "$appName-" "-q" | Out-Null
        }
    }

    $themePath = Join-Path -Path $UserDataPath -ChildPath 'Themes\marketplace'
    if (Test-Path -Path $themePath) {
        $found += 'Themes\marketplace'
        if ($CurrentTheme -eq 'marketplace') {
            Remove-Item -Path (Join-Path -Path $themePath -ChildPath 'user.css') -Force -ErrorAction 'SilentlyContinue'
        }
        else {
            Remove-Item -Path $themePath -Recurse -Force -ErrorAction 'SilentlyContinue'
        }
    }

    if ($found.Count -eq 0) {
        Write-Host -Object 'No existing Marketplace installation found.' -ForegroundColor 'DarkGray'
        return $false
    }

    Write-Host -Object 'Removed existing Marketplace installation:' -ForegroundColor 'Yellow'
    foreach ($entry in $found) {
        Write-Host -Object "  - $entry" -ForegroundColor 'DarkGray'
    }
    return $true
}

function Get-ReleaseArchiveUri {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Repository,

        [Parameter()]
        [string]$ReleaseTag
    )

    # Release downloads are served straight from github.com and are not subject to the API rate limit
    $uri = if ($ReleaseTag) {
        "https://github.com/$Repository/releases/download/$ReleaseTag/marketplace.zip"
    }
    else {
        "https://github.com/$Repository/releases/latest/download/marketplace.zip"
    }

    try {
        Invoke-WebRequest -Uri $uri -UseBasicParsing -Method 'Head' -ErrorAction 'Stop' | Out-Null
        return $uri
    }
    catch {
        $status = $null
        if ($_.Exception.PSObject.Properties.Name -contains 'Response' -and $_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }

        if ($status -eq 404) {
            $which = if ($ReleaseTag) { "release $ReleaseTag" } else { 'the latest release' }
            Write-Host -Object "No marketplace.zip attached to $which of $Repository." -ForegroundColor 'Yellow'
        }
        else {
            $detail = if ($status) { "HTTP $status" } else { $_.Exception.Message.Trim() }
            Write-Host -Object "Could not reach the release download for $Repository ($detail)." -ForegroundColor 'Yellow'
        }

        return $null
    }
}

function Build-FromSource {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Repository,

        [Parameter(Mandatory = $true)]
        [string]$SourceBranch,

        [Parameter(Mandatory = $true)]
        [string]$WorkPath
    )

    if (-not (Get-Command -Name 'node' -ErrorAction 'SilentlyContinue')) {
        throw "Node.js is required to build $Repository from source. Install Node 24+ or publish a release with a marketplace.zip asset."
    }

    if (-not (Get-Command -Name 'pnpm' -ErrorAction 'SilentlyContinue')) {
        if (Get-Command -Name 'corepack' -ErrorAction 'SilentlyContinue') {
            Write-Host -Object 'Enabling pnpm through corepack...' -ForegroundColor 'Cyan'
            & corepack enable pnpm | Out-Null
        }
    }
    if (-not (Get-Command -Name 'pnpm' -ErrorAction 'SilentlyContinue')) {
        throw 'pnpm is required to build from source. Install it with: npm install -g pnpm'
    }

    $sourceZip = Join-Path -Path $WorkPath -ChildPath 'source.zip'
    $sourceUri = "https://github.com/$Repository/archive/refs/heads/$SourceBranch.zip"

    Write-Host -Object "Downloading source from $sourceUri" -ForegroundColor 'Cyan'
    Invoke-WebRequest -Uri $sourceUri -UseBasicParsing -OutFile $sourceZip

    Write-Host -Object 'Extracting source...' -ForegroundColor 'Cyan'
    Expand-Archive -Path $sourceZip -DestinationPath $WorkPath -Force
    $sourceRoot = Get-ChildItem -Path $WorkPath -Directory | Select-Object -First 1
    if (-not $sourceRoot) {
        throw 'Could not find the extracted source directory.'
    }

    Write-Host -Object 'Installing build dependencies (this can take a minute)...' -ForegroundColor 'Cyan'
    Push-Location -Path $sourceRoot.FullName
    try {
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }

        Write-Host -Object 'Building Marketplace...' -ForegroundColor 'Cyan'
        & pnpm build:local
        if ($LASTEXITCODE -ne 0) { throw 'pnpm build:local failed.' }
    }
    finally {
        Pop-Location
    }

    $distPath = Join-Path -Path $sourceRoot.FullName -ChildPath 'dist'
    if (-not (Test-Path -Path (Join-Path -Path $distPath -ChildPath 'index.js'))) {
        throw 'The build finished but no dist/index.js was produced.'
    }
    return $distPath
}

Write-Host -Object 'Setting up...' -ForegroundColor 'Cyan'
Write-Host -Object "Source repository: $Repo ($Branch)" -ForegroundColor 'DarkGray'

if (-not (Get-Command -Name 'spicetify' -ErrorAction 'SilentlyContinue')) {
    Write-Host -Object 'Spicetify not found.' -ForegroundColor 'Yellow'
    Write-Host -Object 'Installing it for you...' -ForegroundColor 'Cyan'
    $Parameters = @{
        Uri             = 'https://raw.githubusercontent.com/spicetify/cli/main/install.ps1'
        UseBasicParsing = $true
    }
    Invoke-WebRequest @Parameters | Invoke-Expression
}

try {
    $result = Invoke-SpicetifyWithOutput "path" "userdata"
    if ($result.ExitCode -ne 0) {
        Write-Host -Object "Error from Spicetify:" -ForegroundColor 'Red'
        Write-Host -Object $result.Output -ForegroundColor 'Red'
        return
    }
    $spiceUserDataPath = $result.Output
} catch {
    Write-Host -Object "Error running Spicetify:" -ForegroundColor 'Red'
    Write-Host -Object $_.Exception.Message.Trim() -ForegroundColor 'Red'
    return
}

if (-not (Test-Path -Path $spiceUserDataPath -PathType 'Container' -ErrorAction 'SilentlyContinue')) {
    $spiceUserDataPath = "$env:APPDATA\spicetify"
}
$marketAppPath = "$spiceUserDataPath\CustomApps\marketplace"
$marketThemePath = "$spiceUserDataPath\Themes\marketplace"

$isThemeInstalled = $(
    Invoke-Spicetify "path" "-s" | Out-Null
    -not $LASTEXITCODE
)
$currentTheme = (Invoke-SpicetifyWithOutput "config" "current_theme").Output
$setTheme = $true

Write-Host -Object 'Checking for an existing Marketplace installation...' -ForegroundColor 'Cyan'
Remove-ExistingMarketplace -UserDataPath $spiceUserDataPath -CurrentTheme $currentTheme | Out-Null

if ($UninstallOnly) {
    Invoke-Spicetify "apply"
    Write-Host -Object 'Marketplace has been removed.' -ForegroundColor 'Green'
    Write-Host -Object 'Its settings and installed items are stored inside Spotify and are not touched by this script.' -ForegroundColor 'DarkGray'
    return
}

Write-Host -Object 'Creating Marketplace folders...' -ForegroundColor 'Cyan'
try {
    if (-not (New-Item -Path $marketAppPath, $marketThemePath -ItemType 'Directory' -Force -ErrorAction 'Stop')) {
        Write-Host -Object "Error: Failed to create Marketplace directories." -ForegroundColor 'Red'
        return
    }
} catch {
    Write-Host -Object "Error: $($_.Exception.Message.Trim())" -ForegroundColor 'Red'
    return
}

$workPath = Join-Path -Path ([System.IO.Path]::GetTempPath()) -ChildPath "marketplace-install-$([guid]::NewGuid().ToString('N'))"
New-Item -Path $workPath -ItemType 'Directory' -Force | Out-Null

try {
    $releaseUri = $null
    if (-not $FromSource) {
        $releaseUri = Get-ReleaseArchiveUri -Repository $Repo -ReleaseTag $Tag
        if (-not $releaseUri) {
            Write-Host -Object 'Falling back to building from source, which needs Node 24+ and pnpm and takes a few minutes.' -ForegroundColor 'Yellow'
        }
    }

    if ($releaseUri) {
        Write-Host -Object "Downloading Marketplace from $releaseUri" -ForegroundColor 'Cyan'
        $marketArchivePath = Join-Path -Path $workPath -ChildPath 'marketplace.zip'
        Invoke-WebRequest -Uri $releaseUri -UseBasicParsing -OutFile $marketArchivePath

        Write-Host -Object 'Unzipping and installing...' -ForegroundColor 'Cyan'
        $extractPath = Join-Path -Path $workPath -ChildPath 'unpacked'
        Expand-Archive -Path $marketArchivePath -DestinationPath $extractPath -Force

        $manifestFile = Get-ChildItem -Path $extractPath -Filter 'manifest.json' -Recurse -File -Depth 2 |
            Sort-Object { $_.FullName.Length } |
            Select-Object -First 1
        if (-not $manifestFile) {
            throw 'The release archive does not contain a manifest.json.'
        }
        $distPath = $manifestFile.Directory.FullName
    }
    else {
        $distPath = Build-FromSource -Repository $Repo -SourceBranch $Branch -WorkPath $workPath
        Write-Host -Object 'Installing...' -ForegroundColor 'Cyan'
    }

    Copy-Item -Path (Join-Path -Path $distPath -ChildPath '*') -Destination $marketAppPath -Recurse -Force
}
catch {
    Write-Host -Object "Error: $($_.Exception.Message.Trim())" -ForegroundColor 'Red'
    return
}
finally {
    Remove-Item -Path $workPath -Recurse -Force -ErrorAction 'SilentlyContinue'
}

Invoke-Spicetify "config" "custom_apps" "marketplace"
Invoke-Spicetify "config" "inject_css" "1" "replace_colors" "1"

Write-Host -Object 'Downloading placeholder theme...' -ForegroundColor 'Cyan'
$Parameters = @{
  Uri             = "https://raw.githubusercontent.com/$Repo/$Branch/resources/color.ini"
  UseBasicParsing = $true
  OutFile         = "$marketThemePath\color.ini"
}
try {
    Invoke-WebRequest @Parameters
}
catch {
    Write-Host -Object 'Could not download the placeholder theme from the fork, falling back to upstream.' -ForegroundColor 'Yellow'
    $Parameters.Uri = 'https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini'
    Invoke-WebRequest @Parameters
}

Write-Host -Object 'Applying...' -ForegroundColor 'Cyan'
if ($KeepTheme) {
    $setTheme = $false
}
elseif ($isThemeInstalled -and ($currentTheme -ne 'marketplace')) {
    $Host.UI.RawUI.Flushinputbuffer()
    $choice = $Host.UI.PromptForChoice(
        'Local theme found',
        "Do you want to replace '$currentTheme' with a placeholder to install themes from the Marketplace?",
        ('&Yes', '&No'),
        0
    )
    if ($choice -eq 1) { $setTheme = $false }
}
if ($setTheme) {
    Invoke-Spicetify "config" "current_theme" "marketplace"
}
Invoke-Spicetify "backup"
Invoke-Spicetify "apply"

Write-Host -Object 'Done!' -ForegroundColor 'Green'
Write-Host -Object "Installed $Repo ($Branch) into $marketAppPath" -ForegroundColor 'DarkGray'
Write-Host -Object 'If nothing has happened, check the messages above for errors'
