# Design Document

## Overview

The City_View is one `<canvas>` rendered by three.js 0.170.0, mounted behind the DOM panels of the game-ui spec. It subscribes to the Game_Controller like every other UI part and reads `GameView.map` (indicator, quarter, per-district central value, class index, Ghost count, Price_Index, selected flag) plus the City_Static_View once.

The design follows the Prototype (`prototype/city3d.ts`), which was checked on 2026-11-18 with the real `districts.json` and `history.json`: about 4,800 buildings, 1,500 road tiles, up to 9,000 moving vehicles and pedestrians, all instanced, rendered smoothly on the Developer's laptop.

## Architecture

```
src/game/controller.ts ──GameView.map──────────────┐
                       ──cityStatic()──────────────┤
                                                   ▼
src/ui/city/index.ts  (mountCityView: owns renderer, scene, loop, subscriptions)
   ├── pure (no three import, tested in Node)
   │     projection.ts   lon/lat → world units (1 unit = 100 m), Mercator centred on 121.6 E, 25.0 N
   │     geometry.ts     point-in-ring, bounding boxes, ring area
   │     placement.ts    seeded buildings and trees per district (mulberry32)
   │     street-grid.ts  Street_Grid edges, gridDist, edge lookup
   │     routing.ts      vehicle and pedestrian movement on the grid
   │     collision.ts    Avatar against building and landmark footprints (phase 3)
   │     focus-order.ts  district focus order and wrap
   │     colours.ts      Indicator_Class index → token name
   └── three (rendering only)
         scene.ts        renderer, camera, lights, fog, sky, water
         districts.ts    District_Ground meshes, outlines, labels (CSS2DRenderer)
         buildings.ts    InstancedMesh with window shader
         traffic.ts      car, scooter, pedestrian models and instanced update
         ghosts.ts       Ghost_Figure sprites
         camera.ts       OrbitControls, flights, bounds, keyboard orbit
         picking.ts      raycast to District_Ground, drag threshold
         tokens.ts       reads CSS custom properties into three.Color and numbers
         landmarks/      one file per Landmark model (phase 2)
         walk.ts         Avatar, follow camera, joystick (phase 3)
         metro.ts        stations, lines, station dialog trigger (phase 3)
```

`three/examples/jsm/` modules used: `controls/OrbitControls.js`, `renderers/CSS2DRenderer.js`, `utils/BufferGeometryUtils.js`.

## Data additions in `src/game/`

- `MapDistrictView` gains `ghosts: number | null` (central Scenario, Displayed_Quarter) and `priceIndex: number | null`.
- `GameController.cityStatic(): CityStaticView` with `{ districts: { code, city, name, areaKm2, centroid, rings, population2015 }[] }`, built once from `LoadedData`. `rings` is a list of polygons, each a list of rings in `[lon, lat]`, outer ring first.

These are small additions to modules written by Kiro; they are tested in `tests/game/` next to Kiro's tests.

## Colours and motion

The style test of game-ui Requirement 1.9 forbids colour literals in `src/ui/**/*.ts`. All City_View colours are CSS custom properties in the Token_File under a `--city-*` prefix (sky, fog, water, ground, outline, window warm, window cool, tree, road, car paints, scooter paints, shirt colours, skin, ghost) plus the existing `--color-seq-*`, `--color-div-*` and `--color-nodata-*` class colours. `tokens.ts` reads them with `getComputedStyle(document.documentElement)` into `THREE.Color`. Motion durations come from `--motion-*`; under reduced motion they are 0.

Shader code uses `vec3(...)` constants only for lighting factors, not for colours of meaning; window colours come in as uniforms from tokens.

## Rendering details (from the Prototype)

