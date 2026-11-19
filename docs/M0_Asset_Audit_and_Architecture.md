# Tomecraft: M0 Asset Audit and Architecture

**Status:** M0 complete (draft for owner review). **Date:** 2026-11-19
**Source of truth:** Wizard World Official GDD v1.0

## 1. What's in the asset folder

Source: `~/Desktop/Assets` (Synty SourceFiles: FBX models and PNG/TGA textures). About 4,000 FBX files across 14 packs.

| Pack | What it gives the game |
|---|---|
| POLYGON Fantasy Rivals | **Main familiar and boss source.** 20 rigged creature or hero models: Spirit Demon, Red Demon, Evil God, Mystic, Medusa (+ snakes), Forest Guardian, Forest Witch, Elemental / Fort / Mechanical Golem, Troll, Big Ork, Barbarian Giant, Mutant, Pig Butcher, Slayer, Dark Elf, Dwarf, Ancient Queen, Ancient Warrior. Each has a matching weapon mesh. Small 4-variant texture atlases. |
| POLYGON Dark Fantasy | Gargoyle, Demon (big), Dark Lord, Witch, Hunter, Plague Doctor, 5 skeleton variants. Gothic buildings, props, FX meshes. |
| POLYGON Dungeon Realms | Demon (with separate wings), skeletons, Undead Knight, dwarves, nomads. About 1,100 dungeon, ruin, lava and hell pieces. **Arena and rift material.** |
| POLYGON Fantasy Kingdom | **Player wizard candidates:** Mage (+ cape), Fortune Teller, Hermit, Monk. Also Fairy (+ wings), about 650 town and castle pieces. **Sanctuary building material.** |
| POLYGON Fantasy Characters | Wizard, Sorcerer, Witch, Druid (older models). |
| POLYGON Elven Realm | Elven characters, buildings, props, weapons. |
| POLYGON Modular Fantasy Hero | Modular hero parts (for character customisation later). |
| POLYGON Pirate Realm | Small unrigged pets: **Parrot, Rat, Squid**. Also docks, ships, treasure. |
| POLYGON Goblin War Camp | Goblin characters (combined FBX), camp pieces. |
| POLYGON Viking Realm + Generic (`SourceFiles`) | Nature, rune stones, 25 symbol meshes, shields, weapons, a bow. |
| POLYGON Nature Biomes: Alpine Mountain | Terrain, trees, rocks. |
| POLYGON Particle FX (`Source Files`) | FX meshes and textures for spells. |
| INTERFACE Dark Fantasy Menus + `Source_Sprites` | Menu frames, icons, fonts, cursors, and 3D chest, coin, gem, key and rune pickups. **UI kit.** |

### Constraints found
1. **Animations (updated 2026-11-19):** Synty animation packs were added: `Anim1` Sword Combat, `Anim2` Idles, `Anim3` Base Locomotion. They target the newer Synty rig (Hips, UpperLeg_L, Shoulder_L...), while all character models use the older rig (Pelvis, Thigh_L, UpperArm_L...). The game retargets at runtime (`anim.js`): bone map, rest-direction correction, and the animation file's own skeleton as the source. Verified in browser: wizard and troll idle, walk and run upright. In use: idle, run F/B/L/R blend, walk, dodge rolls F/B/L/R, cast (sword light attack), heavy attack (troll), stab (dark elf cast), hit react, death.
   *Original finding:* **No usable animations.** The character FBX files hold rigs and a bind pose but no walk, attack or cast clips. Synty sells animations separately. **Fallback (GDD §18 step 3):** procedural motion (bob, lean, hover, squash on hit, spin on dodge) driven by code. Characters will look stiff until an animation pack is added. *Owner decision: buy a Synty animation pack or accept procedural motion for MVP.*
2. **Several "characters" are combined FBX files** (e.g. Goblin `Characters.fbx`, Elven `Characters.fbx`). They need splitting before use. Rivals, Kingdom and Dark Fantasy have individual files, so those are used first.
3. **Licensing:** Synty assets may be used in a game but the raw files may not be redistributed. The prototype stays private. Check the Synty EULA before any public release.

