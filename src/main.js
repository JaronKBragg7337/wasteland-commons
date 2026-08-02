import * as THREE from 'three';
import grid from '../world/grid.json';
import manifest from '../world/manifest.json';
import './style.css';

const canvas = document.querySelector('#world');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#101d20');
scene.fog = new THREE.Fog('#101d20', 38, 170);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
camera.position.set(16, 14, 26);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const textureLoader = new THREE.TextureLoader();
const textureFiles = {
  saltGround: '/assets/materials/salt-ground.png',
  weatheredConcrete: '/assets/materials/weathered-concrete.png',
  rustedSteel: '/assets/materials/rusted-steel.png',
  robotShell: '/assets/materials/robot-shell.png',
  undeadBone: '/assets/materials/undead-bone.png',
  survivorCloth: '/assets/materials/survivor-cloth.png',
  mechPlate: '/assets/materials/mech-plate.png',
  glass: '/assets/materials/glass.png'
};

const ambient = new THREE.HemisphereLight('#c8f2e5', '#251c27', 2.2);
scene.add(ambient);
const sun = new THREE.DirectionalLight('#ffd29a', 3.4);
sun.position.set(-30, 60, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const worldRoot = new THREE.Group();
const objectRoot = new THREE.Group();
const playerRoot = new THREE.Group();
const inspectionRoot = new THREE.Group();
scene.add(worldRoot, objectRoot, playerRoot, inspectionRoot);

const records = new Map(manifest.records.map((record) => [record.id, record]));
const meshes = new Map();
const labels = new Map();
const basePositions = new Map(manifest.records.map((record) => [record.id, { ...record.position }]));
const players = new Map();
const materialCache = new Map();
const localPlayer = {
  id: 'LOCAL',
  position: new THREE.Vector3(manifest.spawn.x, manifest.spawn.y, manifest.spawn.z),
  authoritativePosition: new THREE.Vector3(manifest.spawn.x, manifest.spawn.y, manifest.spawn.z),
  hasAuthoritativeState: false,
  lastAuthoritativeAt: 0,
  vehicleId: null,
  speed: 7
};
const worldState = {
  water: 72,
  food: 64,
  morale: 58,
  relayPower: 0,
  mechModules: ['salvage arm', 'arc shield', 'rail driver'],
  mechModuleIndex: 0,
  nextBuildId: 1,
  elapsed: 0,
  lastSnapshotRevision: -1,
  lastEventId: ''
};
let inspection = false;
let selectedId = null;
let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let lastInputSentAt = 0;
let commandSequence = 0;
let lastReadoutCheckAt = -Infinity;
let lastReadoutSignature = '';
let lastWorldAddress = '';
let connectionState = 'offline';
let touchVector = { x: 0, y: 0 };
const keys = new Set();

const HUD_WRITE_INTERVAL_MS = 250;
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const RECONCILIATION_DEAD_ZONE = 0.35;
const RECONCILIATION_HARD_SNAP_DISTANCE = 3.5;
const RECONCILIATION_MAX_CORRECTION_SPEED = 8;
const ui = {
  connection: document.querySelector('#connection'),
  connectButton: document.querySelector('#connect-button'),
  playerCount: document.querySelector('#player-count'),
  water: document.querySelector('#water-readout'),
  food: document.querySelector('#food-readout'),
  morale: document.querySelector('#morale-readout'),
  mech: document.querySelector('#mech-readout'),
  world: document.querySelector('#world-readout'),
  event: document.querySelector('#event-readout')
};

const colors = {
  saltGround: '#8e8b73', weatheredConcrete: '#7b8580', rustedSteel: '#8e4f3c', robotShell: '#5e8b83', undeadBone: '#c4b68a', survivorCloth: '#9b6f4d', mechPlate: '#706e67', glass: '#496f76'
};

function addressFor(position) {
  const column = Math.floor((position.x - grid.origin.x) / grid.cellSize);
  const row = Math.floor((position.z - grid.origin.z) / grid.cellSize);
  const level = Math.max(0, Math.floor(position.y / grid.levelHeight));
  return `L${level}-H${String(column).padStart(2, '0')}-R${String(row).padStart(2, '0')}`;
}

function makeProceduralMaterial(key) {
  if (materialCache.has(key)) return materialCache.get(key);
  const color = colors[key] ?? '#8b8b82';
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 128;
  textureCanvas.height = 128;
  const context = textureCanvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 128, 128);
  context.globalAlpha = 0.18;
  for (let index = 0; index < 180; index += 1) {
    context.fillStyle = index % 3 ? '#101a1a' : '#f9ddb0';
    const x = (index * 37) % 128;
    const y = (index * 71) % 128;
    const size = 1 + (index % 5);
    context.fillRect(x, y, size, size);
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(key === 'survivorCloth' ? 2 : 1.4, key === 'rustedSteel' ? 1.2 : 1.4);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: key === 'glass' ? 0.22 : 0.82, metalness: ['rustedSteel', 'robotShell', 'mechPlate'].includes(key) ? 0.56 : 0.05 });
  material.userData.semanticMaterial = key;
  material.userData.source = 'procedural-bootstrap';
  const generatedTexturePath = textureFiles[key];
  if (generatedTexturePath) {
    textureLoader.load(generatedTexturePath, (generatedTexture) => {
      generatedTexture.colorSpace = THREE.SRGBColorSpace;
      generatedTexture.wrapS = THREE.RepeatWrapping;
      generatedTexture.wrapT = THREE.RepeatWrapping;
      generatedTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
      generatedTexture.repeat.copy(texture.repeat);
      material.map = generatedTexture;
      material.userData.source = `ai-generated:${generatedTexturePath}`;
      material.needsUpdate = true;
    });
  }
  materialCache.set(key, material);
  return material;
}

