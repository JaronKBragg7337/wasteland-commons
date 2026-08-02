import * as THREE from 'three';
import grid from '../world/grid.json';
import manifest from '../world/manifest.json';
import './style.css';

const canvas = document.querySelector('#world');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#101d20');
scene.fog = new THREE.Fog('#101d20', 38, 170);
const worldBounds = {
  minX: grid.sceneBounds.min.x,
  maxX: grid.sceneBounds.max.x,
  minZ: grid.sceneBounds.min.z,
  maxZ: grid.sceneBounds.max.z,
  width: grid.sceneBounds.max.x - grid.sceneBounds.min.x,
  depth: grid.sceneBounds.max.z - grid.sceneBounds.min.z,
  centerX: (grid.sceneBounds.min.x + grid.sceneBounds.max.x) / 2,
  centerZ: (grid.sceneBounds.min.z + grid.sceneBounds.max.z) / 2,
};
const sectorPalette = ['#d8bb79', '#ff947d', '#7be6d0', '#b9a6c9'];
const sectorDefinitions = (manifest.sectors ?? []).map((sector, index) => ({
  id: sector.id,
  name: sector.name,
  color: sectorPalette[index % sectorPalette.length],
  bounds: sector.bounds,
}));

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
const npcRoot = new THREE.Group();
const inspectionRoot = new THREE.Group();
const selectionRoot = new THREE.Group();
const collisionRoot = new THREE.Group();
inspectionRoot.add(collisionRoot);
scene.add(worldRoot, objectRoot, playerRoot, npcRoot, inspectionRoot, selectionRoot);

const records = new Map(manifest.records.map((record) => [record.id, record]));
const meshes = new Map();
const labels = new Map();
const collisionProxies = new Map();
const landmarkTreatments = new Map();
const networkEntities = new Map();
const npcVisuals = new Map();
const sectorLabels = [];
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
  mechId: null,
  speed: 7
};
const worldState = {
  water: 72,
  food: 64,
  morale: 58,
  relayPower: 0,
  power: 65,
  npcCount: 0,
  mechModules: ['salvage arm', 'arc shield', 'rail driver'],
  mechModuleIndex: 0,
  nextBuildId: 1,
  pendingCommands: new Map(),
  elapsed: 0,
  lastSnapshotRevision: -1,
  lastEventId: ''
};
const mechLoadout = [
  { label: 'salvage arm', key: 'impact-tool', slot: 'right-arm' },
  { label: 'arc shield', key: 'shield', slot: 'left-arm' },
  { label: 'rail driver', key: 'ranged-weapon', slot: 'right-arm' }
];
let inspection = false;
let selectedId = null;
let selectedVisual = null;
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
let touchSprinting = false;
const keys = new Set();

const HUD_WRITE_INTERVAL_MS = 250;
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const RECONCILIATION_DEAD_ZONE = 0.35;
const RECONCILIATION_HARD_SNAP_DISTANCE = 3.5;
const RECONCILIATION_MAX_CORRECTION_SPEED = 8;
const RESUME_STORAGE_KEY = 'wasteland-commons:anonymous-resume-v1';
const ui = {
  connection: document.querySelector('#connection'),
  connectButton: document.querySelector('#connect-button'),
  playerCount: document.querySelector('#player-count'),
  water: document.querySelector('#water-readout'),
  food: document.querySelector('#food-readout'),
  morale: document.querySelector('#morale-readout'),
  power: document.querySelector('#power-readout'),
  npcs: document.querySelector('#npc-readout'),
  revision: document.querySelector('#revision-readout'),
  mech: document.querySelector('#mech-readout'),
  world: document.querySelector('#world-readout'),
  sector: document.querySelector('#sector-readout'),
  route: document.querySelector('#route-readout'),
  event: document.querySelector('#event-readout'),
  objective: document.querySelector('#objective')
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

function sectorFor(position) {
  const direct = sectorDefinitions.find((sector) => (
    position.x >= sector.bounds.min.x && position.x <= sector.bounds.max.x &&
    position.z >= sector.bounds.min.z && position.z <= sector.bounds.max.z
  ));
  if (direct) return direct;
  return sectorDefinitions.reduce((nearest, sector) => {
    const centerX = (sector.bounds.min.x + sector.bounds.max.x) / 2;
    const centerZ = (sector.bounds.min.z + sector.bounds.max.z) / 2;
    const distance = Math.hypot(position.x - centerX, position.z - centerZ);
    return distance < nearest.distance ? { sector, distance } : nearest;
  }, { sector: sectorDefinitions[0], distance: Infinity }).sector;
}

function routeFor(position) {
  const route = manifest.records
    .filter((record) => record.category === 'route')
    .map((record) => {
      const dx = Math.max(Math.abs(position.x - record.position.x) - record.size.x / 2, 0);
      const dz = Math.max(Math.abs(position.z - record.position.z) - record.size.z / 2, 0);
      return { record, distance: Math.hypot(dx, dz) };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return route && route.distance <= grid.cellSize * 1.15 ? route.record.name.toUpperCase() : 'OFF-ROAD';
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
  labelCanvas.width = 640;
  labelCanvas.height = 128;
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(scale * 5.6, scale * 1.1, 1);
  sprite.userData.labelColor = color;
  sprite.userData.labelScale = scale;
  updateLabel(sprite, text);
  return sprite;
}

function updateLabel(sprite, text) {
  const texture = sprite?.material?.map;
  const canvas = texture?.image;
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const [primary, secondary = ''] = text.split(' · ');
  context.fillStyle = 'rgba(3, 10, 12, .86)';
  context.strokeStyle = 'rgba(123, 230, 208, .22)';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 16);
  context.fill();
  context.stroke();
  context.font = '800 23px ui-monospace, monospace';
  context.fillStyle = sprite.userData.labelColor;
  context.fillText(primary.slice(0, 31), 24, 48);
  context.font = '700 27px ui-monospace, monospace';
  context.fillStyle = '#dffaf2';
  context.fillText((secondary || primary).slice(0, 27), 24, 91);
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
  const collisionProxy = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(record.size.x, record.size.y, record.size.z)),
    new THREE.LineBasicMaterial({ color: record.solid ? '#ffbd69' : '#7be6d0', transparent: true, opacity: 0.72, depthTest: false })
  );
  collisionProxy.position.set(record.position.x, record.position.y, record.position.z);
  collisionProxy.name = `${record.id}::collision-proxy`;
  collisionProxy.userData.recordId = record.id;
  collisionProxy.userData.grid = addressFor(record.position);
  collisionRoot.add(collisionProxy);
  collisionProxies.set(record.id, collisionProxy);
  createLandmarkTreatment(record);
  const labelColor = record.category === 'boss' ? '#ff947d' : record.category === 'mech' ? '#ffbd69' : '#7be6d0';
  const label = makeLabel(`${record.id} · ${addressFor(record.position)}`, labelColor, record.category === 'boss' ? 0.95 : record.category === 'mech' ? 0.86 : 0.62);
  label.position.set(record.position.x, record.position.y + record.size.y / 2 + 1.3, record.position.z);
  label.userData.recordId = record.id;
  labels.set(record.id, label);
  inspectionRoot.add(label);
}