## 2. Familiar catalog (MVP, provisional)

The GDD asks for 6 to 12 familiars from real assets with every type represented. These 9 are proposed, 3 per type. All names are working titles taken from the model files. Rarity is provisional and set by the content registry.

| ID | Model file | Type | Base ability (mechanic) | Provisional rarity |
|---|---|---|---|---|
| fam_spirit_demon | Rivals `SK_Character_SpiritDemon` | Arcane | Arcane Bolt: fast aimed projectile | Common |
| fam_mystic | Rivals `SK_Character_Mystic_01` | Arcane | Charged Blast: hold to charge, release a bigger slower bolt | Uncommon |
| fam_fairy | Kingdom `SK_Chr_Fairy_01` + wings | Arcane | Spark Fan: 3 aimed bolts in a narrow cone | Rare |
| fam_fort_golem | Rivals `SK_BR_Character_FortGolem_01` | Runic | Rune Shield: barrier that absorbs damage for a few seconds | Common |
| fam_elemental_golem | Rivals `SK_BR_Character_ElementalGolem_01` | Runic | Retaliation Circle: placed ring that damages enemies inside | Uncommon |
| fam_gargoyle | Dark Fantasy `SM_Chr_Gargoyle_01` | Runic | Stone Skin: damage reduction, slower movement | Epic |
| fam_medusa | Rivals `SK_Character_Medusa_01` + snakes | Ancient | Serpent Dash: aimed dash that damages along its path | Common |
| fam_parrot | Pirate `SM_Prop_Pet_Parrot_01` (unrigged) | Ancient | Gust: aimed knockback cone | Uncommon |
| fam_squid | Pirate `SM_Prop_Pet_Squid_01` (unrigged) | Ancient | Ink Pool: placed zone that slows | Rare |

**Reserved for later familiars or bosses:** Red Demon, Evil God, Forest Guardian, Mechanical Golem, Forest Witch, Dungeon Demon (with wings), Big Demon, Rat.

**PvE enemy archetypes (GDD §9), same rule, existing models only:**
- Melee pursuer: Troll, Big Ork, Barbarian Giant
- Ranged caster: Dark Elf, Witch, Skeleton Ranger
- Zone controller: Mechanical Golem (used)
- Defensive guardian: Ancient Warrior (used), Undead Knight, Skeleton Heavy Armor

**Player wizard:** Kingdom `SK_Chr_Mage_01` (+ cape). Alternatives: Fantasy Characters Wizard or Sorcerer.

## 3. Engine and platform decision

**Chosen: Three.js (JavaScript, WebGL) as a mobile-first web game.**
- Loads Synty FBX and textures directly (FBXLoader), with no engine licence and nothing to install.
- One codebase runs on iOS and Android browsers. It can be wrapped as an app later (Capacitor) if store release is wanted.
- Combat rules live in a **pure JavaScript simulation module** with no rendering. The same module runs in the browser now and on a Node.js server later, which is how GDD §8 "server-authoritative" will be met. In M1 it runs in an automated Node test harness.

**Where it runs:**
- **M1 to M5** (combat, collection, progression, PvE, sanctuary) can be tested as a private Claude artifact page.
- **M6 GPS overworld cannot run inside a Claude artifact.** The artifact frame blocks device location and outside map tiles. GPS testing needs the same game hosted on a normal https site (e.g. GitHub Pages or Netlify, free) with a map provider such as OpenStreetMap tiles via MapLibre. *Owner decision before M6: hosting choice.*
- **M7 and M8 PvP** need a real game server (e.g. Node + WebSocket on a small cloud host). *Owner decision before M7.*

## 4. Data schemas (implemented as JSON config)

All balance numbers live in `data/config.json`, never in code. Records follow GDD §17:

