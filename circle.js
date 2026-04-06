const BLOCK_TYPES = {
  flat:    { name: 'Flat',  dx: 1, dy: 0 },
  slope45: { name: '45°',  dx: 1, dy: 1 },
  slope2:  { name: '1:2',  dx: 1, dy: 2 },
  slope3:  { name: '1:3',  dx: 1, dy: 3 },
  slope4:  { name: '1:4',  dx: 1, dy: 4 },
  slope5:  { name: '1:5',  dx: 1, dy: 5 },
  slope6:  { name: '1:6',  dx: 1, dy: 6 },
};

function getEnabledBlockList(enabledBlocks) {
  return Object.entries(BLOCK_TYPES)
    .filter(([key]) => enabledBlocks.has(key))
    .map(([key, block]) => ({ key, ...block }));
}

function getSegmentCells(seg) {
  const cells = [];
  for (let ix = 0; ix < seg.dx; ix++) {
    for (let iy = 0; iy < seg.dy; iy++) {
      cells.push({ x: seg.x + ix, y: seg.y + iy, cellX: ix, cellY: iy });
    }
  }
  return cells;
}

function areSegmentsEdgeConnected(segA, segB) {
  const cellsA = getSegmentCells(segA);
  const cellsB = getSegmentCells(segB);
  for (const a of cellsA) {
    for (const b of cellsB) {
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) return true;
    }
  }
  return false;
}

function fixDiagonalGaps(segments) {
  if (segments.length < 2) return segments;

  // Build set of occupied cells for quick lookup
  const occupied = new Set();
  for (const seg of segments) {
    for (const cell of getSegmentCells(seg)) {
      occupied.add(cell.x + ',' + cell.y);
    }
  }

  const result = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = result[result.length - 1];
    const curr = segments[i];

    if (!areSegmentsEdgeConnected(prev, curr)) {
      // Find closest cell pair between prev and curr
      const prevCells = getSegmentCells(prev);
      const currCells = getSegmentCells(curr);
      let bestDist = Infinity, bestPc = null, bestCc = null;
      for (const pc of prevCells) {
        for (const cc of currCells) {
          const dist = Math.abs(pc.x - cc.x) + Math.abs(pc.y - cc.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestPc = pc;
            bestCc = cc;
          }
        }
      }

      if (bestPc && bestCc && bestDist === 2) {
        // Diagonal gap — bridge at (nextX, prevY)
        const bx = bestCc.x;
        const by = bestPc.y;
        const key = bx + ',' + by;
        if (!occupied.has(key)) {
          // Use slope45 for bridges so they blend into diagonal transitions
          const bridge = { x: bx, y: by, dx: 1, dy: 1, blockKey: 'slope45' };
          result.push(bridge);
          occupied.add(key);
        }
      }
    }
    result.push(curr);
  }
  return result;
}