function createLandmarkTreatment(record) {
  const landmarkTypes = new Set(['radio-tower', 'settlement-gate', 'water-cistern', 'food-garden', 'mech-bay', 'field-outpost']);
  if (record.category !== 'landmark' && record.category !== 'outpost' && record.category !== 'boss' && !landmarkTypes.has(record.semanticType)) return;
  const color = record.category === 'boss' ? '#ff806c' : record.semanticType === 'mech-bay' ? '#ffbd69' : '#7be6d0';
  const treatment = new THREE.Group();
  treatment.position.set(record.position.x, record.position.y, record.position.z);
  treatment.userData.recordId = record.id;
  const radius = Math.max(record.size.x, record.size.z) * 0.62 + 1.2;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.78, radius, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -record.size.y / 2 + 0.1;
  ring.userData.pulsePhase = [...record.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 17;
  treatment.add(ring);
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, record.category === 'boss' ? 4.5 : 2.4, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: record.category === 'boss' ? 0.24 : 0.14, depthWrite: false })
  );
  beacon.position.y = record.category === 'boss' ? 2.4 : 1.3;
  treatment.add(beacon);
  worldRoot.add(treatment);
  landmarkTreatments.set(record.id, { treatment, ring, beacon });
}

function updateSelectionVisual(record) {
  selectedVisual?.removeFromParent();
  selectedVisual = null;
  if (!record) return;
  const color = record.category === 'boss' ? '#ff947d' : record.category === 'mech' ? '#ffbd69' : '#7be6d0';
  const visual = new THREE.Group();
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(record.size.x + 0.8, record.size.y + 0.8, record.size.z + 0.8)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false })
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(record.size.x, record.size.z) * 0.54, Math.max(record.size.x, record.size.z) * 0.61, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthTest: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -record.size.y / 2 + 0.14;
  visual.add(frame, ring);
  visual.userData.recordId = record.id;
  selectionRoot.add(visual);
  selectedVisual = visual;
  syncSelectionVisual();
}

