# Blender sources

Run with Blender 5 in the background (no window needed):

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P make_anims.py
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P build_island.py -- preview

- `make_anims.py` builds the wizard's custom clips on the Synty animation rig with IK (staff idle, staff walk, staff cast, channel) and exports FBX. Pack with `python3 -I build.py anims`.
- `build_island.py` sculpts the Sanctuary island (terrain, cliffs, underside, pond, islets), dresses it with Fantasy Kingdom props, exports `sanctuary_island.fbx`, and with `preview` renders camera shots to check composition.

Both scripts read the Synty packs from `~/Desktop/Assets` and write to `~/Desktop/Assets/_tomecraft_blender/out`.