function computeQuadrant(rx, ry, blocks, ordering) {
  // Cursor-walking algorithm: step along the perimeter, choosing the
  // enabled block type that keeps the cursor closest to the ideal ellipse.
  const maxX = Math.ceil(rx);
  const maxY = Math.ceil(ry);

  if (maxX <= 0 || maxY <= 0) return [];

  // Build available moves from enabled blocks
  const moves = [];
  for (const block of blocks) {
    if (block.key === 'flat') {
      moves.push({ advX: 1, advY: 0, segDx: 1, segDy: 1, blockKey: 'flat' });
      moves.push({ advX: 0, advY: 1, segDx: 1, segDy: 1, blockKey: 'flat' });
    } else {
      const n = block.dy;
      if (n === 1) {
        moves.push({ advX: 1, advY: 1, segDx: 1, segDy: 1, blockKey: block.key });
      } else {
        moves.push({ advX: n, advY: 1, segDx: n, segDy: 1, blockKey: block.key });
        moves.push({ advX: 1, advY: n, segDx: 1, segDy: n, blockKey: block.key });
      }
    }
  }

  // Find starting position: boundary cell at y=0
  const startStdY = ry - 0.5;
  const startStdX = startStdY > 0
    ? rx * Math.sqrt(Math.max(0, 1 - (startStdY * startStdY) / (ry * ry)))
    : rx;
  let curX = Math.max(0, Math.floor(startStdX));
  let curY = 0;

  const segments = [];
  const isCircle = (rx === ry);

  // Top flat cap (horizontal: body extends in Y direction)
  for (let x = 0; x < curX; x++) {
    segments.push({ x, y: 0, dx: 1, dy: 1, blockKey: 'flat', flatDir: 'h' });
  }

  const maxSteps = (maxX + maxY) * 2;
  const monotonic = ordering === 'monotonic';
  let lastSteepness = -1; // advY/advX ratio; increases from flat(0) to 45°(1)

  for (let step = 0; step < maxSteps && curX < maxX && curY < maxY; step++) {
    // For circles, only compute first octant (stop at 45° diagonal)
    if (isCircle && curX + curY >= ry) break;

    let bestScore = Infinity;
    let bestMove = null;

    for (const move of moves) {
      // In monotonic mode, only allow equal or steeper moves
      if (monotonic) {
        const steepness = move.advX === 0 ? Infinity : move.advY / move.advX;
        if (steepness < lastSteepness - 0.001) continue;
      }

      const nx = curX + move.advX;
      const ny = curY + move.advY;

      if (curX + move.segDx > maxX || curY + move.segDy > maxY) continue;
      if (nx > maxX || ny > maxY) continue;

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

    const seg = {
      x: curX,
      y: curY,
      dx: bestMove.segDx,
      dy: bestMove.segDy,
      blockKey: bestMove.blockKey
    };
    if (bestMove.blockKey === 'flat') {
      seg.flatDir = bestMove.advX === 1 ? 'h' : 'v';
    }
    segments.push(seg);

    curX += bestMove.advX;
    curY += bestMove.advY;
  }

  if (isCircle) {
    // Mirror all first-octant segments about the 45° diagonal
    // to produce the second octant and side flat cap.
    // Reverse mirrored list so segments are in path order (45° → 90°)
    const r = rx;
    const mirrored = [];
    for (const seg of segments) {
      const mx = Math.floor(r - seg.y - seg.dy + 0.5);
      const my = Math.floor(r - seg.x - seg.dx + 0.5);
      if (mx >= 0 && my >= 0 && mx + seg.dy <= maxX && my + seg.dx <= maxY) {
        const ms = { x: mx, y: my, dx: seg.dy, dy: seg.dx, blockKey: seg.blockKey };
        // Octant mirror swaps h/v orientation for flats
        if (seg.flatDir) ms.flatDir = seg.flatDir === 'h' ? 'v' : 'h';
        mirrored.push(ms);
      }
    }
    mirrored.reverse();
    segments.push(...mirrored);
  } else {
    // For ellipses, add side flat cap
    if (curX >= maxX && curY < maxY) {
      for (let y = curY; y < maxY; y++) {
        segments.push({ x: maxX - 1, y, dx: 1, dy: 1, blockKey: 'flat', flatDir: 'v' });
      }
    } else if (curY >= maxY && curX < maxX) {
      for (let x = curX; x < maxX; x++) {
        segments.push({ x, y: maxY - 1, dx: 1, dy: 1, blockKey: 'flat', flatDir: 'h' });
      }
    }
  }

  return fixDiagonalGaps(segments);
}

function mirrorPositions(qx, qy, cx, cy, w, h) {
  const results = new Map(); // key -> {gx, gy, rotation}
  const floorCx = Math.floor(cx);
  const ceilCx = Math.ceil(cx);

  // Top-right quadrant (rotation 0)
  const tr = { gx: floorCx + qx, gy: qy, rotation: 0 };
  // Top-left quadrant (rotation 1)
  const tl = { gx: ceilCx - 1 - qx, gy: qy, rotation: 1 };
  // Bottom-right quadrant (rotation 2)
  const br = { gx: floorCx + qx, gy: h - 1 - qy, rotation: 2 };
  // Bottom-left quadrant (rotation 3)
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

function placeQuadrant(grid, segments, cx, cy, w, h, mode) {
  // Both modes share the same block positions (the slope faces define the circle path).
  // Internal/external only changes which side of the slope line gets filled.
  for (const seg of segments) {
    const cells = getSegmentCells(seg);
    for (const cell of cells) {
      const mirrors = mirrorPositions(cell.x, cell.y, cx, cy, w, h);
      for (const m of mirrors) {
        if (grid[m.gy] && grid[m.gy][m.gx] === null) {
          const cellData = {
            type: seg.blockKey, rotation: m.rotation,
            segDx: seg.dx, segDy: seg.dy,
            cellX: cell.cellX, cellY: cell.cellY
          };
          if (seg.flatDir) cellData.flatDir = seg.flatDir;
          grid[m.gy][m.gx] = cellData;
        }
      }
    }
  }
}

function computeCircle({ width, height, mode, enabledBlocks, ordering }) {
  const w = width;
  const h = height;

  const grid = [];
  for (let y = 0; y < h; y++) {
    grid[y] = new Array(w).fill(null);
  }

  const path = [];

  if (w < 3 || h < 3) {
    return { path, grid };
  }

  const cx = w / 2;
  const cy = h / 2;
  const rx = cx;
  const ry = cy;

  const blocks = getEnabledBlockList(enabledBlocks);
  const segments = computeQuadrant(rx, ry, blocks, ordering);
  placeQuadrant(grid, segments, cx, cy, w, h, mode);

  // Build best-effort path from segments.
  // For slope blocks, segDx and segDy equal the cursor advance (advX, advY).
  // For flat blocks, the cursor advances only in one axis: 'h' → advX=1/advY=0,
  // 'v' → advX=0/advY=1. The block is always 1x1 regardless.
  // path entry: { x0, y0, x1, y1, blockKey }
  for (const seg of segments) {
    const x0 = seg.x;
    const y0 = seg.y;
    let x1, y1;
    if (seg.blockKey === 'flat') {
      if (seg.flatDir === 'v') {
        // Vertical flat: cursor advances downward
        x1 = x0;
        y1 = y0 + 1;
      } else {
        // Horizontal flat (flatDir='h' or missing): cursor advances right
        x1 = x0 + 1;
        y1 = y0;
      }
    } else {
      // Slope blocks: segDx === advX, segDy === advY
      x1 = x0 + seg.dx;
      y1 = y0 + seg.dy;
    }
    path.push({ x0, y0, x1, y1, blockKey: seg.blockKey });
  }

  return { path, grid };
}

if (typeof module !== 'undefined') {
  module.exports = { BLOCK_TYPES, computeCircle };
} else {
  globalThis.BLOCK_TYPES = BLOCK_TYPES;
  globalThis.computeCircle = computeCircle;
}