function syncSelectionVisual() {
  if (!selectedVisual || !selectedId) return;
  const mesh = meshes.get(selectedId);
  if (mesh) selectedVisual.position.copy(mesh.position);
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

function createMech(record) {
  const group = new THREE.Group();
  const armor = makeProceduralMaterial('mechPlate');
  const shell = makeProceduralMaterial('robotShell');
  const core = makeProceduralMaterial('glass').clone();
  core.color.set('#7be6d0');
  core.emissive.set('#176c5d');
  core.emissiveIntensity = 2.8;
  const scale = new THREE.Vector3(record.size.x / 6, record.size.y / 8, record.size.z / 6);
  group.scale.copy(scale);
  addPart(group, new THREE.BoxGeometry(2.4, 2.7, 1.7), armor, [0, 0.25, 0]);
  addPart(group, new THREE.BoxGeometry(1.2, 1.15, 1.1), shell, [0, 2.15, 0]);
  addPart(group, new THREE.BoxGeometry(0.62, 0.24, 0.12), core, [0, 2.15, 0.58]);
  addPart(group, new THREE.BoxGeometry(0.82, 1.8, 1.05), armor, [-1.7, 0.25, 0]);
  addPart(group, new THREE.BoxGeometry(0.82, 1.8, 1.05), armor, [1.7, 0.25, 0]);
  addPart(group, new THREE.BoxGeometry(0.62, 2.7, 0.8), shell, [-0.72, -2.25, 0]);
  addPart(group, new THREE.BoxGeometry(0.62, 2.7, 0.8), shell, [0.72, -2.25, 0]);
  addPart(group, new THREE.CylinderGeometry(0.2, 0.2, 1.2, 12), core, [0, 0.2, 0.94], [Math.PI / 2, 0, 0]);
  styleAsset(group, record);
}

function createAsset(record) {
  if (record.category === 'robot') return createRobot(record);
  if (record.category === 'creature') return createUndead(record);
  if (record.category === 'vehicle') return createVehicle(record);
  if (record.category === 'boss') return createBoss(record);
  if (record.category === 'mech') return createMech(record);
  return createStructure(record);
}

function createGround() {
  const groundMaterial = makeProceduralMaterial('saltGround').clone();
  groundMaterial.map?.repeat.set(Math.max(2, worldBounds.width / 48), Math.max(2, worldBounds.depth / 48));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(worldBounds.width, worldBounds.depth), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(worldBounds.centerX, -0.08, worldBounds.centerZ);
  ground.receiveShadow = true;
  ground.name = 'GROUND-SALTGLASS-BASIN';
  worldRoot.add(ground);
}

function createGrid() {
  const vertices = [];
  for (let x = worldBounds.minX; x <= worldBounds.maxX; x += grid.cellSize) vertices.push(x, 0.02, worldBounds.minZ, x, 0.02, worldBounds.maxZ);
  for (let z = worldBounds.minZ; z <= worldBounds.maxZ; z += grid.cellSize) vertices.push(worldBounds.minX, 0.02, z, worldBounds.maxX, 0.02, z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const helper = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#78e6d0', transparent: true, opacity: 0.3, depthTest: false }));
  inspectionRoot.add(helper);
}

function createWorldDressing() {
  for (const sector of sectorDefinitions) {
    const sectorWidth = sector.bounds.max.x - sector.bounds.min.x;
    const sectorDepth = sector.bounds.max.z - sector.bounds.min.z;
    const centerX = (sector.bounds.min.x + sector.bounds.max.x) / 2;
    const centerZ = (sector.bounds.min.z + sector.bounds.max.z) / 2;
    const wash = new THREE.Mesh(
      new THREE.PlaneGeometry(sectorWidth - 2.4, sectorDepth - 2.4),
      new THREE.MeshBasicMaterial({ color: sector.color, transparent: true, opacity: 0.045, depthWrite: false })
    );
    wash.rotation.x = -Math.PI / 2;
    wash.position.set(centerX, -0.045, centerZ);
    worldRoot.add(wash);

    const sectorBorder = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(centerX - sectorWidth / 2 + 1.2, 0.01, centerZ - sectorDepth / 2 + 1.2),
        new THREE.Vector3(centerX + sectorWidth / 2 - 1.2, 0.01, centerZ - sectorDepth / 2 + 1.2),
        new THREE.Vector3(centerX + sectorWidth / 2 - 1.2, 0.01, centerZ + sectorDepth / 2 - 1.2),
        new THREE.Vector3(centerX - sectorWidth / 2 + 1.2, 0.01, centerZ + sectorDepth / 2 - 1.2)
      ]),
      new THREE.LineBasicMaterial({ color: sector.color, transparent: true, opacity: 0.16, depthTest: false })
    );
    worldRoot.add(sectorBorder);

    const label = makeLabel(`SECTOR · ${sector.name ?? sector.id}`, sector.color, 0.5);
    label.position.set(centerX, 0.28, centerZ);
    label.userData.sectorId = sector.id;
    sectorLabels.push(label);
    inspectionRoot.add(label);
  }

  const routeMaterial = new THREE.MeshBasicMaterial({ color: '#d0a671', transparent: true, opacity: 0.16, depthWrite: false });
  const routeEdgeMaterial = new THREE.MeshBasicMaterial({ color: '#f0c27b', transparent: true, opacity: 0.3, depthWrite: false });
  const routeRecords = manifest.records.filter((record) => record.category === 'route');
  for (const route of routeRecords) {
    const routeMesh = new THREE.Mesh(new THREE.PlaneGeometry(route.size.x, route.size.z), routeMaterial);
    routeMesh.rotation.x = -Math.PI / 2;
    routeMesh.position.set(route.position.x, -0.03, route.position.z);
    worldRoot.add(routeMesh);
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(route.size.x + 0.28, route.size.z + 0.28), routeEdgeMaterial);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(route.position.x, -0.025, route.position.z);
    worldRoot.add(edge);
    const label = makeLabel(`ROUTE · ${route.name}`, '#f0c27b', 0.46);
    label.position.set(route.position.x, 0.25, route.position.z);
    sectorLabels.push(label);
    inspectionRoot.add(label);
  }
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

