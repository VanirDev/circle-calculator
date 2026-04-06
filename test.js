const assert = require('assert');
const { BLOCK_TYPES, computeCircle } = require('./circle.js');

// --- Rule Functions ---
// Each returns { pass: boolean, message: string }

function checkPathConnectivity(path) {
  if (path.length === 0) return { pass: true, message: 'empty path' };
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    if (prev.x1 !== curr.x0 || prev.y1 !== curr.y0) {
      return {
        pass: false,
        message: `segment ${i - 1} ends at (${prev.x1},${prev.y1}) but segment ${i} starts at (${curr.x0},${curr.y0})`
      };
    }
  }
  return { pass: true, message: 'all segments connected' };
}

function checkPathGeometricError(path, rx, ry, maxError) {
  if (path.length === 0) return { pass: true, message: 'empty path' };
  const avgRadius = (rx + ry) / 2;

  const vertices = [{ x: path[0].x0, y: path[0].y0 }];
  for (const seg of path) {
    vertices.push({ x: seg.x1, y: seg.y1 });
  }

  let worstError = 0;
  let worstVertex = null;
  for (const v of vertices) {
    const ex = v.x;
    const ey = ry - v.y;
    const normR = Math.sqrt((ex * ex) / (rx * rx) + (ey * ey) / (ry * ry));
    const error = Math.abs(normR - 1) * avgRadius;
    if (error > worstError) {
      worstError = error;
      worstVertex = v;
    }
  }

  if (worstError > maxError) {
    return {
      pass: false,
      message: `worst error ${worstError.toFixed(3)} at (${worstVertex.x},${worstVertex.y}), threshold ${maxError}`
    };
  }
  return { pass: true, message: `max error ${worstError.toFixed(3)}` };
}

function checkMonotonicity(path) {
  if (path.length <= 1) return { pass: true, message: 'trivial path' };

  let lastSteepness = -Infinity;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;
    const steepness = dx === 0 ? Infinity : dy / dx;

    if (steepness < lastSteepness - 0.001) {
      return {
        pass: false,
        message: `segment ${i} steepness ${steepness.toFixed(3)} < previous ${lastSteepness.toFixed(3)}`
      };
    }
    lastSteepness = steepness;
  }
  return { pass: true, message: 'monotonically increasing steepness' };
}

function checkSymmetry(grid, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      const type = cell ? cell.type : null;

      const hx = w - 1 - x;
      const hType = grid[y][hx] ? grid[y][hx].type : null;
      if (type !== hType) {
        return {
          pass: false,
          message: `horizontal symmetry: (${x},${y})=${type} vs (${hx},${y})=${hType}`
        };
      }

      const vy = h - 1 - y;
      const vType = grid[vy][x] ? grid[vy][x].type : null;
      if (type !== vType) {
        return {
          pass: false,
          message: `vertical symmetry: (${x},${y})=${type} vs (${x},${vy})=${vType}`
        };
      }
    }
  }
  return { pass: true, message: 'symmetric on both axes' };
}

function checkBoundingBox(grid, w, h) {
  let topRow = false, bottomRow = false, leftCol = false, rightCol = false;
  for (let x = 0; x < w; x++) {
    if (grid[0][x]) topRow = true;
    if (grid[h - 1][x]) bottomRow = true;
  }
  for (let y = 0; y < h; y++) {
    if (grid[y][0]) leftCol = true;
    if (grid[y][w - 1]) rightCol = true;
  }
  const missing = [];
  if (!topRow) missing.push('top');
  if (!bottomRow) missing.push('bottom');
  if (!leftCol) missing.push('left');
  if (!rightCol) missing.push('right');
  if (missing.length > 0) {
    return { pass: false, message: `outline missing from edges: ${missing.join(', ')}` };
  }
  return { pass: true, message: 'touches all 4 edges' };
}

function checkSurfaceContribution(grid, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y][x]) continue;
      const hasEmptyNeighbor =
        (x === 0     || !grid[y][x - 1]) ||
        (x === w - 1 || !grid[y][x + 1]) ||
        (y === 0     || !grid[y - 1][x]) ||
        (y === h - 1 || !grid[y + 1][x]);
      if (!hasEmptyNeighbor) {
        return {
          pass: false,
          message: `cell (${x},${y}) type=${grid[y][x].type} is fully surrounded — no exposed face`
        };
      }
    }
  }
  return { pass: true, message: 'all cells have exposed face' };
}

