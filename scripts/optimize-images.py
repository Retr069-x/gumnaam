from pathlib import Path
from PIL import Image, ImageOps

assets = Path(__file__).resolve().parents[1] / "assets"
for source in assets.iterdir():
    if source.suffix.lower() not in (".jpg", ".png") or source.stem == "logo":
        continue
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original)
        image.thumbnail((1600, 1600))
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        target = source.with_suffix(".webp")
        quality = 80
        image.save(target, "WEBP", quality=quality, method=6)
        while target.stat().st_size > 250000 and quality > 60:
            quality -= 10
            image.save(target, "WEBP", quality=quality, method=6)
        if target.stat().st_size > 250000:
            image.thumbnail((1100, 1100))
            image.save(target, "WEBP", quality=quality, method=6)
        print(f"{target.name}: {target.stat().st_size:,} bytes")
