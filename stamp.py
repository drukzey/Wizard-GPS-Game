"""Cache-busting for GitHub Pages: stamp every local module/data URL with ?v=<version>.
Run before each deploy: python3 -I stamp.py <version>"""
import re, sys, pathlib
v = sys.argv[1]
root = pathlib.Path(__file__).parent
pat = re.compile(r"""(['"`])(\./[\w./-]+?\.(?:js|json)|(?:game|data/config)\.(?:js|json)|(?:ui|assets)/\$\{[^}]+\}\.png|ui/\w+\.png|data/config\.json)(\?v=[\w.-]+)?\1""")
for f in ['index.html', 'game.js', 'anim.js', 'sim.js', 'collection.js', 'world.js', 'map.js', 'progression.js']:
    p = root / f; s = p.read_text()
    s2 = pat.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(1)}", s)
    p.write_text(s2)
    print(f, len(pat.findall(s)))