function checkEnabledOnly(grid, w, h, enabledBlocks) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y][x]) continue;
      if (!enabledBlocks.has(grid[y][x].type)) {
        return {
          pass: false,
          message: `cell (${x},${y}) type=${grid[y][x].type} not in enabled set {${[...enabledBlocks].join(',')}}`
        };
      }
    }
  }
  return { pass: true, message: 'all cells use enabled types' };
}

// --- Grid dump for diagnostics ---

function gridToString(grid, w, h) {
  const CHAR_MAP = { flat: '#', slope45: '/', slope2: '2', slope3: '3', slope4: '4', slope5: '5', slope6: '6' };
  let text = '';
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const cell = grid[y][x];
      row += cell ? (CHAR_MAP[cell.type] || '?') : '.';
    }
    text += row + '\n';
  }
  return text;
}

// --- Test Matrix ---

const SIZES = [
  // Squares
  [3, 3], [5, 5], [7, 7], [10, 10], [15, 15], [20, 20], [30, 30], [50, 50],
  // Ellipses
  [10, 20], [20, 10], [7, 15], [15, 7], [5, 11],
  // Odd
  [11, 11], [13, 9], [9, 13],
];

const BLOCK_SETS = {
  default: new Set(['flat', 'slope45', 'slope2']),
  minimal: new Set(['flat', 'slope45']),
  all: new Set(['flat', 'slope45', 'slope2', 'slope3', 'slope4', 'slope5', 'slope6']),
};

function buildTestCases() {
  const cases = [];

  for (const [w, h] of SIZES) {
    for (const mode of ['external', 'internal']) {
      cases.push({
        width: w, height: h, mode,
        enabledBlocks: BLOCK_SETS.default,
        ordering: 'monotonic',
        label: `${w}x${h} ${mode} monotonic default`,
      });
    }
  }

  const subsetSizes = [[10, 10], [20, 20], [15, 7], [11, 11]];
  for (const [w, h] of subsetSizes) {
    for (const [setName, blockSet] of Object.entries(BLOCK_SETS)) {
      if (setName === 'default') continue;
      cases.push({
        width: w, height: h, mode: 'external',
        enabledBlocks: blockSet,
        ordering: 'monotonic',
        label: `${w}x${h} external monotonic ${setName}`,
      });
    }
  }

  for (const [w, h] of subsetSizes) {
    cases.push({
      width: w, height: h, mode: 'external',
      enabledBlocks: BLOCK_SETS.default,
      ordering: 'free',
      label: `${w}x${h} external free default`,
    });
  }

  return cases;
}

// --- Runner ---

const RULES = [
  { name: 'path-connectivity',    fn: (result, tc) => checkPathConnectivity(result.path) },
  { name: 'path-geometric-error', fn: (result, tc) => checkPathGeometricError(result.path, tc.width / 2, tc.height / 2, 1.5) },
  { name: 'monotonicity',         fn: (result, tc) => tc.ordering === 'monotonic' ? checkMonotonicity(result.path) : { pass: true, message: 'skipped (free ordering)' } },
  { name: 'grid-symmetry',        fn: (result, tc) => checkSymmetry(result.grid, tc.width, tc.height) },
  { name: 'grid-bounding-box',    fn: (result, tc) => checkBoundingBox(result.grid, tc.width, tc.height) },
  { name: 'surface-contribution', fn: (result, tc) => checkSurfaceContribution(result.grid, tc.width, tc.height) },
  { name: 'enabled-only',         fn: (result, tc) => checkEnabledOnly(result.grid, tc.width, tc.height, tc.enabledBlocks) },
];

function runTests() {
  const cases = buildTestCases();
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const tc of cases) {
    const result = computeCircle({
      width: tc.width,
      height: tc.height,
      mode: tc.mode,
      enabledBlocks: tc.enabledBlocks,
      ordering: tc.ordering,
    });

    let casePassed = true;
    for (const rule of RULES) {
      const check = rule.fn(result, tc);
      if (!check.pass) {
        casePassed = false;
        failures.push({ label: tc.label, rule: rule.name, message: check.message, grid: result.grid, width: tc.width, height: tc.height });
        break;
      }
    }

    if (casePassed) {
      passed++;
      console.log(`  PASS  ${tc.label}`);
    } else {
      failed++;
    }
  }

  if (failures.length > 0) {
    console.log(`\n--- FAILURES ---\n`);
    for (const f of failures) {
      console.log(`  FAIL  ${f.label}`);
      console.log(`        rule: ${f.rule}`);
      console.log(`        ${f.message}`);
      if (f.width <= 30 && f.height <= 30) {
        console.log('');
        console.log(gridToString(f.grid, f.width, f.height));
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${cases.length} cases`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
