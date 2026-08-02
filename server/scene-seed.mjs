import manifest from '../world/manifest.json' with { type: 'json' };

const hostileRobotIds = new Set(['ROBOT-HOSTILE-0001']);
const vehicleKinds = new Map([
  ['VEHICLE-BUGGY-0001', 'scout'],
  ['VEHICLE-CARGO-0001', 'cargo'],
]);

export function createSceneSeedCommands() {
  const commands = [];
  for (const record of manifest.records) {
    if (record.category === 'robot') {
      commands.push({
        type: 'robot.spawn',
        robotId: record.id,
        model: record.semanticType,
        disposition: hostileRobotIds.has(record.id) ? 'hostile' : 'helpful',
        position: record.position,
      });
    }
    if (record.category === 'creature') {
      commands.push({
        type: 'undead.spawn',
        undeadId: record.id,
        kind: record.semanticType === 'undead-hive' ? 'buried' : 'drifter',
        position: record.position,
      });
    }
    if (record.category === 'vehicle') {
      commands.push({
        type: 'vehicle.spawn',
        vehicleId: record.id,
        kind: vehicleKinds.get(record.id) ?? 'scout',
        position: record.position,
      });
    }
  }

  const npcPositions = [
    { id: 'NPC-GROWER-0001', name: 'Mara', role: 'grower', position: { x: 8, y: 0.9, z: 28 } },
    { id: 'NPC-SCAVENGER-0001', name: 'Ivo', role: 'scavenger', position: { x: -4, y: 0.9, z: 20 } },
    { id: 'NPC-MECHANIC-0001', name: 'Sable', role: 'mechanic', position: { x: -14, y: 0.9, z: 22 } },
    { id: 'NPC-GUARD-0001', name: 'Kestrel', role: 'guard', position: { x: -40, y: 0.9, z: 10 } },
  ];
  for (const npc of npcPositions) commands.push({ type: 'npc.spawn', npcId: npc.id, ...npc });
  return commands;
}

export default createSceneSeedCommands;
