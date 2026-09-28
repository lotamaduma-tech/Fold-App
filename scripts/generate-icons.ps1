Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Join-Path $PWD 'assets/nectarspend-logo.png'))
foreach ($entry in @(@('icon-192.png',192),@('icon-512.png',512),@('apple-touch-icon.png',180),@('favicon.png',32))) {
  $size = [int]$entry[1]
  $bitmap = New-Object System.Drawing.Bitmap($size,$size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#f3efe6'))
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
  $width = [int]($source.Width * $scale)
  $height = [int]($source.Height * $scale)
  $graphics.DrawImage($source,[int](($size-$width)/2),[int](($size-$height)/2),$width,$height)
  $bitmap.Save((Join-Path $PWD ('assets/'+$entry[0])),[System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}
$source.Dispose()
