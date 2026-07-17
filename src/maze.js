import PFModule from "pathfinding";

const PF = PFModule.default ?? PFModule;

export const CELL_SIZE = 4;
export const TILE = {
  FLOOR: 0,
  WALL: 1,
  EXIT: 2,
  TRAP: 3
};

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

export class MazeMap {
  constructor(seed = makeSeed(), width = 31, height = 31) {
    this.seed = seed;
    this.width = width % 2 === 0 ? width + 1 : width;
    this.height = height % 2 === 0 ? height + 1 : height;
    this.rng = mulberry32(hashSeed(seed));
    this.tiles = [];
    this.start = { x: 1, z: 1 };
    this.exit = { x: this.width - 2, z: this.height - 2 };
    this.prisms = [];
    this.obelisks = [];
    this.caches = [];
    this.traps = [];
    this.enemySpawns = [];
    this.floorCells = [];
    this.distances = [];
    this.pathMatrix = [];
    this.finder = new PF.AStarFinder({
      allowDiagonal: false,
      dontCrossCorners: true,
      heuristic: PF.Heuristic.manhattan
    });
    this.grid = null;
    this.generate();
  }

  generate() {
    this.tiles = Array.from({ length: this.height }, () => Array(this.width).fill(TILE.WALL));
    this.carveMaze();
    this.carveRooms(7);
    this.addLoops(0.115);
    this.start = this.pickOpenStart();
    this.distances = this.computeDistances(this.start);
    this.exit = this.pickByDistance(0.985, []);
    this.tiles[this.exit.z][this.exit.x] = TILE.EXIT;
    this.distances = this.computeDistances(this.start);
    this.placeFeatures();
    this.buildPathGrid();
  }

  carveMaze() {
    const stack = [{ x: 1, z: 1 }];
    this.tiles[1][1] = TILE.FLOOR;

    while (stack.length) {
      const current = stack[stack.length - 1];
      const dirs = shuffle(DIRS, this.rng);
      let carved = false;

      for (const [dx, dz] of dirs) {
        const nx = current.x + dx * 2;
        const nz = current.z + dz * 2;
        if (!this.inBounds(nx, nz) || this.tiles[nz][nx] !== TILE.WALL) continue;
        this.tiles[current.z + dz][current.x + dx] = TILE.FLOOR;
        this.tiles[nz][nx] = TILE.FLOOR;
        stack.push({ x: nx, z: nz });
        carved = true;
        break;
      }

      if (!carved) stack.pop();
    }
  }

  carveRooms(count) {
    const attempts = count * 12;
    let carved = 0;

    for (let i = 0; i < attempts && carved < count; i += 1) {
      const roomWidth = randomOdd(this.rng, 3, 7);
      const roomHeight = randomOdd(this.rng, 3, 7);
      const x = randomOdd(this.rng, 3, this.width - roomWidth - 3);
      const z = randomOdd(this.rng, 3, this.height - roomHeight - 3);

      for (let rz = z; rz < z + roomHeight; rz += 1) {
        for (let rx = x; rx < x + roomWidth; rx += 1) {
          if (this.inBounds(rx, rz)) this.tiles[rz][rx] = TILE.FLOOR;
        }
      }

      const center = {
        x: x + Math.floor(roomWidth / 2),
        z: z + Math.floor(roomHeight / 2)
      };
      this.connectRoom(center);
      carved += 1;
    }
  }

  connectRoom(center) {
    const dirs = shuffle(DIRS, this.rng);
    for (const [dx, dz] of dirs) {
      let x = center.x;
      let z = center.z;
      for (let i = 0; i < 5; i += 1) {
        x += dx;
        z += dz;
        if (!this.inBounds(x, z)) break;
        this.tiles[z][x] = TILE.FLOOR;
        if (this.floorNeighborCount(x, z) > 1) break;
      }
    }
  }

