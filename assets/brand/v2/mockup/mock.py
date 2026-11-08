import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
V1="/Users/hideki/github/sofa-os/assets/brand/v1/"; C="/Users/hideki/github/sofa-os/assets/brand/v2/candidates/"; S=sys.argv[1]
def font(sz,bold=False):
    for p,i in (("/System/Library/Fonts/Avenir Next.ttc",8 if bold else 7),("/System/Library/Fonts/Helvetica.ttc",1 if bold else 0)):
        try: return ImageFont.truetype(p,sz,index=i)
        except Exception: pass
    return ImageFont.load_default()
def rr(size,r,fill=None):
    m=Image.new("L",size,0); ImageDraw.Draw(m).rounded_rectangle((0,0,size[0]-1,size[1]-1),r,fill=255); return m
def trim(im):
    return im.crop(im.getchannel("A").getbbox())
def fit_h(im,h): return im.resize((int(im.width*h/im.height),h),Image.LANCZOS)
def cover(im,w,h):
    s=max(w/im.width,h/im.height); im=im.resize((int(im.width*s)+1,int(im.height*s)+1),Image.LANCZOS)
    return im.crop(((im.width-w)//2,0,(im.width-w)//2+w,h))
uni_w=trim(Image.open(V1+"kids/unicorn-welcome-v2.png").convert("RGBA"))
uni_r=trim(Image.open(V1+"kids/unicorn-resting-v2.png").convert("RGBA"))
uni_warn=trim(Image.open(C+"unicorn-warning-c.png").convert("RGBA"))
uni_sleep=trim(Image.open(C+"unicorn-sleeping-b.png").convert("RGBA"))
forest={k:Image.open(C+f).convert("RGB") for k,f in (("m","kids-forest-morning-haze.png"),("d","kids-forest-midday.png"),("a","kids-forest-late-afternoon.png"))}
lake=Image.open(V1+"wallpaper/day-cycle-4k/mountain-lake-evening-3840x2160.jpg").convert("RGB").resize((1920,1080),Image.LANCZOS)
IV=(255,245,227); BR=(58,38,28)
def overlay(im,alpha,col=(0,0,0)):
    return Image.blend(im,Image.new("RGB",im.size,col),alpha)
def txt(d,xy,s,sz,fill=IV,bold=False,anchor="la"): d.text(xy,s,font=font(sz,bold),fill=fill,anchor=anchor)
def glass(base,box,r=28,a=0.55,col=(30,40,30)):
    x0,y0,x1,y1=box; w,h=x1-x0,y1-y0
    reg=base.crop(box).filter(ImageFilter.GaussianBlur(14)); reg=Image.blend(reg,Image.new("RGB",(w,h),col),a)
    base.paste(reg,(x0,y0),rr((w,h),r))
def tile(base,x,y,w,h,state="on"):
    bg=cover(forest["d"].crop((0,0,1920,430)),w,h)
    if state=="off": bg=Image.blend(bg.convert("L").convert("RGB"),Image.new("RGB",(w,h),(60,60,60)),0.35)
    lav=Image.new("RGB",(w,h),(201,166,238)); g=Image.linear_gradient("L").rotate(90).resize((w,h)) # right->left fade
    bg=Image.composite(bg,Image.blend(bg,lav,0.55),g.point(lambda v:255-v))
    base.paste(bg,(x,y),rr((w,h),h//2))
    d=ImageDraw.Draw(base); d.rounded_rectangle((x,y,x+w,y+h),h//2,outline=IV,width=4)
    u=fit_h(uni_sleep if state=="off" else uni_w,int(h*(0.8 if state=="off" else 1.25)))
    ux=x+30; uy=y+h-u.height+(8 if state=="off" else 4)
    base.paste(u,(ux,uy),u)
    tx=x+30+u.width+24
    if state=="off":
        txt(d,(tx,y+h//2-12),"Kids Mode",46,IV,True,"lm"); txt(d,(tx,y+h//2+32),"Not available right now",26,(235,225,215),False,"lm")
    else:
        txt(d,(tx,y+h//2),"Kids Mode",50,IV,True,"lm")
        cx=x+w-h//2-6; d.ellipse((cx-34,y+h//2-34,cx+34,y+h//2+34),fill=IV); d.line((cx-10,y+h//2,cx+12,y+h//2),fill=BR,width=6); d.line((cx+2,y+h//2-12,cx+13,y+h//2),fill=BR,width=6); d.line((cx+2,y+h//2+12,cx+13,y+h//2),fill=BR,width=6)
def header(base,title):
    d=ImageDraw.Draw(base); wm=Image.open(V1+"wordmarks/sofa-wordmark-ivory.png").convert("RGBA"); wm=wm.resize((300,94)); base.paste(wm,(70,26),wm); return d
def dashboard(state="on"):
    im=overlay(lake,0.12); d=ImageDraw.Draw(im); header(im,"")
    d.rounded_rectangle((520,36,660,94),29,fill=IV); txt(d,(590,65),"Home",28,BR,True,"mm")
    for i,t in enumerate(("Apps","Widgets","Profile")): txt(d,(700+i*150,65),t,28,IV,False,"lm")
    txt(d,(1850,66),"20:14",50,IV,True,"rm")
    txt(d,(110,215),"Good evening",64,IV,True); txt(d,(110,290),"Relax, explore, be at home.",30,(235,225,215))
    cards=[("7 °C","Partly cloudy"),("Family calendar","Tomorrow 16:00 Football"),("Home","Living room  on"),("Solar today","12.3 kWh")]
    for i,(a,b) in enumerate(cards):
        x=110+i*430; glass(im,(x,500,x+400,720)); txt(d,(x+28,545),a,38,IV,True); txt(d,(x+28,605),b,26,(225,215,200))
    txt(d,(110,780),"My apps",32,IV,True)
    for i in range(7):
        x=110+i*190; glass(im,(x,830,x+170,990),26,0.5,(240,235,225))
    tile(im,1150,150,700,150,state); return im
def kids_home():
    im=overlay(forest["d"],0.0); d=ImageDraw.Draw(im); u=fit_h(uni_w,300); im.paste(u,(90,40),u)
    txt(d,(430,150),"Kids Mode",72,IV,True)
    glass(im,(1480,90,1840,190),50,0.55); txt(d,(1660,140),"45 min left",38,IV,True,"mm")
    for i,(n,c) in enumerate((("KiKA",(231,111,81)),("Disney+",(40,70,150)),("YouTube Kids",(200,60,60)),("Photos",(90,160,110)))):
        x=110+i*430; glass(im,(x,500,x+400,820),44,0.45,(250,245,235)); d.rounded_rectangle((x+110,540,x+290,720),36,fill=c); txt(d,(x+200,775),n,34,IV,True,"mm")
    txt(d,(110,900),"Placeholder tiles: approved apps are set in Companion",24,(235,225,215)); return im
def card(bg,title,sub,uni,btn=None):
    im=overlay(bg,0.25); d=ImageDraw.Draw(im); glass(im,(260,200,1660,880),60,0.62,(35,28,24))
    u=fit_h(uni,420); im.paste(u,(380,470-u.height//2+120),u)
    txt(d,(900,430),title,76,IV,True); txt(d,(900,530),sub,38,(235,225,215))
    if btn:
        d.rounded_rectangle((900,640,1180,740),50,fill=IV); txt(d,(1040,690),btn,38,BR,True,"mm")
    return im
P=[dashboard("on"),kids_home(),card(forest["a"],"5 minutes left","Time for one last episode.",uni_warn,"OK"),card(forest["a"],"All done for now","See you next time.",uni_r)]
for i,p in enumerate(P): p.save(f"{S}/mock{i+1}.png")
sheet=Image.new("RGB",(1920,1080))
for i,p in enumerate(P): sheet.paste(p.resize((960,540),Image.LANCZOS),((i%2)*960,(i//2)*540))
sheet.save(S+"/mock-sheet.png")
# tile close-up: both states on forest
cu=Image.new("RGB",(1800,520)); cu.paste(cover(forest["d"],1800,520),(0,0)); tile(cu,60,220,700,150,"on"); tile(cu,1040,220,700,150,"off"); cu.save(S+"/tile-states.png")