const npcRoleColors = {
  grower: '#9ed27b',
  scavenger: '#e2ae70',
  mechanic: '#7bc7e6',
  medic: '#f19c9c',
  builder: '#d4b77a',
  guard: '#c99cff'
};

function createNpcMesh(npc) {
  const color = npcRoleColors[npc.role] ?? '#b6c7c2';
  const group = new THREE.Group();
  group.name = npc.id;
  group.userData.npcId = npc.id;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.78, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.08 })
  );
  body.position.y = 0.52;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 8),
    new THREE.MeshStandardMaterial({ color: '#d1a884', roughness: 0.85 })
  );
  head.position.y = 1.35;
  head.castShadow = true;
  const roleMarker = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.36, 0.12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
  );
  roleMarker.position.set(0.48, 0.7, 0);
  roleMarker.castShadow = true;
  group.add(body, head, roleMarker);
  npcRoot.add(group);
  const label = makeLabel(`${npc.id} · ${String(npc.role ?? 'worker').toUpperCase()}`, color, 0.52);
  inspectionRoot.add(label);
  return { mesh: group, label };
}

function syncNpcCollection(npcs = []) {
  const incoming = new Set();
  let activeCount = 0;
  for (const npc of npcs) {
    if (!npc?.id || !npc.position) continue;
    incoming.add(npc.id);
    networkEntities.set(npc.id, npc);
    let visual = npcVisuals.get(npc.id);
    if (!visual) {
      visual = createNpcMesh(npc);
      npcVisuals.set(npc.id, visual);
    }
    const position = npc.position;
    visual.mesh.position.set(position.x, position.y, position.z);
    visual.mesh.visible = !['dead', 'injured', 'unavailable'].includes(npc.status);
    visual.label.position.set(position.x, position.y + 2.2, position.z);
    visual.label.visible = inspection && visual.mesh.visible;
    updateLabel(visual.label, `${npc.id} · ${String(npc.role ?? 'worker').toUpperCase()}`);
    if (npc.status === 'working' || npc.status === 'resting' || npc.status === 'traveling') activeCount += 1;
  }
  for (const [id, visual] of npcVisuals) {
    if (incoming.has(id)) continue;
    visual.mesh.visible = false;
    visual.label.visible = false;
  }
  worldState.npcCount = activeCount;
  setText(ui.npcs, `${activeCount} ACTIVE`);
}

function setPlayerMesh(id, player) {
  if (!players.has(id)) players.set(id, { ...player, mesh: createPlayerMesh(player.color) });
  const entry = players.get(id);
  entry.status = player.status ?? 'active';
  entry.health = player.health;
  entry.maxHealth = player.maxHealth;
  entry.position = player.position;
  entry.mesh.position.set(player.position.x, player.position.y, player.position.z);
  entry.mesh.visible = entry.status === 'active';
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
    local.mesh.visible = local.status === 'active' && !localPlayer.mechId;
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
    if (record.position.x - record.size.x / 2 < grid.sceneBounds.min.x || record.position.x + record.size.x / 2 > grid.sceneBounds.max.x || record.position.z - record.size.z / 2 < grid.sceneBounds.min.z || record.position.z + record.size.z / 2 > grid.sceneBounds.max.z) {
      issues.push(`collision outside scene bounds ${record.id}`);
    }
  }
  return { status: issues.length ? 'ISSUES' : 'VALIDATED', issues };
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setPlayerCount(count) {
  setText(ui.playerCount, String(count));
}

function stateForRecord(record) {
  if (!record) return null;
  return networkEntities.get(record.id) ?? null;
}

function refreshSelectedReadout() {
  if (!selectedId) return;
  const record = records.get(selectedId);
  if (!record) return;
  const state = stateForRecord(record);
  const status = state?.status ?? (record.category === 'structure' || record.category === 'landmark' ? 'STATIC' : 'READY');
  const health = Number.isFinite(Number(state?.health))
    ? `${Math.max(0, Math.round(Number(state.health)))}/${Math.max(1, Math.round(Number(state.maxHealth ?? state.health)))}`
    : state?.progress !== undefined
      ? `${Math.round((Number(state.progress) / Math.max(1, Number(state.buildTicks ?? state.progress))) * 100)}%`
      : '—';
  setText(document.querySelector('#selected-status'), String(status).toUpperCase());
  setText(document.querySelector('#selected-health'), health);
  setText(document.querySelector('#selected-grid'), addressFor(record.position));
  setText(document.querySelector('#selected-sector'), sectorFor(record.position).id);
}

function updateSelection(record) {
  selectedId = record?.id ?? null;
  updateSelectionVisual(record);
  const card = document.querySelector('#selected-card');
  card.hidden = !record;
  if (!record) {
    card.removeAttribute('aria-label');
    return;
  }
  document.querySelector('#selected-title').textContent = record.name;
  document.querySelector('#selected-description').textContent = `${record.semanticType} · ${record.category} · ${record.materialParts.join(', ')}`;
  document.querySelector('#selected-id').textContent = record.id;
  document.querySelector('#selected-grid').textContent = addressFor(record.position);
  document.querySelector('#selected-sector').textContent = sectorFor(record.position).id;
  document.querySelector('#selected-material').textContent = record.materialKey;
  card.setAttribute('aria-label', `Selected ${record.name}, ${addressFor(record.position)}`);
  refreshSelectedReadout();
}