  addLoops(chance) {
    for (let z = 2; z < this.height - 2; z += 1) {
      for (let x = 2; x < this.width - 2; x += 1) {
        if (this.tiles[z][x] !== TILE.WALL || this.rng() > chance) continue;
        const horizontal = this.isFloor(x - 1, z) && this.isFloor(x + 1, z);
        const vertical = this.isFloor(x, z - 1) && this.isFloor(x, z + 1);
        if (horizontal !== vertical) this.tiles[z][x] = TILE.FLOOR;
      }
    }
  }

  placeFeatures() {
    const reserved = new Set([cellKey(this.start), cellKey(this.exit)]);
    this.prisms = [0.28, 0.54, 0.76].map((percent, index) => {
      const cell = this.pickByDistance(percent, [...reserved], 7);
      reserved.add(cellKey(cell));
      return {
        id: `prism-${index}`,
        cell,
        color: [0x76f0c3, 0x86a9ff, 0xf3c363][index],
        name: ["Green Prism", "Blue Prism", "Amber Prism"][index],
        taken: false
      };
    });

    this.obelisks = [0.18, 0.38, 0.62, 0.86].map((percent, index) => {
      const cell = this.pickByDistance(percent, [...reserved], 8);
      reserved.add(cellKey(cell));
      return {
        id: `relay-${index}`,
        cell,
        color: [0xcfe086, 0x80e7ba, 0xff9b71, 0xa994ff][index],
        activated: false
      };
    });

    this.caches = [0.2, 0.47, 0.71, 0.9].map((percent, index) => {
      const cell = this.pickByDistance(percent, [...reserved], 5);
      reserved.add(cellKey(cell));
      return {
        id: `cache-${index}`,
        cell,
        opened: false
      };
    });

    this.traps = [];
    for (let i = 0; i < 18; i += 1) {
      const cell = this.pickByDistance(0.18 + this.rng() * 0.72, [...reserved], 4);
      reserved.add(cellKey(cell));
      this.tiles[cell.z][cell.x] = TILE.TRAP;
      this.traps.push({ id: `trap-${i}`, cell, active: true });
    }

    this.enemySpawns = [0.34, 0.52, 0.69, 0.84, 0.93].map((percent, index) => {
      const cell = this.pickByDistance(percent, [...reserved], 9);
      reserved.add(cellKey(cell));
      return {
        id: `sentinel-${index}`,
        cell,
        rank: index > 2 ? "hunter" : "warden"
      };
    });

    this.collectFloorCells();
  }

  collectFloorCells() {
    this.floorCells = [];
    for (let z = 1; z < this.height - 1; z += 1) {
      for (let x = 1; x < this.width - 1; x += 1) {
        if (this.isFloor(x, z) || this.tiles[z][x] === TILE.EXIT || this.tiles[z][x] === TILE.TRAP) {
          this.floorCells.push({ x, z });
        }
      }
    }
  }

  pickOpenStart() {
    for (let z = 1; z < this.height - 1; z += 1) {
      for (let x = 1; x < this.width - 1; x += 1) {
        if (this.isFloor(x, z) && this.floorNeighborCount(x, z) >= 1) return { x, z };
      }
    }
    return { x: 1, z: 1 };
  }

  pickByDistance(percent, reserved = [], minSeparation = 4) {
    const reservedSet = new Set(reserved.map((entry) => (typeof entry === "string" ? entry : cellKey(entry))));
    const ranked = [];

    for (let z = 1; z < this.height - 1; z += 1) {
      for (let x = 1; x < this.width - 1; x += 1) {
        if (!this.isWalkableCell(x, z) || reservedSet.has(cellKey({ x, z }))) continue;
        const distance = this.distances[z]?.[x] ?? -1;
        if (distance <= 0) continue;
        const tooClose = [...reservedSet].some((key) => {
          const [rx, rz] = key.split(",").map(Number);
          return Math.abs(rx - x) + Math.abs(rz - z) < minSeparation;
        });
        if (tooClose) continue;
        ranked.push({ x, z, distance });
      }
    }

    ranked.sort((a, b) => a.distance - b.distance);
    if (!ranked.length) return { ...this.exit };
    const index = Math.min(ranked.length - 1, Math.max(0, Math.floor(ranked.length * percent)));
    const window = ranked.slice(Math.max(0, index - 6), Math.min(ranked.length, index + 7));
    return { ...window[Math.floor(this.rng() * window.length)] };
  }

