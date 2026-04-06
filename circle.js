const BLOCK_TYPES = {
  flat:    { name: 'Flat',  dx: 1, dy: 0 },
  slope45: { name: '45°',  dx: 1, dy: 1 },
  slope2:  { name: '1:2',  dx: 1, dy: 2 },
  slope3:  { name: '1:3',  dx: 1, dy: 3 },
  slope4:  { name: '1:4',  dx: 1, dy: 4 },
  slope5:  { name: '1:5',  dx: 1, dy: 5 },
  slope6:  { name: '1:6',  dx: 1, dy: 6 },
};

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

  // TODO: Algorithm goes here in later tasks

  return { path, grid };
}

if (typeof module !== 'undefined') {
  module.exports = { BLOCK_TYPES, computeCircle };
} else {
  globalThis.BLOCK_TYPES = BLOCK_TYPES;
  globalThis.computeCircle = computeCircle;
}
