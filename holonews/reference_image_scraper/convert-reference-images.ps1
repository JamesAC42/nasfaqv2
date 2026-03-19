param(
    [string]$InputFolder = ".\reference_images",
    [string]$OutputSubfolder = "jpg_60pct",
    [double]$Scale = 0.60,
    [ValidateRange(1, 100)]
    [int]$JpegQuality = 88
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $InputFolder)) {
    throw "Input folder not found: $InputFolder"
}

if ($Scale -le 0 -or $Scale -gt 1) {
    throw "Scale must be greater than 0 and less than or equal to 1."
}

$resolvedInputFolder = (Resolve-Path -LiteralPath $InputFolder).Path
$outputFolder = Join-Path -Path $resolvedInputFolder -ChildPath $OutputSubfolder

if (-not (Test-Path -LiteralPath $outputFolder)) {
    $null = New-Item -ItemType Directory -Path $outputFolder
}

$supportedExtensions = @(".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".tif", ".tiff")

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq "image/jpeg" } |
    Select-Object -First 1

if (-not $jpegCodec) {
    throw "JPEG encoder not found on this system."
}

$encoder = [System.Drawing.Imaging.Encoder]::Quality
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($encoder, [long]$JpegQuality)

$imageFiles = Get-ChildItem -LiteralPath $resolvedInputFolder -File |
    Where-Object { $supportedExtensions -contains $_.Extension.ToLowerInvariant() }

if (-not $imageFiles) {
    Write-Host "No supported image files found in $resolvedInputFolder"
    exit 0
}

foreach ($file in $imageFiles) {
    $destinationPath = Join-Path -Path $outputFolder -ChildPath ($file.BaseName + ".jpg")

    $sourceImage = $null
    $canvas = $null
    $graphics = $null

    try {
        $sourceImage = [System.Drawing.Image]::FromFile($file.FullName)

        $newWidth = [Math]::Max(1, [int][Math]::Round($sourceImage.Width * $Scale))
        $newHeight = [Math]::Max(1, [int][Math]::Round($sourceImage.Height * $Scale))

        $canvas = New-Object System.Drawing.Bitmap($newWidth, $newHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [System.Drawing.Graphics]::FromImage($canvas)

        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

        # JPEG has no alpha channel, so transparent source pixels are flattened onto white.
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.DrawImage(
            $sourceImage,
            (New-Object System.Drawing.Rectangle(0, 0, $newWidth, $newHeight)),
            (New-Object System.Drawing.Rectangle(0, 0, $sourceImage.Width, $sourceImage.Height)),
            [System.Drawing.GraphicsUnit]::Pixel
        )

        $canvas.Save($destinationPath, $jpegCodec, $encoderParams)
        Write-Host ("Converted {0} -> {1} ({2}x{3}, JPEG quality {4})" -f $file.Name, (Split-Path -Leaf $destinationPath), $newWidth, $newHeight, $JpegQuality)
    }
    finally {
        if ($graphics) { $graphics.Dispose() }
        if ($canvas) { $canvas.Dispose() }
        if ($sourceImage) { $sourceImage.Dispose() }
    }
}

Write-Host "Done. Output folder: $outputFolder"