function updateReadouts(force = false, now = performance.now()) {
  if (!force && now - lastReadoutCheckAt < HUD_WRITE_INTERVAL_MS) return;
  lastReadoutCheckAt = now;
  const values = [
    `${Math.round(worldState.water)}%`,
    `${Math.round(worldState.food)}%`,
    `${Math.round(worldState.morale)}%`,
    worldState.mechModules[worldState.mechModuleIndex].toUpperCase(),
    String(Math.round(worldState.power)),
    `${worldState.npcCount} ACTIVE`,
    worldState.lastSnapshotRevision >= 0 ? String(worldState.lastSnapshotRevision) : 'LOCAL'
  ];
  const signature = values.join('|');
  if (!force && signature === lastReadoutSignature) return;
  lastReadoutSignature = signature;
  setText(ui.water, values[0]);
  setText(ui.food, values[1]);
  setText(ui.morale, values[2]);
  setText(ui.mech, values[3]);
  setText(ui.power, values[4]);
  setText(ui.npcs, values[5]);
  setText(ui.revision, values[6]);
}

function updateWorldReadout(force = false) {
  const address = addressFor(localPlayer.position);
  if (!force && address === lastWorldAddress) return;
  lastWorldAddress = address;
  setText(ui.world, address);
  setText(ui.sector, sectorFor(localPlayer.position).id);
  setText(ui.route, routeFor(localPlayer.position));
}

function announce(message) {
  setText(ui.event, message);
  showToast(message);
}

function relayIsOnline(snapshot) {
  return snapshot?.settlement?.systems?.signal === true;
}

function updateObjectiveFromSnapshot(snapshot) {
  if (!ui.objective || !snapshot?.settlement) return;
  ui.objective.textContent = relayIsOnline(snapshot)
    ? 'The relay is online. Keep the commons supplied and defend the basin.'
    : 'Find the old relay station and bring the commons back online.';
  worldState.relayPower = relayIsOnline(snapshot) ? 100 : 0;
}

function sendAuthoritativeCommand(message, pendingMessage = 'Command queued for the world relay.') {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    announce('The world relay is offline. Reconnect before changing the commons.');
    return false;
  }
  if (message?.commandId) worldState.pendingCommands.set(String(message.commandId), pendingMessage);
  socket.send(JSON.stringify(message));
  announce(pendingMessage);
  return true;
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
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    announce('The world relay is offline. Reconnect before engaging a target.');
    return;
  }
  if (target.category === 'boss') {
    const bossKey = target.id.includes('RELAY') ? 'relay-warden' : 'foundry-giant';
    sendAuthoritativeCommand({ type: 'command', command: 'boss.start', commandId: createCommandId('boss'), bossId: target.id, bossKey, position: target.position }, `Preparing the ${target.name} encounter.`);
    return;
  }
  if (localPlayer.mechId) {
    sendAuthoritativeCommand({
      type: 'command', command: 'mech.activate', commandId: createCommandId('mech-attack'),
      mechId: localPlayer.mechId, action: 'attack', targetId: target.id
    }, `Mech weapon queued against ${target.name} at ${addressFor(target.position)}.`);
    return;
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
  sendAuthoritativeCommand(command, `Engaging ${target.name} at ${addressFor(target.position)}.`);
}

function interact() {
  const record = nearestRecord();
  if (!record) {
    announce('Move within seven meters of a marked object to interact.');
    return;
  }
  updateSelection(record);
  if (record.category === 'robot' && isCombatTarget(record)) {
    attackTarget();
  } else if (record.category === 'robot') {
    sendAuthoritativeCommand({ type: 'command', command: 'interact', commandId: createCommandId('interact'), recordId: record.id }, `Requesting a work order from ${record.name}.`);
  } else if (record.category === 'creature') {
    attackTarget();
  } else if (record.category === 'vehicle') {
    if (localPlayer.vehicleId === record.id) {
      sendAuthoritativeCommand({ type: 'command', command: 'exitVehicle', commandId: createCommandId('exit'), vehicleId: record.id }, `Exiting ${record.name}.`);
    } else {
      sendAuthoritativeCommand({ type: 'command', command: 'enterVehicle', commandId: createCommandId('enter'), vehicleId: record.id }, `Boarding ${record.name}.`);
    }
  } else if (record.category === 'mech') {
    cycleMech(record);
  } else if (record.category === 'boss') {
    const bossKey = record.id.includes('RELAY') ? 'relay-warden' : 'foundry-giant';
    sendAuthoritativeCommand({ type: 'command', command: 'boss.start', commandId: createCommandId('boss'), bossId: record.id, bossKey, position: record.position }, `${record.name} detected. Preparing the encounter.`);
  } else if (record.semanticType === 'mech-bay') {
    cycleMech();
  } else {
    sendAuthoritativeCommand({ type: 'command', command: 'interact', commandId: createCommandId('interact'), recordId: record.id }, `Interacting with ${record.name} at ${addressFor(record.position)}.`);
  }
}

