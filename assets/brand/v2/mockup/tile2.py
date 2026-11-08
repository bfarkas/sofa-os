import sys
S=sys.argv[1]; sys.argv=["x",S]
src=open(S+"/mock.py").read().split("P=[dashboard")[0]
exec(src)
DP=(83,59,112)
def tile2(base,x,y,w,h,state,variant):
    off=state=="off"
    bg=cover(forest["d"].crop((0,0,1920,430)),w,h)
    if off: bg=Image.blend(bg.convert("L").convert("RGB"),Image.new("RGB",(w,h),(60,60,60)),0.35)
    ramp=Image.linear_gradient("L").rotate(90).resize((w,h)).point(lambda v:255-v)  # 255 left -> 0 right
    if variant=="scrim":
        dark=Image.new("RGB",(w,h),(38,26,44)); m=ramp.point(lambda v:int(v*0.0)) 
        # scrim: strong on the label zone, fading toward the arrow end
        m=Image.linear_gradient("L").rotate(90).resize((w,h)).point(lambda v:int(255*min(1,max(0,(255-v)/255*1.25))*0.8))
        bg=Image.composite(dark,bg,m)
        fg,sub=IV,(235,225,215)
    else:
        lav=Image.new("RGB",(w,h),(233,223,242))
        m=Image.linear_gradient("L").rotate(90).resize((w,h)).point(lambda v:int(255*min(1,max(0,((255-v)/255-0.12)*2.2))))
        m=m.point(lambda v:int(v*0.96))
        bg=Image.composite(lav,bg,m); fg,sub=DP,(117,81,154)
    base.paste(bg,(x,y),rr((w,h),h//2)); d=ImageDraw.Draw(base)
    d.rounded_rectangle((x,y,x+w,y+h),h//2,outline=IV if variant=="scrim" else (214,197,229),width=4)
    u=fit_h(uni_sleep if off else uni_w,int(h*(1.05 if off else 1.25)))
    base.paste(u,(x+30,y+h-u.height+(10 if off else 4)),u); tx=x+30+u.width+24
    if off:
        txt(d,(tx,y+h//2-14),"Kids Mode",46,fg,True,"lm"); txt(d,(tx,y+h//2+30),"Not available right now",26,sub,False,"lm")
    else:
        txt(d,(tx,y+h//2),"Kids Mode",50,fg,True,"lm")
        cx=x+w-h//2-6; ac=IV if variant=="scrim" else DP; ic=BR if variant=="scrim" else IV
        d.ellipse((cx-34,y+h//2-34,cx+34,y+h//2+34),fill=ac)
        for p in ((cx-10,y+h//2,cx+12,y+h//2),(cx+2,y+h//2-12,cx+13,y+h//2),(cx+2,y+h//2+12,cx+13,y+h//2)): d.line(p,fill=ic,width=6)
cu=Image.new("RGB",(1800,860))
cu.paste(cover(forest["d"],1800,860),(0,0))
cu.paste(overlay(lake,0.12).crop((0,100,1800,960)),(0,0)) if False else None
for r,v in enumerate(("scrim","panel")):
    tile2(cu,60,90+r*380,700,150,"on",v); tile2(cu,1040,90+r*380,700,150,"off",v)
d=ImageDraw.Draw(cu); txt(d,(60,40),"A: dark scrim",28,IV,True); txt(d,(60,420),"B: light lavender panel",28,IV,True)
cu.save(S+"/tile-variants.png")
# same two on the real dashboard
for v in ("scrim","panel"):
    im=dashboard("on"); tile2(im,1150,150,700,150,"on",v); im.crop((1100,100,1900,350)).save(f"{S}/tile-dash-{v}.png")
