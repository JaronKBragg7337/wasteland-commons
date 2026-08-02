#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TOOL_DIR, '..');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');
const MATERIALS_ROOT = path.join(PUBLIC_ROOT, 'assets', 'materials');

const INPUTS = {
  manifest: path.join(PROJECT_ROOT, 'world', 'manifest.json'),
  catalog: path.join(PROJECT_ROOT, 'world', 'asset-materials.json'),
  materialsDirectory: MATERIALS_ROOT,
};

const MOBILE_BUDGETS = {
  visibleSceneTextureBytes: 128 * 1024 * 1024,
  uniqueMaterialVariants: 32,
  ordinaryMaterialSlots: 4,
  heroMaterialSlots: 8,
  runtimeAiCalls: 0,
};

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.ktx2',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
]);

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp() {
  console.log(`Usage: node tools/material-audit.mjs [--json] [--strict]

Scans world/manifest.json, world/asset-materials.json, and
public/assets/materials without modifying them.

  --json    Emit the complete report as JSON.
  --strict  Exit 1 when warnings are present, including unused catalog keys.
`);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

function asString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toAssetUrl(fileValue) {
  const file = asString(fileValue);
  if (!file) return null;
  const normalized = file.replaceAll('\\', '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function resolveCatalogFile(fileValue) {
  const assetUrl = toAssetUrl(fileValue);
  if (!assetUrl || !assetUrl.startsWith('/assets/')) {
    return { assetUrl, absolutePath: null, error: 'file must point inside /assets/' };
  }

  const relativeAssetPath = assetUrl.slice(1);
  const absolutePath = path.resolve(PUBLIC_ROOT, relativeAssetPath);
  const relativeToPublic = path.relative(PUBLIC_ROOT, absolutePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) {
    return { assetUrl, absolutePath: null, error: 'file resolves outside public/' };
  }

  return { assetUrl, absolutePath, error: null };
}

async function fileBytes(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile() ? details.size : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function listImageFiles(directory, relativeDirectory = '') {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listImageFiles(absolutePath, relativePath));
      continue;
    }
    if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push({
        absolutePath,
        assetUrl: `/assets/materials/${relativePath.replaceAll(path.sep, '/')}`,
        bytes: (await stat(absolutePath)).size,
      });
    }
  }
  return files.sort((left, right) => left.assetUrl.localeCompare(right.assetUrl));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isHeroRecord(record) {
  const category = String(record?.category ?? '').toLowerCase();
  const semanticType = String(record?.semanticType ?? '').toLowerCase();
  return category === 'vehicle'
    || category === 'robot'
    || category === 'mech'
    || semanticType.includes('vehicle')
    || semanticType.includes('robot')
    || semanticType.includes('mech');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function budgetCheck(label, used, budget, unit, note = null) {
  return {
    label,
    used,
    budget,
    unit,
    status: used <= budget ? 'pass' : 'over',
    ...(note ? { note } : {}),
  };
}

async function buildReport() {
  const [manifest, catalog] = await Promise.all([
    readJson(INPUTS.manifest, 'world/manifest.json'),
    readJson(INPUTS.catalog, 'world/asset-materials.json'),
  ]);

  const records = Array.isArray(manifest.records) ? manifest.records : [];
  const materials = catalog.materials && typeof catalog.materials === 'object'
    ? catalog.materials
    : {};
  const catalogKeys = Object.keys(materials).sort((left, right) => left.localeCompare(right));
  const referencedMaterialKeys = uniqueSorted(records.flatMap((record) => [
    record.materialKey,
    ...(Array.isArray(record.materialParts) ? record.materialParts : []),
  ]).concat(manifest.groundMaterialKey));
  const missingMaterialKeys = referencedMaterialKeys.filter((key) => !Object.hasOwn(materials, key));
  const untrackedMaterialKeys = catalogKeys.filter((key) => !referencedMaterialKeys.includes(key));

  const catalogFiles = [];
  const missingFiles = [];
  const provenanceGaps = [];
  for (const key of catalogKeys) {
    const material = materials[key];
    const resolved = resolveCatalogFile(material?.file);
    const bytes = resolved.absolutePath ? await fileBytes(resolved.absolutePath) : null;
    const fileRecord = {
      key,
      assetUrl: resolved.assetUrl,
      bytes,
      exists: bytes !== null,
      source: asString(material?.source),
      hasPrompt: Boolean(asString(material?.prompt)),
    };
    catalogFiles.push(fileRecord);

    if (!resolved.error && bytes === null) {
      missingFiles.push({ key, assetUrl: resolved.assetUrl, reason: 'file does not exist' });
    } else if (resolved.error) {
      missingFiles.push({ key, assetUrl: resolved.assetUrl, reason: resolved.error });
    }
    if (!fileRecord.source || !fileRecord.hasPrompt) {
      provenanceGaps.push({
        key,
        missing: [
          ...(!fileRecord.source ? ['source'] : []),
          ...(!fileRecord.hasPrompt ? ['prompt'] : []),
        ],
      });
    }
  }

  const imageFiles = await listImageFiles(MATERIALS_ROOT);
  const trackedAssetUrls = new Set(catalogFiles.map((file) => file.assetUrl).filter(Boolean));
  const untrackedImageFiles = imageFiles
    .filter((file) => !trackedAssetUrls.has(file.assetUrl))
    .map(({ assetUrl, bytes }) => ({ assetUrl, bytes }));
  const trackedImageFiles = imageFiles
    .filter((file) => trackedAssetUrls.has(file.assetUrl))
    .map(({ assetUrl, bytes }) => ({ assetUrl, bytes }));
  const trackedImageBytes = trackedImageFiles.reduce((total, file) => total + file.bytes, 0);

  const ordinaryRecords = records.filter((record) => !isHeroRecord(record));
  const heroRecords = records.filter(isHeroRecord);
  const materialSlots = (record) => new Set([
    record.materialKey,
    ...(Array.isArray(record.materialParts) ? record.materialParts : []),
  ].filter(Boolean)).size;
  const maxOrdinarySlots = ordinaryRecords.length
    ? Math.max(...ordinaryRecords.map(materialSlots))
    : 0;
  const maxHeroSlots = heroRecords.length
    ? Math.max(...heroRecords.map(materialSlots))
    : 0;

  const mobileBudget = {
    sourceImageBytes: budgetCheck(
      'Tracked material image bytes',
      trackedImageBytes,
      MOBILE_BUDGETS.visibleSceneTextureBytes,
      'bytes',
      'Disk bytes are an inventory proxy; actual compressed GPU residency requires runtime profiling.',
    ),
    uniqueMaterialVariants: budgetCheck(
      'Unique referenced material variants',
      referencedMaterialKeys.length,
      MOBILE_BUDGETS.uniqueMaterialVariants,
      'variants',
    ),
    ordinaryMaterialSlots: budgetCheck(
      'Maximum ordinary-asset material slots',
      maxOrdinarySlots,
      MOBILE_BUDGETS.ordinaryMaterialSlots,
      'slots',
    ),
    heroMaterialSlots: budgetCheck(
      'Maximum hero vehicle/robot/mech material slots',
      maxHeroSlots,
      MOBILE_BUDGETS.heroMaterialSlots,
      'slots',
    ),
    runtimeAiCalls: budgetCheck(
      'Runtime AI/image-generation calls',
      0,
      MOBILE_BUDGETS.runtimeAiCalls,
      'calls',
      'Static audit; runtime behavior is not inferred from these manifests.',
    ),
    initialLoadBytes: {
      label: 'Initial playable load',
      budget: 20 * 1024 * 1024,
      unit: 'bytes',
      status: 'not-evaluated',
      note: 'The 20 MB target covers compressed code and core scene data, not material source images.',
    },
  };

  const errors = [
    ...missingFiles.map((file) => `missing file: ${file.key} -> ${file.assetUrl ?? '(invalid path)'}`),
    ...missingMaterialKeys.map((key) => `manifest material key is absent from catalog: ${key}`),
  ];
  const warnings = [
    ...untrackedMaterialKeys.map((key) => `catalog material key is not referenced by manifest records: ${key}`),
    ...untrackedImageFiles.map((file) => `image is not referenced by catalog: ${file.assetUrl}`),
    ...provenanceGaps.map((gap) => `${gap.key} is missing provenance fields: ${gap.missing.join(', ')}`),
    ...Object.values(mobileBudget)
      .filter((check) => check.status === 'over')
      .map((check) => `${check.label} exceeds mobile budget`),
  ];

  return {
    status: errors.length ? 'fail' : warnings.length ? 'pass-with-warnings' : 'pass',
    projectRoot: PROJECT_ROOT,
    inputs: {
      manifest: 'world/manifest.json',
      catalog: 'world/asset-materials.json',
      materialsDirectory: 'public/assets/materials',
    },
    counts: {
      manifestRecords: records.length,
      referencedMaterialKeys: referencedMaterialKeys.length,
      catalogMaterialKeys: catalogKeys.length,
      imageFiles: imageFiles.length,
    },
    missingFiles,
    missingMaterialKeys,
    untrackedMaterialKeys,
    untrackedImageFiles,
    imageByteSizes: catalogFiles,
    imageDirectoryByteSizes: imageFiles.map(({ assetUrl, bytes }) => ({ assetUrl, bytes })),
    provenance: {
      catalogEntries: catalogKeys.length,
      completeEntries: catalogKeys.length - provenanceGaps.length,
      gaps: provenanceGaps,
    },
    mobileBudget,
    errors,
    warnings,
  };
}

function printBytes(bytes) {
  return bytes === null ? 'MISSING' : `${bytes} B (${formatBytes(bytes)})`;
}

function printTextReport(report) {
  console.log(`Material/asset provenance audit: ${report.status}`);
  console.log(`Inputs: ${report.inputs.manifest}, ${report.inputs.catalog}, ${report.inputs.materialsDirectory}`);
  console.log(`Catalog keys: ${report.counts.catalogMaterialKeys}; referenced keys: ${report.counts.referencedMaterialKeys}; images: ${report.counts.imageFiles}`);

  console.log('\nMissing files:');
  console.log(report.missingFiles.length
    ? report.missingFiles.map((file) => `- ${file.key}: ${file.assetUrl ?? '(invalid path)'} — ${file.reason}`).join('\n')
    : '- none');

  console.log('\nMissing catalog keys:');
  console.log(report.missingMaterialKeys.length ? report.missingMaterialKeys.map((key) => `- ${key}`).join('\n') : '- none');

  console.log('\nUntracked material keys:');
  console.log(report.untrackedMaterialKeys.length ? report.untrackedMaterialKeys.map((key) => `- ${key}`).join('\n') : '- none');

  console.log('\nImage byte sizes:');
  console.log(report.imageByteSizes.length
    ? report.imageByteSizes.map((file) => `- ${file.key}: ${file.assetUrl ?? '(invalid path)'} — ${printBytes(file.bytes)}`).join('\n')
    : '- none');
  if (report.untrackedImageFiles.length) {
    console.log('\nUntracked image files:');
    console.log(report.untrackedImageFiles.map((file) => `- ${file.assetUrl} — ${printBytes(file.bytes)}`).join('\n'));
  }

  console.log('\nProvenance:');
  console.log(`- complete catalog entries: ${report.provenance.completeEntries}/${report.provenance.catalogEntries}`);
  if (report.provenance.gaps.length) {
    console.log(report.provenance.gaps.map((gap) => `- ${gap.key}: missing ${gap.missing.join(', ')}`).join('\n'));
  }

  console.log('\nMobile budget summary:');
  for (const check of Object.values(report.mobileBudget)) {
    const used = check.unit === 'bytes' && typeof check.used === 'number' ? formatBytes(check.used) : check.used ?? 'n/a';
    const budget = check.unit === 'bytes' ? formatBytes(check.budget) : check.budget ?? 'n/a';
    console.log(`- ${check.label}: ${used} / ${budget} ${check.status.toUpperCase()}`);
    if (check.note) console.log(`  ${check.note}`);
  }

  if (report.errors.length) {
    console.log('\nErrors:');
    console.log(report.errors.map((error) => `- ${error}`).join('\n'));
  }
  if (report.warnings.length) {
    console.log('\nWarnings:');
    console.log(report.warnings.map((warning) => `- ${warning}`).join('\n'));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  let report;
  try {
    report = await buildReport();
  } catch (error) {
    console.error(`Material/asset provenance audit: fail\n${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  if (report.errors.length || (options.strict && report.warnings.length)) {
    process.exitCode = 1;
  }
}

main();