function makeLabel(text, color = '#7be6d0', scale = 0.8) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 96;
  const context = labelCanvas.getContext('2d');
  context.font = '800 30px ui-monospace, monospace';
  context.fillStyle = color;
  context.strokeStyle = 'rgba(3, 10, 12, .85)';
  context.lineWidth = 8;
  context.strokeText(text, 12, 54);
  context.fillText(text, 12, 54);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(scale * 5.2, scale, 1);
  sprite.userData.labelText = text;
  sprite.userData.labelColor = color;
  sprite.userData.labelScale = scale;
  return sprite;
}

function updateLabel(sprite, text) {
  const texture = sprite?.material?.map;
  const canvas = texture?.image;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '800 30px ui-monospace, monospace';
  context.fillStyle = sprite.userData.labelColor;
  context.strokeStyle = 'rgba(3, 10, 12, .85)';
  context.lineWidth = 8;
  context.strokeText(text, 12, 54);
  context.fillText(text, 12, 54);
  texture.needsUpdate = true;
  sprite.userData.labelText = text;
}

function addPart(group, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function styleAsset(group, record) {
  group.position.set(record.position.x, record.position.y, record.position.z);
  group.name = record.id;
  group.userData.recordId = record.id;
  group.userData.grid = addressFor(record.position);
  group.userData.semanticType = record.semanticType;
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.userData.recordId = record.id;
    child.userData.grid = addressFor(record.position);
    child.userData.semanticType = record.semanticType;
  });
  objectRoot.add(group);
  meshes.set(record.id, group);
  const label = makeLabel(`${record.id} · ${addressFor(record.position)}`, record.category === 'boss' ? '#ff947d' : '#7be6d0', record.category === 'boss' ? 0.95 : 0.62);
  label.position.set(record.position.x, record.position.y + record.size.y / 2 + 1.3, record.position.z);
  label.userData.recordId = record.id;
  labels.set(record.id, label);
  inspectionRoot.add(label);
}

function createStructure(record) {
  const group = new THREE.Group();
  const primary = makeProceduralMaterial(record.materialKey);
  const steel = makeProceduralMaterial('rustedSteel');
  const concrete = makeProceduralMaterial('weatheredConcrete');
  if (record.semanticType === 'radio-tower') {
    addPart(group, new THREE.CylinderGeometry(1.6, 2.1, record.size.y, 8), steel);
    addPart(group, new THREE.CylinderGeometry(0.28, 0.42, record.size.y + 5, 8), steel, [0, 2.5, 0]);
    addPart(group, new THREE.TorusGeometry(1.7, 0.1, 8, 24), makeProceduralMaterial('glass'), [0, 2, 0], [Math.PI / 2, 0, 0]);
    addPart(group, new THREE.TorusGeometry(1.35, 0.08, 8, 24), makeProceduralMaterial('glass'), [0, 5, 0], [Math.PI / 2, 0, 0]);
  } else if (record.semanticType === 'settlement-gate') {
    addPart(group, new THREE.BoxGeometry(1.2, record.size.y, 1.2), concrete, [-2.1, 0, 0]);
    addPart(group, new THREE.BoxGeometry(1.2, record.size.y, 1.2), concrete, [2.1, 0, 0]);
    addPart(group, new THREE.BoxGeometry(5.4, 1.1, 1.2), steel, [0, 1.45, 0]);
    addPart(group, new THREE.BoxGeometry(3.8, 2.3, 0.3), steel, [0, -0.75, 0.15]);
  } else if (record.semanticType === 'water-cistern') {
    addPart(group, new THREE.CylinderGeometry(1.45, 1.55, record.size.y, 20), primary);
    addPart(group, new THREE.TorusGeometry(1.48, 0.08, 8, 24), steel, [0, 0.6, 0], [Math.PI / 2, 0, 0]);
    addPart(group, new THREE.CylinderGeometry(0.3, 0.3, 0.5, 12), makeProceduralMaterial('glass'), [0, 1.9, 0]);
  } else if (record.semanticType === 'food-garden') {
    addPart(group, new THREE.BoxGeometry(record.size.x, 0.55, record.size.z), concrete, [0, -0.45, 0]);
    const soil = makeProceduralMaterial('saltGround');
    for (const x of [-3.5, 0, 3.5]) addPart(group, new THREE.BoxGeometry(2.7, 0.7, 5.8), soil, [x, 0.15, 0]);
    const cloth = makeProceduralMaterial('survivorCloth');
    addPart(group, new THREE.BoxGeometry(record.size.x + 0.8, 0.12, 0.16), cloth, [0, 1.5, -3.4]);
    addPart(group, new THREE.BoxGeometry(record.size.x + 0.8, 0.12, 0.16), cloth, [0, 1.5, 3.4]);
  } else if (record.semanticType === 'mech-bay') {
    addPart(group, new THREE.BoxGeometry(record.size.x, record.size.y, record.size.z), primary, [0, 0, 0]);
    addPart(group, new THREE.BoxGeometry(3.6, 3.8, 0.22), steel, [0, -0.25, record.size.z / 2 + 0.12]);
    addPart(group, new THREE.BoxGeometry(record.size.x + 0.8, 0.28, record.size.z + 0.8), steel, [0, record.size.y / 2 + 0.18, 0]);
  } else {
    addPart(group, new THREE.BoxGeometry(record.size.x, record.size.y, record.size.z), primary);
    addPart(group, new THREE.BoxGeometry(record.size.x * 0.65, record.size.y * 0.18, 0.16), steel, [0, record.size.y * 0.12, record.size.z / 2 + 0.1]);
  }
  styleAsset(group, record);
}

