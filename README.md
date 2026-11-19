# Tomecraft (prototype)

Wizard exploration game prototype: GPS world map, familiar collecting, isometric combat.
Built with Three.js and MapLibre (map data © OpenStreetMap contributors, tiles by OpenFreeMap).

Art, models and animations are Synty Studios assets, licensed to the project owner and packed into the game build.
They are not licensed for reuse from this repository.

## Development
- Run tests: `node --test sim.test.mjs collection.test.mjs world.test.mjs`
- Rebuild packed assets: `python3 -I build.py` (needs the Synty source files locally; not in this repo)
- Design status and asset audit: `docs/M0_Asset_Audit_and_Architecture.md`
- Deploy: bump the version, `python3 -I stamp.py <n>`, commit and push (GitHub Pages serves the repo root).
