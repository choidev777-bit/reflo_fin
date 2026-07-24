param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8081
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$requestedPort = $Port
$lastCandidate = [Math]::Min(65535, $requestedPort + 20)

function Test-PortAvailable {
  param([int]$Candidate)

  $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Candidate)
  try {
    $probe.Start()
    return $true
  } catch [Net.Sockets.SocketException] {
    return $false
  } finally {
    $probe.Stop()
  }
}

while ($Port -le $lastCandidate -and -not (Test-PortAvailable -Candidate $Port)) {
  $Port++
}

if ($Port -gt $lastCandidate) {
  throw "No available local port was found between $requestedPort and $lastCandidate."
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg' = 'image/svg+xml'
  '.png' = 'image/png'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.woff2' = 'font/woff2'
  '.ico' = 'image/x-icon'
}

try {
  $listener.Start()
  $url = "http://127.0.0.1:$Port/"

  if ($Port -ne $requestedPort) {
    Write-Host "Port $requestedPort is already in use. Using port $Port instead."
  }

  Write-Host "REFLO local server: $url"
  Write-Host "Serving current files from: $root"
  Write-Host 'Close this window to stop the server.'

  if ($env:REFLO_NO_BROWSER -ne '1') {
    $cacheBustedUrl = "$url`?refresh=$([DateTime]::UtcNow.Ticks)"
    Start-Process $cacheBustedUrl
  }

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { continue }
      while ($reader.ReadLine() -ne '') { }

      $requestTarget = ($requestLine -split ' ')[1]
      $requestPath = [Uri]::UnescapeDataString(($requestTarget -split '\?')[0]).TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'index.html' }

      $filePath = [IO.Path]::GetFullPath((Join-Path $root $requestPath))
      if (-not $filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        $status = '403 Forbidden'
        $body = [Text.Encoding]::UTF8.GetBytes('Forbidden')
        $contentType = 'text/plain; charset=utf-8'
      } elseif (Test-Path -LiteralPath $filePath -PathType Leaf) {
        $status = '200 OK'
        $body = [IO.File]::ReadAllBytes($filePath)
        $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
        $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      } else {
        $status = '404 Not Found'
        $body = [Text.Encoding]::UTF8.GetBytes('Not Found')
        $contentType = 'text/plain; charset=utf-8'
      }

      $header = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store, no-cache, must-revalidate`r`nPragma: no-cache`r`nExpires: 0`r`nConnection: close`r`n`r`n"
      $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
      $stream.Flush()
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
