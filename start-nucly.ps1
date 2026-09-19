# NUCLY local server — serves the folder so the PWA can be installed.
#   Desktop: run this, open http://localhost:8800 in Chrome/Edge, click "Install app".
#   Mobile:  same network, open http://<this IP>:8800, use "Install app" / Add to Home Screen.
#   Stop the server: Ctrl+C
param(
    [int]$Port = 8800,
    [switch]$OpenBrowser = $true
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Get-MimeMap {
    return @{
        ".html" = "text/html; charset=utf-8"
        ".htm"  = "text/html; charset=utf-8"
        ".css"  = "text/css; charset=utf-8"
        ".js"   = "application/javascript; charset=utf-8"
        ".mjs"  = "application/javascript; charset=utf-8"
        ".json" = "application/json; charset=utf-8"
        ".webmanifest" = "application/manifest+json; charset=utf-8"
        ".png"  = "image/png"
        ".webp" = "image/webp"
        ".jpg"  = "image/jpeg"
        ".jpeg" = "image/jpeg"
        ".gif"  = "image/gif"
        ".ico"  = "image/x-icon"
        ".svg"  = "image/svg+xml"
        ".woff" = "font/woff"
        ".woff2" = "font/woff2"
        ".ttf"  = "font/ttf"
        ".txt"  = "text/plain; charset=utf-8"
    }
}

function Get-MimeOf([string]$Path) {
    if ([System.IO.Path]::GetExtension($Path).ToLowerInvariant() -eq ".webmanifest") {
        return "application/manifest+json; charset=utf-8"
    }
    $map = Get-MimeMap
    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($map.ContainsKey($ext)) { return $map[$ext] }
    return "application/octet-stream"
}

function Get-LanIp {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
              Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
              Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return $ip }
    } catch { }
    try {
        return [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
               Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
               Where-Object { $_.IPAddressToString -notlike "127.*" } |
               Select-Object -First 1 -ExpandProperty IPAddressToString
    } catch { }
    return "localhost"
}

function New-NuclyListener([int]$port) {
    $listener = New-Object System.Net.HttpListener
    $anyPrefix = "http://+:$port/"
    $localPrefix = "http://localhost:$port/"
    $servesLan = $true
    try {
        $listener.Prefixes.Add($anyPrefix)
        $listener.Start()
    } catch {
        # Binding to "+" (any interface) needs admin or a URL ACL; retry on localhost only.
        $servesLan = $false
        $listener = New-Object System.Net.HttpListener
        try {
            $listener.Prefixes.Add($localPrefix)
            $listener.Start()
        } catch {
            throw "Unable to start the server on port $port. Close any program using it, or allow Windows Firewall."
        }
    }
    return @{ Listener = $listener; ServesLan = $servesLan }
}

function Handle-NuclyRequest($ctx, [string]$siteRoot) {
    $p = $ctx.Request.Url.LocalPath
    if ($p -eq "/") { $p = "/index.html" }
    $rel = $p.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $siteRoot $rel))
    if (-not $full.StartsWith($siteRoot)) {
        $ctx.Response.StatusCode = 403
        $ctx.Response.Close()
        return
    }
    if (Test-Path -LiteralPath $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ctx.Response.ContentType = Get-MimeOf $full
        $ctx.Response.Headers["Cache-Control"] = "no-cache"
        $ctx.Response.Headers["Access-Control-Allow-Origin"] = "*"
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
}

function Start-NuclyMain {
    param([int]$Port, [bool]$OpenBrowser)
    if (-not (Test-Path (Join-Path $Root "index.html"))) {
        Write-Host "index.html not found next to this script." -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "  NUCLY local server" -ForegroundColor Green
    Write-Host "  ================="
    Write-Host ""

    $server = New-NuclyListener $Port
    $listener = $server.Listener
    $servesLan = $server.ServesLan

    $lan = Get-LanIp
    Write-Host "  Desktop:   http://localhost:$Port" -ForegroundColor Cyan
    if ($servesLan) {
        Write-Host "  Mobile:    http://$lan`:$Port   (phone on the same Wi-Fi)" -ForegroundColor Cyan
    } else {
        Write-Host "  Mobile:    run this script as Administrator to also serve on the network, then use:" -ForegroundColor Yellow
        Write-Host "             http://$lan`:$Port   (phone on the same Wi-Fi)" -ForegroundColor Yellow
    }

    if ($OpenBrowser) {
        Start-Process "http://localhost:$Port"
    }

    Write-Host ""
    Write-Host "  Serving $Root" -ForegroundColor DarkGray
    Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
    Write-Host ""

    try {
        while ($listener.IsListening) {
            $ctx = $listener.GetContext()
            Handle-NuclyRequest $ctx $Root
        }
    } catch {
        # Only reached when the listener is stopped.
    } finally {
        $listener.Stop()
        Write-Host ""
        Write-Host "  Server stopped." -ForegroundColor DarkGray
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    Start-NuclyMain -Port $Port -OpenBrowser $OpenBrowser
}