function buildCommunityModule() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    announce('The world relay is offline. Reconnect before building in the commons.');
    return;
  }
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
  sendAuthoritativeCommand({ type: 'command', command: 'build', commandId: createCommandId('build'), record }, `Building request queued at ${addressFor(record.position)}.`);
}

function cycleMech(nearestMech = null) {
  worldState.mechModuleIndex = (worldState.mechModuleIndex + 1) % worldState.mechModules.length;
  updateReadouts(true);
  const mech = nearestMech ?? [...records.values()]
    .filter((record) => record.category === 'mech')
    .sort((a, b) => a.position.x ** 2 + a.position.z ** 2 - (b.position.x ** 2 + b.position.z ** 2))[0];
  if (!mech || !socket || socket.readyState !== WebSocket.OPEN) {
    announce(`Mech loadout: ${worldState.mechModules[worldState.mechModuleIndex]}.`);
    return;
  }
  const distance = meshes.get(mech.id)?.position.distanceTo(localPlayer.position) ?? Infinity;
  if (distance > 8 && localPlayer.mechId !== mech.id) {
    announce(`Move within eight meters of ${mech.name} to pilot it.`);
    return;
  }
  if (localPlayer.mechId === mech.id) {
    sendAuthoritativeCommand({ type: 'command', command: 'mech.unpilot', commandId: createCommandId('mech-unpilot'), mechId: mech.id }, 'Exiting the modular mech suit.');
    return;
  }
  sendAuthoritativeCommand({ type: 'command', command: 'mech.pilot', commandId: createCommandId('mech-pilot'), mechId: mech.id }, `Boarding ${mech.name}.`);
  sendAuthoritativeCommand({
    type: 'command', command: 'mech.installModule', commandId: createCommandId('mech-module'),
    mechId: mech.id, moduleKey: mechLoadout[worldState.mechModuleIndex].key, slot: mechLoadout[worldState.mechModuleIndex].slot
  }, `Installing ${worldState.mechModules[worldState.mechModuleIndex]}.`);
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
    const collisionProxy = collisionProxies.get(record.id);
    if (collisionProxy) {
      collisionProxy.position.set(nextPosition.x, nextPosition.y, nextPosition.z);
      collisionProxy.userData.grid = addressFor(nextPosition);
    }
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
  syncSelectionVisual();
  if (selectedId) {
    const selected = records.get(selectedId);
    if (selected) {
      setText(document.querySelector('#selected-grid'), addressFor(selected.position));
      setText(document.querySelector('#selected-sector'), sectorFor(selected.position).id);
    }
  }
  for (const { ring, beacon } of landmarkTreatments.values()) {
    const phase = ring.userData.pulsePhase ?? 0;
    const pulse = 0.82 + Math.sin(worldState.elapsed * 1.5 + phase) * 0.18;
    ring.material.opacity = 0.22 * pulse;
    beacon.material.opacity = 0.14 * pulse;
  }
  updateReadouts();
}

