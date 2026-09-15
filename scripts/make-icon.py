# 生成象棋 AI 专属应用图标（.ico，多尺寸）
# 设计：深木色底 + 金色棋盘网格（楚河汉界） + 中央红色"帅"字圆棋
import io, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'gui', 'build', 'icon.ico')
SIZE = 256

def font(sz):
    for fp in [r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf']:
        try:
            return ImageFont.truetype(fp, sz)
        except Exception:
            continue
    return ImageFont.load_default()

img = Image.new('RGBA', (SIZE, SIZE), (43, 36, 28, 255))  # 深木色 #2b241c
d = ImageDraw.Draw(img)

# ---- 棋盘外框 ----
M = 26                       # 外边距
d.rectangle([M - 6, M - 6, SIZE - M + 6, SIZE - M + 6], outline=(212, 175, 55, 255), width=4)
cell = (SIZE - 2 * M) / 8    # 9 列 8 格

# ---- 网格线（金）----
GOLD = (212, 175, 55, 255)
for r in range(10):  # 10 条横线
    y = M + r * cell
    d.line([M, y, SIZE - M, y], fill=GOLD, width=2)
for f in range(9):   # 9 条竖线，中间行断开（楚河汉界）
    x = M + f * cell
    yMid = M + 4 * cell
    d.line([x, M, x, yMid - cell * 0.28], fill=GOLD, width=2)
    d.line([x, yMid + cell * 0.28, x, SIZE - M], fill=GOLD, width=2)
# 九宫斜线
for (x0, y0, x1, y1) in [
    (M, M, M + 2 * cell, M + 2 * cell), (M + 6 * cell, M, M + 8 * cell, M + 2 * cell),
    (M, SIZE - M - 2 * cell, M + 2 * cell, SIZE - M), (M + 6 * cell, SIZE - M - 2 * cell, M + 8 * cell, SIZE - M),
]:
    d.line([x0, y0, x1, y1], fill=GOLD, width=2)

# ---- 楚河汉界 ----
f2 = font(26)
def txt_c(c, s, f, fy):
    w = d.textlength(s, font=f)
    d.text((c - w / 2, fy), s, font=f, fill=(150, 130, 90, 255))
yMid = M + 4 * cell
txt_c(SIZE / 2 - cell * 1.15, '楚', f2, yMid - cell * 0.52)
txt_c(SIZE / 2 + cell * 1.15, '汉', f2, yMid - cell * 0.52)

# ---- 中央红圆棋"帅" ----
cx, cy = SIZE / 2, SIZE / 2 - 0  # 正中
R = 62
d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(196, 52, 32, 255), outline=(120, 28, 16, 255), width=5)
d.ellipse([cx - R + 12, cy - R + 12, cx + R - 12, cy + R - 12], outline=(245, 200, 120, 255), width=3)
f3 = font(88)
w3 = d.textlength('帅', font=f3)
d.text((cx - w3 / 2, cy - 46), '帅', font=f3, fill=(255, 236, 190, 255))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('icon written:', OUT, os.path.getsize(OUT), 'bytes')