"""Generate Windows and renderer assets from the approved raster identity."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
RENDERER_ASSETS = ROOT / "src" / "assets"
PROMO_ASSETS = ROOT / "promo-video" / "src" / "assets"
APP_SOURCE = ROOT / "assets" / "tahlas-ai-business-logo.png"
CHAT_SOURCE = ROOT / "assets" / "tahlas-chat-avatar.png"
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def resized(source: Image.Image, size: int) -> Image.Image:
    return source.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    RENDERER_ASSETS.mkdir(parents=True, exist_ok=True)
    PROMO_ASSETS.mkdir(parents=True, exist_ok=True)

    app = Image.open(APP_SOURCE).convert("RGBA")
    chat = Image.open(CHAT_SOURCE).convert("RGBA")
    images = {size: resized(app, size) for size in SIZES}

    images[256].save(BUILD / "icon.png", optimize=True)
    images[256].save(
        BUILD / "icon.ico",
        format="ICO",
        sizes=[(size, size) for size in SIZES],
    )
    resized(app, 384).save(RENDERER_ASSETS / "tahlas-logo.png", optimize=True)
    resized(chat, 192).save(RENDERER_ASSETS / "tahlas-chat-avatar.png", optimize=True)
    resized(app, 384).save(PROMO_ASSETS / "tahlas-logo.png", optimize=True)
    print("Generated Windows and renderer brand assets")


if __name__ == "__main__":
    main()