function toggleInspection() {
  inspection = !inspection;
  inspectionRoot.visible = inspection;
  document.querySelector('#mode-readout').textContent = inspection ? 'INSPECT' : 'BEAUTY';
  document.querySelector('#inspection-toggle').textContent = inspection ? 'Beauty mode' : 'Inspection mode';
  document.querySelector('#inspection-toggle').setAttribute('aria-pressed', String(inspection));
  setText(document.querySelector('#inspection-hint'), inspection
    ? 'INSPECT · grid cells, sector routes, IDs, and selectable bounds are visible.'
    : 'BEAUTY · explore the basin, then switch modes to see the spatial layer.');
  document.body.classList.toggle('inspection-active', inspection);
  for (const visual of npcVisuals.values()) visual.label.visible = inspection && visual.mesh.visible;
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

function readResumeState() {
  try {
    const value = globalThis.sessionStorage?.getItem(RESUME_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    if (!parsed?.playerId || !parsed?.resumeToken) return null;
    return { playerId: String(parsed.playerId), resumeToken: String(parsed.resumeToken) };
  } catch {
    return null;
  }
}

function storeResumeState(message) {
  if (!message?.playerId || !message?.resumeToken) return;
  try {
    globalThis.sessionStorage?.setItem(RESUME_STORAGE_KEY, JSON.stringify({
      playerId: message.playerId,
      resumeToken: message.resumeToken,
    }));
  } catch {
    // Private browsing and native webviews may deny session storage; the relay
    // still provides a normal anonymous session in that case.
  }
}

function relayUrlWithResume(relayUrl) {
  const resume = readResumeState();
  if (!resume) return relayUrl;
  const separator = relayUrl.includes('?') ? '&' : '?';
  return `${relayUrl}${separator}playerId=${encodeURIComponent(resume.playerId)}&resumeToken=${encodeURIComponent(resume.resumeToken)}&lastRevision=${encodeURIComponent(worldState.lastSnapshotRevision)}`;
}

function applyPlayerList(list = []) {
  const incoming = new Set();
  let activeCount = 0;
  for (const player of list) {
    if (!player?.id || !player.position) continue;
    incoming.add(player.id);
    networkEntities.set(player.id, player);
    if ((player.status ?? 'active') === 'active') activeCount += 1;
    if (player.id === localPlayer.id) {
      localPlayer.vehicleId = player.vehicleId ?? null;
      localPlayer.mechId = player.mechId ?? null;
      reconcileLocalPlayer(player);
      setPlayerMesh(player.id, { ...player, color: player.color ?? '#7be6d0' });
    } else {
      setPlayerMesh(player.id, { ...player, color: player.color ?? '#ffbd69' });
      const remote = players.get(player.id);
      if (remote) remote.mesh.visible = player.status === 'active' && !player.mechId;
    }
  }
  for (const [id, entry] of players) {
    if (id !== localPlayer.id && !incoming.has(id)) {
      entry.mesh.removeFromParent();
      players.delete(id);
    }
  }
  setPlayerCount(activeCount || (incoming.size ? 0 : 1));
}

function setEntityPosition(record, position) {
  if (!record || !position) return;
  record.position = { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 };
  const mesh = meshes.get(record.id);
  if (mesh) {
    mesh.position.set(record.position.x, record.position.y, record.position.z);
    mesh.userData.grid = addressFor(record.position);
  }
  const collisionProxy = collisionProxies.get(record.id);
  if (collisionProxy) {
    collisionProxy.position.set(record.position.x, record.position.y, record.position.z);
    collisionProxy.userData.grid = addressFor(record.position);
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
    networkEntities.set(entity.id, entity);
    record.networkControlled = true;
    setEntityPosition(record, entity.position);
    const visible = !inactive.has(entity.status);
    meshes.get(record.id)?.traverse((child) => { child.visible = visible; });
    if (collisionProxies.has(record.id)) collisionProxies.get(record.id).visible = visible;
    const label = labels.get(record.id);
    if (label) label.visible = visible;
  }
  refreshSelectedReadout();
}

function ensureMechRecord(entity) {
  if (!entity?.id) return null;
  let record = records.get(entity.id);
  if (!record) {
    record = {
      id: entity.id,
      name: 'Modular pilotable mech',
      category: 'mech',
      semanticType: 'modular-mech-suit',
      position: { x: entity.position?.x ?? 0, y: entity.position?.y ?? 4, z: entity.position?.z ?? 0 },
      size: { x: 6, y: 8, z: 6 },
      materialKey: 'mechPlate',
      materialParts: ['mechPlate', 'robotShell', 'glass'],
      solid: false,
    };
    records.set(record.id, record);
    basePositions.set(record.id, { ...record.position });
    createAsset(record);
  }
  return record;
}

function syncMechCollection(mechs = []) {
  const inactive = new Set(['destroyed', 'disabled']);
  const incoming = new Set();
  for (const entity of mechs) {
    const record = ensureMechRecord(entity);
    if (!record) continue;
    incoming.add(record.id);
    networkEntities.set(entity.id, entity);
    record.networkControlled = true;
    setEntityPosition(record, entity.position);
    const visible = !inactive.has(entity.status);
    meshes.get(record.id)?.traverse((child) => { child.visible = visible; });
    if (collisionProxies.has(record.id)) collisionProxies.get(record.id).visible = visible;
    const label = labels.get(record.id);
    if (label) label.visible = visible;
    if (entity.pilotId === localPlayer.id) localPlayer.mechId = entity.id;
  }
  for (const record of records.values()) {
    if (record.category !== 'mech' || incoming.has(record.id)) continue;
    const label = labels.get(record.id);
    if (label) label.visible = false;
    meshes.get(record.id)?.traverse((child) => { child.visible = false; });
  }
  refreshSelectedReadout();
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
    networkEntities.set(construction.id, construction);
    setEntityPosition(record, construction.position);
    const visible = construction.status !== 'destroyed';
    meshes.get(record.id)?.traverse((child) => { child.visible = visible; });
    if (collisionProxies.has(record.id)) collisionProxies.get(record.id).visible = visible;
    const label = labels.get(record.id);
    if (label) label.visible = visible;
  }
  refreshSelectedReadout();
}

function applySnapshotEvents(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  for (const event of events) {
    const commandId = event?.commandId ? String(event.commandId) : '';
    if (commandId && worldState.pendingCommands.has(commandId)) {
      worldState.pendingCommands.delete(commandId);
      if (event.type === 'command.rejected') announce(`Action rejected: ${event.reason}.`);
      else if (event.type === 'construction.placed') announce('Community construction accepted by the relay.');
      else if (event.type === 'settlement.interacted') announce('Settlement update confirmed by the relay.');
      else if (event.type === 'mech.piloted') announce('Mech pilot authority confirmed.');
      else if (event.type === 'mech.unpiloted') announce('Mech exit confirmed.');
      else if (event.type === 'mech.moduleInstalled') announce('Mech module installation confirmed.');
      else if (event.type === 'vehicle.boarded') announce('Vehicle boarded.');
      else if (event.type === 'vehicle.exited') announce('Vehicle exit confirmed.');
      continue;
    }
    if (event?.eventId && event.eventId === worldState.lastEventId) continue;
    if (event?.eventId) worldState.lastEventId = event.eventId;
    if (event.type === 'construction.completed') announce('Community construction completed.');
    if (event.type === 'boss.started') announce('Boss encounter active. Target its core.');
    if (event.type === 'boss.defeated') announce('Boss defeated. The basin is safer.');
  }
}

function applyCommandAcknowledgement(message) {
  const commandId = String(message?.commandId ?? '');
  if (!commandId || !worldState.pendingCommands.has(commandId)) return;
  if (message.state === 'rejected') {
    worldState.pendingCommands.delete(commandId);
    announce(`Action rejected: ${message.reason ?? 'the relay refused the command'}.`);
  }
}

function applySnapshot(snapshot) {
  if (!snapshot || (Number.isFinite(snapshot.revision) && snapshot.revision <= worldState.lastSnapshotRevision)) return;
  if (Number.isFinite(snapshot.revision)) worldState.lastSnapshotRevision = snapshot.revision;
  applyPlayerList(snapshot?.players ?? []);
  syncNpcCollection(snapshot?.npcs ?? []);
  syncEntityCollection(snapshot?.robots);
  syncEntityCollection(snapshot?.undead);
  syncEntityCollection(snapshot?.vehicles);
  syncEntityCollection(snapshot?.bosses);
  syncMechCollection(snapshot?.mechs);
  syncConstructionCollection(snapshot?.constructions);
  const resources = snapshot?.settlement?.resources;
  if (resources) {
    if (Number.isFinite(Number(resources.water))) worldState.water = Math.min(100, Math.max(0, Number(resources.water)));
    if (Number.isFinite(Number(resources.food))) worldState.food = Math.min(100, Math.max(0, Number(resources.food)));
    if (Number.isFinite(Number(snapshot?.settlement?.morale))) worldState.morale = Math.min(100, Math.max(0, Number(snapshot.settlement.morale)));
    if (Number.isFinite(Number(resources.power))) worldState.power = Math.max(0, Number(resources.power));
    updateObjectiveFromSnapshot(snapshot);
    updateReadouts(true);
  }
  setText(ui.revision, Number.isFinite(Number(snapshot.revision)) ? String(snapshot.revision) : 'LOCAL');
  refreshSelectedReadout();
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
  const relayUrl = relayUrlWithResume(configuredRelayUrl || (protocol === 'wss' ? `${protocol}://${host}/api/ws` : `${protocol}://${host}:8787`));
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
      storeResumeState(message);
      localPlayer.id = message.playerId;
      localPlayer.hasAuthoritativeState = false;
      localPlayer.lastAuthoritativeAt = 0;
      worldState.lastSnapshotRevision = -1;
      worldState.lastEventId = '';
      worldState.pendingCommands.clear();
      applyPlayerList(message.players ?? []);
      applySnapshot(message.snapshot);
      setText(ui.event, message.resumed
        ? 'Reconnected to your Saltglass Basin survivor.'
        : 'Connected to Saltglass Basin. Find the old relay station and bring the commons online.');
    }
    if (message.type === 'snapshot') {
      applySnapshot(message.snapshot);
    }
    if (message.type === 'command.ack') {
      applyCommandAcknowledgement(message);
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
  socket.send(JSON.stringify({ type: 'input', direction, sprint: touchSprinting || keys.has('ShiftLeft') || keys.has('ShiftRight') }));
}

function movePlayer(delta) {
  const keyboardX = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const keyboardZ = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
  const x = keyboardX || touchVector.x;
  const z = keyboardZ || touchVector.y;
  const direction = new THREE.Vector2(x, z);
  if (direction.lengthSq() > 1) direction.normalize();
  const sprinting = touchSprinting || keys.has('ShiftLeft') || keys.has('ShiftRight');
  const movementSpeed = localPlayer.speed * (sprinting ? 10 / 7 : 1);
  localPlayer.position.x = THREE.MathUtils.clamp(localPlayer.position.x + direction.x * movementSpeed * delta, grid.sceneBounds.min.x + 2, grid.sceneBounds.max.x - 2);
  localPlayer.position.z = THREE.MathUtils.clamp(localPlayer.position.z + direction.y * movementSpeed * delta, grid.sceneBounds.min.z + 2, grid.sceneBounds.max.z - 2);
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

function setTouchSprint(active) {
  touchSprinting = Boolean(active);
  const button = document.querySelector('#touch-sprint');
  button?.setAttribute('aria-pressed', String(touchSprinting));
  button?.classList.toggle('active', touchSprinting);
}

function clearMovementInput() {
  keys.clear();
  clearTouch();
  setTouchSprint(false);
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
createWorldDressing();
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
pad.addEventListener('pointerdown', (event) => { pad.setPointerCapture?.(event.pointerId); touchPoint(event); });
pad.addEventListener('pointermove', touchPoint);
pad.addEventListener('pointerup', clearTouch);
pad.addEventListener('pointercancel', clearTouch);
pad.addEventListener('lostpointercapture', clearTouch);
const touchSprint = document.querySelector('#touch-sprint');
touchSprint.addEventListener('pointerdown', (event) => { touchSprint.setPointerCapture?.(event.pointerId); setTouchSprint(true); });
touchSprint.addEventListener('pointerup', () => setTouchSprint(false));
touchSprint.addEventListener('pointercancel', () => setTouchSprint(false));
touchSprint.addEventListener('lostpointercapture', () => setTouchSprint(false));

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
