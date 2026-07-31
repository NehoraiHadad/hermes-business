"""Generate deterministic Windows icon assets from the product mark.

The drawing primitives intentionally mirror assets/app-icon.svg so tiny Windows
sizes stay crisp without depending on an image-generation service.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
SCALE = 4


def point(value: float, size: int) -> int:
    return round(value / 1024 * size * SCALE)


def render(size: int) -> Image.Image:
    canvas = size * SCALE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (point(48, size), point(48, size), point(976, size), point(976, size)),
        radius=point(264, size),
        fill="#5C5BA8",
    )
    bubble = [
        (point(246, size), point(285, size)),
        (point(778, size), point(285, size)),
        (point(883, size), point(390, size)),
        (point(883, size), point(644, size)),
        (point(778, size), point(749, size)),
        (point(500, size), point(749, size)),
        (point(318, size), point(866, size)),
        (point(318, size), point(749, size)),
        (point(246, size), point(749, size)),
        (point(141, size), point(644, size)),
        (point(141, size), point(390, size)),
    ]
    draw.polygon(bubble, fill="#FFFFFF")
    for cx in (386, 638):
        radius = point(42, size)
        center_x = point(cx, size)
        center_y = point(518, size)
        draw.ellipse(
            (center_x - radius, center_y - radius, center_x + radius, center_y + radius),
            fill="#5C5BA8",
        )
    sparkle = [
        (point(780, size), point(182, size)),
        (point(800, size), point(236, size)),
        (point(854, size), point(256, size)),
        (point(800, size), point(276, size)),
        (point(780, size), point(330, size)),
        (point(760, size), point(276, size)),
        (point(706, size), point(256, size)),
        (point(760, size), point(236, size)),
    ]
    draw.polygon(sparkle, fill="#F4C86A")
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    images = {size: render(size) for size in SIZES}
    images[256].save(BUILD / "icon.png", optimize=True)
    images[256].save(
        BUILD / "icon.ico",
        format="ICO",
        sizes=[(size, size) for size in SIZES],
        append_images=[images[size] for size in SIZES[:-1]],
    )
    print(f"Generated {BUILD / 'icon.png'} and {BUILD / 'icon.ico'}")


if __name__ == "__main__":
    main()