- **District_Ground**: `ExtrudeGeometry` of the projected rings, depth 2 units, rotated to lie in the XZ plane. Material colour = class colour; emissive = class colour × 0.25. Hover and selection raise `emissiveIntensity`; focus adds a dashed outline (`LineDashedMaterial`); selection adds a thick outline. Four states are distinct in greyscale by width and dash.
- **Buildings**: one `InstancedMesh` of a unit box translated to stand on y = 0. Footprint 2.2–4.6 units, base height `(2 + r^3.5 × 24) × (0.5 + min(density, 40000) / 50000)`. Instance colour = class colour mixed 25 % with neutral × a per-building brightness. Windows: an `onBeforeCompile` patch that lights a hash-selected subset of window cells on side faces and fades them with view distance (120–420 units) to avoid noise.
- **Street_Grid**: spacing 13 units, half width 1.4 units, axis-aligned in world space. An edge exists where its midpoint lies in an Urban_District. Road tiles are one `InstancedMesh` of planes.
- **Traffic**: cars, scooters with riders and pedestrians are merged low-poly geometries with per-vertex attributes `aTint` (takes the instance colour), `aGlow` (head and tail lights) and `aLimb` (walking swing, animated in the vertex shader from `gl_InstanceID` and a time uniform). Counts at `high`: cars min(2500, 0.9 × edges), scooters min(3000, 1.1 × edges), pedestrians min(3500, 1.3 × edges); a quarter of that at `low`.
- **Routing**: a mover sits on an edge from node (i, j) in direction (di, dj) at fraction t. At a node it continues straight with probability 0.6 if possible, otherwise picks another existing edge, and turns back only at a dead end. Right-hand lane offset is perpendicular to the heading.
- **Ghost_Figures**: sprites with a canvas-drawn ghost texture, additive blending, slow bobbing. Count per district = min(12, ghosts).
- **Camera**: `OrbitControls` with damping, polar angle ≤ 0.46 π, distance 30–1400 units; target clamped to the city bounding box. Flights interpolate target and position with a cubic ease over `--motion-slow` (0 under reduced motion).
- **Labels**: `CSS2DRenderer`; labels of districts smaller than 40 km² hide when the camera is farther than 700 units.

## Layout

The Game_Screen root gets two layers: `.city-layer` (the canvas, `position: fixed; inset: 0`) and `.ui-layer` (panels). The game-ui components are placed in overlay containers:

- ≥ 1024 px: Turn_Bar top centre; District_Panel right; Policy_Panel left; legend and Illustration_Note bottom left; Timeline_View as a collapsible drawer.
- < 1024 px: Turn_Bar fixed bottom; a tab row above it opens District, Policy, Legend or Timeline as a bottom sheet (closed, half, full).

The exact positions are part of the City_Design_Proposal (Requirement 1.1).

## Fallback and lifecycle

`mountCityView` tries `WebGLRenderer`; on failure it renders the fallback text in the City layer and returns a no-op handle. The render loop is `renderer.setAnimationLoop`, paused on `visibilitychange` hidden. `dispose()` disposes geometries, materials, textures, the renderer and the listeners.

## Testing

- Pure modules: unit and fast-check property tests in `tests/ui/city/` (placement determinism and containment, grid membership, routing stays on grid, collision never inside a footprint, focus order covers 41 districts once per pass, colour mapping covers every class and "no value").
- Boundary test: extend the existing static test so that `three` imports outside `src/ui/city/` fail.
- No WebGL in tests. Visual checks by hand (Requirement 13.5), using the Playwright screenshots the Developer already uses for the Prototype.

## Phases and dependencies

| Phase | Depends on |
|---|---|
| 1 City_View in the game | game-ui tasks 13 (Token_File), 14 (UI strings), 16 components, 17 wiring; City_Design_Proposal approval |
| 2 Landmarks | Phase 1 |
| 3 Walk_Mode and Metro_Travel | Phase 1; Station_File from the data pipeline |
| 4 Citizen encounters, street detail | Phase 3; story-layer narrative module |

Until the game-ui components exist, phase 1 work that does not need them (pure modules, controller additions, rendering modules) proceeds against the Prototype harness.