function createRobot(record) {
  const group = new THREE.Group();
  const hostile = record.id.includes('HOSTILE');
  const shell = makeProceduralMaterial('robotShell');
  const steel = makeProceduralMaterial('rustedSteel');
  const glass = makeProceduralMaterial('glass').clone();
  glass.color.set(hostile ? '#d66758' : '#75e2cf');
  glass.emissive.set(hostile ? '#8e2217' : '#124e43');
  glass.emissiveIntensity = 2.1;
  const sx = record.size.x / 1.8;
  const sy = record.size.y / 2.6;
  const sz = record.size.z / 1.8;
  group.scale.set(sx, sy, sz);
  addPart(group, new THREE.BoxGeometry(1.05, 1.1, 0.78), shell, [0, 0.1, 0]);
  addPart(group, new THREE.BoxGeometry(0.78, 0.58, 0.68), steel, [0, 0.93, 0]);
  addPart(group, new THREE.BoxGeometry(0.46, 0.12, 0.08), glass, [0, 0.98, 0.36]);
  addPart(group, new THREE.BoxGeometry(0.18, 0.8, 0.22), shell, [-0.72, 0, 0]);
  addPart(group, new THREE.BoxGeometry(0.18, 0.8, 0.22), shell, [0.72, 0, 0]);
  addPart(group, new THREE.BoxGeometry(0.24, 0.82, 0.24), steel, [-0.32, -0.92, 0]);
  addPart(group, new THREE.BoxGeometry(0.24, 0.82, 0.24), steel, [0.32, -0.92, 0]);
  addPart(group, new THREE.CylinderGeometry(0.11, 0.11, 0.55, 10), glass, [0, 1.42, 0]);
  styleAsset(group, record);
}

function createUndead(record) {
  const group = new THREE.Group();
  const bone = makeProceduralMaterial('undeadBone');
  const cloth = makeProceduralMaterial('survivorCloth');
  const scale = Math.max(record.size.x, record.size.z) / 2.2;
  group.scale.set(scale, record.size.y / 3.4, scale);
  const count = record.semanticType === 'undead-hive' ? 3 : 1;
  for (let index = 0; index < count; index += 1) {
    const offset = count === 1 ? 0 : (index - 1) * 0.58;
    addPart(group, new THREE.CapsuleGeometry(0.34, 0.82, 4, 8), bone, [offset, 0, 0]);
    addPart(group, new THREE.SphereGeometry(0.38, 12, 8), bone, [offset, 0.92, 0]);
    addPart(group, new THREE.CylinderGeometry(0.09, 0.12, 0.85, 8), bone, [offset - 0.42, 0.1, 0], [0, 0, -0.5]);
    addPart(group, new THREE.CylinderGeometry(0.09, 0.12, 0.85, 8), bone, [offset + 0.42, 0.1, 0], [0, 0, 0.5]);
    addPart(group, new THREE.BoxGeometry(0.68, 0.34, 0.5), cloth, [offset, 0.2, 0]);
  }
  styleAsset(group, record);
}

function createVehicle(record) {
  const group = new THREE.Group();
  const steel = makeProceduralMaterial('rustedSteel');
  const cloth = makeProceduralMaterial('survivorCloth');
  const glass = makeProceduralMaterial('glass');
  addPart(group, new THREE.BoxGeometry(record.size.x, 0.62, record.size.z), steel, [0, -0.28, 0]);
  addPart(group, new THREE.BoxGeometry(record.size.x * 0.76, 0.9, record.size.z * 0.45), cloth, [0, 0.35, -0.15]);
  addPart(group, new THREE.BoxGeometry(record.size.x * 0.62, 0.44, record.size.z * 0.22), glass, [0, 0.53, -0.14]);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#15191b', roughness: 0.92, metalness: 0.08 });
  for (const x of [-record.size.x * 0.55, record.size.x * 0.55]) {
    for (const z of [-record.size.z * 0.32, record.size.z * 0.32]) addPart(group, new THREE.CylinderGeometry(0.45, 0.45, 0.35, 16), wheelMaterial, [x, -0.7, z], [0, 0, Math.PI / 2]);
  }
  styleAsset(group, record);
}

function createBoss(record) {
  const group = new THREE.Group();
  const armor = makeProceduralMaterial('mechPlate');
  const shell = makeProceduralMaterial('robotShell');
  const core = makeProceduralMaterial('glass').clone();
  core.color.set('#ff866d');
  core.emissive.set('#a52c1c');
  core.emissiveIntensity = 2.4;
  const scale = new THREE.Vector3(record.size.x / 8, record.size.y / 9, record.size.z / 8);
  group.scale.copy(scale);
  addPart(group, new THREE.BoxGeometry(2.8, 2.8, 1.8), armor, [0, 0.15, 0]);
  addPart(group, new THREE.BoxGeometry(1.35, 1.1, 1.2), shell, [0, 2.15, 0]);
  addPart(group, new THREE.BoxGeometry(0.62, 0.24, 0.12), core, [0, 2.17, 0.62]);
  addPart(group, new THREE.BoxGeometry(0.98, 1.8, 1.2), armor, [-1.95, 0.15, 0]);
  addPart(group, new THREE.BoxGeometry(0.98, 1.8, 1.2), armor, [1.95, 0.15, 0]);
  addPart(group, new THREE.BoxGeometry(0.78, 3.1, 0.95), shell, [-0.82, -2.35, 0]);
  addPart(group, new THREE.BoxGeometry(0.78, 3.1, 0.95), shell, [0.82, -2.35, 0]);
  addPart(group, new THREE.BoxGeometry(0.34, 0.55, 2.2), armor, [0, 0.3, 1.3]);
  styleAsset(group, record);
}

