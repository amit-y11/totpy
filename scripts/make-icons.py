"""Render the extension icons (no dependencies): a rounded indigo tile with a
countdown ring and a center dot. Run: python3 scripts/make-icons.py"""

import math
import struct
import zlib
from pathlib import Path

BG = (91, 91, 214)
FG = (255, 255, 255)
SS = 4  # supersampling factor for anti-aliasing


def coverage(x, y):
    """Returns (bg_alpha, fg_alpha) at normalized point x, y in [0, 1]."""
    # Rounded square tile.
    r = 0.22
    dx = max(abs(x - 0.5) - (0.5 - r), 0)
    dy = max(abs(y - 0.5) - (0.5 - r), 0)
    if math.hypot(dx, dy) > r:
        return 0, 0
    cx, cy = x - 0.5, y - 0.5
    dist = math.hypot(cx, cy)
    # Ring with a gap in the top-left quarter, like a countdown timer.
    angle = (math.degrees(math.atan2(cx, -cy)) + 360) % 360
    on_ring = 0.24 <= dist <= 0.32 and not (275 <= angle <= 355)
    on_dot = dist <= 0.085
    return 1, 1 if (on_ring or on_dot) else 0


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            bg = fg = 0
            for sy in range(SS):
                for sx in range(SS):
                    b, f = coverage((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
                    bg += b
                    fg += f
            n = SS * SS
            a, t = bg / n, (fg / bg if bg else 0)
            rgb = [round(BG[i] * (1 - t) + FG[i] * t) for i in range(3)]
            row += bytes(rgb + [round(a * 255)])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


out = Path(__file__).resolve().parent.parent / "icons"
out.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    (out / f"icon-{size}.png").write_bytes(render(size))
    print(f"icons/icon-{size}.png")
