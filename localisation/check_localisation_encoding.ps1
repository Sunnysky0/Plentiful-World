$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$allowedLanguages = @(
  'english',
  'french',
  'german',
  'spanish',
  'braz_por',
  'polish',
  'russian',
  'japanese',
  'simp_chinese',
  'korean'
)

$issues = New-Object System.Collections.Generic.List[object]
$files = Get-ChildItem -Path $scriptDir -Recurse -File -Filter *.yml | Sort-Object FullName

foreach ($file in $files) {
  $relativePath = $file.FullName.Substring($scriptDir.Length).TrimStart('\')
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
  $suffixLanguage = $null

  if ($baseName -match '_l_([A-Za-z_]+)$') {
    $suffixLanguage = $Matches[1].ToLowerInvariant()
    if ($allowedLanguages -notcontains $suffixLanguage) {
      $issues.Add([pscustomobject]@{
          File    = $relativePath
          Rule    = 'Filename suffix'
          Details = "Unknown language suffix: $suffixLanguage"
        })
    }
  }
  else {
    $issues.Add([pscustomobject]@{
        File    = $relativePath
        Rule    = 'Filename suffix'
        Details = 'Missing _l_<language> suffix in filename'
      })
  }

  $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
  $hasUtf8Bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  if (-not $hasUtf8Bom) {
    $issues.Add([pscustomobject]@{
        File    = $relativePath
        Rule    = 'BOM'
        Details = 'Not UTF-8 with BOM (missing EF BB BF)'
      })
  }
  elseif ($bytes.Length -ge 6 -and $bytes[3] -eq 0xEF -and $bytes[4] -eq 0xBB -and $bytes[5] -eq 0xBF) {
    $issues.Add([pscustomobject]@{
        File    = $relativePath
        Rule    = 'BOM'
        Details = 'Duplicate BOM detected (EF BB BF EF BB BF)'
      })
  }

  $firstLine = ''
  $reader = [System.IO.StreamReader]::new($file.FullName, [System.Text.Encoding]::UTF8, $true)
  try {
    $firstLine = $reader.ReadLine()
  }
  finally {
    $reader.Dispose()
  }
  if ($null -eq $firstLine) { $firstLine = '' }
  $firstLine = $firstLine -replace "^[\uFEFF]", ''

  if ($firstLine -notmatch '^l_(english|french|german|spanish|braz_por|polish|russian|japanese|simp_chinese|korean):$') {
    $issues.Add([pscustomobject]@{
        File    = $relativePath
        Rule    = 'Header line'
        Details = "Invalid first line header: $firstLine"
      })
  }
  else {
    $headerLanguage = $Matches[1].ToLowerInvariant()
    if ($null -ne $suffixLanguage -and $suffixLanguage -ne $headerLanguage) {
      $issues.Add([pscustomobject]@{
          File    = $relativePath
          Rule    = 'Suffix/header match'
          Details = "Filename has l_$suffixLanguage but header is l_${headerLanguage}:"
        })
    }
  }
}

if ($issues.Count -eq 0) {
  Write-Host "OK: Checked $($files.Count) localisation files, all checks passed."
  exit 0
}

Write-Host "FAIL: Found $($issues.Count) issues." -ForegroundColor Red
$issues | Format-Table -AutoSize
exit 1