function createAsset(record) {
  if (record.category === 'robot') return createRobot(record);
  if (record.category === 'creature') return createUndead(record);
  if (record.category === 'vehicle') return createVehicle(record);
  if (record.category === 'boss') return createBoss(record);
  return createStructure(record);
}

function createGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 128), makeProceduralMaterial('saltGround'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.08, 0);
  ground.receiveShadow = true;
  ground.name = 'GROUND-SALTGLASS-BASIN';
  worldRoot.add(ground);
}

function createGrid() {
  const size = grid.sceneBounds.max.x - grid.sceneBounds.min.x;
  const divisions = size / grid.cellSize;
  const helper = new THREE.GridHelper(size, divisions, '#78e6d0', '#274d4d');
  helper.position.set((grid.sceneBounds.min.x + grid.sceneBounds.max.x) / 2, 0.02, (grid.sceneBounds.min.z + grid.sceneBounds.max.z) / 2);
  helper.material.transparent = true;
  helper.material.opacity = 0.3;
  helper.material.depthTest = false;
  inspectionRoot.add(helper);
}

function createPlayerMesh(color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.8, 5, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.18 }));
  body.castShadow = true;
  group.add(body);
  const light = new THREE.PointLight(color, 2.2, 7);
  light.position.y = 1.4;
  group.add(light);
  return group;
}

function setPlayerMesh(id, player) {
  if (!players.has(id)) players.set(id, { ...player, mesh: createPlayerMesh(player.color) });
  const entry = players.get(id);
  entry.position = player.position;
  entry.mesh.position.set(player.position.x, player.position.y, player.position.z);
  if (!entry.mesh.parent) playerRoot.add(entry.mesh);
}

function syncLocalPlayerMesh() {
  const local = players.get(localPlayer.id);
  if (local) {
    local.position = {
      x: localPlayer.position.x,
      y: localPlayer.position.y,
      z: localPlayer.position.z
    };
    local.mesh.position.copy(localPlayer.position);
    return;
  }
  setPlayerMesh(localPlayer.id, {
    id: localPlayer.id,
    position: localPlayer.position,
    color: '#7be6d0'
  });
}

function reconcileLocalPlayer(player) {
  if (!player?.position || player.id !== localPlayer.id) return;
  const { x, y, z } = player.position;
  if (![x, y, z].every(Number.isFinite)) return;
  localPlayer.authoritativePosition.set(x, y, z);
  localPlayer.lastAuthoritativeAt = performance.now();
  if (!localPlayer.hasAuthoritativeState) {
    localPlayer.position.copy(localPlayer.authoritativePosition);
    localPlayer.hasAuthoritativeState = true;
    syncLocalPlayerMesh();
    updateWorldReadout(true);
    return;
  }
  if (localPlayer.position.distanceTo(localPlayer.authoritativePosition) > RECONCILIATION_HARD_SNAP_DISTANCE) {
    localPlayer.position.copy(localPlayer.authoritativePosition);
    syncLocalPlayerMesh();
    updateWorldReadout(true);
  }
}

function applyLocalReconciliation(delta) {
  if (!localPlayer.hasAuthoritativeState || performance.now() - localPlayer.lastAuthoritativeAt > 1000) return;
  const correction = localPlayer.authoritativePosition.clone().sub(localPlayer.position);
  correction.y = 0;
  const distance = correction.length();
  if (distance <= RECONCILIATION_DEAD_ZONE) return;
  const step = Math.min(distance - RECONCILIATION_DEAD_ZONE, RECONCILIATION_MAX_CORRECTION_SPEED * delta);
  localPlayer.position.addScaledVector(correction.normalize(), step);
}

