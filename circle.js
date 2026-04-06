const BLOCK_TYPES = {
  flat:    { name: 'Flat',  dx: 1, dy: 0 },
  slope45: { name: '45°',  dx: 1, dy: 1 },
  slope2:  { name: '1:2',  dx: 1, dy: 2 },
  slope3:  { name: '1:3',  dx: 1, dy: 3 },
  slope4:  { name: '1:4',  dx: 1, dy: 4 },
  slope5:  { name: '1:5',  dx: 1, dy: 5 },
  slope6:  { name: '1:6',  dx: 1, dy: 6 },
};

// Build the set of cursor moves from enabled block types.
function buildMoves(enabledBlocks) {
  const moves = [];
  for (const key of enabledBlocks) {
    const block = BLOCK_TYPES[key];
    if (!block) continue;
    if (key === 'flat') {
      moves.push({ advX: 1, advY: 0, blockKey: 'flat' });
      moves.push({ advX: 0, advY: 1, blockKey: 'flat' });
    } else if (block.dx === 1 && block.dy === 1) {
      moves.push({ advX: 1, advY: 1, blockKey: key });
    } else {
      const n = block.dy;
      moves.push({ advX: n, advY: 1, blockKey: key });
      moves.push({ advX: 1, advY: n, blockKey: key });
    }
  }
  return moves;
}

// Walk the cursor along the ellipse, choosing the best move at each step.
// stopCondition(curX, curY) returns true to stop early (used for octant limit).
function walkPath(moves, rx, ry, maxX, maxY, monotonic, stopCondition) {
  // Calculate where the ellipse crosses y=0.5 to find starting flat cap extent
  const startStdY = ry - 0.5;
  const startX = startStdY > 0
    ? rx * Math.sqrt(Math.max(0, 1 - (startStdY * startStdY) / (ry * ry)))
    : rx;
  let curX = Math.max(0, Math.floor(startX));

  const path = [];
  // Top flat cap: horizontal segments from (0,0) to (curX, 0)
  for (let x = 0; x < curX; x++) {
    path.push({ x0: x, y0: 0, x1: x + 1, y1: 0, blockKey: 'flat' });
  }

  let curY = 0;
  let lastSteepness = -1;
  const maxSteps = (maxX + maxY) * 3;

  for (let step = 0; step < maxSteps; step++) {
    if (curX >= maxX || curY >= maxY) break;
    if (stopCondition && stopCondition(curX, curY)) break;

    let bestScore = Infinity;
    let bestMove = null;

    for (const move of moves) {
      const nx = curX + move.advX;
      const ny = curY + move.advY;

      if (nx > maxX || ny > maxY) continue;
      if (stopCondition && stopCondition(nx, ny)) continue;

      if (monotonic) {
        const steepness = move.advX === 0 ? Infinity : move.advY / move.advX;
        if (steepness < lastSteepness - 0.001) continue;
        if (move.advX === 0 && curX < maxX) continue;
        if (steepness > lastSteepness + 0.001 && nx < maxX) {
          const remainY = maxY - ny;
          const maxXperY = steepness > 0 ? 1 / steepness : Infinity;
          const reachableX = nx + remainY * maxXperY;
          if (reachableX < maxX - 0.001) continue;
        }
      }

      const stdX = nx;
      const stdY = ry - ny;
      const normR = Math.sqrt((stdX * stdX) / (rx * rx) + (stdY * stdY) / (ry * ry));
      const score = Math.abs(normR - 1);

      if (score < bestScore ||
          (score === bestScore && bestMove &&
           move.advX + move.advY > bestMove.advX + bestMove.advY)) {
        bestScore = score;
        bestMove = move;
      }
    }

    if (!bestMove) break;

    if (monotonic) {
      lastSteepness = bestMove.advX === 0 ? Infinity : bestMove.advY / bestMove.advX;
    }

    path.push({
      x0: curX, y0: curY,
      x1: curX + bestMove.advX, y1: curY + bestMove.advY,
      blockKey: bestMove.blockKey
    });

    curX += bestMove.advX;
    curY += bestMove.advY;
  }

  return { path, curX, curY };
}

// Phase 1: Compute a connected vertex chain approximating one quadrant of the ellipse.
// Returns array of { x0, y0, x1, y1, blockKey }.
function computePath(rx, ry, enabledBlocks, ordering) {
  const maxX = Math.ceil(rx);
  const maxY = Math.ceil(ry);
  if (maxX <= 0 || maxY <= 0) return [];

  const moves = buildMoves(enabledBlocks);
  const monotonic = ordering === 'monotonic';

  // For odd height, limit the walker's Y so slopes can't reach the center
  // row. The center row lies on the vertical mirror axis; slopes there would
  // overlap with conflicting rotations. The flat cap fills the final row.
  // (Odd width doesn't need this — the center column is at qx=0, always flat.)
  const h = Math.ceil(ry * 2);
  const walkMaxY = (h % 2 === 1) ? maxY - 1 : maxY;

  const result = walkPath(moves, rx, ry, maxX, walkMaxY, monotonic, null);
  const path = result.path;
  let curX = result.curX;
  let curY = result.curY;

  // Add flat caps to reach the full quadrant boundary
  if (curX < maxX && curY >= maxY) {
    if (!monotonic || curY === 0) {
      for (let x = curX; x < maxX; x++) {
        path.push({ x0: x, y0: curY, x1: x + 1, y1: curY, blockKey: 'flat' });
      }
    }
  }
  if (curY < maxY) {
    for (let y = curY; y < maxY; y++) {
      path.push({ x0: curX, y0: y, x1: curX, y1: y + 1, blockKey: 'flat' });
    }
  }

  return path;
}

