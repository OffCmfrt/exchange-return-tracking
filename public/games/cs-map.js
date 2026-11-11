/* ============================================================================
   Counter Strike — Shared map layout + collision math
   ----------------------------------------------------------------------------
   ONE source of truth for arena geometry, loaded twice:
     • browser  : counter-strike/script.js installs these colliders as its physics
                  (the visual builders still draw the meshes themselves)
     • node     : cs-sim.js (hub) uses the same colliders for bot navigation, LOS
                  and bullet validation, through RaceHub.js

   Why this file exists: the hub used to carry a hand-copied collider list. It
   drifted from the client within a few map edits, so in co-op bots hid behind
   walls that are open ground on screen and bullets stopped at geometry the bot
   could walk through. Both sides now read the same table, so drift is impossible.

   Everything here is pure arithmetic — no THREE, no DOM, no wall clock — so it
   runs unchanged inside the Node process.
   ============================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const WALL_T = 0.6;          // exterior wall thickness
  const STEP = 0.4;            // anything shorter than this is walkable, not a wall
  const EYE = 1.65;            // standing sight height, used for line of sight

  // ── Primitive builders (mirrors script.js addBox/addCylinder exactly) ──
  const makeSink = (out) => (x, z, w, d, h, y = 0) => {
    out.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y, maxY: y + h });
    return [x, z, w, d, h, y];
  };
  // Cylinders are approximated by their bounding square, same as the client does.
  const cyl = (out) => (x, z, radius, h, y = 0) => {
    out.push({ minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius, minY: y, maxY: y + h });
  };

  // A wall run with a centred full-height DOORWAY.
  function doorWall(box, cx, cz, len, axis, baseY, h, gapW) {
    const side = (len - gapW) / 2;
    if (axis === 'x') {
      box(cx - (gapW / 2 + side / 2), cz, side, WALL_T, h, baseY);
      box(cx + (gapW / 2 + side / 2), cz, side, WALL_T, h, baseY);
      box(cx, cz, gapW, WALL_T, 0.9, baseY + h - 0.9);          // lintel over the opening
    } else {
      box(cx, cz - (gapW / 2 + side / 2), WALL_T, side, h, baseY);
      box(cx, cz + (gapW / 2 + side / 2), WALL_T, side, h, baseY);
      box(cx, cz, WALL_T, gapW, 0.9, baseY + h - 0.9);
    }
  }

  // A wall run with a centred WINDOW (sill below, header above, clear view through the opening).
  function winWall(box, cx, cz, len, axis, baseY, h, winW, sillH, headH) {
    const side = (len - winW) / 2;
    if (axis === 'x') {
      box(cx - (winW / 2 + side / 2), cz, side, WALL_T, h, baseY);
      box(cx + (winW / 2 + side / 2), cz, side, WALL_T, h, baseY);
      box(cx, cz, winW, WALL_T, sillH, baseY);
      box(cx, cz, winW, WALL_T, headH, baseY + h - headH);
    } else {
      box(cx, cz - (winW / 2 + side / 2), WALL_T, side, h, baseY);
      box(cx, cz + (winW / 2 + side / 2), WALL_T, side, h, baseY);
      box(cx, cz, WALL_T, winW, sillH, baseY);
      box(cx, cz, WALL_T, winW, headH, baseY + h - headH);
    }
  }

  // Climbable staircase: stacked steps each growing to full height, so groundHeight() can land on
  // any tread and the whole run is walkable from below.
  function stairs(box, x, z, totalH, steps, width, dir) {
    const stepH = totalH / steps, stepD = 0.55;
    for (let i = 0; i < steps; i++) {
      const y = (i + 1) * stepH, off = i * stepD;
      if (dir === 'N') box(x, z - off, width, stepD, y);
      else if (dir === 'S') box(x, z + off, width, stepD, y);
      else if (dir === 'E') box(x + off, z, stepD, width, y);
      else box(x - off, z, stepD, width, y);
    }
  }

  const container = (box, x, z, len, axis, y = 0) =>
    box(x, z, axis === 'x' ? len : 2.4, axis === 'x' ? 2.4 : len, 2.6, y);
  const crate = (box, x, z, s = 1.2, y = 0) => box(x, z, s, s, s, y);
  const platform = (box, x, z, w, d, y) => box(x, z, w, d, 0.3, y);
  const pavement = (box, x, z, w, d) => box(x, z, w, d, 0.18);

  // ── Mission-02 eastern structures (mirrored visually by buildIndustrialMap in script.js) ──
  // Corrugated weapons warehouse: 16x12, 5 m clear height, big west roll-up door, ground slab so
  // the interior floor is solid, east stair shaft to a roof, interior crates left clear of the
  // door corridor and of the three demolition-charge spots.
  function warehouseBuilding(box, bx, bz, w, d, h) {
    const hw = w / 2, hd = d / 2;
    platform(box, bx, bz, w, d, 0);                              // floor slab (0.3)
    winWall(box, bx, bz - hd, w, 'x', 0.3, h, 2.4, 1.6, 1.2);    // north (glazed, matches drawn map)
    winWall(box, bx, bz + hd, w, 'x', 0.3, h, 2.4, 1.6, 1.2);    // south
    box(bx + hw, bz, WALL_T, d, h, 0.3);                         // east wall
    doorWall(box, bx - hw, bz, d, 'z', 0.3, h, 5.0);             // west: roll-up cargo door
    doorWall(box, bx, bz - hd + 3.2, 6, 'x', 0.3, 3.2, 2.4);     // interior partition (N bay)
    crate(box, bx - hw + 2.5, bz - hd + 2.5, 2.0, 0.3);
    crate(box, bx - hw + 2.5, bz - hd + 2.5, 1.4, 2.3);
    crate(box, bx - hw + 5.0, bz + hd - 2.5, 2.2, 0.3);
    crate(box, bx + hw - 2.4, bz + hd - 2.6, 2.0, 0.3);
    crate(box, bx + hw - 2.4, bz + hd - 4.6, 1.6, 0.3);
    box(bx + hw - 1.6, bz - 1.0, 1.4, 4.0, 2.4, 0.3);            // shelving run (east)
    box(bx - 2.5, bz + 1.5, 2.6, 1.1, 0.9, 0.3);                 // archive filing table
    const shaft = 3.4, slabEast = bx + hw - shaft;
    const slabW = slabEast - (bx - hw);
    box(bx - hw + slabW / 2, bz, slabW, d - WALL_T, 0.3, h);     // roof slab
    stairs(box, slabEast + shaft / 2, bz + hd - 1.2, h + 0.3, 13, 2.8, 'N');
    box(bx, bz - hd - 0.2, w + 0.6, 0.3, 0.7, h + 0.3);          // roof parapets (escape deck edge)
    box(bx, bz + hd + 0.2, w + 0.6, 0.3, 0.7, h + 0.3);
  }

  // Workers' greenhouse: concrete kerb + corner posts + rails. The GLASS infill is drawn by the
  // client but carries NO collider here — one collider per pane would add dozens of eye-height
  // blockers around the plant beds and gridlock bot pathing through the marsh.
  function greenhouseBuilding(box, bx, bz, w, d) {
    const hw = w / 2, hd = d / 2, h = 3.2;
    pavement(box, bx, bz, w, d);                                 // low kerb/slab, walkable
    box(bx - hw, bz - hd, 0.35, 0.35, h); box(bx + hw, bz - hd, 0.35, 0.35, h);
    box(bx - hw, bz + hd, 0.35, 0.35, h); box(bx + hw, bz + hd, 0.35, 0.35, h);
    box(bx, bz - hd, w, 0.2, 0.3, 0.2); box(bx, bz + hd, w, 0.2, 0.3, 0.2);   // base rails
    box(bx - hw, bz, 0.2, d, 0.3, 0.2); box(bx + hw, bz, 0.2, d, 0.3, 0.2);
    box(bx, bz - hd, w, 0.2, 0.3, h - 0.5); box(bx, bz + hd, w, 0.2, 0.3, h - 0.5); // top rails
    box(bx - hw, bz, 0.2, d, 0.3, h - 0.5); box(bx + hw, bz, 0.2, d, 0.3, h - 0.5);
    box(bx, bz + 0.4, w - 1.2, 1.4, 1.0, 0.4); box(bx, bz, w, 0.3, 1.7, h - 0.3);  // ridge
    doorWall(box, bx - hw, bz, 4, 'z', 0, h, 2.4);               // west door
    crate(box, bx + 1.5, bz - 1.8, 1.6, 0.6);                    // potting bench
    crate(box, bx - 1.0, bz + 2.0, 1.4, 0.6);                    // planter bed (bud sits on this)
  }

  // Eastern maintenance room: single-storey supply shed, west door, one interior partition.
  function maintenanceRoom(box, bx, bz, w, d) {
    const hw = w / 2, hd = d / 2, h = 3.2;
    pavement(box, bx, bz, w, d);
    box(bx, bz - hd, w, WALL_T, h, 0.2);
    box(bx, bz + hd, w, WALL_T, h, 0.2);
    box(bx + hw, bz, WALL_T, d, h, 0.2);
    doorWall(box, bx - hw, bz, d, 'z', 0.2, h, 2.6);
    box(bx + 2, bz - 1.2, WALL_T, 4.2, h, 0.2);                  // interior partition
    crate(box, bx + hw - 1.4, bz - 1.6, 1.2, 0.2);               // locker bank
    crate(box, bx + hw - 1.4, bz + 1.6, 1.2, 0.2);
    box(bx, bz + hd + 0.4, w + 1.2, 2.4, 0.3, h);                // awning
    box(bx - 2.2, bz + hd + 2.2, 1.6, 1.1, 0.9, 0);              // standby generator (solid)
  }

  // Administrative wing: two walkable floors like a duplex, but with a locked office on the upper
  // level reached through a doorway in the east partition — Kessler's holding room.
  function adminWingBuilding(box, bx, bz, w, d) {
    const gfH = 3.5, slabT = 0.3, ufH = 2.8;
    const upY = gfH + slabT, roofY = upY + ufH;
    const hw = w / 2, hd = d / 2;
    winWall(box, bx, bz - hd, w, 'x', 0, gfH, 2.4, 1.1, 1.1);
    doorWall(box, bx, bz + hd, w, 'x', 0, gfH, 2.6);
    box(bx - hw, bz, WALL_T, d, gfH);
    winWall(box, bx + hw, bz, d, 'z', 0, gfH, 2.2, 1.1, 1.1);
    doorWall(box, bx - 2, bz, d - 2, 'z', 0, gfH, 2.2);           // ground partition
    crate(box, bx - hw + 2.2, bz - hd + 2.2, 1.6);
    crate(box, bx - hw + 2.2, bz + hd - 2.2, 1.4);
    box(bx - hw + 1.8, bz + 1.4, 2.4, 1.0, 0.8);                  // reception counter
    const shaft = 3.5, slabEast = bx + hw - shaft;
    const slabW = slabEast - (bx - hw);
    box(bx - hw + slabW / 2, bz, slabW, d - WALL_T, slabT, gfH);
    stairs(box, slabEast + shaft / 2, bz + hd - 0.8, upY, 11, 3.0, 'N');
    winWall(box, bx, bz - hd, w, 'x', upY, ufH, 2.6, 0.9, 0.9);
    winWall(box, bx, bz + hd, w, 'x', upY, ufH, 2.6, 0.9, 0.9);
    box(bx - hw, bz, WALL_T, d, ufH, upY);
    winWall(box, bx + hw, bz, d, 'z', upY, ufH, 2.2, 0.9, 0.9);
    doorWall(box, bx - 2, bz, d - 2, 'z', upY, ufH, 2.2);         // upper partition (office door)
    crate(box, bx + 3.0, bz - 2.0, 1.8, upY);                     // office desk
    box(bx + 4.5, bz + 2.4, 2.2, 0.9, 0.8, upY);                  // filing cabinet
    box(bx, bz, w + 0.6, d + 0.6, slabT, roofY);
    box(bx, bz - hd - 0.2, w + 0.6, 0.3, 0.7, roofY + slabT);     // roof parapets
    box(bx, bz + hd + 0.2, w + 0.6, 0.3, 0.7, roofY + slabT);
  }

  // NE service complex: single-storey bunker with a back room — the M02 extraction point.
  function serviceComplex(box, bx, bz, w, d) {
    const hw = w / 2, hd = d / 2, h = 3.8;
    pavement(box, bx, bz, w, d);
    box(bx, bz - hd, w, WALL_T, h, 0.2);
    doorWall(box, bx, bz + hd, w, 'x', 0.2, h, 2.8);
    box(bx - hw, bz, WALL_T, d, h, 0.2);
    winWall(box, bx + hw, bz, d, 'z', 0.2, h, 2.4, 1.2, 1.0);     // east (glazed, matches drawn map)
    doorWall(box, bx + 2, bz, d - 3, 'z', 0.2, h, 2.2);           // interior partition
    crate(box, bx - hw + 2.0, bz - hd + 2.0, 1.5, 0.2);
    box(bx, bz, w + 0.6, d + 0.6, 0.3, h);                       // roof
    stairs(box, bx + hw - 1.8, bz + hd + 1.6, h + 0.3, 10, 2.4, 'N');
  }

  function pillars(box, x, z, w, d, h, count = 4) {
    const pts = count === 4
      ? [[-w / 2 + 0.4, -d / 2 + 0.4], [w / 2 - 0.4, -d / 2 + 0.4], [-w / 2 + 0.4, d / 2 - 0.4], [w / 2 - 0.4, d / 2 - 0.4]]
      : [[0, 0]];
    for (const [ox, oz] of pts) box(x + ox, z + oz, 0.5, 0.5, h - 0.3);
  }

  // ── Duplex building: two walkable floors, interior partition, east stair shaft, roof ──
  function duplexBuilding(box, bx, bz, w, d) {
    const gfH = 3.5, slabT = 0.3, ufH = 2.8;
    const midY = gfH, upY = gfH + slabT, roofY = upY + ufH;
    const hw = w / 2, hd = d / 2;

    winWall(box, bx, bz - hd, w, 'x', 0, gfH, 2.4, 1.1, 1.1);      // north
    doorWall(box, bx, bz + hd, w, 'x', 0, gfH, 2.6);                // south (entry)
    winWall(box, bx - hw, bz, d, 'z', 0, gfH, 2.2, 1.1, 1.1);       // west
    box(bx + hw, bz, WALL_T, d, gfH);                               // east (solid)

    doorWall(box, bx - 1, bz, d - 2, 'z', 0, gfH, 2.2);             // interior partition
    crate(box, bx - hw + 2, bz + hd - 2, 1.4);
    crate(box, bx - hw + 2, bz - hd + 2, 1.2);

    const shaft = 3.5;
    const slabEast = bx + hw - shaft;
    const slabW = slabEast - (bx - hw);
    box(bx - hw + slabW / 2, bz, slabW, d - WALL_T, slabT, midY);   // second-floor slab
    stairs(box, slabEast + shaft / 2, bz + hd - 0.8, upY, 11, 3.0, 'N');

    winWall(box, bx, bz - hd, w, 'x', upY, ufH, 2.6, 0.9, 0.9);
    winWall(box, bx, bz + hd, w, 'x', upY, ufH, 2.6, 0.9, 0.9);
    winWall(box, bx - hw, bz, d, 'z', upY, ufH, 2.2, 0.9, 0.9);
    box(bx + hw, bz, WALL_T, d, ufH);
    doorWall(box, bx - 1, bz, d - 2, 'z', upY, ufH, 2.2);

    box(bx, bz, w + 0.6, d + 0.6, slabT, roofY);                    // roof slab
    box(bx, bz - hd - 0.2, w + 0.6, 0.3, 0.7, roofY + slabT);       // parapets
    box(bx, bz + hd + 0.2, w + 0.6, 0.3, 0.7, roofY + slabT);
  }

  // ── Rounded (octagonal) duplex with a cylindrical roof cap ──
  function roundDuplex(box, cyl, bx, bz, w, d) {
    const gfH = 3.5, slabT = 0.3, ufH = 2.8;
    const midY = gfH, upY = gfH + slabT, roofY = upY + ufH;
    const hw = w / 2, hd = d / 2;
    const c = 2, flatX = w - 2 * c, flatZ = d - 2 * c;
    const co = hw - c / 2, czo = hd - c / 2;

    winWall(box, bx, bz - hd, flatX, 'x', 0, gfH, 2.2, 1.1, 1.1);
    doorWall(box, bx, bz + hd, flatX, 'x', 0, gfH, 2.6);
    winWall(box, bx - hw, bz, flatZ, 'z', 0, gfH, 2.2, 1.1, 1.1);
    box(bx + hw, bz, WALL_T, d, gfH);
    box(bx - co, bz - czo, c, c, gfH);                                // NW chamfer
    box(bx - co, bz + czo, c, c, gfH);                                // SW chamfer
    box(bx + co, bz - czo, c, c, gfH);                                // NE chamfer (SE left open)

    doorWall(box, bx - 1, bz, d - 2, 'z', 0, gfH, 2.2);
    crate(box, bx - hw + 2, bz + hd - 2, 1.4);

    const shaft = 3.5;
    const slabEast = bx + hw - shaft;
    const slabW = slabEast - (bx - hw);
    box(bx - hw + slabW / 2, bz, slabW, d - WALL_T, slabT, midY);
    stairs(box, slabEast + shaft / 2, bz + hd - 0.8, upY, 11, 3.0, 'N');

    winWall(box, bx, bz - hd, flatX, 'x', upY, ufH, 2.4, 0.9, 0.9);
    winWall(box, bx, bz + hd, flatX, 'x', upY, ufH, 2.4, 0.9, 0.9);
    winWall(box, bx - hw, bz, flatZ, 'z', upY, ufH, 2.2, 0.9, 0.9);
    box(bx + hw, bz, WALL_T, d, ufH);
    box(bx - co, bz - czo, c, c, ufH, upY);
    box(bx - co, bz + czo, c, c, ufH, upY);
    box(bx + co, bz - czo, c, c, ufH, upY);
    doorWall(box, bx - 1, bz, d - 2, 'z', upY, ufH, 2.2);

    const rr = Math.max(hw, hd) + 0.3;
    cyl(bx, bz, rr, slabT, roofY);
    cyl(bx, bz, rr, 0.6, roofY + slabT);
    cyl(bx, bz, 0.5, 1.6, roofY + slabT + 0.6);
  }

  // ── Round lookout tower: shaft, walkable deck at h, lamp room, railings, external stair ──
  function roundTower(box, cyl, x, z, radius, h) {
    cyl(x, z, radius - 1.1, h);
    cyl(x, z, radius, 0.35, h);
    cyl(x, z, radius * 0.55, 1.6, h + 0.35);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      box(x + Math.cos(a) * (radius - 0.2), z + Math.sin(a) * (radius - 0.2), 0.2, 0.2, 1, h + 0.35);
    }
    const steps = Math.round(h / 0.35);
    stairs(box, x, z + radius + (steps - 1) * 0.55, h + 0.35, steps, 2.4, 'N');
  }

  // ── Vehicle: truck (climbable 2.6 m bed + cab + step block) or car (jumpable 1.1 m roof) ──
  function vehicle(box, x, z, axis, type) {
    if (type === 'truck') {
      const L = axis === 'x' ? [5, 2.4] : [2.4, 5];
      const C = axis === 'x' ? [2.2, 2.4] : [2.4, 2.2];
      const off = axis === 'x' ? [3.6, 0] : [0, 3.6];
      box(x, z, L[0], L[1], 2.6);
      box(x + off[0], z + off[1], C[0], C[1], 2.2);
      box(x - (axis === 'x' ? 3.2 : 0), z - (axis === 'x' ? 0 : 3.2), 1.2, 1.2, 0.8);
    } else {
      const B = axis === 'x' ? [4, 2] : [2, 4];
      box(x, z, B[0], B[1], 1.1);
      const c = axis === 'x' ? [2, 1.7] : [1.7, 2];
      box(x, z, c[0], c[1], 0.7, 1.1);
    }
  }

  // ══ INDUSTRIAL COMPLEX — 99x99 core ══════════════════════════════════════
  // Six square duplexes + two rounded ones around a central street, industrial filler,
  // pavement avenues, three lookouts and parked vehicles. Order and numbers match
  // buildIndustrialMap() in counter-strike/script.js.
  // The perimeter's east side differs per variant: `industrial` keeps the original wall at
  // x=49.5; `industrial_east` (Mission-02 only) replaces it with the marsh expansion below.
  function buildIndustrialCore(out) {
    const box = makeSink(out), cylinder = cyl(out);
    const HALF = 49.5;
    // West wall only: the N/S walls and the east side belong to the variant, because the marsh
    // arena spans them at a different length/position than the plain 99x99 arena.
    box(-HALF, 0, 1, 99, 8);

    duplexBuilding(box, -33, -33, 12, 9);
    duplexBuilding(box, 33, -33, 12, 9);
    duplexBuilding(box, -16, 3, 11, 8);
    duplexBuilding(box, 16, 3, 11, 8);
    duplexBuilding(box, -33, 29, 12, 9);
    duplexBuilding(box, 33, 29, 12, 9);
    roundDuplex(box, cylinder, -36, 0, 12, 12);
    roundDuplex(box, cylinder, 36, 0, 12, 12);

    cylinder(0, -30, 3.0, 3.4);
    cylinder(0, -22, 2.4, 3.0);
    container(box, 0, 20, 6, 'x');
    stairs(box, 6.5, 20, 2.6, 8, 2.4, 'W');

    cylinder(-45, -12, 2.8, 9); cylinder(-45, 12, 2.6, 8);
    cylinder(45, -12, 2.6, 8); cylinder(45, 12, 2.8, 10);

    container(box, -45, 0, 6, 'z');
    container(box, 45, 0, 6, 'z');
    container(box, -45, 0, 6, 'z', 2.6);                 // double-stack (west)
    stairs(box, -40, -24, 2.6, 8, 2.4, 'W');
    container(box, -45, -24, 6, 'x');

    box(0, -14, 8, 1.2, 2.6);
    box(-24, -14, 1.2, 8, 2.4); box(24, -14, 1.2, 8, 2.4);
    box(-24, 16, 1.2, 8, 2.6); box(24, 16, 1.2, 8, 2.6);
    box(0, 12, 6, 1.2, 2.2);

    // Overhead pipe rack: high enough to walk under, so it must not block anything at eye level.
    box(0, -6, 20, 0.4, 0.4, 4.8);
    box(-9, -6, 0.4, 0.4, 4.8); box(9, -6, 0.4, 0.4, 4.8);

    pillars(box, 0, -40, 3, 3, 3);
    platform(box, 0, -40, 3.4, 3.4, 3);
    stairs(box, 0, -35, 3, 8, 2, 'N');

    cylinder(-20, -30, 0.6, 1.2); cylinder(20, -30, 0.6, 1.2);
    cylinder(-8, 28, 0.6, 1.3); cylinder(8, 28, 0.5, 1.1);

    pavement(box, 0, 0, 8, 70);
    pavement(box, -28, 0, 5, 70); pavement(box, 28, 0, 5, 70);
    pavement(box, 0, -20, 70, 5); pavement(box, 0, 20, 70, 5);
    pavement(box, 0, 0, 16, 16);
    pavement(box, 0, -32, 44, 4); pavement(box, 0, 32, 44, 4);
    pavement(box, -38, 0, 4, 44); pavement(box, 38, 0, 4, 44);
    pavement(box, -14, 0, 3, 40); pavement(box, 14, 0, 3, 40);

    roundTower(box, cylinder, -28, -2, 3.2, 5);
    roundTower(box, cylinder, 28, 2, 3.2, 5);
    roundTower(box, cylinder, 0, -34, 2.8, 4);

    vehicle(box, -28, -18, 'x', 'truck'); vehicle(box, 28, 18, 'x', 'truck');
    vehicle(box, -4, 30, 'z', 'truck');
    vehicle(box, 6, -28, 'z', 'car'); vehicle(box, -14, 12, 'x', 'car');
    vehicle(box, 14, -12, 'x', 'car'); vehicle(box, 30, -30, 'z', 'car');

    crate(box, -8, -18, 1.4); crate(box, 8, -18, 1.4);
    crate(box, -20, 8, 1.5); crate(box, 20, 8, 1.5);
    crate(box, -8, 30, 1.2); crate(box, 8, 30, 1.2);
  }

  // Plain arena: original symmetric 99x99 footprint, east wall back at x=49.5.
  function buildIndustrial(out) {
    buildIndustrialCore(out);
    const box = makeSink(out);
    box(0, -49.5, 99, 1, 8); box(0, 49.5, 99, 1, 8);
    box(49.5, 0, 1, 99, 8);
  }

  // ════════════════════════════════════════════════════════════
  //  MISSION-02 EASTERN MARSHLAND EXPANSION — 128x99 total
  //  x from ~50 to 64: flooded ground (no colliders under water — the marsh stays
  //  walkable so bots never gridlock), raised boardwalk lanes, and the five
  //  mission structures. Only `industrial_east` (OPERATION BLACKOUT 02) uses this.
  // ════════════════════════════════════════════════════════════
  function buildIndustrialEast(out) {
    buildIndustrialCore(out);
    const box = makeSink(out), cylinder = cyl(out);
    // One long run of N/S wall across both the core and the marsh, east wall at x=86 — drawn
    // wall-for-wall by buildIndustrialMap (splitting the run here would drift from the meshes)
    box(18.25, -49.5, 135.5, 1, 8); box(18.25, 49.5, 135.5, 1, 8);
    box(86, 0, 1, 99, 8);

    warehouseBuilding(box, 70, -18, 16, 12, 5.0);      // eastern weapons warehouse / archive
    greenhouseBuilding(box, 48, 10, 10, 7);            // abandoned workers' greenhouse (Purple Bud)
    maintenanceRoom(box, 72, 8, 8, 6);                 // emergency resupply shed
    adminWingBuilding(box, 78, 26, 14, 10);            // administrative wing — Kessler's office
    serviceComplex(box, 58, 40, 12, 9);                // NE service complex — extraction

    // Boardwalk spine + arms. Keep the ~2 m gaps beside every run free so bots have lanes.
    pavement(box, 56, 8, 4, 52);                       // N-S spine through the marsh
    pavement(box, 63, -18, 12, 3);                     // W connector to the warehouse door
    pavement(box, 58, 40, 10, 3);                      // S arm to the service complex
    pavement(box, 71, 3, 12, 3);                       // warehouse <-> maintenance link
    pavement(box, 76, 17, 3, 14);                      // maintenance <-> admin wing
    pavement(box, 60, -30, 6, 2.5);                    // dock
    pavement(box, 64, 20, 5, 2.5);                     // jetty
    pavement(box, 52, -6, 2.5, 7);                     // side boardwalk

    // Decaying industrial leftovers in the marsh (low, climbable cover)
    container(box, 62, -38, 6, 'x');
    container(box, 52, 34, 6, 'z');
    cylinder(56, -42, 2.2, 2.4);                       // collapsed tank
    cylinder(50, 40, 1.8, 1.8);                        // half-buried tank
    crate(box, 58, -24, 1.4); crate(box, 66, 30, 1.6);
    crate(box, 54, 20, 1.2); crate(box, 62, 44, 1.3);
  }

  // ════════════════════════════════════════════════════════════
  //  MISSION-03 MOUNTAIN SECTOR — SECTOR ZERO (OPERATION BLACKOUT 03)
  //
  //  The arena grows NORTH of the industrial complex: x[-49.5, 49.5] × z[49.5, 89.5] adds a
  //  99 × 40 m ridge, so the map is 13,761 m² against the plain arena's 9,801 m² — 40 % more
  //  ground, and all of it new. `industrial` and `industrial_east` are untouched.
  //
  //  The relief is NOT a collider table. Hills are an analytic height field evaluated the same
  //  way by the renderer, the player, the local bots and (should a co-op room ever load it) the
  //  hub: a smooth base profile, three octaves of hash noise, a ridged term for crests, a
  //  carved gully, seven flat terraces cut into the slope and graded trails that wind up it.
  //  Storing that as boxes would need roughly one AABB per 2 m² and would gridlock bot
  //  navigation, which is footprint-driven. Instead:
  //    • groundHeight() returns max(collider top, terrainH)  — you stand on the hill
  //    • canClimb() rejects a step whose rise outruns CLIMB_RATE — cliffs and the summit
  //      buttress physically stop you, everything under ~40° is fair game
  //    • walkSlow() shaves pace on steep ground, so the graded trails stay the fast route
  //    • terrainLOS() hides a mover behind a crest, terrainBlock() stops a bullet in rock
  //  Only the MAN-MADE volumes (blast door, portals, pit rim, hall shells, headframe) are in the
  //  collider table, so installSharedColliders() keeps its drift check and cs-sim stays sane.
  // ════════════════════════════════════════════════════════════
  const MTN = {
    xLo: -100, xHi: 100, zLo: 49.5, zHi: 130,
    zBase: 50.5,          // still compound ground behind the north gate
    zFull: 86,            // the engineered datum reaches full height at the top terrace
    base: 0, peak: 28,    // metres of designed climb across the valley floor
    // Valley walls rise on both flanks. The floor is the existing compound/terrace sector; the
    // east and west sides climb to 35 m creating a true U-shaped valley open only to the south.
    wallFrom: 48,         // |x| where the wall begins rising
    wallPeak: 55,         // height of valley wall peaks at |x|=100
    // One long E-W ridge closes the north end and the whole facility is terraced into its south
    // face. `crestA` lifts the spine above the flank; `colA` removes most of that lift at `colX`,
    // which is what makes the crest line walkable through a saddle instead of being a wall.
    crestZ: 127, crestW: 5, crestA: 7, colX: -2, colA: 0.78,
    CLIMB_RATE: 0.85,     // metres of rise per metre walked before a face stops you
    CLIMB_SLACK: 0.45,    // plus this, so a curb-height step is always walkable
    SLOW_RATE: 0.45,      // above this gradient the pace drops toward 0.55
    TERR_F: 0.72,         // flat core, as a fraction of the pad radius
    TERR_A: 1.5,          // the retaining apron blends back into the relief by 1.5 x the radius
    TRAIL_R: 3.4,         // graded trail corridor
    ROAD_R: 3.0,          // cut-road corridor: 3 m of metalled surface, single file, retaining lips
    CELL: 1.5,            // trail/gully bake resolution
    // Bench staircase, declared in the order the mission climbs it. `dy` lifts a pad above the
    // surrounding datum (embankment) or sinks it below (cut face); the absolute surface `y` is
    // then DERIVED from the datum at each pad centre, together with every anchor height below.
    // Hand-typing those numbers is exactly what made the first pass fail — a bench that sits 8 m
    // under its own slope reads as a pothole, and two pads at different heights blend into a bulge.
    // Pads are spaced so that no bench's apron can ever reach another bench's flat core: blending a
    // second level into a floor produces a bulge, not a step. The audit checks the spacing directly,
    // in both directions, because sequential blending makes the order of the overlap matter.
    terraces: [
      { x:  12, z: 55.0, r: 7.0, dy:  0.5 },   // T1 blast-door apron
      { x: -24, z: 58.5, r: 7.0, dy:  0.4 },   // T2 decontamination tunnels
      { x:  26, z: 63.5, r: 7.0, dy:  0.3 },   // T3 upper ventilation terrace
      { x:  -6, z: 68.0, r: 8.0, dy:  0.5 },   // T4 generator terrace
      { x: -30, z: 76.0, r: 8.0, dy:  0.3 },   // T5 central atrium
      { x:  12, z: 78.5, r: 7.0, dy:  0.0 },   // T6 centrifuge chamber
      { x:  -4, z: 85.5, r: 7.0, dy: -0.4 },   // T7 HVAC distribution hub, astride the crest
      { x:  26, z: 85.5, r: 6.5, dy:  0.4 }    // T8 extraction elevator headframe
    ],
    // Excavations cut INTO a bench after it is flattened — the flooded generator sub-level. A
    // carve, not a second pad: two overlapping pads at different heights average into a bulge.
    pits: [ { x: -6, z: 69.8, r: 5.6, depth: 1.7 } ],
    // Graded routes, as plain x/z lines: every route height is read back off the engineered
    // surface, so a trail can never disagree with the bench it crosses and stays the guaranteed
    // walkable line up a face that is otherwise too steep (see the audit's 0.5 m march).
    trails: [
      // The mission line: gate → every terrace in story order → the col → the crest overwatch.
      // Each leg threads the lanes the structures leave open, so the route is also the bot path.
      [ [0,51.5], [6,52.6], [12,53.6], [12,55], [12,56.6], [12,58.4],
        [7,60.8], [0,60.2], [-8,60.0], [-16,59.6], [-24,58.5],
        [-24.2,59.8], [-24,61.4], [-16,62], [-6,62.4], [4,62.8], [14,63], [22,63.2], [26,63.5],
        [26,65], [20,66], [12,66.6], [4,67.2], [-2,67.6], [-6,68], [-6,69], [-6,69.8],
        [-10.5,71.2], [-16,72.6], [-24,74], [-30,76],
        [-30,77.4], [-22,78.4], [-11,78.8], [-2,78.9], [4,77.2], [9.8,76.0], [9.8,78.0],
        [9.8,80.5], [9.8,82.2], [3,82.0], [-4,82.4], [-4,84.0], [-4,86.0], [-4,87.9], [-2,87.9],
        [6,88.0], [14,87.8], [22,87.6], [26,86.6], [26,85.5],
        [22,87.6], [14,87.8], [6,88.0], [-2,87.9], [-12,88.0], [-24,88.2] ],
      // Maintenance spur: the east shoulder, a way up to the vent field without the switchbacks.
      [ [18,55.6], [26,56.4], [34,57.6], [40,59.4], [38,61.4], [30,62.6], [26,63.5] ],
      // Drover's track: the western pasture where the flocks graze, linked up into T2.
      [ [-44,53], [-40,52.4], [-30,54], [-22,55.4], [-30,56.8], [-24,58.5] ],
      // The crest line itself, east and west from the col. Sector Zero's duct lane and the lift pad
      // both open onto it, which is why Scene Nine can arrive from either direction.
      [ [-2,87.9], [-12,88.0], [-22,88.2], [-32,88.0], [6,88.0], [14,87.8], [22,87.6], [32,87.0], [40,86.6] ]
    ],
    // Cut roads — currently NONE, and that is a measurement, not an omission. The brief was graded
    // 1:4 roads cut into the hill as alternatives to the foot-tracks: solved by
    // .leafcheck/cs-mtn-ramps.js, then verified on the BUILT surface by .leafcheck/cs-mtn-roads.js,
    // which is the only surface anyone walks. Three links solved cleanly at 1:4 in the data. All three
    // measured 1:2.0 to 1:2.3 once built, and the reason is the height FIELD, not the line:
    // bakeField stores one nearest-segment height per CELL (1.5 m) node and sampleField rebuilds
    // between nodes by interpolation, so a corridor climbing 1:4 gains 0.375 m per node while the
    // reconstruction error of that interpolation is of the same order. The built surface wanders a
    // fifth of a metre off the authored profile between nodes, which on a 0.8 m measuring window is a
    // fifth steeper than the brief. It is not a bug to patch: expressing 1:4 would mean baking the
    // corridor fields at ~0.5 m, about nine times the current bake, on a surface every mover query
    // hits several times a frame. Trails dodge this entirely because a trail's height is read back off
    // the surface it crosses, so it never asks the field to hold a height the ground does not have.
    // The roads are therefore parked until that cost trade is decided. This list being empty makes
    // roadField inert: no segments, so sampleField returns null everywhere and the blend below costs
    // one failed lookup.
    roads: [
    ],
    // Watercourses: a main stream down the valley centre plus tributaries descending the east and
    // west walls. Carved before the benches so culverted fords under terraces still work.
    gullies: [
      // West tributary: from the high west wall down to the main stream
      [[-30,66], [-33,62], [-35,58], [-38,54.5], [-42,52]],
      // Main valley stream: north to south along the floor
      [[8,120], [5,112], [2,104], [0,96], [-2,88], [-4,82], [-6,76], [-8,70], [-12,64], [-16,58], [-20,53]],
      // East tributary: from the east wall down to the main stream
      [[55,95], [45,90], [38,85], [30,80], [22,76], [14,72], [6,70], [0,68]],
      // West creek: joins the main stream from upper west wall
      [[-65,100], [-55,95], [-45,90], [-36,85], [-28,80], [-20,76], [-12,72], [-6,68]],
    ],
    // Grazing beats: the areas the flocks are turned out on, as centre + radius. These are NOT
    // positions — the client rejection-samples a legal standing spot inside each disc, because
    // "legal" means the surface's own slope/trail/pad arithmetic — and they were SOLVED for, not
    // typed: a march of the sector under the client's exact tests found the ground a sheep will
    // actually stand on is under 10 % of the hillside, so every centre below is the best available
    // within its neighbourhood and at least 15 m from the next one. Re-cut a bench or re-grade a
    // trail and the audit will tell you which beat went barren.
    flocks: [
      { x:  -9.0, z: 55.5, r: 4.5 },   // the first fold above the gate lane
      { x: -37.5, z: 57.0, r: 4.5 },   // the west pasture proper
      { x:  41.5, z: 56.0, r: 4.5 },   // the east shoulder under the maintenance spur
      { x:  30.0, z: 66.5, r: 4.5 },   // the shoulder between T3 and the spur
      { x: -36.5, z: 74.0, r: 4.5 },   // the west flank above the atrium
      { x: -19.0, z: 75.5, r: 4.5 },   // the col below T4's apron
      { x:  16.5, z: 74.5, r: 4.5 },   // synthesis-floor ground
      { x:  42.0, z: 79.0, r: 4.5 },   // the crest shoulder east of the headframe
      { x: -55.0, z: 62.0, r: 5.0 },   // west mid-slope pasture
      { x:  55.0, z: 65.0, r: 5.0 },   // east mid-slope pasture
      { x:  -25.0, z: 95.0, r: 5.0 },   // upper west fold
      { x:  25.0, z: 98.0, r: 5.0 },   // upper east fold
      { x:   0.0, z: 108.0, r: 5.0 },  // north basin
      { x: -70.0, z: 75.0, r: 5.5 },   // far west terrace
      { x:  70.0, z: 78.0, r: 5.5 },   // far east terrace
      { x: -45.0, z: 90.0, r: 5.0 },   // west upper fold
      { x:  45.0, z: 92.0, r: 5.0 },   // east upper fold
      { x: -10.0, z: 85.0, r: 4.5 },   // central ridge meadow
      { x:  10.0, z: 60.0, r: 4.5 },   // east lower slope
      { x: -15.0, z: 65.0, r: 4.5 },   // west lower slope
      { x:  35.0, z: 105.0, r: 5.0 },  // northeast basin
      { x: -35.0, z: 107.0, r: 5.0 },  // northwest basin
      { x:   0.0, z: 70.0, r: 4.5 },   // valley floor centre
      { x:  60.0, z: 90.0, r: 5.0 },   // east high pasture
      { x: -60.0, z: 88.0, r: 5.0 },   // west high pasture
    ],
    // The hamlet's abandoned field. Solved onto the flattest legal fold next to the west pasture —
    // 18 of its 21 stations sit on ground the crop gate accepts — and `yaw` lays the rows along the
    // contour, which is the only way a hillside field reads as worked rather than as dropped there.
    grow: { x: -37.5, z: 55.5, yaw: 0.5, cols: 7, rows: 3, pitch: 1.15, rowPitch: 1.5 },
    // One shared list of every named story position. cs-map.js builds the blocking volumes around
    // them, the client draws its props at them, and Mission 03's objective zones read them — so a
    // coordinate can never drift between the three the way the old duplicated collider table did.
    // `y` is filled in below from the same engineered surface the renderer will stand on. Anything
    // inside a bench stays within 0.72 x its radius, so it sits on guaranteed flat ground.
    anchors: {
      gate:       { x:  0.0, z: 51.5 },        // compound north gate into the hills
      foothold:   { x: 12.0, z: 53.6 },        // first shepherd's pasture on the way up to T1
      blastDoor:  { x: 12.0, z: 58.4 },        // T1 — Sector Zero exterior, set into the cut face
      panelT1:    { x: 12.0, z: 56.6 },        // exterior control panel
      pressA:     { x:  7.0, z: 56.6 },        // manual pressure control A
      pressB:     { x: 17.0, z: 56.6 },        // manual pressure control B
      // The three containment breaches are one per terrace, spread west → east → north-centre, so
      // sealing them walks the full width of the hillside twice instead of pacing 7 m of one bench.
      // They were two-on-T2 and one-on-T3, which read as a single beat; the story only asks that each
      // be a bulkhead, not that they be neighbours. Each station sits on a bench floor just downhill
      // of its own cut face, so the portal mouth is punched uphill and ROOK approaches with the slope
      // at his back.
      breach1:    { x:-27.5, z: 57.0 },        // T2 — the west decontamination line
      breach2:    { x: 31.5, z: 60.5 },        // T3's east apron, under the maintenance spur
      breach3:    { x: -3.0, z: 63.2 },        // T4 — the generator terrace's south retaining wall
      genPit:     { x: -6.0, z: 69.8 },        // T4 flooded generator sub-level (pit floor)
      breaker1:   { x: -9.5, z: 68.6 },
      breaker2:   { x: -2.5, z: 69.2 },
      breaker3:   { x: -6.0, z: 71.8 },
      atrium:     { x:-30.0, z: 76.0 },        // T5 central atrium
      terminalA:  { x:-32.0, z: 74.5 },        // security terminal A
      terminalB:  { x:-26.5, z: 79.8 },        // security terminal B
      centrifuge: { x: 13.0, z: 79.5 },        // T6 synthesis floor
      synth:      { x: 12.0, z: 76.4 },        // synthesis terminal to defend for 90 s
      chokeA:     { x: 17.0, z: 77.0 },        // three approach chokepoints, story order
      chokeB:     { x:  7.0, z: 77.0 },
      chokeC:     { x: 15.0, z: 82.0 },
      hvac:       { x: -4.0, z: 85.5 },        // T7 air-scrubber hall, astride the crest line
      consoleA:   { x: -5.8, z: 83.3 },        // antidote distribution (option A), in the duct lane
      consoleB:   { x: -2.2, z: 83.3 },        // thermal sterilisation (option B)
      lift:       { x: 26.0, z: 85.5 },        // T8 extraction elevator
      liftPanel:  { x: 29.5, z: 84.0 },        // elevator control to hold
      col:        { x: -2.0, z: 87.9 },        // the saddle: foot of the crest line
      overwatch:  { x:-24.0, z: 88.2 },        // ridge-top view of the whole compound
      pasture:    { x:-32.0, z: 55.0 },        // the flocks' grazing ground (ambient wildlife)
      settlement: { x:-40.0, z: 53.0 },        // ruined shepherd hamlet, western foothills
      // The briefing beat sits in the compound itself, on the NE service yard by the duplex.
      serviceYard:{ x: 24.0, z:-30.0 }
    }
  };

  // ── Deterministic value noise: the same arithmetic on every consumer, so the hub, the mesh and
  //    the player never disagree about where a hill is.
  function hash2(ix, iz) {
    const n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
    let m = n;
    m = Math.imul(m ^ (m >>> 13), 1274126177);
    m ^= m >>> 16;
    return (m >>> 0) / 4294967295;
  }
  const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smoother(x - ix), fz = smoother(z - iz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
  }
  const octave = (x, z, f, a, seed) => (vnoise(x * f + seed, z * f + seed * 1.7) - 0.5) * 2 * a;
  // |1-2n| folds the field into crests: ridge lines instead of rolling blobs.
  function ridgeOct(x, z, f, a, seed) {
    const n = vnoise(x * f + seed, z * f + seed * 1.31);
    return (1 - Math.abs(n * 2 - 1)) * a;
  }
  // ── The designed surface ────────────────────────────────────────────────
  // `benchH` is the datum Sector Zero was cut to: a smooth climb up the south face of a ridge, plus
  // the spine itself. Every terrace height, every anchor height and every trail height below is
  // DERIVED from it, which is the only reason the bench staircase and the story positions cannot
  // drift out of step with the slope they sit on.
  const profileFrac = (z) => clamp((z - MTN.zBase) / (MTN.zFull - MTN.zBase), 0, 1);
  function profileH(z) {
    const p = profileFrac(z);
    return MTN.base + (MTN.peak - MTN.base) * p * p * (3 - 2 * p);
  }
  // The crest is a Gaussian band along the ridge line, with most of its lift removed at the col. So
  // the saddle is the low point of the spine: the crest can be walked east and west from it, which
  // is what makes the ridge-top overwatch a place the player can stand, not just see.
  function crestH(x, z) {
    const band = Math.exp(-Math.pow((z - MTN.crestZ) / MTN.crestW, 2));
    const atCol = Math.exp(-Math.pow((x - MTN.colX) / 9, 2));
    return MTN.crestA * band * (1 - MTN.colA * atCol);
  }
  // Valley wall: rises on both flanks beyond |x| = wallFrom, reaching wallPeak at the sector edge.
  // Adds a ridgeline undulation along z so the mountain faces have multiple peaks and folds —
  // a real jungle ridge, not a smooth ramp. The secondary term creates sub-peaks offset from center.
  function wallH(x, z) {
    const dist = Math.abs(x);
    if (dist <= MTN.wallFrom) return 0;
    const t = (dist - MTN.wallFrom) / (100 - MTN.wallFrom);
    const base = MTN.wallPeak * t * t * (3 - 2 * t);
    // Ridgeline fold: medium-frequency sine along the z axis creates multiple peaks (3 peaks per wall)
    const ridge = 1 + 0.25 * Math.sin(z * 0.06 + x * 0.02) + 0.15 * Math.sin(z * 0.13 - 2.1);
    // Sub-peak: secondary undulation at different frequency for "multi-layer" look
    const sub = 1 + 0.12 * Math.sin(z * 0.22 + 4.7) * t;
    return base * ridge * sub;
  }
  const benchH = (x, z) => profileH(z) + crestH(x, z) + wallH(x, z);

  // One bench's flattening weight: dead flat out to TERR_F x r, then blended back into the relief
  // by TERR_A x r. The apron is deliberately short, so the uphill side of a pad reads as a retaining
  // face — and canClimb refuses it — instead of a ramp that would make the graded trails pointless.
  function padWeight(t, x, z) {
    const fr = Math.hypot(x - t.x, z - t.z) / t.r;
    if (fr >= MTN.TERR_A) return 0;
    if (fr <= MTN.TERR_F) return 1;
    return smoother((MTN.TERR_A - fr) / (MTN.TERR_A - MTN.TERR_F));
  }
  // Excavations are subtracted after the benches (see MTN.pits), on the same core/apron profile, so
  // a pit floor is as flat as a pad floor and its rim is as short.
  function pitCarve(x, z) {
    let cut = 0;
    for (const p of MTN.pits) {
      const w = padWeight(p, x, z);
      if (w > 0) cut = Math.max(cut, p.depth * w);
    }
    return cut;
  }
  function padBlend(h, x, z) {
    for (const t of MTN.terraces) {
      const w = padWeight(t, x, z);
      if (w > 0) h = h * (1 - w) + t.y * w;
    }
    return h;
  }
  // The engineered surface: datum, benched, excavated — no noise, no trail grading. This is the
  // drawing the whole sector is dimensioned from.
  function engH(x, z) { return padBlend(benchH(x, z), x, z) - pitCarve(x, z); }

  // Natural relief laid over the datum. The benches cancel it inside their floors, which is exactly
  // what makes a flat pad read as man-made against a hillside that does not. Ridged octaves give the
  // crest lines; the short octaves give scree-scale bumpiness that never blocks a step on its own.
  function reliefH(x, z) {
    // More craggy the higher you are (z profile) and the further from the valley centre (wall)
    const roughZ = 0.35 + 0.65 * profileFrac(z);
    const wallFactor = Math.abs(x) > MTN.wallFrom ? 1.6 : 1.0;
    const rough = roughZ * wallFactor;
    // Medium-frequency fold: large undulations create the "layered mountain" look
    const fold = 1.8 * Math.sin(x * 0.04 + z * 0.02) * Math.sin(z * 0.035 - x * 0.015) * rough;
    let n = octave(x, z, 0.030, 3.30 * rough, 11.3) + octave(x, z, 0.072, 1.50 * rough, 47.9)
          + octave(x, z, 0.170, 0.55 * rough, 91.7) + octave(x, z, 0.430, 0.13, 7.1);
    n += ridgeOct(x, z, 0.045, 2.40 * rough, 23.7) - 1.05 * rough;
    n += ridgeOct(x, z, 0.105, 0.85 * rough, 63.1);
    n += fold;
    return n;
  }

  // Bakes a true nearest-point field: for every cell, the exact distance to the nearest point on
  // any segment plus that segment's interpolated route height. A stamped neighbourhood would look
  // cheaper, but bilinear reads across a junction then average two branches' heights together and
  // drag a trail corridor through the middle of a terrace.
  function bakeField(paths, cell) {
    const segs = [];
    for (const p of paths) {
      for (let i = 0; i < p.length - 1; i++) {
        const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1];
        const L2 = dx * dx + dz * dz;
        segs.push({ x: p[i][0], z: p[i][1], dx, dz, L2, L: Math.sqrt(L2) || 1e-6, h0: p[i][2], h1: p[i + 1][2] });
      }
    }
    const W = Math.ceil((MTN.xHi - MTN.xLo) / cell) + 2, H = Math.ceil((MTN.zHi - MTN.zLo) / cell) + 2;
    const dist = new Float32Array(W * H), val = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = MTN.xLo + i * cell, z = MTN.zLo + j * cell;
        let best = 1e9, bh = 0;
        for (const s of segs) {
          let t = ((x - s.x) * s.dx + (z - s.z) * s.dz) / s.L2;
          t = clamp(t, 0, 1);
          const px = s.x + s.dx * t, pz = s.z + s.dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d < best) { best = d; bh = s.h0 + (s.h1 - s.h0) * t; }
        }
        const id = j * W + i;
        dist[id] = best; val[id] = bh;
      }
    }
    return { W, H, dist, val, cell };
  }
  function sampleField(f, x, z, radius) {
    if (x < MTN.xLo || x > MTN.xHi || z < MTN.zLo || z > MTN.zHi) return null;
    const gx = (x - MTN.xLo) / f.cell, gz = (z - MTN.zLo) / f.cell;
    const i0 = clamp(Math.floor(gx), 0, f.W - 2), j0 = clamp(Math.floor(gz), 0, f.H - 2);
    const tx = clamp(gx - i0, 0, 1), tz = clamp(gz - j0, 0, 1);
    const a = j0 * f.W + i0;
    const dd = f.dist[a] * (1 - tx) * (1 - tz) + f.dist[a + 1] * tx * (1 - tz)
             + f.dist[a + f.W] * (1 - tx) * tz + f.dist[a + f.W + 1] * tx * tz;
    if (dd > radius) return null;
    const vv = f.val[a] * (1 - tx) * (1 - tz) + f.val[a + 1] * tx * (1 - tz)
             + f.val[a + f.W] * (1 - tx) * tz + f.val[a + f.W + 1] * tx * tz;
    return { d: dd, h: vv };
  }

  // ── Dimension the sector from the datum, once, at load ──────────────────
  // Pad floors: the designed grade at each pad centre plus its own cut/fill offset. This has to
  // happen before the corridors are baked, because a trail reads its own height back off `engH`.
  for (const t of MTN.terraces) t.y = +(benchH(t.x, t.z) + t.dy).toFixed(2);

  // ── The one surface everything is measured against ──────────────────────
  // The baked route fields and the height query live at module scope instead of inside a factory,
  // so the terrace levels, the story anchors, the collider builder, the renderer, the player's
  // ground snap and the hub's bullet check are all dimensioned from ONE evaluated surface. Anything
  // derived from a second copy can drift; derived from this, it cannot. The bake is ~150k segment
  // tests once per load, which is why it is not repeated per consumer.
  const trailField = bakeField(MTN.trails.map(r => r.map(p => [p[0], p[1], engH(p[0], p[1])])), MTN.CELL);
  // Roads keep their own heights, because the whole point of a road is that its grade was fitted
  // rather than inherited. They are baked into a SECOND field, not concatenated into the trail one,
  // so the two can be told apart when they are drawn (cut gravel against a retaining lip, versus a
  // muddy track) and so a road can be blended after a trail and win where they cross — an engineered
  // surface beats a footpath. The nearest-segment rule means both still cost one sample each.
  const roadField = bakeField(MTN.roads, MTN.CELL);
  const gullyField = bakeField(MTN.gullies.map(g => g.map(p => [p[0], p[1], 0])), MTN.CELL);
  const maxPadWeight = (x, z) => {
    let w = 0;
    for (const t of MTN.terraces) { const pw = padWeight(t, x, z); if (pw > w) w = pw; }
    return w;
  };

  // Evaluated in construction order, which is how a hillside cut to a bench staircase actually
  // reads: natural ground, then the stream, then the pads flattened onto it, then the excavation
  // sunk into the pad, then the trails graded through all of it.
  // Edge falloff: terrain descends smoothly near the boundary to avoid an abrupt cliff-edge cut.
  const EDGE_MARGIN = 12; // metres of downward taper at each boundary
  function edgeFalloff(x, z) {
    const ex = Math.min(1, Math.max(0, Math.min(x - MTN.xLo, MTN.xHi - x) / EDGE_MARGIN));
    const ez = Math.min(1, Math.max(0, Math.min(z - MTN.zLo, MTN.zHi - z) / EDGE_MARGIN));
    return Math.min(ex, ez);
  }

  function terrainHeight(x, z) {
    if (z < MTN.zLo - 2 || z > MTN.zHi + 2 || x < MTN.xLo - 2 || x > MTN.xHi + 2) return 0;
    let h = benchH(x, z) + reliefH(x, z);
    const g = sampleField(gullyField, x, z, 6.5);
    if (g) h -= (1 - g.d / 6.5) * (1 - g.d / 6.5) * (2.4 + 1.2 * clamp(1 - g.d / 3, 0, 1));
    const pw = maxPadWeight(x, z);
    h = padBlend(h, x, z);
    h -= pitCarve(x, z);
    // A graded corridor exists to negotiate a slope, so it must stop where an engineered bench
    // floor begins: the floor is already flat and already walkable, and regrading it would drag the
    // pad toward the height of whatever vertex the trail was graded from. That is the one way a
    // bench core can disagree with its own declared level, and it is what an audit must catch.
    // Gating against the same pad weight that flattened the floor makes the two meet exactly at
    // the core boundary instead of fighting each other across the apron.
    const tr = sampleField(trailField, x, z, MTN.TRAIL_R);
    if (tr) {
      const w = smoother(clamp(1 - tr.d / MTN.TRAIL_R, 0, 1)) * (1 - pw);
      h = h * (1 - w) + (tr.h - 0.05) * w;
    }
    // Last, so a road regrades a trail it crosses. No -0.05 here: that is the ruts a muddy track
    // carries, and a metalled road surface sits at its own finished level.
    const rd = sampleField(roadField, x, z, MTN.ROAD_R);
    if (rd) {
      const w = smoother(clamp(1 - rd.d / MTN.ROAD_R, 0, 1)) * (1 - pw);
      h = h * (1 - w) + rd.h * w;
    }
    if (z < MTN.zLo) h *= clamp((z - (MTN.zLo - 2)) / 2, 0, 1);
    // Apply edge falloff: terrain tapers down near all boundaries to avoid an abrupt cliff-edge cut
    h *= edgeFalloff(x, z);
    // Never below the compound's own ground plane — the flat floor mesh is at 0 and a dip under
    // it would be a hole in the world the player can fall into.
    return h > 0 ? h : 0;
  }

  // Feet-level climb test: the only slope rule that matters, because a downhill or lateral step
  // is always free. Measured from the ground the mover is standing on, never from eye height.
  function canClimb(fromX, fromZ, toX, toZ, feetY) {
    const run = Math.hypot(toX - fromX, toZ - fromZ);
    if (run < 1e-6) return true;
    const rise = terrainHeight(toX, toZ) - feetY;
    return rise <= run * MTN.CLIMB_RATE + MTN.CLIMB_SLACK;
  }

  // Gradient magnitude, used to slow the walk off-trail without ever hard-blocking it.
  function gradient(x, z) {
    const e = 0.9;
    const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
    const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }
  function walkSlow(x, z) {
    const g = gradient(x, z);
    if (g <= MTN.SLOW_RATE) return 1;
    return Math.max(0.55, 1 - (g - MTN.SLOW_RATE) * 0.75);
  }

  // Crest occlusion for sight: march the ray and compare it against the ground under it.
  function losBlocked(x1, y1, z1, x2, y2, z2) {
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.ceil(dist / 1.6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t, y = y1 + (y2 - y1) * t;
      if (terrainHeight(x, z) > y + 0.15) return true;
    }
    return false;
  }
  // Bullets: return the hit distance if the relief swallows the ray, else 0.
  function rayHit(ox, oy, oz, dx, dy, dz, maxDist, step) {
    const steps = Math.ceil(maxDist / step);
    for (let i = 1; i <= steps; i++) {
      const t = i * step;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (t > 3 && terrainHeight(x, z) > y) return t;
    }
    return 0;
  }

  const TERRAIN = { height: terrainHeight, canClimb, gradient, walkSlow, losBlocked, rayHit, bounds: MTN };

  // Story positions: the surface they will actually stand on — benches, excavation, natural relief
  // and graded corridors included, read from the same function the renderer will stand them on. The
  // client draws its props at these heights, the collider builder seats its volumes at them and
  // Mission 03 puts its objective zones there, so the four can never disagree the way the old
  // duplicated collider table did.
  for (const k in MTN.anchors) {
    const a = MTN.anchors[k];
    a.y = +terrainHeight(a.x, a.z).toFixed(2);
  }

  // The terrain API is the module-level surface above, handed out as one shared object: a height
  // asked for by the renderer, by the player's ground snap or by the hub's bullet check is literally
  // the same function, so the three cannot disagree about where a hill is.
  function descriptor(name) {
    const m = MAPS[BUILDERS[name] ? name : 'industrial'];
    if (!m || !m.terrain) return null;
    return TERRAIN;
  }

  // Perimeter, north gate and the man-made volumes of Sector Zero, all read off MTN.anchors.
  // Only geometry that must STOP a body is registered here; the client draws rails, pipes, ducts,
  // doors and machinery as collider-free deco on top, so the drift check stays a straight comparison.
  function buildMountainSector(out) {
    const box = makeSink(out), cylinder = cyl(out);
    const A = MTN.anchors;
    // Compound gate block, straddling the old north wall line at z=49.5.
    box(-6, 49.5, 8, 1, 8); box(6, 49.5, 8, 1, 8);
    box(0, 49.5, 4, 1, 0.9, 6.2);                        // lintel over the gateway
    box(-11.5, 51.5, 6, 5, 3.2);                          // checkpoint house, west of the track
    pavement(box, 0, 52.5, 9, 7);                         // gate apron

    // T1 — the blast door into Sector Zero, set into the cut face above the apron. The jambs carry
    // full height and the header leaves a 4 m walk-through, so the door reads as an entrance the
    // player can actually walk into rather than a wall with a texture on it. The two manual pressure
    // controls stand either side of the apron, in the open, exactly as Scene Two needs them.
    const D = A.blastDoor;
    box(D.x - 4.6, D.z, 1.4, 2.4, 7.2, D.y);
    box(D.x + 4.6, D.z, 1.4, 2.4, 7.2, D.y);
    box(D.x, D.z, 10.6, 2.4, 1.6, D.y + 6.8);             // header, clear below
    box(D.x - 8.6, D.z - 0.6, 1.2, 3.4, 2.4, D.y);          // apron retaining walls, clear of the lane
    box(D.x + 8.6, D.z - 0.6, 1.2, 3.4, 2.4, D.y);
    box(A.panelT1.x, A.panelT1.z, 1.8, 0.9, 1.4, A.panelT1.y);   // exterior control panel
    box(A.pressA.x, A.pressA.z, 1.2, 1.2, 1.3, A.pressA.y);      // manual pressure control A
    box(A.pressB.x, A.pressB.z, 1.2, 1.2, 1.3, A.pressB.y);      // manual pressure control B

    // The two bulkhead stations, on T2 and on T4's south face. Each portal mouth is uphill of its
    // control station, so ROOK approaches with the slope at his back instead of fighting a door and
    // a face at the same time.
    for (const st of [A.breach1, A.breach3]) {
      box(st.x, st.z, 1.5, 1.0, 1.2, st.y);               // bulkhead control station
      const pz = st.z + 1.9;                              // portal mouth in the cut face
      box(st.x - 2.1, pz, 1.2, 2.4, 3.4, st.y);
      box(st.x + 2.1, pz, 1.2, 2.4, 3.4, st.y);
      box(st.x, pz, 5.4, 2.4, 0.9, st.y + 3.4);
    }

    // The third station, out on T3's ventilation apron: duct bases either side of it and a bulk
    // housing behind, so the beat has real cover without being sealed in. This one is the far
    // eastern objective of the scene — the reason the other two are on the west and north faces.
    box(A.breach2.x, A.breach2.z, 1.5, 1.0, 1.2, A.breach2.y);
    cylinder(A.breach2.x - 4.2, A.breach2.z - 1.4, 1.4, 2.6, A.breach2.y);
    cylinder(A.breach2.x + 4.2, A.breach2.z - 1.4, 1.4, 2.6, A.breach2.y);
    box(A.breach2.x - 2.6, A.breach2.z + 2.8, 5, 1.2, 2.4, A.breach2.y);   // housing, west of the lane

    // T4 — the flooded generator sub-level, excavated into the bench. The rim collars stand on the
    // upper side only; the ramp down is the trail itself, so a bot never has to path through a door
    // it cannot see. Three switchgear banks on the pit floor are Scene Four's circuit breakers.
    const pit = MTN.pits[0], PY = A.genPit.y;
    for (const b of [A.breaker1, A.breaker2, A.breaker3]) box(b.x, b.z, 2.2, 1.4, 1.6, b.y);
    box(A.genPit.x + 1.0, A.genPit.z + 2.8, 4.6, 3.0, 1.2, PY);   // generator plinth
    box(pit.x - 3.6, pit.z + 4.4, 5.4, 1.2, 2.4, PY + pit.depth); // rim collar, W
    box(pit.x + 3.4, pit.z + 4.0, 4.4, 1.2, 2.4, PY + pit.depth); // rim collar, E

    // T5 — central atrium. Cover walls with walk-around lanes and one back wall into the cut face;
    // nothing here is roofed, because a roof slab would make the whole plaza unreadable to bot
    // navigation and the defence beat would have nobody to defend it against.
    box(A.atrium.x - 4.5, A.atrium.z + 0.6, 1.2, 7, 2.4, A.atrium.y);
    box(A.atrium.x - 4.0, A.atrium.z + 5.4, 9, 1.2, 2.4, A.atrium.y);
    box(A.terminalA.x, A.terminalA.z, 2.4, 1.4, 1.5, A.terminalA.y);
    box(A.terminalB.x, A.terminalB.z, 2.4, 1.4, 1.5, A.terminalB.y);

    // T6 — the centrifuge chamber, open to the south as the brief says: drum, two shields and a
    // back baffle, with the synthesis terminal in front. The lanes between the shields are the three
    // chokepoints Scene Six is fought over, so they are wide enough to walk and narrow enough to hold.
    cylinder(A.centrifuge.x, A.centrifuge.z, 2.3, 4.6, A.centrifuge.y);
    box(A.centrifuge.x - 4.6, A.centrifuge.z + 0.7, 1.2, 3.4, 4.4, A.centrifuge.y);
    box(A.centrifuge.x + 4.6, A.centrifuge.z + 0.7, 1.2, 3.4, 4.4, A.centrifuge.y);
    box(A.centrifuge.x, A.centrifuge.z + 5.0, 8, 1.2, 4.4, A.centrifuge.y);
    box(A.synth.x, A.synth.z, 2.6, 1.4, 1.5, A.synth.y);          // synthesis terminal to defend

    // T7 — HVAC distribution hub, astride the crest. Two scrubber blocks stand either side of a
    // duct lane, the lane holds the two consoles the moral choice is played in, and the ridge trail
    // walks up that lane and out onto the col. The hall is sunk 0.8 m because its footprint reaches
    // past the bench's flat core into the apron — a base kept on the pad level would float where
    // the natural ground takes over again. The plenum and duct runs that feed the scrubbers are 1.8
    // m of climbable clutter, so the client draws them as collider-free deco instead.
    box(A.hvac.x - 5.0, A.hvac.z, 4.4, 5, 3.4, A.hvac.y - 0.8);
    box(A.hvac.x + 5.0, A.hvac.z, 4.4, 5, 3.4, A.hvac.y - 0.8);
    box(A.consoleA.x, A.consoleA.z, 1.8, 1.0, 1.3, A.consoleA.y);  // antidote distribution
    box(A.consoleB.x, A.consoleB.z, 1.8, 1.0, 1.3, A.consoleB.y);  // thermal sterilisation

    // T8 — extraction elevator headframe: two legs, the sheave deck over the shaft, the winding
    // house beside it and the hold control on its wall. The deck is the one roofed spot in the
    // sector, and the beat the player must stand at is the panel, not the shaft underneath it.
    box(A.lift.x, A.lift.z - 3, 1.2, 1.2, 8.6, A.lift.y);
    box(A.lift.x, A.lift.z + 3, 1.2, 1.2, 8.6, A.lift.y);
    box(A.lift.x, A.lift.z, 2.4, 7.4, 0.6, A.lift.y + 8.6);
    box(A.liftPanel.x + 2.2, A.liftPanel.z, 4.4, 4, 3.2, A.liftPanel.y);   // winding house
    box(A.lift.x, A.lift.z + 3.6, 9, 1.2, 2.6, A.lift.y);                  // shaft back wall

    // The crest: a breastwork on the south rim of the ridge line, so the position sits above it with
    // the whole south face and the compound in view — where the closing cinematic is staged.
    box(A.overwatch.x, A.overwatch.z - 1.3, 6, 1.0, 1.1, A.overwatch.y);
  }

  function buildIndustrialMountain(out) {
    buildIndustrialCore(out);
    const box = makeSink(out);
    // West and east walls run the full depth; the south wall stays where it always was.
    box(-49.5, 20, 1, 139, 8); box(49.5, 20, 1, 139, 8);
    box(0, -49.5, 99, 1, 8);
    // Old compound north wall on both sides of the gate; the mountain perimeter is the walls above.
    box(-27.75, 49.5, 43.5, 1, 8); box(27.75, 49.5, 43.5, 1, 8);
    box(0, 89.5, 99, 1, 12);
    buildMountainSector(out);
  }

  // ══ CLASSIC ARENA — 66x66 ════════════════════════════════════════════════
  function buildClassic(out) {
    const box = makeSink(out);
    box(0, -32.5, 66, 1, 7); box(0, 32.5, 66, 1, 7);
    box(-32.5, 0, 1, 66, 7); box(32.5, 0, 1, 66, 7);
    box(-18, 0, 20, 1.2, 5); box(18, 0, 20, 1.2, 5);
    box(0, 0, 6, 6, 4.2);
    box(-22, -14, 8, 10, 5.5); box(22, 16, 10, 8, 5.5);
    box(-4, 15, 6, 4, 3.5); box(5, -14, 4, 6, 3.5);
    box(-10, 19, 1.2, 12, 4.5); box(11, -20, 1.2, 12, 4.5);
    box(-26, 10, 8, 1.2, 4); box(26, -8, 8, 1.2, 4);
    box(16, 6, 6, 2.4, 2.6); box(-15, -6, 2.4, 6, 2.6);
    crate(box, -21, 21, 2); crate(box, -19, 21, 2); crate(box, -21, 21, 1.3, 2);
    crate(box, -16, 25, 1.2); crate(box, -25, 17, 1.4);
    crate(box, 21, -16, 2); crate(box, 21, -18, 2); crate(box, 21, -16, 1.3, 2);
    crate(box, 16, -12, 1.2); crate(box, 25, -22, 1.4); crate(box, 26, -24, 1.1);
    crate(box, -6, -6, 1.3); crate(box, 6, 6, 1.3); crate(box, -3, 7, 1.1); crate(box, 3, -8, 1.1);
    crate(box, -12, -24, 1.4); crate(box, 12, 25, 1.4); crate(box, -28, -28, 1.6); crate(box, 28, 28, 1.6);
    crate(box, -28, 2.5, 1.2); crate(box, 28, -2.5, 1.2); crate(box, 0, 22, 1.2); crate(box, 0, -22, 1.2);
  }

  const BUILDERS = {
    industrial: buildIndustrial, industrial_east: buildIndustrialEast,
    industrial_mountain: buildIndustrialMountain, classic: buildClassic
  };
  // `industrial` is the classic symmetric 99x99 arena everyone (incl. co-op) plays. The marsh
  // expansion lives in its OWN entry `industrial_east` — a 128x99 rect running x[-49.5, 64.5]
  // (the west wall never moved) used ONLY by Mission 02. xMin/xMax describe that asymmetry;
  // halfW stays the generic largest half-extent so older consumers keep working.
  const MAPS = {
    industrial: {
      size: 99, half: 48, halfW: 49.5, halfD: 49.5, xMin: -49.5, xMax: 49.5,
      ct: { xMin: -8, xMax: 8, zMin: -45, zMax: -40 },
      t: { xMin: -20, xMax: 20, zMin: 35, zMax: 45 },
    },
    industrial_east: {
      size: 99, half: 48, halfW: 86, halfD: 49.5, xMin: -49.5, xMax: 86, east: true,
      ct: { xMin: -8, xMax: 8, zMin: -45, zMax: -40 },
      t: { xMin: -20, xMax: 20, zMin: 35, zMax: 45 },
    },
    // Mission-03 arena: the plain compound plus the mountain sector NORTH of it. Per-axis z is
    // mandatory here — the arena is 99 × 139 and its centre sits 20 m north of the origin, so
    // anything still reading halfD as a symmetric ±extent is wrong on this map.
    industrial_mountain: {
      size: 99, half: 48, halfW: 100, halfD: 89.75, xMin: -100, xMax: 100,
      zMin: -49.5, zMax: 130, mountain: true, terrain: true,
      ct: { xMin: -8, xMax: 8, zMin: -45, zMax: -40 },
      t: { xMin: -20, xMax: 20, zMin: 52, zMax: 66 },
    },
    classic: {
      size: 66, half: 32, halfW: 32.5, halfD: 32.5, xMin: -32.5, xMax: 32.5,
      ct: { xMin: -8, xMax: 8, zMin: -25, zMax: -20 },
      t: { xMin: -20, xMax: 20, zMin: 20, zMax: 25 },
    },
  };

  // Built once per map and frozen: every consumer must see the identical array.
  const _cache = {};
  function collidersFor(name) {
    const key = BUILDERS[name] ? name : 'industrial';
    if (!_cache[key]) { const out = []; BUILDERS[key](out); _cache[key] = out; }
    return _cache[key];
  }
  function info(name) { return MAPS[BUILDERS[name] ? name : 'industrial']; }

  // ── Collision math, shared verbatim ──
  function circleHitsBox(x, z, r, c) {
    const dx = x - clamp(x, c.minX, c.maxX), dz = z - clamp(z, c.minZ, c.maxZ);
    return dx * dx + dz * dz < r * r;
  }

  // Height-aware: a collider only blocks when it spans the mover's body band. Low props (pavement,
  // stair treads under the step height) are walked over; overhead slabs are ignored from below.
  function collide(colliders, pos, r, h, step = STEP) {
    for (const c of colliders) {
      if (c.maxY <= pos.y + step || c.minY >= pos.y + h) continue;
      // Quick 2D reject: skip colliders whose extent cannot reach the mover
      if (pos.x < c.minX - r || pos.x > c.maxX + r || pos.z < c.minZ - r || pos.z > c.maxZ + r) continue;
      const cx = clamp(pos.x, c.minX, c.maxX), cz = clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (r - d);
        pos.z += (dz / d) * (r - d);
      } else {
        const pl = pos.x - c.minX, pr = c.maxX - pos.x, pb = pos.z - c.minZ, pf = c.maxZ - pos.z;
        const m = Math.min(pl, pr, pb, pf);
        if (m === pl) pos.x = c.minX - r; else if (m === pr) pos.x = c.maxX + r;
        else if (m === pb) pos.z = c.minZ - r; else pos.z = c.maxZ + r;
      }
    }
  }

  // Terrain-aware variants. `terr` is the descriptor from descriptor(map); null on every map that
  // predates Mission 03, which keeps the arithmetic (and the hub's cost) exactly as it was.
  //
  // The step rule for a height field, shared verbatim so a cliff stops the player, a bot and a
  // hub simulation at the same metre. The rollback mirrors collide()'s push-out: when the diagonal
  // is refused, whichever single axis is still climbable is kept, so walking beside a rock face
  // slides along it instead of sticking dead.
  function terrainStep(terr, pos, fromX, fromZ) {
    if (!terr) return;
    if (terr.canClimb(fromX, fromZ, pos.x, pos.z, pos.y)) return;
    if (terr.canClimb(fromX, fromZ, pos.x, fromZ, pos.y)) { pos.z = fromZ; return; }
    if (terr.canClimb(fromX, fromZ, fromX, pos.z, pos.y)) { pos.x = fromX; return; }
    pos.x = fromX; pos.z = fromZ;
  }

  function groundHeight(colliders, pos, r, step = STEP, terr = null) {
    let g = 0;
    const reach = r * 0.85;
    for (const c of colliders) {
      // 2D quick-reject before circleHitsBox: a box farther than reach from the centre cannot hit.
      if (pos.x < c.minX - reach || pos.x > c.maxX + reach || pos.z < c.minZ - reach || pos.z > c.maxZ + reach) continue;
      if (c.maxY <= pos.y + step && c.maxY > g && circleHitsBox(pos.x, pos.z, reach, c)) g = c.maxY;
    }
    if (terr) { const t = terr.height(pos.x, pos.z); if (t > g) g = t; }
    return g;
  }

  // Footprint-only on purpose: isFree() gates spawn points, waypoints and where trees/bushes may
  // land, and the arena's owner wants thin raised pavement counted as occupied so vegetation never
  // spawns on a walkway. Passability over those low props comes from collide()'s step height, not
  // from here. `bounds` is the map's {halfW, halfD} — industrial is a 128x99 rectangle after the
  // eastern marsh expansion, so a single half-extent no longer describes the arena.
  function isFree(colliders, bounds, x, z, r, terr = null) {
    const b = (bounds && (bounds.halfW !== undefined || bounds.xMin !== undefined))
      ? bounds : { halfW: bounds, halfD: bounds };
    const xLo = b.xMin !== undefined ? b.xMin : -b.halfW;
    const xHi = b.xMax !== undefined ? b.xMax : b.halfW;
    const zLo = b.zMin !== undefined ? b.zMin : -b.halfD;
    const zHi = b.zMax !== undefined ? b.zMax : b.halfD;
    if (x < xLo + r || x > xHi - r) return false;
    if (z < zLo + r || z > zHi - r) return false;
    // A face too steep to stand on is not free ground, and on the mountain the relief is not in
    // the collider table, so the slope test has to live here or every waypoint lands on a cliff.
    if (terr && terr.gradient(x, z) > 1.05) return false;
    return !colliders.some(c => circleHitsBox(x, z, r, c));
  }

  // Ground line of sight: only geometry that actually covers eye height blocks the view, which is
  // what makes windows see-through and pavements irrelevant to a bot's targeting.
  // `terr` adds the relief: the sight line is drawn between the two eye points measured from the
  // ground under each foot, so a crest between them hides a mover and a dip reveals one.
  function hasLOS(colliders, x1, z1, x2, z2, eyeY = EYE, terr = null) {
    const dx = x2 - x1, dz = z2 - z1, dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / 0.5);
    let y1 = eyeY, y2 = eyeY;
    if (terr) {
      y1 += terr.height(x1, z1); y2 += terr.height(x2, z2);
      // Relief marched on its own coarse 2 m stride: a crest that matters is metres wide, and
      // sampling it every 0.5 m would multiply the hot per-frame LOS cost for nothing.
      const tSteps = Math.ceil(dist / 2);
      for (let i = 1; i < tSteps; i++) {
        const t = i / tSteps;
        if (terr.height(x1 + dx * t, z1 + dz * t) > y1 + (y2 - y1) * t - 0.2) return false;
      }
    }
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = x1 + dx * t, z = z1 + dz * t;
      for (const c of colliders) {
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.minY <= eyeY && c.maxY >= eyeY) return false;
      }
    }
    return true;
  }

  // Bullets: march in 3D and stop on whatever spans the ray's height at that point, so a bot
  // crouched behind a low barrier is genuinely hard to hit and a raised deck genuinely shields.
  // `step` is exposed because the same march serves two very different jobs: the hub validates a
  // fired bullet and needs 25 cm precision, while a cabinet drawing a teammate's tracer only needs
  // to know which wall it stops on and would otherwise march 564 volumes 400 times per shot.
  function rayBlock(colliders, ox, oy, oz, dx, dy, dz, maxDist, step = 0.25, terr = null) {
    const steps = Math.ceil(maxDist / step);
    for (let i = 1; i <= steps; i++) {
      const t = i * step;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y < 0 || y > 12) return { wall: true, dist: t };
      // A round fired across the valley stops in the hillside instead of flying through solid rock.
      // Skipped below 4 m so a shooter standing on the ground never hits the slope under their own
      // feet — the same reason the collider loop reads only eye-band volumes.
      if (terr && t > 4 && terr.height(x, z) > y) return { wall: true, dist: t, terrain: true };
      for (const c of colliders) {
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.minY <= y && c.maxY >= y) return { wall: true, dist: t };
      }
    }
    return null;
  }

  // Hub-side patrol points. The client makes its own (THREE.Vector2), so this only serves cs-sim.
  function waypoints(name, count) {
    const m = info(name), col = collidersFor(name), terr = descriptor(name), out = [];
    const xLo = (m.xMin !== undefined ? m.xMin : -m.halfW) + 3, xHi = (m.xMax !== undefined ? m.xMax : m.halfW) - 3;
    const zLo = (m.zMin !== undefined ? m.zMin : -m.halfD) + 3, zHi = (m.zMax !== undefined ? m.zMax : m.halfD) - 3;
    let guard = 0;
    while (out.length < count && guard++ < count * 200) {
      const x = xLo + Math.random() * (xHi - xLo);
      const z = zLo + Math.random() * (zHi - zLo);
      if (isFree(col, m, x, z, 0.9, terr)) out.push({ x, z, y: groundHeight(col, { x, y: 0, z }, 0.4, STEP, terr) });
    }
    return out;
  }

  return {
    MAPS, STEP, EYE, MTN, info, collidersFor, waypoints, descriptor,
    collide, groundHeight, isFree, hasLOS, rayBlock, circleHitsBox, terrainStep,
  };
});
