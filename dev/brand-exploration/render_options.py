from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = Path(__file__).parent
SRC = Path(r"C:\Users\oxoth\projects\leaf\docs\user-guides\vario-user-manual\leaf-logotype.png")

GREEN = "#D8FF00"
BLUE = "#0099FF"
CHARCOAL = "#242A2E"
MID_GREY = "#68757F"
LIGHT_GREY = "#D8E0E5"
WHITE = "#FFFFFF"
DARK = "#252B30"

source = Image.open(SRC).convert("L")

def mask_crop(box):
    crop = source.crop(box)
    mask = Image.eval(crop, lambda p: 255 - p)
    bbox = mask.getbbox()
    return mask.crop(bbox)

mark_mask = mask_crop((80, 90, 430, 455))
leaf_word_mask = mask_crop((465, 120, 1170, 390))

def font(size, bold=False):
    candidates = [
        r"C:\Windows\Fonts\bahnschrift.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()

def fit_mask(mask, width, height):
    scale = min(width / mask.width, height / mask.height)
    return mask.resize((round(mask.width * scale), round(mask.height * scale)), Image.Resampling.LANCZOS)

def paste_mask(canvas, mask, xy, color):
    layer = Image.new("RGBA", mask.size, color)
    canvas.paste(layer, xy, mask)

def colored_mark(size, fg, bg=None, ring=None, gradient=None, accent_dot=None):
    im = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    if ring:
        inset = max(2, size // 18)
        draw.rounded_rectangle((inset, inset, size-inset-1, size-inset-1), radius=size//5,
                               outline=ring, width=max(2, size//22))
    m = fit_mask(mark_mask, size * .62, size * .70)
    x, y = (size-m.width)//2, (size-m.height)//2
    if gradient:
        grad = Image.new("RGBA", m.size)
        gd = ImageDraw.Draw(grad)
        for yy in range(m.height):
            t = yy / max(1, m.height-1)
            c1, c2 = tuple(int(gradient[0][i:i+2],16) for i in (1,3,5)), tuple(int(gradient[1][i:i+2],16) for i in (1,3,5))
            c = tuple(round(a*(1-t)+b*t) for a,b in zip(c1,c2))
            gd.line((0,yy,m.width,yy), fill=(*c,255))
        im.paste(grad, (x,y), m)
    else:
        paste_mask(im, m, (x,y), fg)
    if accent_dot:
        r = size * .075
        draw.ellipse((size*.73-r, size*.72-r, size*.73+r, size*.72+r), fill=accent_dot)
    return im

favicons = [
    ("01", "Hero on charcoal", dict(fg=GREEN, bg=CHARCOAL)),
    ("02", "Blue on charcoal", dict(fg=BLUE, bg=CHARCOAL)),
    ("03", "Hero on white", dict(fg=GREEN, bg=WHITE, ring=LIGHT_GREY)),
    ("04", "Charcoal on hero", dict(fg=CHARCOAL, bg=GREEN)),
    ("05", "White on blue", dict(fg=WHITE, bg=BLUE)),
    ("06", "Green to blue", dict(fg=GREEN, bg=CHARCOAL, gradient=(GREEN, BLUE))),
    ("07", "Hero plus blue", dict(fg=GREEN, bg=CHARCOAL, accent_dot=BLUE)),
    ("08", "Blue with hero ring", dict(fg=BLUE, bg=WHITE, ring=GREEN)),
]

for code, label, kwargs in favicons:
    colored_mark(512, **kwargs).save(OUT / f"favicon-{code}.png")

sheet = Image.new("RGB", (1500, 940), "#F2F5F6")
d = ImageDraw.Draw(sheet)
d.text((55,35), "LEAF LOG — BROWSER TAB ICON DIRECTIONS", font=font(32, True), fill=CHARCOAL)
d.text((55,80), "Actual Leaf mark · hero green #D8FF00 · sidekick blue #0099FF", font=font(18), fill=MID_GREY)
for i,(code,label,kwargs) in enumerate(favicons):
    col, row = i%4, i//4
    x, y = 55+col*360, 135+row*385
    d.rounded_rectangle((x,y,x+320,y+330), radius=18, fill=WHITE, outline=LIGHT_GREY, width=2)
    icon = colored_mark(190, **kwargs)
    sheet.paste(icon, (x+65,y+34), icon)
    d.text((x+20,y+242), f"{code}  {label}", font=font(19,True), fill=CHARCOAL)
    d.text((x+20,y+278), "16 px", font=font(13,True), fill=MID_GREY)
    tiny = colored_mark(32, **kwargs)
    sheet.paste(tiny, (x+70,y+272), tiny)
    d.text((x+125,y+278), "32 px", font=font(13,True), fill=MID_GREY)
    small = colored_mark(48, **kwargs)
    sheet.paste(small, (x+180,y+264), small)
sheet.save(OUT / "favicon-options-contact-sheet.png")

wordmarks = [
    ("A", "Balanced", GREEN, CHARCOAL, BLUE, None),
    ("B", "Leaf-led", GREEN, CHARCOAL, GREEN, None),
    ("C", "Blue companion", GREEN, CHARCOAL, BLUE, BLUE),
    ("D", "Cool technical", BLUE, CHARCOAL, BLUE, GREEN),
    ("E", "Quiet charcoal", MID_GREY, CHARCOAL, BLUE, None),
    ("F", "Gradient mark", (GREEN,BLUE), CHARCOAL, BLUE, GREEN),
]

def wordmark(width, height, bg, spec, leaf_override=None, large_log=False):
    code,label,mark_color,leaf_light,log_color,underline = spec
    dark_bg = bg == DARK
    im = Image.new("RGBA", (width,height), bg)
    m = fit_mask(mark_mask, height*.60, height*.68)
    mx,my = 26,(height-m.height)//2
    if isinstance(mark_color, tuple):
        mark = colored_mark(max(m.size), GREEN, gradient=mark_color)
        crop = mark.getbbox()
        mark = mark.crop(crop).resize(m.size, Image.Resampling.LANCZOS)
        im.alpha_composite(mark,(mx,my))
    else:
        paste_mask(im,m,(mx,my),mark_color)
    lw = fit_mask(leaf_word_mask, width*.45, height*.43)
    lx = mx+m.width+20
    ly = (height-lw.height)//2-1
    leaf_color = leaf_override or (WHITE if dark_bg else leaf_light)
    paste_mask(im,lw,(lx,ly),leaf_color)
    draw=ImageDraw.Draw(im)
    log_font=font(round(height*(.48 if large_log else .35)),True)
    log_x=lx+lw.width+11
    bbox=draw.textbbox((0,0),"Log",font=log_font)
    log_y=(height-(bbox[3]-bbox[1]))//2-bbox[1]
    draw.text((log_x,log_y),"Log",font=log_font,fill=log_color)
    if underline:
        y=height-round(height*.16)
        draw.rounded_rectangle((log_x,y,min(width-24,log_x+round(height*.58)),y+4),radius=2,fill=underline)
    return im

wm_sheet=Image.new("RGB",(1500,1320),"#F2F5F6")
d=ImageDraw.Draw(wm_sheet)
d.text((55,35),"LEAFLOG — HEADER WORDMARK DIRECTIONS",font=font(32,True),fill=CHARCOAL)
d.text((55,80),"Each direction shown on white and dark grey",font=font(18),fill=MID_GREY)
for i,spec in enumerate(wordmarks):
    y=135+i*190
    d.text((55,y+65),f"{spec[0]}  {spec[1]}",font=font(19,True),fill=CHARCOAL)
    light=wordmark(560,145,WHITE,spec)
    dark=wordmark(560,145,DARK,spec)
    wm_sheet.paste(light,(300,y),light)
    wm_sheet.paste(dark,(885,y),dark)
    light.save(OUT/f"wordmark-{spec[0].lower()}-light.png")
    dark.save(OUT/f"wordmark-{spec[0].lower()}-dark.png")
wm_sheet.save(OUT/"wordmark-options-contact-sheet.png")

# A second exploration makes "Log" a co-equal, highly legible part of the
# name. The lower half repeats every treatment with the official "leaf"
# letters in Hero Green, as requested, while preserving both backgrounds.
large_sheet=Image.new("RGB",(1500,2700),"#F2F5F6")
d=ImageDraw.Draw(large_sheet)
d.text((55,35),"LEAFLOG — LARGE ‘LOG’ WORDMARK DIRECTIONS",font=font(32,True),fill=CHARCOAL)
d.text((55,80),"Neutral leaf family, followed by Hero Green leaf family · each on white and dark grey",font=font(18),fill=MID_GREY)

families = [("NEUTRAL ‘LEAF’", None, "neutral"), ("HERO GREEN ‘LEAF’", GREEN, "hero")]
row = 0
for family_label, leaf_override, family_slug in families:
    heading_y = 135 + row * 180
    d.text((55,heading_y),family_label,font=font(19,True),fill=MID_GREY)
    row += 1
    for spec in wordmarks:
        y=135+row*180
        d.text((55,y+61),f"{spec[0]}  {spec[1]}",font=font(19,True),fill=CHARCOAL)
        light=wordmark(560,140,WHITE,spec,leaf_override=leaf_override,large_log=True)
        dark=wordmark(560,140,DARK,spec,leaf_override=leaf_override,large_log=True)
        large_sheet.paste(light,(300,y),light)
        large_sheet.paste(dark,(885,y),dark)
        light.save(OUT/f"wordmark-large-{spec[0].lower()}-{family_slug}-light.png")
        dark.save(OUT/f"wordmark-large-{spec[0].lower()}-{family_slug}-dark.png")
        row += 1
large_sheet.save(OUT/"wordmark-large-log-options-contact-sheet.png")

def text_mask(text, size=160, font_path=None):
    f = ImageFont.truetype(font_path, size) if font_path else font(size, True)
    scratch = Image.new("L", (700, 260), 0)
    sd = ImageDraw.Draw(scratch)
    bbox = sd.textbbox((0, 0), text, font=f)
    sd.text((-bbox[0], -bbox[1]), text, font=f, fill=255)
    return scratch.crop(scratch.getbbox())

supplied_log_source = Image.open(OUT / "supplied-log-lettering.png").convert("L")
# Preserve the supplied lettering as one shape. Its visible l runs from y=26
# through the baseline at y=124; the g alone continues to y=152.
supplied_log_mask = Image.eval(supplied_log_source, lambda p: 255 - p).crop((15, 26, 211, 152))

def scaled_supplied_log(stem_height):
    scale = stem_height / 98
    return supplied_log_mask.resize(
        (round(supplied_log_mask.width * scale), round(supplied_log_mask.height * scale)),
        Image.Resampling.LANCZOS,
    )

def precise_wordmark(width, height, bg, spec, hero_leaf=False, compact=False, guides=False):
    _, _, mark_color, leaf_light, log_color, _underline = spec
    dark_bg = bg == DARK
    im = Image.new("RGBA", (width, height), bg)
    m = fit_mask(mark_mask, height * .60, height * .68)
    mx, my = 26, (height - m.height) // 2
    if isinstance(mark_color, tuple):
        mark = colored_mark(max(m.size), GREEN, gradient=mark_color)
        mark = mark.crop(mark.getbbox()).resize(m.size, Image.Resampling.LANCZOS)
        im.alpha_composite(mark, (mx, my))
    else:
        paste_mask(im, m, (mx, my), mark_color)

    # Both lockups share the official leaf's text size and baseline; the g's
    # descender must not affect vertical placement.
    leaf_mask = fit_mask(leaf_word_mask, width * .45, height * .43)
    lx = mx + m.width + 20
    ly = (height - leaf_mask.height) // 2
    if compact:
        log_mask = scaled_supplied_log(leaf_mask.height)
        paste_mask(im, log_mask, (lx, ly), log_color)
    else:
        leaf_color = GREEN if hero_leaf else (WHITE if dark_bg else leaf_light)
        paste_mask(im, leaf_mask, (lx, ly), leaf_color)
        # Scale the supplied lettering from its l stem, putting its ascender
        # and baseline on the same guides as the official Leaf lettering.
        letter_gap = round(leaf_mask.height * 88 / 225)
        lx += leaf_mask.width + letter_gap
        log_mask = scaled_supplied_log(leaf_mask.height)
        paste_mask(im, log_mask, (lx, ly), log_color)
        x_top = ly + round(27 * leaf_mask.height / 98)
        if guides:
            draw = ImageDraw.Draw(im)
            end_x = lx + log_mask.width
            for y, color in [
                (ly, "#D81B60"),
                (x_top, "#7B61FF"),
                (ly + leaf_mask.height, "#00A67E"),
            ]:
                draw.line((mx + m.width + 13, y, end_x + 5, y), fill=color, width=1)
    return im

def render_two_column_sheet(filename, title, rows, height):
    sheet = Image.new("RGB", (1500, height), "#F2F5F6")
    draw = ImageDraw.Draw(sheet)
    draw.text((55, 35), title, font=font(32, True), fill=CHARCOAL)
    draw.text((55, 80), "White and dark-grey backgrounds · exact optical alignment", font=font(18), fill=MID_GREY)
    y = 135
    for label, light, dark in rows:
        draw.text((55, y + 58), label, font=font(18, True), fill=CHARCOAL)
        sheet.paste(light, (300, y), light)
        sheet.paste(dark, (885, y), dark)
        y += 175
    sheet.save(OUT / filename)

equal_rows = []
for family_label, hero_leaf, slug in [("Neutral leaf", False, "neutral"), ("Hero Green leaf", True, "hero")]:
    for spec in wordmarks:
        light = precise_wordmark(560, 135, WHITE, spec, hero_leaf=hero_leaf)
        dark = precise_wordmark(560, 135, DARK, spec, hero_leaf=hero_leaf)
        equal_rows.append((f"{family_label} · {spec[0]} {spec[1]}", light, dark))
        light.save(OUT / f"wordmark-equal-{spec[0].lower()}-{slug}-light.png")
        dark.save(OUT / f"wordmark-equal-{spec[0].lower()}-{slug}-dark.png")
render_two_column_sheet(
    "wordmark-equal-height-options-contact-sheet.png",
    "LEAFLOG — MATCHED LOWERCASE LETTERING",
    equal_rows,
    2310,
)

guide_rows = []
for hero_leaf, family_label in [(False, "Neutral leaf"), (True, "Hero Green leaf")]:
    for spec in wordmarks[:2]:
        light = precise_wordmark(560, 155, WHITE, spec, hero_leaf=hero_leaf, guides=True)
        dark = precise_wordmark(560, 155, DARK, spec, hero_leaf=hero_leaf, guides=True)
        guide_rows.append((f"{family_label} · {spec[0]} {spec[1]}", light, dark))
render_two_column_sheet(
    "wordmark-alignment-guide-contact-sheet.png",
    "LEAFLOG — THREE-LINE ALIGNMENT CHECK",
    guide_rows,
    890,
)

compact_rows = []
for spec in wordmarks:
    light = precise_wordmark(560, 135, WHITE, spec, compact=True)
    dark = precise_wordmark(560, 135, DARK, spec, compact=True)
    compact_rows.append((f"{spec[0]}  {spec[1]}", light, dark))
    light.save(OUT / f"mark-log-{spec[0].lower()}-light.png")
    dark.save(OUT / f"mark-log-{spec[0].lower()}-dark.png")
render_two_column_sheet(
    "mark-log-options-contact-sheet.png",
    "LEAF SYMBOL + LOG — COMPACT LOCKUPS",
    compact_rows,
    1260,
)

# Additional background comparison, preserving the approved lettering geometry.
SOFTER_DARK = "#414A52"
grey_sheet = Image.new("RGB", (1500, 1260), "#F2F5F6")
grey_draw = ImageDraw.Draw(grey_sheet)
grey_draw.text((55, 35), "LEAF SYMBOL + LOG — GREY BACKGROUNDS", font=font(32, True), fill=CHARCOAL)
grey_draw.text((300, 90), f"Current charcoal {DARK}", font=font(18), fill=MID_GREY)
grey_draw.text((885, 90), f"Lighter grey {SOFTER_DARK}", font=font(18), fill=MID_GREY)
for index, spec in enumerate(wordmarks):
    y = 135 + index * 175
    grey_draw.text((55, y + 58), f"{spec[0]}  {spec[1]}", font=font(18, True), fill=CHARCOAL)
    current = precise_wordmark(560, 135, DARK, spec, compact=True)
    softer = precise_wordmark(560, 135, SOFTER_DARK, spec, compact=True)
    grey_sheet.paste(current, (300, y), current)
    grey_sheet.paste(softer, (885, y), softer)
    softer.save(OUT / f"mark-log-{spec[0].lower()}-lighter-grey.png")
grey_sheet.save(OUT / "mark-log-grey-backgrounds-contact-sheet.png")

# Center the complete symbol + lettering, including the descender, in a pill.
MIDDLE_DARK = "#333B41"
capsule_sheet = Image.new("RGB", (1560, 1260), "#F2F5F6")
capsule_draw = ImageDraw.Draw(capsule_sheet)
capsule_draw.text((55, 35), "LEAF SYMBOL + LOG — CAPSULES", font=font(32, True), fill=CHARCOAL)
capsule_draw.text((300, 90), f"Current charcoal {DARK}", font=font(18), fill=MID_GREY)
capsule_draw.text((710, 90), f"Middle grey {MIDDLE_DARK}", font=font(18), fill=MID_GREY)
capsule_draw.text((1120, 90), f"Lighter grey {SOFTER_DARK}", font=font(18), fill=MID_GREY)
for index, spec in enumerate(wordmarks):
    y = 135 + index * 175
    capsule_draw.text((55, y + 58), f"{spec[0]}  {spec[1]}", font=font(18, True), fill=CHARCOAL)
    artwork = precise_wordmark(560, 135, (0, 0, 0, 0), spec, compact=True)
    artwork = artwork.crop(artwork.getbbox())
    for x, background, slug in [(300, DARK, "dark"), (710, MIDDLE_DARK, "middle-grey"), (1120, SOFTER_DARK, "lighter-grey")]:
        capsule = Image.new("RGBA", (360, 135), (0, 0, 0, 0))
        ImageDraw.Draw(capsule).rounded_rectangle((0, 0, 359, 134), radius=67.5, fill=background)
        capsule.alpha_composite(artwork, ((360 - artwork.width) // 2, (135 - artwork.height) // 2))
        capsule.save(OUT / f"mark-log-capsule-{spec[0].lower()}-{slug}.png")
        capsule_sheet.paste(capsule, (x, y), capsule)
capsule_sheet.save(OUT / "mark-log-capsules-contact-sheet.png")