// Phase 2: Convert path segments into grid cells.
function fillPathToGrid(path, grid, rx, ry, w, h, mode) {
  const cx = w / 2;
  const cy = h / 2;

  for (const seg of path) {
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;

    let cells = [];

    if (dx > 0 && dy > 0) {
      // Diagonal segment: fill all cells in bounding box [x0..x1-1] x [y0..y1-1]
      for (let x = seg.x0; x < seg.x1; x++) {
        for (let y = seg.y0; y < seg.y1; y++) {
          cells.push({ x, y, segDx: dx, segDy: dy, relX: x - seg.x0, relY: y - seg.y0 });
        }
      }
    } else if (dx > 0 && dy === 0) {
      // Flat horizontal segment: fill the adjacent row.
      // External: fill the row above (toward exterior). At y=0 boundary, fill y=0 itself.
      // Internal: fill the row below (toward interior).
      let fillY;
      if (mode === 'external') {
        fillY = seg.y0 === 0 ? 0 : seg.y0 - 1;
      } else {
        fillY = seg.y0;
      }
      for (let x = seg.x0; x < seg.x1; x++) {
        cells.push({ x, y: fillY, segDx: 0, segDy: 0, relX: 0, relY: 0 });
      }
    } else if (dx === 0 && dy > 0) {
      // Flat vertical segment: fill the adjacent column.
      // External: fill the column to the right. At x=maxX boundary, fill maxX-1 itself.
      // Internal: fill the column to the left.
      const maxX = Math.ceil(rx);
      let fillX;
      if (mode === 'external') {
        fillX = seg.x0 >= maxX ? seg.x0 - 1 : seg.x0;
      } else {
        fillX = seg.x0 === 0 ? 0 : seg.x0 - 1;
      }
      if (fillX >= 0) {
        for (let y = seg.y0; y < seg.y1; y++) {
          cells.push({ x: fillX, y, segDx: 0, segDy: 0, relX: 0, relY: 0 });
        }
      }
    }

    for (const cell of cells) {
      const mirrors = mirrorPositions(cell.x, cell.y, cx, cy, w, h);
      for (const m of mirrors) {
        if (grid[m.gy] && grid[m.gy][m.gx] === null) {
          grid[m.gy][m.gx] = {
            type: seg.blockKey,
            rotation: m.rotation,
            segDx: cell.segDx,
            segDy: cell.segDy,
            relX: cell.relX,
            relY: cell.relY,
          };
        }
      }
    }
  }
}

// For circles: enforce 90° rotational symmetry by overwriting second-octant
// cells with rotated first-octant cells. The first octant (near top/bottom
// edges) is more accurate because the walker starts there.
//
// The visual transformation for 90° CW grid rotation is:
//   Rot90CW = H-flip ∘ transpose
// So canonical geometry gets transposed (swap dx/dy, relX/relY) and the
// rotation field maps as: 0→1, 1→3, 2→0, 3→2.
function enforceRotationalSymmetry(grid, w, h) {
  const half = (w - 1) / 2;
  // 90° CW rotation composed with each source rotation:
  // 0(id)→4(90°CW), 1(H)→6(anti-diag), 2(V)→5(transpose), 3(H+V)→7(90°CCW)
  const ROT_MAP = [4, 6, 5, 7];

  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const dx = Math.abs(gx - half);
      const dy = Math.abs(gy - half);
      if (dx <= dy) continue; // first octant or diagonal — keep as-is

      // Second octant: overwrite with 90° CCW rotation source (from first octant)
      const srcX = gy;
      const srcY = w - 1 - gx;
      const src = grid[srcY][srcX];

      if (src) {
        grid[gy][gx] = {
          type: src.type,
          rotation: ROT_MAP[src.rotation],
          segDx: src.segDx,
          segDy: src.segDy,
          relX: src.relX,
          relY: src.relY,
        };
      } else {
        grid[gy][gx] = null;
      }
    }
  }
}

function mirrorPositions(qx, qy, cx, cy, w, h) {
  const results = new Map();
  const floorCx = Math.floor(cx);
  const ceilCx = Math.ceil(cx);

  const tr = { gx: floorCx + qx, gy: qy, rotation: 0 };
  const tl = { gx: ceilCx - 1 - qx, gy: qy, rotation: 1 };
  const br = { gx: floorCx + qx, gy: h - 1 - qy, rotation: 2 };
  const bl = { gx: ceilCx - 1 - qx, gy: h - 1 - qy, rotation: 3 };

  const positions = [tr, tl, br, bl];
  for (const pos of positions) {
    if (pos.gx >= 0 && pos.gx < w && pos.gy >= 0 && pos.gy < h) {
      const key = pos.gy * w + pos.gx;
      if (!results.has(key)) {
        results.set(key, pos);
      }
    }
  }

  return Array.from(results.values());
}

function computeCircle({ width, height, mode, enabledBlocks, ordering }) {
  const w = width;
  const h = height;

  const grid = [];
  for (let y = 0; y < h; y++) {
    grid[y] = new Array(w).fill(null);
  }

  if (w < 3 || h < 3) {
    return { path: [], grid };
  }

  const rx = w / 2;
  const ry = h / 2;

  const path = computePath(rx, ry, enabledBlocks, ordering);
  fillPathToGrid(path, grid, rx, ry, w, h, mode);

  if (w === h) {
    enforceRotationalSymmetry(grid, w, h);
  }

  return { path, grid };
}

if (typeof module !== 'undefined') {
  module.exports = { BLOCK_TYPES, computeCircle };
} else {
  globalThis.BLOCK_TYPES = BLOCK_TYPES;
  globalThis.computeCircle = computeCircle;
}