function validateWorld() {
  const ids = new Set();
  const issues = [];
  for (const record of records.values()) {
    if (ids.has(record.id)) issues.push(`duplicate ${record.id}`);
    ids.add(record.id);
    if (!record.semanticType || !record.materialKey) issues.push(`incomplete ${record.id}`);
    if (record.position.y - record.size.y / 2 < -0.001) issues.push(`below ground ${record.id}`);
  }
  return { status: issues.length ? 'ISSUES' : 'VALIDATED', issues };
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setPlayerCount(count) {
  setText(ui.playerCount, String(count));
}

function updateSelection(record) {
  selectedId = record?.id ?? null;
  const card = document.querySelector('#selected-card');
  card.hidden = !record;
  if (!record) return;
  document.querySelector('#selected-title').textContent = record.name;
  document.querySelector('#selected-description').textContent = `${record.semanticType} · ${record.category} · ${record.materialParts.join(', ')}`;
  document.querySelector('#selected-id').textContent = record.id;
  document.querySelector('#selected-grid').textContent = addressFor(record.position);
  document.querySelector('#selected-material').textContent = record.materialKey;
}

function updateReadouts(force = false, now = performance.now()) {
  if (!force && now - lastReadoutCheckAt < HUD_WRITE_INTERVAL_MS) return;
  lastReadoutCheckAt = now;
  const values = [
    `${Math.round(worldState.water)}%`,
    `${Math.round(worldState.food)}%`,
    `${Math.round(worldState.morale)}%`,
    worldState.mechModules[worldState.mechModuleIndex].toUpperCase()
  ];
  const signature = values.join('|');
  if (!force && signature === lastReadoutSignature) return;
  lastReadoutSignature = signature;
  setText(ui.water, values[0]);
  setText(ui.food, values[1]);
  setText(ui.morale, values[2]);
  setText(ui.mech, values[3]);
}

function updateWorldReadout(force = false) {
  const address = addressFor(localPlayer.position);
  if (!force && address === lastWorldAddress) return;
  lastWorldAddress = address;
  setText(ui.world, address);
}

function announce(message) {
  setText(ui.event, message);
  showToast(message);
}

function nearestRecord(maxDistance = 7) {
  let closest = null;
  let closestDistance = maxDistance;
  for (const [id, mesh] of meshes) {
    const distance = mesh.position.distanceTo(localPlayer.position);
    if (distance < closestDistance) {
      closest = records.get(id);
      closestDistance = distance;
    }
  }
  return closest;
}

function isCombatTarget(record) {
  return Boolean(record && (
    record.category === 'boss' ||
    record.category === 'creature' ||
    (record.category === 'robot' && (record.semanticType === 'hostile-robot' || record.id.includes('HOSTILE')))
  ));
}

function nearestCombatTarget(maxDistance = 28) {
  let closest = null;
  let closestDistance = maxDistance;
  for (const [id, mesh] of meshes) {
    const record = records.get(id);
    if (!isCombatTarget(record)) continue;
    const distance = mesh.position.distanceTo(localPlayer.position);
    if (distance < closestDistance) {
      closest = record;
      closestDistance = distance;
    }
  }
  return closest;
}

function createCommandId(prefix) {
  commandSequence += 1;
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}-${commandSequence}`;
}

function attackTarget() {
  const selected = selectedId ? records.get(selectedId) : null;
  const target = isCombatTarget(selected) ? selected : nearestCombatTarget();
  if (!target) {
    announce('No hostile robot, undead, or boss is close enough to engage.');
    return;
  }
  updateSelection(target);
  if (target.category === 'boss' && socket?.readyState === WebSocket.OPEN) {
    const bossKey = target.id.includes('RELAY') ? 'relay-warden' : 'foundry-giant';
    socket.send(JSON.stringify({ type: 'command', command: 'boss.start', commandId: createCommandId('boss'), bossId: target.id, bossKey, position: target.position }));
  }
  const idempotencyKey = createCommandId('attack');
  const command = {
    type: 'command',
    command: 'attack',
    commandId: idempotencyKey,
    targetId: target.id,
    targetCategory: target.category,
    targetGrid: addressFor(target.position)
  };
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
  announce(`Engaging ${target.name} at ${addressFor(target.position)}.`);
}

function interact() {
  const record = nearestRecord();
  if (!record) {
    announce('Move within seven meters of a marked object to interact.');
    return;
  }
  updateSelection(record);
  if (record.id === 'RELAY-TOWER-0001') {
    worldState.relayPower = Math.min(100, worldState.relayPower + 25);
    worldState.morale = Math.min(100, worldState.morale + 5);
    document.querySelector('#objective').textContent = worldState.relayPower >= 100
      ? 'The relay is online. Keep the commons supplied and defend the basin.'
      : `Restore the relay station: ${worldState.relayPower}% power.`;
    announce(`Relay station charged to ${worldState.relayPower}%.`);
  } else if (record.category === 'robot' && isCombatTarget(record)) {
    attackTarget();
  } else if (record.category === 'robot') {
    const helpful = record.semanticType === 'friendly-robot';
    worldState.morale = Math.min(100, worldState.morale + (helpful ? 7 : -4));
    worldState.food = Math.min(100, worldState.food + (helpful ? 3 : 0));
    announce(helpful ? `${record.name} accepted a work order and joined the commons.` : `${record.name} marked you as a threat; keep your distance.`);
  } else if (record.category === 'creature') {
    attackTarget();
  } else if (record.category === 'vehicle') {
    if (localPlayer.vehicleId === record.id) {
      socket?.send(JSON.stringify({ type: 'command', command: 'exitVehicle', commandId: createCommandId('exit'), vehicleId: record.id }));
      announce(`Exited ${record.name}.`);
    } else if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'command', command: 'enterVehicle', commandId: createCommandId('enter'), vehicleId: record.id }));
      announce(`Boarding ${record.name}.`);
    } else {
      announce(`${record.name} is ready for a driver after reconnect.`);
    }
  } else if (record.category === 'boss') {
    worldState.morale = Math.max(0, worldState.morale - 3);
    announce(`${record.name} detected. Engage when the team is ready.`);
    if (socket?.readyState === WebSocket.OPEN) {
      const bossKey = record.id.includes('RELAY') ? 'relay-warden' : 'foundry-giant';
      socket.send(JSON.stringify({ type: 'command', command: 'boss.start', commandId: createCommandId('boss'), bossId: record.id, bossKey, position: record.position }));
    }
  } else if (record.semanticType === 'water-cistern') {
    worldState.water = Math.min(100, worldState.water + 12);
    announce(`Cistern recovered. Water reserves are now ${Math.round(worldState.water)}%.`);
  } else if (record.semanticType === 'food-garden') {
    worldState.food = Math.min(100, worldState.food + 10);
    worldState.morale = Math.min(100, worldState.morale + 2);
    announce(`Grow beds tended. Food reserves are now ${Math.round(worldState.food)}%.`);
  } else if (record.semanticType === 'mech-bay') {
    cycleMech();
    announce(`Mech bay ready. Equipped ${worldState.mechModules[worldState.mechModuleIndex]}.`);
  } else {
    announce(`${record.name} is recorded at ${addressFor(record.position)}.`);
  }
  updateReadouts(true);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'command', command: 'interact', commandId: createCommandId('interact'), recordId: record.id }));
}

function buildCommunityModule() {
  const column = Math.floor((localPlayer.position.x - grid.origin.x) / grid.cellSize);
  const row = Math.floor((localPlayer.position.z - grid.origin.z) / grid.cellSize);
  const position = {
    x: grid.origin.x + column * grid.cellSize + grid.cellSize / 2,
    y: 0.8,
    z: grid.origin.z + row * grid.cellSize + grid.cellSize / 2
  };
  const ownerToken = String(localPlayer.id || 'LOCAL').replace(/[^A-Z0-9-]/gi, '').slice(-8) || 'LOCAL';
  const id = `BUILD-${ownerToken}-${String(worldState.nextBuildId).padStart(4, '0')}`;
  worldState.nextBuildId += 1;
  const record = {
    id,
    name: 'Built community module',
    category: 'community',
    semanticType: 'community-module',
    position,
    size: { x: 3.4, y: 1.6, z: 3.4 },
    materialKey: 'survivorCloth',
    solid: true,
    materialParts: ['survivorCloth', 'weatheredConcrete']
  };
  records.set(record.id, record);
  basePositions.set(record.id, { ...record.position });
  createAsset(record);
  const validation = validateWorld();
  document.querySelector('#validation-readout').textContent = validation.status;
  announce(`${record.name} placed at ${addressFor(record.position)}.`);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'command', command: 'build', commandId: createCommandId('build'), record }));
}

function cycleMech() {
  worldState.mechModuleIndex = (worldState.mechModuleIndex + 1) % worldState.mechModules.length;
  updateReadouts(true);
}

function updateRoamingAgents() {
  const labelTick = Math.floor(worldState.elapsed * 4);
  for (const record of records.values()) {
    if (!['robot', 'creature'].includes(record.category) || record.networkControlled) continue;
    const base = basePositions.get(record.id);
    const mesh = meshes.get(record.id);
    if (!base || !mesh) continue;
    const phase = [...record.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 31;
    const radius = record.semanticType === 'undead-hive' ? 1.1 : 1.8;
    const nextPosition = {
      x: base.x + Math.sin(worldState.elapsed * 0.45 + phase) * radius,
      y: base.y,
      z: base.z + Math.cos(worldState.elapsed * 0.36 + phase) * radius
    };
    mesh.position.set(nextPosition.x, nextPosition.y, nextPosition.z);
    record.position = nextPosition;
    mesh.userData.grid = addressFor(nextPosition);
    const label = labels.get(record.id);
    if (label) {
      label.position.set(nextPosition.x, nextPosition.y + record.size.y / 2 + 1.3, nextPosition.z);
      if (labelTick !== worldState.lastLabelTick) updateLabel(label, `${record.id} · ${addressFor(nextPosition)}`);
    }
  }
  worldState.lastLabelTick = labelTick;
}

function updateWorld(delta) {
  worldState.elapsed += delta;
  updateRoamingAgents();
  updateReadouts();
}

function toggleInspection() {
  inspection = !inspection;
  inspectionRoot.visible = inspection;
  document.querySelector('#mode-readout').textContent = inspection ? 'INSPECT' : 'BEAUTY';
  document.querySelector('#inspection-toggle').textContent = inspection ? 'Beauty mode' : 'Inspection mode';
  showToast(inspection ? 'Inspection layer enabled' : 'Beauty layer enabled');
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('visible'), 1800);
}

function setConnectionStatus(state, detail = '') {
  connectionState = state;
  const labels = {
    connected: 'CONNECTED',
    connecting: 'CONNECTING',
    reconnecting: Number.isFinite(detail) ? `RECONNECTING · ${detail}s` : 'RECONNECTING',
    offline: 'OFFLINE',
    paused: 'PAUSED'
  };
  setText(ui.connection, labels[state] ?? String(state).toUpperCase());
  if (ui.connection) {
    ui.connection.dataset.state = state;
    ui.connection.setAttribute('aria-live', 'polite');
    for (const stateName of ['connected', 'connecting', 'reconnecting', 'offline', 'paused']) ui.connection.classList.toggle(stateName, state === stateName);
  }
  const buttonLabels = {
    connected: 'Connected',
    connecting: 'Connecting…',
    reconnecting: 'Retrying…',
    offline: 'Join world',
    paused: 'Resume world'
  };
  setText(ui.connectButton, buttonLabels[state] ?? 'Join world');
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  if (document.hidden) {
    setConnectionStatus('paused');
    return;
  }
  if (navigator.onLine === false) {
    setConnectionStatus('offline');
    return;
  }
  const backoffIndex = Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1);
  const delay = RECONNECT_BACKOFF_MS[backoffIndex];
  reconnectAttempt = Math.min(reconnectAttempt + 1, RECONNECT_BACKOFF_MS.length - 1);
  setConnectionStatus('reconnecting', Math.ceil(delay / 1000));
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function applyPlayerList(list = []) {
  const incoming = new Set();
  for (const player of list) {
    if (!player?.id || !player.position) continue;
    incoming.add(player.id);
    if (player.id === localPlayer.id) {
      localPlayer.vehicleId = player.vehicleId ?? null;
      reconcileLocalPlayer(player);
    }
    else setPlayerMesh(player.id, { ...player, color: player.color ?? '#ffbd69' });
  }
  for (const [id, entry] of players) {
    if (id !== localPlayer.id && !incoming.has(id)) {
      entry.mesh.removeFromParent();
      players.delete(id);
    }
  }
  setPlayerCount(incoming.size || 1);
}

function setEntityPosition(record, position) {
  if (!record || !position) return;
  record.position = { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 };
  const mesh = meshes.get(record.id);
  if (mesh) {
    mesh.position.set(record.position.x, record.position.y, record.position.z);
    mesh.userData.grid = addressFor(record.position);
  }
  const label = labels.get(record.id);
  if (label) {
    label.position.set(record.position.x, record.position.y + record.size.y / 2 + 1.3, record.position.z);
    updateLabel(label, `${record.id} · ${addressFor(record.position)}`);
  }
}

function syncEntityCollection(entities = []) {
  const inactive = new Set(['destroyed', 'dead', 'defeated', 'disabled']);
  for (const entity of entities) {
    const record = records.get(entity.id);
    if (!record) continue;
    record.networkControlled = true;
    setEntityPosition(record, entity.position);
    const visible = !inactive.has(entity.status);
    meshes.get(record.id)?.traverse((child) => { child.visible = visible; });
    const label = labels.get(record.id);
    if (label) label.visible = visible;
  }
}

function syncConstructionCollection(constructions = []) {
  for (const construction of constructions) {
    let record = records.get(construction.id);
    if (!record) {
      record = {
        id: construction.id,
        name: `${construction.blueprint ?? 'community'} module`,
        category: 'community',
        semanticType: `construction-${construction.blueprint ?? 'module'}`,
        position: { x: construction.position?.x ?? 0, y: construction.position?.y ?? 0.8, z: construction.position?.z ?? 0 },
        size: { x: 3.4, y: 1.6, z: 3.4 },
        materialKey: 'survivorCloth',
        materialParts: ['survivorCloth', 'weatheredConcrete'],
        solid: true,
      };
      records.set(record.id, record);
      basePositions.set(record.id, { ...record.position });
      createAsset(record);
    }
    record.networkControlled = true;
    setEntityPosition(record, construction.position);
    const visible = construction.status !== 'destroyed';
    meshes.get(record.id)?.traverse((child) => { child.visible = visible; });
    const label = labels.get(record.id);
    if (label) label.visible = visible;
  }
}

function applySnapshotEvents(snapshot) {
  const latest = snapshot?.events?.at?.(-1);
  if (!latest || latest.eventId === worldState.lastEventId) return;
  worldState.lastEventId = latest.eventId;
  if (latest.type === 'command.rejected') announce(`Action rejected: ${latest.reason}.`);
  if (latest.type === 'construction.completed') announce('Community construction completed.');
  if (latest.type === 'boss.started') announce('Boss encounter active. Target its core.');
  if (latest.type === 'boss.defeated') announce('Boss defeated. The basin is safer.');
  if (latest.type === 'vehicle.boarded') announce('Vehicle boarded. Interact again to exit.');
}

function applySnapshot(snapshot) {
  if (!snapshot || (Number.isFinite(snapshot.revision) && snapshot.revision <= worldState.lastSnapshotRevision)) return;
  if (Number.isFinite(snapshot.revision)) worldState.lastSnapshotRevision = snapshot.revision;
  applyPlayerList(snapshot?.players ?? []);
  syncEntityCollection(snapshot?.robots);
  syncEntityCollection(snapshot?.undead);
  syncEntityCollection(snapshot?.vehicles);
  syncEntityCollection(snapshot?.bosses);
  syncConstructionCollection(snapshot?.constructions);
  const resources = snapshot?.settlement?.resources;
  if (resources) {
    worldState.water = Math.min(100, Number(resources.water ?? worldState.water));
    worldState.food = Math.min(100, Number(resources.food ?? worldState.food));
    if (Number.isFinite(Number(snapshot?.settlement?.morale))) worldState.morale = Math.min(100, Number(snapshot.settlement.morale));
    updateReadouts(true);
  }
  applySnapshotEvents(snapshot);
}

function connect({ manual = false } = {}) {
  if (manual) reconnectAttempt = 0;
  if (document.hidden) {
    setConnectionStatus('paused');
    return;
  }
  if (navigator.onLine === false) {
    setConnectionStatus('offline');
    return;
  }
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const configuredRelayUrl = String(import.meta.env.VITE_RELAY_URL ?? '').trim();
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || 'localhost';
  const relayUrl = configuredRelayUrl || (protocol === 'wss' ? `${protocol}://${host}/api/ws` : `${protocol}://${host}:8787`);
  setConnectionStatus('connecting');
  let clientSocket;
  try {
    clientSocket = new WebSocket(relayUrl);
  } catch {
    socket = null;
    scheduleReconnect();
    return;
  }
  socket = clientSocket;
  clientSocket.addEventListener('open', () => {
    if (socket !== clientSocket) return;
    reconnectAttempt = 0;
    setConnectionStatus(document.hidden ? 'paused' : 'connected');
    showToast('Joined Saltglass Basin');
  });
  clientSocket.addEventListener('message', (event) => {
    if (socket !== clientSocket) return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      localPlayer.id = message.playerId;
      localPlayer.hasAuthoritativeState = false;
      localPlayer.lastAuthoritativeAt = 0;
      worldState.lastSnapshotRevision = -1;
      worldState.lastEventId = '';
      applyPlayerList(message.players ?? []);
      applySnapshot(message.snapshot);
    }
    if (message.type === 'snapshot') {
      applySnapshot(message.snapshot);
    }
    if (message.type === 'players') {
      applyPlayerList(message.players ?? []);
    }
    if (message.type === 'error') {
      announce(`World relay error: ${message.reason ?? 'unknown error'}.`);
    }
  });
  clientSocket.addEventListener('error', () => {
    if (socket !== clientSocket) return;
    setConnectionStatus(document.hidden ? 'paused' : 'reconnecting');
    if (clientSocket.readyState < WebSocket.CLOSING) clientSocket.close();
  });
  clientSocket.addEventListener('close', () => {
    if (socket !== clientSocket) return;
    socket = null;
    localPlayer.hasAuthoritativeState = false;
    if (document.hidden) setConnectionStatus('paused');
    else scheduleReconnect();
  });
}

