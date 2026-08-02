
$output = & npm run package 2>&1
if ($LASTEXITCODE) {
    exit $LASTEXITCODE
}

$vsixPath = $output[-1].Split(" ") | Where-Object { $_.EndsWith(".vsix") }
if (!$vsixPath -or -not (Test-Path $vsixPath)) {
    Write-Error "Failed to find vsix path: "
}

& code --install-extension $vsixPath --force

