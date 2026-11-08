#!/usr/bin/env python3
"""Rebuild wordmarks and launch assets; requires CairoSVG."""
from pathlib import Path
import xml.etree.ElementTree as ET
import cairosvg
ROOT=Path(__file__).resolve().parent
ns={'s':'http://www.w3.org/2000/svg'}
tree=ET.parse(ROOT/'sofa-mark-sage.svg')
group=tree.getroot().find('s:g',ns)
geometry=''.join(ET.tostring(x,encoding='unicode') for x in group)
def wordmark(color,dot):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><title>Sofa.OS wordmark</title><g transform="translate(-30 -16) scale(.23)" fill="{color}">{geometry}</g><text x="208" y="142" fill="{color}" font-family="Avenir Next, Avenir, sans-serif" font-weight="500" font-size="116" letter-spacing="-3">Sofa<tspan fill="{dot}">.</tspan>OS</text></svg>'
for name,color,dot in [('sage','#465C48','#829B78'),('ivory','#FFF5E3','#A4BA93'),('charcoal','#29332F','#829B78')]:
    source=wordmark(color,dot)
    (ROOT/'wordmarks'/f'sofa-wordmark-{name}.svg').write_text(source+'\n')
    cairosvg.svg2png(bytestring=source.encode(),write_to=str(ROOT/'wordmarks'/f'sofa-wordmark-{name}.png'),output_width=1280,output_height=400)
source=f'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><title>Sofa.OS launch screen</title><rect width="1920" height="1080" fill="#465C48"/><g transform="translate(680 447) scale(.875)">{wordmark("#FFF5E3","#A4BA93")}</g></svg>'
(ROOT/'launch'/'sofa-launch.svg').write_text(source+'\n')
cairosvg.svg2png(bytestring=source.encode(),write_to=str(ROOT/'launch'/'sofa-launch-1920x1080.png'))
print('Exported wordmarks and launch screen.')
