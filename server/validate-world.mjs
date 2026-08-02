import { readFile } from 'node:fs/promises';

const [grid, manifest] = await Promise.all([
  readFile(new URL('../world/grid.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../world/manifest.json', import.meta.url), 'utf8').then(JSON.parse),
]);

const ids = new Set();
const issues = [];

function addressFor(position) {
  const column = Math.floor((position.x - grid.origin.x) / grid.cellSize);
  const row = Math.floor((position.z - grid.origin.z) / grid.cellSize);
  const level = Math.max(0, Math.floor(position.y / grid.levelHeight));
  return `L${level}-H${String(column).padStart(2, '0')}-R${String(row).padStart(2, '0')}`;
}

for (const record of manifest.records) {
  if (ids.has(record.id)) issues.push(`duplicate id: ${record.id}`);
  ids.add(record.id);
  const expected = addressFor(record.position);
  if (!record.materialKey) issues.push(`missing material: ${record.id}`);
  if (!record.semanticType) issues.push(`missing semantic type: ${record.id}`);
  if (record.position.y - record.size.y / 2 < -0.001) issues.push(`below ground: ${record.id}`);
  if (record.position.x < grid.sceneBounds.min.x || record.position.x > grid.sceneBounds.max.x || record.position.z < grid.sceneBounds.min.z || record.position.z > grid.sceneBounds.max.z) {
    issues.push(`outside scene bounds: ${record.id}`);
  }
  if (!expected) issues.push(`missing grid address: ${record.id}`);
}

const result = { sceneId: manifest.sceneId, checked: manifest.records.length, issues, status: issues.length ? 'ISSUES' : 'VALIDATED' };
console.log(JSON.stringify(result, null, 2));
if (issues.length) process.exitCode = 1;

