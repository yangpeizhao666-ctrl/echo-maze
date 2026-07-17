import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { CELL_SIZE, MazeMap, TILE, cellKey, formatTime, makeSeed } from "./maze.js";

const WALL_HEIGHT = 4.6;
const PLAYER_HEIGHT = 1.65;
const PLAYER_RADIUS = 0.72;
const DISCOVERY_RADIUS = 5;
const BEST_KEY = "echo-maze-best-time";

export class EchoMazeGame {
  constructor(root) {
    this.root = root;
    this.seed = makeSeed();
    this.maze = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.world = null;
    this.clock = new THREE.Clock();
    this.keys = new Map();
    this.virtualMove = {
      forward: false,
      back: false,
      left: false,
      right: false,
      sprint: false
    };
    this.state = this.initialState();
    this.discovered = new Set();
    this.objects = {
      prisms: [],
      obelisks: [],
      caches: [],
      traps: [],
      enemies: [],
      exit: null
    };
    this.materials = {};
    this.textures = {};
    this.scratch = {
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      move: new THREE.Vector3(),
      temp: new THREE.Vector3()
    };
    this.ui = this.collectUi();
    this.lastUiUpdate = 0;
    this.lastMapUpdate = 0;
    this.interactTarget = null;
    this.trapCooldown = 0;
    this.lowHealthPulse = 0;
  }

  initialState() {
    return {
      mode: "menu",
      health: 100,
      stamina: 100,
      prisms: 0,
      relays: 0,
      elapsed: 0,
      noise: 0,
      alert: 0,
      exitOpen: false,
      mapExpanded: false,
      paused: false,
      won: false,
      lost: false
    };
  }

  collectUi() {
    return {
      seedLabel: document.querySelector("#seedLabel"),
      healthBar: document.querySelector("#healthBar"),
      staminaBar: document.querySelector("#staminaBar"),
      prismHud: document.querySelector("#prismHud"),
      relayHud: document.querySelector("#relayHud"),
      timeHud: document.querySelector("#timeHud"),
      objectiveText: document.querySelector("#objectiveText"),
      promptText: document.querySelector("#promptText"),
      logList: document.querySelector("#logList"),
      minimap: document.querySelector("#minimap"),
      compass: document.querySelector("#compass"),
      overlay: document.querySelector("#overlay"),
      menuSubtitle: document.querySelector("#menuSubtitle"),
      startBtn: document.querySelector("#startBtn"),
      newSeedBtn: document.querySelector("#newSeedBtn"),
      actionBtn: document.querySelector("#actionBtn"),
      mapBtn: document.querySelector("#mapBtn"),
      pauseBtn: document.querySelector("#pauseBtn"),
      menuPrisms: document.querySelector("#menuPrisms"),
      menuRelays: document.querySelector("#menuRelays"),
      bestTime: document.querySelector("#bestTime"),
      minimapPanel: document.querySelector(".minimap-panel")
    };
  }

  start() {
    this.setupRenderer();
    this.bindEvents();
    this.createRun(this.seed);
    this.setMenu("menu");
    this.log("The maze breathes below.");
    this.loop();
  }

