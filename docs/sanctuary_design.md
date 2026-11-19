# Sanctuary island: design guideline

The Sanctuary is the wizard's home: a fragment of an old hillside torn into the dusk sky and settled by one wizard. Every piece on it is there for a reason a visitor could guess. `blender/build_island.py` follows these rules; change the rules here first, then the script.

## Reading order (camera looks from the south)
1. **Arrival (front, south).** A flat stone landing at the cliff edge where the wizard arrives, two lanterns, and a dirt path that climbs gently to the plot. The foreground stays low (bushes, flowers, no trees) so the camera sees in.
2. **The clearing (centre).** The 24 × 24 m build plot is flat and kept clear: only the four facilities and the player's decorations stand here. Worn dirt paths leave the clearing through the middle of each side.
3. **The ridge (back, north).** The ground rises 4–6 m into a ridge. A dense band of pines frames the skyline. On the crest stands the **Ley Hearth**: a ring of standing stones around a brazier, reached by the north path. It is the one landmark; nothing else competes with it for height.
4. **The spring (east).** A pond in a hollow with reeds, lilies and bank stones. It overflows down a stream to the east edge, where it falls off the island as a waterfall.
5. **The garden (west).** The gentler side: a gazebo with flower beds, ornamental round trees, a bench and a well, linked to the clearing by the west path.

## Terrain
- One sculpted surface with three blended ground textures from Fantasy Kingdom: grass (two tones mixed by noise), dirt on paths and worn ground, rock on slopes steeper than about 35°.
- The island edge is one continuous cliff: the top surface, the cliff wall and the underside share the same rim, so there are no gaps or see-through seams. The cliff is layered strata that taper to a rocky point below, darkening and turning violet with depth.
- Height changes are gentle in the playable area and steep only at the rim and the ridge's back.

## Placement rules
- Every prop has a footprint radius. Nothing overlaps another footprint, a path, the pond or the plot.
- Trees grow in groups of 3–7 with one large tree and smaller ones around it, never in rows and never as single trees in open ground. Dense at the edges (to frame), sparse in the middle (to read).
- Small props only where they make sense: lanterns at path junctions and the arrival, reeds and lilies only at water, flowers around the gazebo and path edges, boulders where slopes break.
- Scale: props use their natural Synty size (about 0.8× to sit with the 7 m facility buildings). No single prop larger than the facilities except the ridge pines.

## Palette and light
Dusk: warm lantern and brazier light against a cool violet sky and mist. Greens are muted, not saturated. The only glow sources are the brazier, lanterns and the waterfall's spray.

## What not to do
- No props scattered evenly or at random.
- No floating, clipping or half-buried buildings.
- No sparkles or particles without a source.
- No oversized landmarks (the old observatory dome was removed for this reason).