```text
FamiliarDefinition { familiarId, modelAssetId, type, rarity, baseAbilityId, passiveId?, modifierIds[] }
AbilityDefinition  { abilityId, castMode: "aimed"|"self"|"placed"|"charge", cooldown, manaCost, staminaCost,
                     damage?, speed?, range?, radius?, duration?, shield?, dashDistance?, slowPct?, telegraph, counterplayNotes }
WeaponDefinition   { weaponId, fireMode: "hold"|"tap"|"charge", damage, speed, range, fireInterval }
EnemyDefinition    { enemyId, modelAssetId, archetype, health, speed, damage, attackRange, attackCooldown, telegraph }
Loadout            { weaponId, familiarIds[3] }
```

Collection, inventory, economy and settlement records (OwnedFamiliar, Encounter, RewardTransaction, Settlement) are defined in the GDD and will be implemented in M2, M3 and M5.

## 5. Milestone status

| Milestone | Status |
|---|---|
| M0 Repository and asset audit | **Done** (this document) |
| M1 Combat vertical slice | **Playable**: combat sim + 14 automated tests passing, Synty animations, Dark Fantasy HUD (orbs, ring ability frames, stamina bar, framed familiar cards, sigil ground FX). Remaining: on-device touch feel test, server harness |
| M2 Collection | **Playable**: Explore tab with timed sightings and battle-wave discoveries, rarity shown before binding, timing-based binding challenge (two stages for Rare+), outcome rolled by `collection.js` with disclosed chance bounds (15% at zero skill up to the rarity's top), rarity reveal (chime from Rare, particles from Epic, banner style from Legendary; reduced-motion respected), first capture unlocks the ability, duplicates add Ascension credits, Journal with all 8 rarity tiers and their odds, saved in the browser. 11 collection tests passing (25 total). All 9 familiars now use real models (Fairy with wings, Gargoyle on the new rig, Parrot and Squid static). Remaining: server-side rolls and accounts (needs hosting) |
| M3 Progression | **Playable**: `progression.js` + config `progression`/`modifiers`. Wizard XP and levels (cap 50), Gold and Arcane Essence; rewards per run (kills, waves cleared, capped) and per binding; every grant has a transaction id so it applies once (no lost or doubled rewards). Mastery 1 to 10 from real contribution only: the sim credits each slot's damage dealt, damage blocked (shield, stoneskin) and hits; casting into empty space earns nothing. Two sidegrade modifiers per ability unlock at Mastery 3, free to swap or remove. Ascension spends duplicate credits (1, 2, 3, 5, 8), Arcane Essence covers a shortfall (40 per credit), bounded at +12.5% power at max rank. Results screen (End run or defeat) with rewards, level-ups, per-familiar Mastery and a next goal. Familiar detail screen from the Journal. Three saved loadouts. 15 new tests (48 total). Verified on the live site. Remaining: server-side settlement |
| M4 PvE | **Playable**: two new enemy archetypes and a boss, all Fantasy Rivals models. **Zone controller** (Mechanical Golem) marks where you stand, then fills it with a damaging pool. **Defensive guardian** (Ancient Warrior) blocks 80% of hits arriving at its front, turns slowly, and drops its guard while swinging, so flanks, zones and timing beat it. **Evil God boss**: three phases at 60% and 25% health, with slam, 5-lane volley, nova ring and ground pools, plus summons; every attack is telegraphed and resolves exactly as shown. **Rifts**: Wild Skirmish, Shallow Rift, Twisting Rift (level 3, Haste + Lingering) and Godfall Rift (level 5, Frenzy, boss), each with fixed waves, named modifiers that change tactics rather than enemy health, and a clear bonus paid through the M3 reward ledger. Training waves now use the new enemies too. 11 PvE tests (59 total), including one answer per familiar type to the new enemies. Verified on the live site. The Undead Knight from the audit was swapped for the Ancient Warrior to reuse the Rivals texture. Remaining: human playtests of the "all three types contribute" bar, rift markers on the world map |
| M5 Sanctuary | **Playable**: `sanctuary.js` + config `gear`, `materials`, `sanctuary`, `research`. Private plot (12×12 tiles) with four facilities built from Fantasy Kingdom preset buildings that grow when upgraded (Hut → House, House 08 → House 05, forge workbench → Blacksmith, cottage → Tower): Dwelling (decoration room), Familiar Chamber (Ascension, modifiers, more saved teams), Arcane Forge (craft and upgrade gear; tier cap by level), Research Library (projects tied to real play that unlock gear designs). Gear in five slots with a trade-off on every piece, bonuses capped at 20% per stat, deterministic upgrades that never fail or destroy, tiers Apprentice → Relic; two new weapon patterns (Scatter Staff fan, Seer's Staff). Materials (Ore, Arcane Stone, Rune Fragments) from waves, rifts and bindings through the once-only ledger. Decorations bought with Gold and placed on the grid with rotation, move, put-away and collision checks. Everything saved in the browser and rebuilt on re-entry. 12 Sanctuary tests (71 total). **Interface overhaul**: camp screen with a live 3D stage (your wizard holding the equipped Kingdom staff, your three familiars beside them) behind a framed sheet, five-place dock (Map, Play, Wizard, Sanctuary, Journal), Dark Fantasy Menus frames and icons, Grenze + Alegreya Sans type, side panel on wide screens and bottom sheet on phones. Creatures in binding hold a wary stance (Synty Idles pack) and the reveal an easy idle; parrot, squid and fairy hover. Verified on the live site at desktop and phone sizes. Remaining: armour pieces are stats only (no visible robe or boot models yet), Alchemy/Garden/Trophy Hall facilities, server-side saves |
| M6 GPS alpha (done early at owner request) | **Live**: MapLibre + OpenFreeMap (free, no key) with a dark fantasy recolour, phone GPS, deterministic familiar spawns per ~120 m map cell and 20-minute window (same for everyone, no server), 40 m reach with capped GPS-accuracy allowance, speed gate above 7 m/s, no spawns on water or main roads, safety screen, demo mode (tap to walk), location never leaves the device. 8 world tests (33 total). Verified on the live site in demo mode: map, markers, range message, walk, bind, return. Remaining: real-device walking test, rural/urban density tuning, server-side spawns and anti-spoofing |
| M7 to M9 | Pending |

## 6. Open owner decisions
1. ~~Animation~~ **Resolved:** Synty animation packs added and retargeted.
2. ~~Name~~ **Decided:** Tomecraft (open to change).
3. ~~Hosting for the GPS alpha~~ **Done:** GitHub Pages from the public repo `drukzey/Wizard-GPS-Game` → https://drukzey.github.io/Wizard-GPS-Game/ . Raw Synty FBX files are excluded (`.gitignore`); only packed builds are published. Owner to confirm the Synty licence allows a public repo.
4. Game server for PvP (M7) and server-side spawns/accounts: still open.

## 7. Build notes
- Source of truth: GitHub repo `drukzey/Wizard-GPS-Game` (index.html, game.js, anim.js, sim.js, collection.js, world.js, map.js, data/config.json). Deploy: `python3 -I stamp.py <version>` (cache-busting), commit, push; Pages serves the repo root. Tests: `node --test *.test.mjs`. `python3 -I build.py m5` packs the Sanctuary models (one file each in `pub/sanct/`), staffs (`pub/gear.js`), idle clips and menu sprites. `python3 -I build.py m4` packs only the M4 enemy models into `pub/models_m4.js`. `python3 -I build.py` packs FBX as gzip+base64 JS (the artifact host does not serve .fbx) and resizes HUD sprites into `ui/`.
- HUD sprites come from `Source_Sprites` (Synty INTERFACE Dark Fantasy HUD): Frame_Orb_01, Ring_Small_01, Frame_Bar_01, Frame_Box_Medium_01, Sigil rings, Reticle arc, stat/status/element icons.
- Debug: open the game with `#debug` for an animation readout; Z = close camera, P = freeze.