  setupRenderer() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070907);
    this.scene.fog = new THREE.FogExp2(0x070907, 0.036);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 260);
    this.camera.position.set(0, PLAYER_HEIGHT, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.root.appendChild(this.renderer.domElement);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.player());

    const ambient = new THREE.HemisphereLight(0xc6d9bd, 0x15120f, 1.42);
    this.scene.add(ambient);

    const moon = new THREE.DirectionalLight(0xf1dca5, 1.6);
    moon.position.set(-24, 34, -18);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -80;
    moon.shadow.camera.right = 80;
    moon.shadow.camera.top = 80;
    moon.shadow.camera.bottom = -80;
    this.scene.add(moon);

    this.materials = this.createMaterials();
  }

  createRun(seed, keepOverlay = true) {
    this.seed = seed;
    this.state = this.initialState();
    this.discovered = new Set();
    this.interactTarget = null;
    this.trapCooldown = 0;
    this.maze = new MazeMap(seed, 33, 33);
    this.clearWorld();
    this.buildWorld();
    this.placePlayerAtStart();
    this.updateDiscovery();
    this.updateExitState();
    this.updateUi(true);
    this.drawMinimap(true);
    if (keepOverlay) this.setMenu("menu");
  }

  player() {
    return this.controls?.object ?? this.camera;
  }

  clearWorld() {
    if (!this.world) return;
    this.scene.remove(this.world);
    this.world.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
    });
  }

  buildWorld() {
    this.world = new THREE.Group();
    this.world.name = "world";
    this.scene.add(this.world);
    this.objects = {
      prisms: [],
      obelisks: [],
      caches: [],
      traps: [],
      enemies: [],
      exit: null
    };

    this.buildFloorAndCeiling();
    this.buildWalls();
    this.buildDecor();
    this.buildPrisms();
    this.buildObelisks();
    this.buildCaches();
    this.buildTraps();
    this.buildExit();
    this.buildEnemies();
  }

  buildFloorAndCeiling() {
    const width = this.maze.width * CELL_SIZE;
    const height = this.maze.height * CELL_SIZE;
    const floorGeo = new THREE.PlaneGeometry(width, height, this.maze.width, this.maze.height);
    const floor = new THREE.Mesh(floorGeo, this.materials.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.world.add(floor);

    const ceilingGeo = new THREE.PlaneGeometry(width, height);
    const ceiling = new THREE.Mesh(ceilingGeo, this.materials.ceiling);
    ceiling.position.y = WALL_HEIGHT + 0.18;
    ceiling.rotation.x = Math.PI / 2;
    this.world.add(ceiling);
  }

  buildWalls() {
    const wallCells = [];
    for (let z = 0; z < this.maze.height; z += 1) {
      for (let x = 0; x < this.maze.width; x += 1) {
        if (this.maze.tiles[z][x] === TILE.WALL) wallCells.push({ x, z });
      }
    }

    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
    const walls = new THREE.InstancedMesh(wallGeo, this.materials.wall, wallCells.length);
    walls.castShadow = true;
    walls.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    wallCells.forEach((cell, index) => {
      const world = this.maze.cellToWorld(cell);
      const wobble = ((cell.x * 37 + cell.z * 19) % 9) * 0.012;
      matrix.compose(
        new THREE.Vector3(world.x, WALL_HEIGHT / 2 - 0.02, world.z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1 + wobble, 1)
      );
      walls.setMatrixAt(index, matrix);
    });
    walls.instanceMatrix.needsUpdate = true;
    this.world.add(walls);
  }

  buildDecor() {
    const trimGeo = new THREE.CylinderGeometry(0.42, 0.62, 2.8, 8);
    const trimMat = this.materials.darkStone;
    const every = Math.max(1, Math.floor(this.maze.floorCells.length / 42));
    this.maze.floorCells.forEach((cell, index) => {
      if (index % every !== 0 || this.maze.floorNeighborCount(cell.x, cell.z) < 3) return;
      const world = this.maze.cellToWorld(cell);
      const pillar = new THREE.Mesh(trimGeo, trimMat);
      pillar.position.set(world.x, 1.4, world.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.world.add(pillar);
    });
  }

  buildPrisms() {
    const geo = new THREE.IcosahedronGeometry(0.72, 1);
    this.maze.prisms.forEach((prism, index) => {
      const mat = new THREE.MeshStandardMaterial({
        color: prism.color,
        emissive: prism.color,
        emissiveIntensity: 1.35,
        roughness: 0.28,
        metalness: 0.12
      });
      const world = this.maze.cellToWorld(prism.cell);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(world.x, 1.18, world.z);
      mesh.castShadow = true;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.92, 0.035, 8, 36),
        new THREE.MeshBasicMaterial({ color: prism.color, transparent: true, opacity: 0.55 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.38;
      mesh.add(ring);
      this.world.add(mesh);
      this.objects.prisms.push({ ...prism, mesh, ring, spin: 0.9 + index * 0.22 });
    });
  }

  buildObelisks() {
    this.maze.obelisks.forEach((obelisk) => {
      const group = new THREE.Group();
      const world = this.maze.cellToWorld(obelisk.cell);
      group.position.set(world.x, 0, world.z);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.25, 0.55, 7), this.materials.darkStone);
      base.position.y = 0.28;
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 2.8, 6), this.materials.obelisk);
      shaft.position.y = 1.8;
      shaft.castShadow = true;
      group.add(shaft);

      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.46),
        new THREE.MeshStandardMaterial({
          color: obelisk.color,
          emissive: obelisk.color,
          emissiveIntensity: 0.34,
          roughness: 0.22
        })
      );
      gem.position.y = 3.42;
      group.add(gem);

      const light = new THREE.PointLight(obelisk.color, 0.85, 13, 2);
      light.position.y = 3.3;
      group.add(light);

      this.world.add(group);
      this.objects.obelisks.push({ ...obelisk, group, gem, light });
    });
  }

  buildCaches() {
    const bodyGeo = new THREE.BoxGeometry(1.55, 0.82, 1.1);
    const lidGeo = new THREE.BoxGeometry(1.62, 0.28, 1.16);
    this.maze.caches.forEach((cache) => {
      const group = new THREE.Group();
      const world = this.maze.cellToWorld(cache.cell);
      group.position.set(world.x, 0.45, world.z);
      const body = new THREE.Mesh(bodyGeo, this.materials.cache);
      const lid = new THREE.Mesh(lidGeo, this.materials.cacheTrim);
      lid.position.y = 0.52;
      body.castShadow = true;
      body.receiveShadow = true;
      lid.castShadow = true;
      group.add(body, lid);
      this.world.add(group);
      this.objects.caches.push({ ...cache, group, lid });
    });
  }

  buildTraps() {
    const geo = new THREE.PlaneGeometry(CELL_SIZE * 0.74, CELL_SIZE * 0.74);
    this.maze.traps.forEach((trap) => {
      const world = this.maze.cellToWorld(trap.cell);
      const mesh = new THREE.Mesh(geo, this.materials.trap);
      mesh.position.set(world.x, 0.018, world.z);
      mesh.rotation.x = -Math.PI / 2;
      this.world.add(mesh);
      this.objects.traps.push({ ...trap, mesh, cooldown: 0 });
    });
  }

  buildExit() {
    const group = new THREE.Group();
    const world = this.maze.cellToWorld(this.maze.exit);
    group.position.set(world.x, 0, world.z);

    const gate = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.16, 12, 44), this.materials.exitLocked);
    gate.position.y = 2.12;
    gate.rotation.y = Math.PI / 2;
    gate.castShadow = true;
    group.add(gate);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.2, 0.22), this.materials.exitVeil);
    slab.position.y = 1.75;
    slab.position.z = -0.16;
    group.add(slab);

    const light = new THREE.PointLight(0xdf6a5f, 1.2, 16, 1.7);
    light.position.set(0, 2.1, 0);
    group.add(light);

    this.world.add(group);
    this.objects.exit = { group, gate, slab, light };
  }

  buildEnemies() {
    this.maze.enemySpawns.forEach((spawn, index) => {
      const world = this.maze.cellToWorld(spawn.cell);
      const group = new THREE.Group();
      group.position.set(world.x, 0.08, world.z);

      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.5, 1.6, 5, 9),
        new THREE.MeshStandardMaterial({
          color: spawn.rank === "hunter" ? 0xad6fe2 : 0xd5855e,
          emissive: spawn.rank === "hunter" ? 0x3a164e : 0x4e2116,
          emissiveIntensity: 0.35,
          roughness: 0.44
        })
      );
      body.position.y = 1.08;
      body.castShadow = true;
      group.add(body);

      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 16, 10),
        new THREE.MeshBasicMaterial({ color: spawn.rank === "hunter" ? 0xdcc2ff : 0xffd38c })
      );
      eye.position.set(0, 1.55, -0.48);
      group.add(eye);

      const glow = new THREE.PointLight(spawn.rank === "hunter" ? 0xa994ff : 0xff9b71, 1.2, 12, 2);
      glow.position.y = 1.6;
      group.add(glow);

      this.world.add(group);
      this.objects.enemies.push({
        id: spawn.id,
        rank: spawn.rank,
        group,
        body,
        eye,
        glow,
        path: [],
        target: null,
        thinkAt: 0,
        attackAt: 0,
        speed: spawn.rank === "hunter" ? 3.2 : 2.55,
        detection: spawn.rank === "hunter" ? 34 : 26,
        mode: "patrol",
        phase: index * 1.17
      });
    });
  }

  createMaterials() {
    this.textures.wall = makeStoneTexture("#59624f", "#232820", "#82906f");
    this.textures.floor = makeFloorTexture();
    this.textures.floor.wrapS = THREE.RepeatWrapping;
    this.textures.floor.wrapT = THREE.RepeatWrapping;
    this.textures.floor.repeat.set(22, 22);

    this.textures.wall.wrapS = THREE.RepeatWrapping;
    this.textures.wall.wrapT = THREE.RepeatWrapping;
    this.textures.wall.repeat.set(1.2, 1.2);

    return {
      wall: new THREE.MeshStandardMaterial({
        map: this.textures.wall,
        color: 0x9cae88,
        roughness: 0.86,
        metalness: 0.03
      }),
      floor: new THREE.MeshStandardMaterial({
        map: this.textures.floor,
        color: 0x6e7f63,
        roughness: 0.92,
        metalness: 0.02
      }),
      ceiling: new THREE.MeshStandardMaterial({
        color: 0x171a14,
        roughness: 0.96
      }),
      darkStone: new THREE.MeshStandardMaterial({
        color: 0x33382e,
        roughness: 0.84
      }),
      obelisk: new THREE.MeshStandardMaterial({
        color: 0x50584c,
        roughness: 0.72,
        metalness: 0.05
      }),
      cache: new THREE.MeshStandardMaterial({
        color: 0x7f533c,
        roughness: 0.66
      }),
      cacheTrim: new THREE.MeshStandardMaterial({
        color: 0xc08a54,
        roughness: 0.5,
        metalness: 0.16
      }),
      trap: new THREE.MeshBasicMaterial({
        color: 0xb45b58,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide
      }),
      exitLocked: new THREE.MeshStandardMaterial({
        color: 0xb65c55,
        emissive: 0x581e1a,
        emissiveIntensity: 0.8,
        roughness: 0.38
      }),
      exitOpen: new THREE.MeshStandardMaterial({
        color: 0x80e7ba,
        emissive: 0x2a9f7c,
        emissiveIntensity: 1.4,
        roughness: 0.24
      }),
      exitVeil: new THREE.MeshBasicMaterial({
        color: 0x6c2523,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide
      })
    };
  }

  placePlayerAtStart() {
    const start = this.maze.cellToWorld(this.maze.start);
    const rig = this.player();
    rig.position.set(start.x, PLAYER_HEIGHT, start.z);
    rig.rotation.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
  }

  bindEvents() {
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => this.onKey(event, true));
    window.addEventListener("keyup", (event) => this.onKey(event, false));
    this.ui.startBtn.addEventListener("click", () => this.beginPlay());
    this.ui.newSeedBtn.addEventListener("click", () => {
      this.seed = makeSeed();
      this.createRun(this.seed);
      this.log("A new maze folds into place.");
    });
    this.ui.actionBtn.addEventListener("click", () => this.interact());
    this.ui.mapBtn.addEventListener("click", () => this.toggleMap());
    this.ui.pauseBtn.addEventListener("click", () => this.togglePause());

    document.querySelectorAll("[data-move]").forEach((button) => {
      const move = button.dataset.move;
      const set = (value) => {
        this.virtualMove[move] = value;
        if (value && this.state.mode === "menu") this.beginPlay();
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        set(true);
      });
      button.addEventListener("pointerup", () => set(false));
      button.addEventListener("pointercancel", () => set(false));
      button.addEventListener("pointerleave", () => set(false));
    });

    this.controls.addEventListener("unlock", () => {
      if (this.state.mode === "running" && !this.state.paused) {
        this.ui.pauseBtn.textContent = "Resume";
      }
    });
    this.controls.addEventListener("lock", () => {
      if (this.state.mode === "running") this.ui.pauseBtn.textContent = "Pause";
    });
  }

  onKey(event, isDown) {
    this.keys.set(event.code, isDown);
    if (!isDown || event.repeat) return;

    if (event.code === "Enter" && this.state.mode !== "running") {
      this.beginPlay();
      return;
    }
    if (event.code === "KeyE") this.interact();
    if (event.code === "KeyM") this.toggleMap();
    if (event.code === "KeyR") {
      this.createRun(this.seed, false);
      this.beginPlay();
    }
    if (event.code === "Escape" && this.state.mode === "running") this.togglePause(true);
  }

  beginPlay() {
    if (this.state.mode === "win" || this.state.mode === "lose") {
      this.createRun(this.seed, false);
    }
    this.state.mode = "running";
    this.state.paused = false;
    this.ui.overlay.classList.add("hidden");
    this.ui.pauseBtn.textContent = "Pause";
    this.tryLockPointer();
  }

  tryLockPointer() {
    if (!this.controls.isLocked && document.hasFocus()) {
      this.controls.lock();
    }
  }

  togglePause(forcePause = false) {
    if (this.state.mode !== "running") return;
    this.state.paused = forcePause || !this.state.paused;
    this.ui.pauseBtn.textContent = this.state.paused ? "Resume" : "Pause";
    if (this.state.paused) {
      if (this.controls.isLocked) this.controls.unlock();
      this.log("The maze holds its breath.");
    } else {
      this.log("The echo returns.");
      this.tryLockPointer();
    }
  }

  toggleMap() {
    this.state.mapExpanded = !this.state.mapExpanded;
    this.ui.minimapPanel.classList.toggle("expanded", this.state.mapExpanded);
    this.drawMinimap(true);
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.animateScene(dt);
    if (this.state.mode !== "running" || this.state.paused) {
      this.updateUi();
      return;
    }

    this.state.elapsed += dt;
    this.movePlayer(dt);
    this.updateDiscovery();
    this.updateCollectibles(dt);
    this.updateInteractions();
    this.updateTraps(dt);
    this.updateEnemies(dt);
    this.updateExitState();
    this.updateUi();
    this.drawMinimap();
  }

  movePlayer(dt) {
    const forwardInput = (this.keys.get("KeyW") ? 1 : 0) - (this.keys.get("KeyS") ? 1 : 0) + (this.virtualMove.forward ? 1 : 0) - (this.virtualMove.back ? 1 : 0);
    const sideInput = (this.keys.get("KeyD") ? 1 : 0) - (this.keys.get("KeyA") ? 1 : 0) + (this.virtualMove.right ? 1 : 0) - (this.virtualMove.left ? 1 : 0);
    const wantsSprint = this.keys.get("ShiftLeft") || this.keys.get("ShiftRight") || this.virtualMove.sprint;
    const moving = Math.abs(forwardInput) + Math.abs(sideInput) > 0;
    const sprinting = wantsSprint && moving && this.state.stamina > 6;
    const speed = sprinting ? 7.25 : 4.55;
    const rig = this.player();

    if (moving) {
      this.camera.getWorldDirection(this.scratch.forward);
      this.scratch.forward.y = 0;
      this.scratch.forward.normalize();
      this.scratch.right.set(this.scratch.forward.z, 0, -this.scratch.forward.x);
      this.scratch.move
        .copy(this.scratch.forward)
        .multiplyScalar(forwardInput)
        .add(this.scratch.right.multiplyScalar(sideInput));
      if (this.scratch.move.lengthSq() > 0.001) {
        this.scratch.move.normalize().multiplyScalar(speed * dt);
        const nx = rig.position.x + this.scratch.move.x;
        const nz = rig.position.z + this.scratch.move.z;
        if (this.maze.canMoveWorld(nx, rig.position.z, PLAYER_RADIUS)) rig.position.x = nx;
        if (this.maze.canMoveWorld(rig.position.x, nz, PLAYER_RADIUS)) rig.position.z = nz;
        this.state.noise = THREE.MathUtils.clamp(this.state.noise + (sprinting ? dt * 0.38 : dt * 0.16), 0, 1);
      }
    } else {
      this.state.noise = THREE.MathUtils.clamp(this.state.noise - dt * 0.5, 0, 1);
    }

    this.state.stamina = THREE.MathUtils.clamp(this.state.stamina + (sprinting ? -28 * dt : 17 * dt), 0, 100);

    const bob = moving ? Math.sin(this.state.elapsed * (sprinting ? 13 : 9)) * 0.035 : 0;
    rig.position.y = PLAYER_HEIGHT + bob;
  }

  updateDiscovery() {
    const cell = this.maze.worldToCell(this.player().position.x, this.player().position.z);
    for (let z = cell.z - DISCOVERY_RADIUS; z <= cell.z + DISCOVERY_RADIUS; z += 1) {
      for (let x = cell.x - DISCOVERY_RADIUS; x <= cell.x + DISCOVERY_RADIUS; x += 1) {
        if (!this.maze.inBounds(x, z)) continue;
        const dist = Math.hypot(x - cell.x, z - cell.z);
        if (dist <= DISCOVERY_RADIUS) this.discovered.add(`${x},${z}`);
      }
    }
  }

  updateCollectibles(dt) {
    const rig = this.player();

    this.objects.prisms.forEach((prism) => {
      if (prism.taken) return;
      prism.mesh.rotation.y += dt * prism.spin;
      prism.mesh.position.y = 1.18 + Math.sin(this.state.elapsed * 2 + prism.spin) * 0.16;
      prism.ring.rotation.z += dt * 1.4;
      const dist = distance2D(rig.position, prism.mesh.position);
      if (dist < CELL_SIZE * 0.58) {
        prism.taken = true;
        prism.mesh.visible = false;
        this.state.prisms += 1;
        this.log(`${prism.name} recovered.`);
        playTone(520 + this.state.prisms * 120, 0.12, "triangle");
      }
    });

    this.objects.obelisks.forEach((obelisk) => {
      obelisk.gem.rotation.y += dt * 1.6;
      const active = obelisk.activated;
      obelisk.gem.material.emissiveIntensity = active ? 1.8 + Math.sin(this.state.elapsed * 5) * 0.35 : 0.34;
      obelisk.light.intensity = active ? 1.8 : 0.75;
    });
  }

  updateInteractions() {
    const rig = this.player();
    this.interactTarget = null;
    let bestDist = Number.POSITIVE_INFINITY;

    const consider = (target, label, action) => {
      const position = target.group?.position ?? target.mesh?.position;
      if (!position) return;
      const dist = distance2D(rig.position, position);
      if (dist < CELL_SIZE * 0.92 && dist < bestDist) {
        bestDist = dist;
        this.interactTarget = { target, label, action };
      }
    };

    this.objects.obelisks.forEach((obelisk) => {
      if (!obelisk.activated) consider(obelisk, "Relay is dormant.", "obelisk");
    });

    this.objects.caches.forEach((cache) => {
      if (!cache.opened) consider(cache, "Supply cache sealed.", "cache");
    });

    if (this.objects.exit) {
      const label = this.state.exitOpen ? "The exit is awake." : "The exit is sealed.";
      consider(this.objects.exit, label, "exit");
      const cell = this.maze.worldToCell(rig.position.x, rig.position.z);
      if (this.state.exitOpen && cell.x === this.maze.exit.x && cell.z === this.maze.exit.z) {
        this.finish(true);
      }
    }
  }

  interact() {
    if (this.state.mode !== "running" || this.state.paused || !this.interactTarget) return;
    const { target, action } = this.interactTarget;

    if (action === "obelisk") {
      target.activated = true;
      this.state.relays += 1;
      this.log(`Relay ${this.state.relays}/4 awakened.`);
      playTone(330 + this.state.relays * 44, 0.16, "sine");
      return;
    }

    if (action === "cache") {
      target.opened = true;
      target.lid.rotation.x = -0.75;
      this.state.health = THREE.MathUtils.clamp(this.state.health + 28, 0, 100);
      this.state.stamina = 100;
      this.log("Cache opened. Vitality restored.");
      playTone(250, 0.1, "square");
      return;
    }

    if (action === "exit") {
      if (!this.state.exitOpen) {
        this.log("The exit rejects the unfinished pattern.");
        this.state.alert = Math.max(this.state.alert, 0.42);
        return;
      }
      this.finish(true);
    }
  }

  updateTraps(dt) {
    this.trapCooldown = Math.max(0, this.trapCooldown - dt);
    const rig = this.player();
    const cell = this.maze.worldToCell(rig.position.x, rig.position.z);
    const trap = this.objects.traps.find((entry) => entry.active && entry.cell.x === cell.x && entry.cell.z === cell.z);
    this.objects.traps.forEach((entry) => {
      entry.mesh.material.opacity = 0.16 + Math.sin(this.state.elapsed * 4 + entry.cell.x) * 0.04;
    });
    if (trap && this.trapCooldown <= 0) {
      this.trapCooldown = 1.25;
      this.state.health -= 8;
      this.state.noise = 1;
      this.state.alert = Math.max(this.state.alert, 0.7);
      trap.mesh.material.opacity = 0.55;
      this.log("Pressure glyph flared.");
      playTone(120, 0.08, "sawtooth");
      if (this.state.health <= 0) this.finish(false);
    }
  }

  updateEnemies(dt) {
    const player = this.player().position;
    this.state.alert = Math.max(0, this.state.alert - dt * 0.18);

    this.objects.enemies.forEach((enemy) => {
      const enemyPos = enemy.group.position;
      const dist = distance2D(player, enemyPos);
      const visible = dist < enemy.detection * (1 + this.state.noise * 0.35) && this.maze.hasLineOfSight(enemyPos, player);
      if (visible) {
        enemy.mode = "hunt";
        enemy.thinkAt = 0;
        this.state.alert = Math.max(this.state.alert, 1 - dist / enemy.detection);
      } else if (enemy.mode === "hunt" && dist > enemy.detection * 1.35) {
        enemy.mode = "patrol";
        enemy.path = [];
      }

      if (this.state.elapsed >= enemy.thinkAt) {
        this.planEnemy(enemy);
        enemy.thinkAt = this.state.elapsed + (enemy.mode === "hunt" ? 0.42 : 1.2);
      }

      this.moveEnemy(enemy, dt);

      enemy.body.rotation.y += Math.sin(this.state.elapsed * 3 + enemy.phase) * dt * 0.18;
      enemy.eye.material.color.setHex(enemy.mode === "hunt" ? 0xff4f47 : enemy.rank === "hunter" ? 0xdcc2ff : 0xffd38c);
      enemy.glow.intensity = enemy.mode === "hunt" ? 2.2 : 1.05;

      if (dist < CELL_SIZE * 0.52 && this.state.elapsed >= enemy.attackAt) {
        enemy.attackAt = this.state.elapsed + 0.7;
        this.state.health -= enemy.rank === "hunter" ? 18 : 13;
        this.state.alert = 1;
        this.log("A sentinel struck.");
        playTone(85, 0.1, "square");
        if (this.state.health <= 0) this.finish(false);
      }
    });
  }

  planEnemy(enemy) {
    const from = this.maze.worldToCell(enemy.group.position.x, enemy.group.position.z);
    const playerCell = this.maze.worldToCell(this.player().position.x, this.player().position.z);
    let goal = playerCell;

    if (enemy.mode !== "hunt") {
      if (!enemy.target || isSameCell(from, enemy.target) || enemy.path.length === 0) {
        const minDistance = Math.floor(this.maze.floorCells.length * 0.08);
        enemy.target = this.maze.randomFloor(minDistance);
      }
      goal = enemy.target;
    }

    const path = this.maze.findPath(from, goal);
    enemy.path = path.length > 1 ? path.slice(1, 11) : [];
  }

  moveEnemy(enemy, dt) {
    if (!enemy.path.length) return;
    const targetCell = enemy.path[0];
    const targetWorld = this.maze.cellToWorld(targetCell);
    this.scratch.temp.set(targetWorld.x, enemy.group.position.y, targetWorld.z);
    const dir = this.scratch.temp.sub(enemy.group.position);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 0.14) {
      enemy.path.shift();
      return;
    }
    dir.normalize();
    const speed = enemy.speed * (enemy.mode === "hunt" ? 1.34 : 1);
    enemy.group.position.addScaledVector(dir, speed * dt);
    enemy.group.rotation.y = Math.atan2(dir.x, dir.z);
  }

  updateExitState() {
    const open = this.state.prisms >= 3 && this.state.relays >= 4;
    if (open === this.state.exitOpen) return;
    this.state.exitOpen = open;
    const exit = this.objects.exit;
    if (!exit) return;
    exit.gate.material = open ? this.materials.exitOpen : this.materials.exitLocked;
    exit.slab.material.color.setHex(open ? 0x2a9f7c : 0x6c2523);
    exit.slab.material.opacity = open ? 0.18 : 0.34;
    exit.light.color.setHex(open ? 0x80e7ba : 0xdf6a5f);
    exit.light.intensity = open ? 2.4 : 1.2;
    if (open) {
      this.log("The exit opens.");
      playTone(620, 0.2, "triangle");
    }
  }

  animateScene(dt) {
    if (this.objects.exit) {
      this.objects.exit.gate.rotation.z += dt * (this.state.exitOpen ? 0.7 : 0.25);
      this.objects.exit.slab.position.y = 1.75 + Math.sin(this.state.elapsed * 2.4) * 0.035;
    }
    if (this.state.health < 28 && this.state.mode === "running") {
      this.lowHealthPulse += dt;
      const pulse = Math.sin(this.lowHealthPulse * 8) * 0.5 + 0.5;
      this.scene.fog.color.setHex(pulse > 0.7 ? 0x21100e : 0x070907);
    } else {
      this.scene.fog.color.setHex(0x070907);
    }
  }

  finish(won) {
    if (this.state.mode !== "running") return;
    this.state.mode = won ? "win" : "lose";
    this.state.won = won;
    this.state.lost = !won;
    this.state.paused = true;
    if (this.controls.isLocked) this.controls.unlock();
    if (won) {
      this.storeBestTime();
      this.log("The labyrinth releases you.");
      playTone(740, 0.24, "sine");
    } else {
      this.log("The maze goes silent.");
      playTone(70, 0.25, "sawtooth");
    }
    this.setMenu(this.state.mode);
    this.updateUi(true);
  }

  setMenu(mode) {
    this.ui.overlay.classList.remove("hidden");
    const copy = {
      menu: "A sealed labyrinth waits below the relay stones.",
      win: `Run complete in ${formatTime(this.state.elapsed)}.`,
      lose: "The sentinels claimed the passage."
    };
    this.ui.menuSubtitle.textContent = copy[mode] ?? copy.menu;
    this.ui.startBtn.textContent = mode === "menu" ? "Enter Maze" : "Run Again";
    this.ui.menuPrisms.textContent = `${this.state.prisms}/3`;
    this.ui.menuRelays.textContent = `${this.state.relays}/4`;
    this.ui.bestTime.textContent = this.getBestTimeLabel();
  }

  storeBestTime() {
    const current = Number(localStorage.getItem(BEST_KEY) ?? 0);
    if (!current || this.state.elapsed < current) {
      localStorage.setItem(BEST_KEY, String(this.state.elapsed));
    }
  }

  getBestTimeLabel() {
    const best = Number(localStorage.getItem(BEST_KEY) ?? 0);
    return best ? formatTime(best) : "--:--";
  }

  updateUi(force = false) {
    if (!force && this.state.elapsed - this.lastUiUpdate < 0.08) return;
    this.lastUiUpdate = this.state.elapsed;

    this.ui.seedLabel.textContent = `Seed ${this.seed}`;
    this.ui.healthBar.style.width = `${THREE.MathUtils.clamp(this.state.health, 0, 100)}%`;
    this.ui.staminaBar.style.width = `${THREE.MathUtils.clamp(this.state.stamina, 0, 100)}%`;
    this.ui.prismHud.textContent = `Prisms ${this.state.prisms}/3`;
    this.ui.relayHud.textContent = `Relays ${this.state.relays}/4`;
    this.ui.timeHud.textContent = formatTime(this.state.elapsed);
    this.ui.menuPrisms.textContent = `${this.state.prisms}/3`;
    this.ui.menuRelays.textContent = `${this.state.relays}/4`;
    this.ui.bestTime.textContent = this.getBestTimeLabel();
    this.ui.promptText.textContent = this.interactTarget?.label ?? "";
    this.ui.actionBtn.disabled = !this.interactTarget || this.state.mode !== "running" || this.state.paused;
    this.ui.objectiveText.textContent = this.getObjectiveText();

    const yaw = this.camera.rotation.y;
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round((((-yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    this.ui.compass.textContent = directions[index];
  }

  getObjectiveText() {
    if (this.state.mode === "win") return "Exit reached.";
    if (this.state.mode === "lose") return "Run failed.";
    if (this.state.prisms < 3) return `Recover prism ${this.state.prisms + 1}.`;
    if (this.state.relays < 4) return `Awaken relay ${this.state.relays + 1}.`;
    if (!this.state.exitOpen) return "The exit is aligning.";
    return "Reach the open exit.";
  }

  log(message) {
    const li = document.createElement("li");
    li.textContent = message;
    this.ui.logList.prepend(li);
    while (this.ui.logList.children.length > 5) this.ui.logList.lastElementChild.remove();
  }

  drawMinimap(force = false) {
    if (!force && this.state.elapsed - this.lastMapUpdate < 0.16) return;
    this.lastMapUpdate = this.state.elapsed;
    const canvas = this.ui.minimap;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const size = Math.min(w, h);
    const cellW = size / this.maze.width;
    const cellH = size / this.maze.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#090b09";
    ctx.fillRect(0, 0, w, h);

    for (let z = 0; z < this.maze.height; z += 1) {
      for (let x = 0; x < this.maze.width; x += 1) {
        if (!this.discovered.has(`${x},${z}`)) continue;
        const tile = this.maze.tiles[z][x];
        ctx.fillStyle = tile === TILE.WALL ? "#1d241e" : tile === TILE.EXIT ? "#3d6c55" : tile === TILE.TRAP ? "#51302d" : "#6f8065";
        ctx.fillRect(x * cellW, z * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    const drawMarker = (cell, color, radius = 3) => {
      if (!this.discovered.has(cellKey(cell))) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc((cell.x + 0.5) * cellW, (cell.z + 0.5) * cellH, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    this.objects.prisms.forEach((entry) => {
      if (!entry.taken) drawMarker(entry.cell, hexCss(entry.color), 3.4);
    });
    this.objects.obelisks.forEach((entry) => drawMarker(entry.cell, entry.activated ? "#80e7ba" : "#cdb36b", 3.2));
    this.objects.caches.forEach((entry) => {
      if (!entry.opened) drawMarker(entry.cell, "#c08a54", 2.7);
    });
    drawMarker(this.maze.exit, this.state.exitOpen ? "#80e7ba" : "#df6a5f", 4.6);

    const playerCell = this.maze.worldToCell(this.player().position.x, this.player().position.z);
    ctx.fillStyle = "#eef3e9";
    ctx.beginPath();
    ctx.arc((playerCell.x + 0.5) * cellW, (playerCell.z + 0.5) * cellH, 4.8, 0, Math.PI * 2);
    ctx.fill();

    this.objects.enemies.forEach((enemy) => {
      const cell = this.maze.worldToCell(enemy.group.position.x, enemy.group.position.z);
      if (enemy.mode === "hunt" || distanceCells(cell, playerCell) < 7) {
        ctx.fillStyle = enemy.mode === "hunt" ? "#ff4f47" : "#ff9b71";
        ctx.fillRect(cell.x * cellW + 1, cell.z * cellH + 1, Math.max(3, cellW - 2), Math.max(3, cellH - 2));
      }
    });

    if (this.state.alert > 0.05) {
      ctx.strokeStyle = `rgba(255, 79, 71, ${0.2 + this.state.alert * 0.55})`;
      ctx.lineWidth = 5;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }
  }
}

function makeStoneTexture(base, dark, light) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 64) {
      const offset = y % 64 === 0 ? 0 : 32;
      ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.04)";
      ctx.fillRect(x - offset, y, 62, 30);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - offset, y, 64, 32);
    }
  }
  for (let i = 0; i < 440; i += 1) {
    ctx.fillStyle = Math.random() > 0.5 ? light : dark;
    ctx.globalAlpha = Math.random() * 0.13;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeFloorTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#6f8065";
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 64) {
    for (let x = 0; x < 256; x += 64) {
      ctx.fillStyle = (x + y) % 128 === 0 ? "#75876b" : "#66765d";
      ctx.fillRect(x, y, 64, 64);
      ctx.strokeStyle = "rgba(18, 22, 18, 0.42)";
      ctx.strokeRect(x, y, 64, 64);
    }
  }
  for (let i = 0; i < 520; i += 1) {
    ctx.fillStyle = Math.random() > 0.65 ? "#8fa27c" : "#384334";
    ctx.globalAlpha = Math.random() * 0.09;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 5, 1 + Math.random() * 5);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function distanceCells(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

function isSameCell(a, b) {
  return a && b && a.x === b.x && a.z === b.z;
}

function hexCss(hex) {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

let audioContext = null;
function playTone(frequency, duration, type) {
  try {
    audioContext ??= new AudioContext();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration + 0.02);
  } catch {
    // Audio is optional and can be blocked until a user gesture.
  }
}
