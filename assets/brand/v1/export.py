#!/usr/bin/env python3
"""Export the selected Low profile icon. Requires cairosvg and Pillow."""
from pathlib import Path
from io import BytesIO
import json
import cairosvg
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent
SAGE = '#465C48'
IVORY = '#FFF5E3'
CHARCOAL = '#29332F'
# Shared geometry: low continuous back, flat arms, an open seat line and short feet.
MARK = '<path d="M300 358H724Q800 358 800 434V457Q774 457 774 486V524H250V486Q250 457 224 457V434Q224 358 300 358Z"/><path d="M190 468H210Q238 468 238 496V548H786V496Q786 468 814 468H834Q872 468 872 506V610Q872 652 830 652H194Q152 652 152 610V506Q152 468 190 468Z"/><rect x="216" y="664" width="56" height="28" rx="7"/><rect x="752" y="664" width="56" height="28" rx="7"/>'
def svg(background=SAGE, color=IVORY, scale=1, rounded=False):
    bg = f'<rect width="1024" height="1024" rx="{220 if rounded else 0}" fill="{background}"/>' if background else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><title>Sofa.OS — Low profile</title>{bg}<g fill="{color}" transform="translate(512 512) scale({scale}) translate(-512 -512)">{MARK}</g></svg>'
def raster(source, size):
    return Image.open(BytesIO(cairosvg.svg2png(bytestring=source.encode(),output_width=size,output_height=size))).convert('RGBA')
def save_svg(name, source):
    (ROOT / name).write_text(source + '\n')
master = svg()
maskable = svg(scale=.9)
save_svg('sofa-icon.svg', master)
save_svg('sofa-icon-maskable.svg', maskable)
save_svg('sofa-mark-ivory.svg', svg(background=None))
save_svg('sofa-mark-sage.svg', svg(background=None, color=SAGE))
for size in (32, 48, 117, 180, 192, 512, 1024):
    raster(master, size).convert('RGB').save(ROOT / f'sofa-icon-{size}.png')
for size in (192,512):
    raster(maskable, size).convert('RGB').save(ROOT / f'sofa-icon-maskable-{size}.png')
raster(master,256).save(ROOT / 'favicon.ico',sizes=[(16,16),(32,32),(48,48)])
icons = [{'src':f'/icons/sofa-icon-{n}.png','sizes':f'{n}x{n}','type':'image/png','purpose':'any'} for n in (192,512)]
icons += [{'src':f'/icons/sofa-icon-maskable-{n}.png','sizes':f'{n}x{n}','type':'image/png','purpose':'maskable'} for n in (192,512)]
(ROOT/'manifest-icons.json').write_text(json.dumps({'icons':icons,'theme_color':SAGE,'background_color':SAGE},indent=2)+'\n')
# Actual asset geometry in presentation masks, plus native-size inspection samples.
board = Image.new('RGB',(1600,1040),IVORY)
draw = ImageDraw.Draw(board)
fontpath = '/System/Library/Fonts/Supplemental/Arial.ttf'
def font(size):
    return ImageFont.truetype(fontpath,size)
def text(x,y,value,size=24,fill=CHARCOAL):
    draw.text((x,y),value,font=font(size),fill=fill)
text(76,52,'Sofa.OS',64)
text(78,136,'Low profile / production asset study',26)
large = raster(svg(rounded=True),560)
board.paste(large,(76,222),large)
text(78,814,'Ivory on sage',28)
text(78,859,'#FFF5E3  /  #465C48',22)
text(740,224,'Small-size checks',28)
for x,size in ((740,117),(925,64),(1050,48),(1160,32)):
    im = raster(svg(rounded=True),size)
    board.paste(im,(x,290),im)
    text(x,430,str(size)+' px',20)
text(740,512,'Maskable / alternate system crops',28)
for x,shape in ((740,'circle'),(1010,'rounded')):
    im = raster(maskable,220)
    mask=Image.new('L',(220,220)); md=ImageDraw.Draw(mask)
    if shape=='circle': md.ellipse((0,0,219,219),fill=255)
    else: md.rounded_rectangle((0,0,219,219),radius=58,fill=255)
    board.paste(im,(x,574),mask)
text(740,858,'Continuous back. Low arms. Quiet proportions.',22)
text(740,902,'SVG master + PNG exports for PWA and Tizen.',22)
board.save(ROOT/'preview.png')
print('Exported assets to',ROOT)