  computeDistances(start) {
    const distances = Array.from({ length: this.height }, () => Array(this.width).fill(-1));
    const queue = [{ ...start }];
    distances[start.z][start.x] = 0;

    while (queue.length) {
      const current = queue.shift();
      const base = distances[current.z][current.x];
      for (const [dx, dz] of DIRS) {
        const nx = current.x + dx;
        const nz = current.z + dz;
        if (!this.inBounds(nx, nz) || distances[nz][nx] !== -1 || !this.isWalkableCell(nx, nz)) continue;
        distances[nz][nx] = base + 1;
        queue.push({ x: nx, z: nz });
      }
    }

    return distances;
  }

  buildPathGrid() {
    this.pathMatrix = this.tiles.map((row) => row.map((tile) => (tile === TILE.WALL ? 1 : 0)));
    this.grid = new PF.Grid(this.width, this.height, this.pathMatrix);
  }

  findPath(fromCell, toCell) {
    if (!fromCell || !toCell) return [];
    if (!this.inBounds(fromCell.x, fromCell.z) || !this.inBounds(toCell.x, toCell.z)) return [];
    const grid = this.grid.clone();
    return this.finder.findPath(fromCell.x, fromCell.z, toCell.x, toCell.z, grid).map(([x, z]) => ({ x, z }));
  }

  randomFloor(minDistance = 0) {
    const candidates = this.floorCells.filter((cell) => (this.distances[cell.z]?.[cell.x] ?? 0) >= minDistance);
    return { ...candidates[Math.floor(this.rng() * candidates.length)] };
  }

  worldToCell(x, z) {
    return {
      x: Math.floor(x / CELL_SIZE + this.width / 2),
      z: Math.floor(z / CELL_SIZE + this.height / 2)
    };
  }

  cellToWorld(cell) {
    return {
      x: (cell.x - this.width / 2 + 0.5) * CELL_SIZE,
      z: (cell.z - this.height / 2 + 0.5) * CELL_SIZE
    };
  }

  canMoveWorld(x, z, radius = 0.78) {
    const points = [
      [x, z],
      [x + radius, z],
      [x - radius, z],
      [x, z + radius],
      [x, z - radius],
      [x + radius * 0.72, z + radius * 0.72],
      [x - radius * 0.72, z + radius * 0.72],
      [x + radius * 0.72, z - radius * 0.72],
      [x - radius * 0.72, z - radius * 0.72]
    ];
    return points.every(([px, pz]) => {
      const cell = this.worldToCell(px, pz);
      return this.isWalkableCell(cell.x, cell.z);
    });
  }

  hasLineOfSight(fromWorld, toWorld) {
    const dx = toWorld.x - fromWorld.x;
    const dz = toWorld.z - fromWorld.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(distance / (CELL_SIZE * 0.45)));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const cell = this.worldToCell(fromWorld.x + dx * t, fromWorld.z + dz * t);
      if (!this.isWalkableCell(cell.x, cell.z)) return false;
    }
    return true;
  }

  inBounds(x, z) {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  isFloor(x, z) {
    return this.inBounds(x, z) && this.tiles[z][x] === TILE.FLOOR;
  }

  isWalkableCell(x, z) {
    return this.inBounds(x, z) && this.tiles[z][x] !== TILE.WALL;
  }

  floorNeighborCount(x, z) {
    return DIRS.reduce((count, [dx, dz]) => count + (this.isFloor(x + dx, z + dz) ? 1 : 0), 0);
  }
}

export function makeSeed() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function cellKey(cell) {
  return `${cell.x},${cell.z}`;
}

function randomOdd(rng, min, max) {
  const low = min % 2 === 0 ? min + 1 : min;
  const high = max % 2 === 0 ? max - 1 : max;
  return low + Math.floor(rng() * Math.max(1, Math.floor((high - low) / 2) + 1)) * 2;
}

function shuffle(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function hashSeed(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