function sendInput(direction = { x: 0, z: 0 }, force = false) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (!force && now - lastInputSentAt < 50) return;
  lastInputSentAt = now;
  socket.send(JSON.stringify({ type: 'input', direction, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') }));
}

function movePlayer(delta) {
  const keyboardX = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const keyboardZ = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
  const x = keyboardX || touchVector.x;
  const z = keyboardZ || touchVector.y;
  const direction = new THREE.Vector2(x, z);
  if (direction.lengthSq() > 1) direction.normalize();
  localPlayer.position.x = THREE.MathUtils.clamp(localPlayer.position.x + direction.x * localPlayer.speed * delta, grid.sceneBounds.min.x + 2, grid.sceneBounds.max.x - 2);
  localPlayer.position.z = THREE.MathUtils.clamp(localPlayer.position.z + direction.y * localPlayer.speed * delta, grid.sceneBounds.min.z + 2, grid.sceneBounds.max.z - 2);
  applyLocalReconciliation(delta);
  syncLocalPlayerMesh();
  updateWorldReadout();
  sendInput({ x: direction.x, z: direction.y });
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function pick(event) {
  const bounds = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...meshes.values()], true);
  updateSelection(hits[0] ? records.get(hits[0].object.userData.recordId) : null);
}

function updateCamera() {
  const target = localPlayer.position.clone();
  const desired = target.clone().add(new THREE.Vector3(14, 12, 18));
  camera.position.lerp(desired, 0.08);
  camera.lookAt(target.x, target.y + 0.3, target.z);
}

function touchPoint(event) {
  const pad = document.querySelector('#touch-pad');
  const rect = pad.getBoundingClientRect();
  const point = event.touches?.[0] ?? event;
  const dx = point.clientX - (rect.left + rect.width / 2);
  const dy = point.clientY - (rect.top + rect.height / 2);
  const radius = rect.width * 0.39;
  const magnitude = Math.min(1, Math.hypot(dx, dy) / radius);
  const angle = Math.atan2(dy, dx);
  touchVector = { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
  const knob = pad.querySelector('span');
  knob.style.transform = `translate(${touchVector.x * radius}px, ${touchVector.y * radius}px)`;
}

function clearTouch() {
  touchVector = { x: 0, y: 0 };
  document.querySelector('#touch-pad span').style.transform = '';
}

function clearMovementInput() {
  keys.clear();
  clearTouch();
  sendInput({ x: 0, z: 0 }, true);
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearMovementInput();
    setConnectionStatus('paused');
    return;
  }
  if (socket?.readyState === WebSocket.OPEN) setConnectionStatus('connected');
  else scheduleReconnect();
}

createGround();
createGrid();
for (const record of records.values()) createAsset(record);
inspectionRoot.visible = false;
const validation = validateWorld();
document.querySelector('#validation-readout').textContent = validation.status;

window.addEventListener('resize', resize);
window.addEventListener('blur', clearMovementInput);
window.addEventListener('online', () => {
  if (socket?.readyState === WebSocket.OPEN) setConnectionStatus('connected');
  else scheduleReconnect();
});
window.addEventListener('offline', () => {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  setConnectionStatus('offline');
});
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (event.code === 'KeyI') toggleInspection();
  if (event.code === 'KeyE') interact();
  if (event.code === 'KeyB') buildCommunityModule();
  if (event.code === 'KeyM') cycleMech();
  if (event.code === 'KeyF' && !event.repeat) attackTarget();
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
canvas.addEventListener('pointerup', pick);
document.querySelector('#inspection-toggle').addEventListener('click', toggleInspection);
document.querySelector('#touch-inspection').addEventListener('click', toggleInspection);
document.querySelector('#connect-button').addEventListener('click', () => connect({ manual: true }));
document.querySelector('#action-button').addEventListener('click', interact);
document.querySelector('#build-button').addEventListener('click', buildCommunityModule);
document.querySelector('#mech-button').addEventListener('click', cycleMech);
document.querySelector('#attack-button')?.addEventListener('click', attackTarget);
document.querySelector('#clear-selection').addEventListener('click', () => updateSelection(null));
const pad = document.querySelector('#touch-pad');
pad.addEventListener('touchstart', touchPoint, { passive: true });
pad.addEventListener('touchmove', touchPoint, { passive: true });
pad.addEventListener('touchend', clearTouch, { passive: true });

resize();
updateReadouts(true);
updateWorldReadout(true);
connect();
let lastFrame = performance.now();
function animate(now) {
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  movePlayer(delta);
  updateWorld(delta);
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
