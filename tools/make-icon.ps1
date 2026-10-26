Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\Administrator\Documents\Qoder\2026-10-26\ced5229b\vibe_images\antigravity-launcher-icon_1793008059113_7019d9b3.png'
$outDir = 'E:\Github_Pro\antigravity-launcher\build'

function New-RoundedIcon {
    param([int]$Size, [double]$CornerRadius, [double]$InsetRatio, $Source)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $inset = [double]$Size * $InsetRatio
    $side = [double]$Size - (2 * $inset)
    $right = $inset + $side
    $bottom = $inset + $side
    $d = New-Object System.Drawing.RectangleF(0.0, 0.0, [float]$Size, [float]$Size)

    # Clip to a rounded rect inset slightly more than the artwork's own corner,
    # so the white background outside the source tile can never survive.
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc($inset, $inset, $CornerRadius, $CornerRadius, 180, 90)
    $gp.AddArc(($right - $CornerRadius), $inset, $CornerRadius, $CornerRadius, 270, 90)
    $gp.AddArc(($right - $CornerRadius), ($bottom - $CornerRadius), $CornerRadius, $CornerRadius, 0, 90)
    $gp.AddArc($inset, ($bottom - $CornerRadius), $CornerRadius, $CornerRadius, 90, 90)
    $gp.CloseFigure()

    $g.SetClip($gp, [System.Drawing.Drawing2D.CombineMode]::Intersect)
    $g.DrawImage($Source, $d)
    $g.ResetClip()
    $g.Dispose()
    $gp.Dispose()
    return $bmp
}

$img = [System.Drawing.Image]::FromFile($src)
$full = New-RoundedIcon -Size 1024 -CornerRadius 200 -InsetRatio 0.03 -Source $img
$pngPath = Join-Path $outDir 'icon.png'
$full.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$full.Dispose()
$img.Dispose()

foreach ($s in 16, 24, 32, 48, 64, 128, 256, 512) {
    $srcImg = [System.Drawing.Image]::FromFile($pngPath)
    $b = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.DrawImage($srcImg, 0, 0, $s, $s)
    $g.Dispose()
    $srcImg.Dispose()
    $b.Save((Join-Path $outDir ("icon_{0}.png" -f $s)), [System.Drawing.Imaging.ImageFormat]::Png)
    $b.Dispose()
}

# Verify the corners really are transparent now.
$chk = New-Object System.Drawing.Bitmap($pngPath)
foreach ($pt in @(@(2, 2), @(1021, 2), @(2, 1021), @(1021, 1021), @(512, 512))) {
    $c = $chk.GetPixel($pt[0], $pt[1])
    "pixel $($pt[0]),$($pt[1]) -> A=$($c.A) R=$($c.R) G=$($c.G) B=$($c.B)"
}
$chk.Dispose()
'done'
