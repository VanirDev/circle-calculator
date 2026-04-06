const BLOCK_TYPES = {
  flat:    { name: 'Flat',  dx: 1, dy: 0 },
  slope45: { name: '45°',  dx: 1, dy: 1 },
  slope2:  { name: '1:2',  dx: 1, dy: 2 },
  slope3:  { name: '1:3',  dx: 1, dy: 3 },
  slope4:  { name: '1:4',  dx: 1, dy: 4 },
  slope5:  { name: '1:5',  dx: 1, dy: 5 },
  slope6:  { name: '1:6',  dx: 1, dy: 6 },
};

// Phase 1: Compute a connected vertex chain approximating one quadrant of the ellipse.
// Returns array of { x0, y0, x1, y1, blockKey }.
function computePath(rx, ry, enabledBlocks, ordering) {
  const maxX = Math.ceil(rx);
  const maxY = Math.ceil(ry);
  if (maxX <= 0 || maxY <= 0) return [];

  // Build available moves from enabled blocks
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

  const monotonic = ordering === 'monotonic';

  // Calculate where the ellipse crosses y=0.5 to find starting flat cap extent
  const startStdY = ry - 0.5;
  const startX = startStdY > 0
    ? rx * Math.sqrt(Math.max(0, 1 - (startStdY * startStdY) / (ry * ry)))
    : rx;
  let curX = Math.max(0, Math.floor(startX));

  // Top flat cap: horizontal segments from (0,0) to (curX, 0)
  const path = [];
  for (let x = 0; x < curX; x++) {
    path.push({ x0: x, y0: 0, x1: x + 1, y1: 0, blockKey: 'flat' });
  }

  let curY = 0;
  let lastSteepness = -1;
  const maxSteps = (maxX + maxY) * 3;

  for (let step = 0; step < maxSteps; step++) {
    if (curX >= maxX || curY >= maxY) break;

    let bestScore = Infinity;
    let bestMove = null;

    for (const move of moves) {
      const nx = curX + move.advX;
      const ny = curY + move.advY;

      if (nx > maxX || ny > maxY) continue;

      // Monotonic: reject moves that decrease steepness
      if (monotonic) {
        const steepness = move.advX === 0 ? Infinity : move.advY / move.advX;
        if (steepness < lastSteepness - 0.001) continue;
        // Don't allow vertical-only moves until we've reached maxX
        if (move.advX === 0 && curX < maxX) continue;
        // Don't commit to a steepness that would prevent reaching maxX.
        // After this move, the remaining y-budget is maxY - ny.
        // With steepness >= s, max x-advance per y = 1/s (for s>0) or 0 (for s=Inf).
        // The flattest available move with steepness >= s determines max x progress.
        if (steepness > lastSteepness + 0.001 && nx < maxX) {
          // Check if we can still reach maxX with this new minimum steepness
          const remainY = maxY - ny;
          // Best case: use moves at exactly this steepness to maximize x advance
          const maxXperY = steepness > 0 ? 1 / steepness : Infinity;
          const reachableX = nx + remainY * maxXperY;
          if (reachableX < maxX - 0.001) continue;
        }
      }

      // Score: how close is the endpoint to the ideal ellipse?
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

  // Add side flat cap at the end to reach maxY (vertical segments)
  // These continue the monotonic increase (steepness goes to Inf)
  if (curX < maxX && curY >= maxY) {
    // Need horizontal cap but this would break monotonicity after vertical moves
    // Only add if it won't break monotonicity
    if (!monotonic || lastSteepness <= 0.001) {
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
          cells.push({ x, y });
        }
      }
    } else if (dx > 0 && dy === 0) {
      // Flat horizontal segment
      const fillY = mode === 'external' ? seg.y0 - 1 : seg.y0;
      if (fillY >= 0) {
        for (let x = seg.x0; x < seg.x1; x++) {
          cells.push({ x, y: fillY });
        }
      }
    } else if (dx === 0 && dy > 0) {
      // Flat vertical segment
      const fillX = mode === 'external' ? seg.x0 : seg.x0 - 1;
      if (fillX >= 0) {
        for (let y = seg.y0; y < seg.y1; y++) {
          cells.push({ x: fillX, y });
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
          };
        }
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

  return { path, grid };
}

if (typeof module !== 'undefined') {
  module.exports = { BLOCK_TYPES, computeCircle };
} else {
  globalThis.BLOCK_TYPES = BLOCK_TYPES;
  globalThis.computeCircle = computeCircle;
}
