# Wasteland Commons: First Release Game Loop

## Product promise

Wasteland Commons is a cross-platform cooperative survival and community game for 2–4 players. Players leave a fragile settlement to explore a dangerous wasteland, bring useful things home, and turn those materials into a safer, more capable community. The community then makes deeper expeditions possible.

The first release is a complete game, not an endless sandbox without a finish line. It has a clear regional objective, a final boss-scale encounter, and a free-play state after completion. It is deliberately compact enough to finish, save, join, and play on a PC, iPhone, or Android phone.

The camera is third-person and readable at small screen sizes. Precision aiming is helpful but never the only way to succeed; contextual actions, generous interaction targets, and optional aim assistance make the same game usable with keyboard and mouse, a controller, or touch controls.

## The central loop

```text
Settlement
   ↓ plan an outing, assign community jobs, equip players
Expedition
   ↓ travel, explore, scavenge, repair, recruit, avoid or fight
Threat decision
   ↓ spend supplies, use the vehicle, call an ally, use the mech, or retreat
Return
   ↓ secure the haul and bring home people, robots, parts, and information
Community work
   ↓ build, grow food, purify water, repair vehicles, and assign NPC roles
Progression
   ↓ restore regional systems and unlock stronger tools and routes
Boss expedition
   ↓ use the community's preparation and the players' builds to overcome a guardian
Settlement grows
   ↺ repeat with new access, new risks, and a more capable community
```

Every expedition should answer three questions:

1. What can we safely bring home?
2. What risk are we willing to accept for something more valuable?
3. How will today's choice change the settlement and the next outing?

The game should create stories from those decisions without requiring a large, complicated simulation. A lost vehicle, a repaired helper robot, an injured NPC, or a newly opened route is enough to make the next expedition feel different.

## First-release shape

The world feels like a giant wasteland through connected routes, landmarks, alternate approaches, and changing threats. The first release is an authored region rather than an infinite procedural map or an MMO.

| Area | First-release scope |
| --- | --- |
| Players | 2–4 online co-op players; drop-in and reconnect support |
| Platforms | PC, iPhone, and Android with shared sessions |
| World | One settlement, three connected wasteland sectors, and two boss sites |
| Session | A useful outing can take 15–30 minutes; a full first clear can fit into several sessions |
| Community | One main settlement with a small number of expandable field outposts |
| Vehicles | Two drivable frames: a fast scout runner and a slower cargo rover |
| Mech | One pilotable chassis with replaceable modules and three practical loadout identities |
| Enemies | Three readable undead behaviours, helpful/neutral robots, hostile robots, and two boss machines |
| Construction | Snap-grid structures, storage, food, water, power, defenses, repair, and vehicle/mech facilities |
| PvP | Not part of the first release; the design is cooperative and readable across devices |

This scope is large enough to express the son's whole idea while keeping the number of simultaneous systems under control. More regions, factions, vehicles, and mech frames remain natural expansions instead of unfinished promises inside the first release.

## 1. Prepare at the settlement

The settlement is the safe place where the team turns last expedition's materials into the next expedition's options.

Before leaving, players can:

- Review discovered landmarks, known threats, weather, and open objectives.
- Choose an outing type: salvage, rescue, repair, recovery, robot contact, or boss preparation.
- Equip a compact personal kit with tools, weapons, healing, and carrying capacity.
- Select a vehicle and decide whether cargo space or speed matters more.
- Choose whether the modular mech stays in the settlement or is deployed.
- Assign community NPCs to jobs and check the settlement's food, water, power, safety, and morale.
- Spend materials on a structure, repair, fabrication project, or expedition supply.

Preparation should be a meaningful choice, not a menu tax. A team that takes more medical supplies has less room for salvage. A team that sends the mechanic away to scavenge gains materials but risks a disabled vehicle. Players can leave with an imperfect plan and adapt in the field.

## 2. Explore the wasteland

The wasteland is divided into three sectors with distinct traversal problems and material identities. Each sector has a safe approach, a faster dangerous route, discoverable side locations, and one system needed to stabilize the region.

The player can travel on foot or use a vehicle. Vehicles reduce travel time and increase carrying capacity but create noise, consume repair resources, and can become disabled. On foot is slower and quieter, allowing players to approach places a vehicle cannot reach.

Exploration is driven by visible landmarks and readable signals rather than a wall of quest markers. Players may follow a radio trace, smoke plume, damaged road, robot beacon, survivor request, or a structure they can see in the distance.

Each important location has a stable identity in the world. The player can describe a problem in ordinary language—“the gate near the water tower is blocked”—and the game or an inspecting agent can resolve that description to the location, object, and exact grid address.

## 3. Scavenge, repair, and make contact

At a point of interest, the team searches containers, buildings, vehicles, wreckage, and machines. Loot is grouped by use so the inventory stays understandable:

- **Survival:** food, water, medicine, and shelter supplies.
- **Construction:** structural scrap, fasteners, glass, wiring, and panels.
- **Fabrication:** machine parts, power cells, tools, and rare components.
- **Knowledge:** maps, schematics, access codes, and records that reveal better routes or recipes.
- **Relationship:** items or actions that improve the settlement's standing with a robot or survivor group.

Scavenging is not only opening every container. Players choose whether to:

- Take a small guaranteed haul and leave quietly.
- Search deeper while threat pressure rises.
- Repair or escort a stranded helpful robot.
- Strip a hostile robot for valuable parts after disabling it.
- Use a vehicle as a mobile stash and risk losing the vehicle.
- Carry a critical item home even if it means abandoning ordinary loot.

The team has limited personal inventory. Vehicle cargo expands the haul but does not remove the need to make decisions. Valuable items are safe once stored at the settlement; an incapacitated player may drop some field inventory but does not erase the community's progress.

## 4. Threats are choices, not only damage sources

### Undead creatures

The undead are a persistent environmental pressure. The first release needs only three clear behaviours:

- **Drifters:** slow, visible groups that block routes and punish careless noise.
- **Runners:** fragile, fast creatures that make open ground dangerous and split the team.
- **Buried ones:** ambushers that turn apparently safe salvage sites into a sudden decision.

They create pressure through sound, numbers, and terrain. They should be simple to understand on touch screens and dangerous because of positioning, not because of opaque status effects.

### Robots

Robots are not one faction. Their behaviour depends on their condition, programming, and the player's actions.

- **Helpful robots** can repair, carry, scout, defend, or provide a service after being rescued, supplied, or trusted. Some can be recruited into the settlement's robot bay.
- **Neutral robots** follow old routines. Players can avoid them, redirect them, trade with them, or accidentally trigger a hostile response.
- **Hostile robots** patrol, protect valuable sites, and use predictable equipment that players can learn to counter.

Robot encounters should support fight, bypass, repair, distraction, or retreat. A repaired helper is a lasting community improvement; a destroyed hostile machine may provide a rare mech or vehicle component.

### Threat pressure

Every sector has a simple threat-pressure state that rises when players make noise, trigger alarms, linger, or fail an objective. Higher pressure changes patrols and undead activity. It is a readable reason to leave rather than an invisible punishment system. Returning to safety lowers pressure for that expedition but does not permanently erase the sector's danger.

## 5. Return and convert the haul

The expedition ends successfully when the team returns to the settlement or completes a safe extraction at a field outpost. Players then:

- Store salvage and move critical items into shared project stock.
- Repair or scrap damaged vehicles and robots.
- Treat injured players or NPCs.
- Review what was learned and mark new routes or locations.
- Decide which project receives the scarce component.

If the team is overwhelmed, an extraction is still a valid choice. A downed player can be revived by a teammate or recovered by a settlement rescue action. Failure costs time, field inventory, vehicle condition, or threat pressure; it does not wipe the settlement or make the game restart from zero.

## 6. Build a living community

The community is a small resource ecology, not a spreadsheet simulator. Four settlement meters make its health legible:

- **Food** keeps people working and supports population growth.
- **Water** supports people, crops, and some machines.
- **Power** runs fabrication, lighting, communications, and robot facilities.
- **Safety** represents defenses, medical readiness, and the settlement's ability to withstand events.

Morale is expressed through NPC availability, requests, and small events rather than another meter that players must constantly maintain.

### NPC jobs

Each recruited NPC can hold one primary role. The first release includes:

- **Grower:** turns water, seeds, and time into food.
- **Scavenger:** adds a small, reliable material return between expeditions.
- **Mechanic:** repairs vehicles and increases the value of machine salvage.
- **Medic:** improves recovery and reduces the cost of injuries.
- **Builder:** accelerates construction and field-outpost work.
- **Guard:** raises safety and helps repel settlement events.

NPCs have a clear availability state—working, resting, injured, traveling, or unavailable—so players can understand why an output changed. Job assignments update at meaningful settlement events or after expeditions, not every second. This keeps the ecology alive without turning the game into a maintenance chore.

### Construction

Construction uses a deterministic snap grid so buildings, doors, defenses, and machines remain aligned and inspectable. The first release supports:

- Foundations, floors, walls, roofs, gates, and storage.
- A water collector and purifier.
- A grow plot and food store.
- A powered workshop and fabricator.
- A medical station.
- A watch post and basic perimeter defenses.
- A vehicle garage, robot bay, and mech bay.
- Two small field-outpost templates that extend expedition reach.

The settlement begins as a damaged commons. Players choose which functions to restore first, so two groups can have different early strengths even though they share the same complete release path.

## 7. Restore the region

The first-release campaign is organized around three infrastructure systems:

1. **Water system:** restores reliable water, unlocks farming, and makes additional NPC recruitment practical.
2. **Signal system:** reveals routes and machine patterns, improves robot contact, and opens the first boss site.
3. **Fabrication system:** unlocks advanced repairs, vehicle upgrades, and the mech bay.

Each system requires an expedition to recover a key component, a settlement project to install it, and a follow-up trip to activate or defend it. This makes the community and the wasteland dependent on each other; neither side can be completed from menus alone.

## 8. Vehicles

The first release has two frames with different purposes:

- **Scout runner:** quick, lightly protected, limited cargo, useful for mapping and rescue.
- **Cargo rover:** slower, tougher, seats the whole group, and carries enough material for serious construction projects.

Both vehicles support a driver and passengers, can be damaged or disabled, and have a small number of upgrade slots. Upgrades improve one of speed, durability, storage, or quiet operation. The team must still decide which vehicle fits the outing.

Vehicles are a traversal and team-play system, not a separate racing game. They should be easy to steer on a phone, support keyboard/mouse and gamepad on PC, and remain useful even when the team has to abandon them temporarily.

## 9. The modular pilotable mech

The mech is the settlement's most expensive project and the clearest expression of player choice. It is a single chassis in the first release with replaceable modules that change how it moves, survives, and fights.

The first chassis has five meaningful slots:

- **Core:** energy capacity, heat handling, or support systems.
- **Locomotion:** stable heavy legs or faster lighter legs.
- **Left arm:** shield, grabber, repair tool, or close-range weapon.
- **Right arm:** impact tool, ranged weapon, or machine-disabling tool.
- **Back/utility:** cargo rig, repair drone, sensor array, or emergency power.

The initial module set supports three readable identities:

- **Breaker:** close-range damage and obstacle removal.
- **Guardian:** shielding, rescue, and team protection.
- **Salvager:** cargo, repair, scanning, and machine recovery.

Parts can be replaced only at the mech bay. That makes loadout choice part of preparation while keeping the controls and encounter balance predictable in the field. In the first release, a settlement can deploy one active mech at a time. Each player can save a preferred configuration, but the team must decide who pilots the active chassis on a given expedition. Simultaneous mechs are a deliberate expansion point rather than a hidden multiplayer burden.

The mech is powerful but not an automatic win. It consumes power, makes more noise, cannot enter every location, and can be disabled. It should change the team's options, not remove the need for scavenging, NPC support, or careful positioning.

## 10. Boss progression and completion

The first release includes two boss-scale robot encounters:

- **The Relay Warden:** a mobile signal guardian that controls the region's machine traffic. Defeating it requires the restored signal system and teaches players to combine vehicle movement, robot knowledge, and mech timing.
- **The Foundry Giant:** a heavy construction machine that has been converting the wasteland's remaining infrastructure into hostile defenses. It is the final campaign encounter and requires the water, signal, and fabrication systems to be operating.

Boss arenas are prepared through ordinary community work. NPC guards can protect an approach, mechanics can repair the vehicle, helpful robots can reveal a weakness, and the mech's chosen modules determine the team's safest strategy.

The first-release completion state is reached when the team:

1. Restores all three regional systems.
2. Stabilizes the settlement so its core meters remain above emergency level.
3. Defeats the Relay Warden.
4. Builds and deploys the mech.
5. Defeats the Foundry Giant.

After the final encounter, the settlement becomes a free-play home. Players can continue recruiting, building, collecting alternate modules, improving routes, and replaying boss sites for different rewards.

## 11. Multiplayer and device rules

The shared session is cooperative and small by design.

- A session contains 2–4 players and one shared settlement state.
- Players join with a short room code or invite link; public identity is not required for the core loop.
- The settlement, NPC jobs, construction, boss progression, and world events are shared.
- Personal kits and carried inventory are private until deposited in shared storage.
- A disconnected player receives a short grace period; the group can continue without losing the settlement.
- The game does not require a player to stay online for NPC jobs to make sense; job output resolves at settlement events.

Controls are designed from the action verb outward:

- Move, look, interact, dodge, use tool, use vehicle, and open inventory are always reachable on touch.
- Contextual interaction replaces large collections of tiny buttons.
- PC keyboard/mouse and gamepad expose the same actions without giving PC players exclusive mechanics.
- Important labels, inventory cards, and status changes remain readable on a phone-sized viewport.
- Combat encounters use clear silhouettes, telegraphs, and forgiving target selection rather than relying on pixel-perfect pointer work.

## 12. Spatial memory and material identity

The world is built with spatial memory from the beginning. Every important object receives a stable ID when created, a deterministic grid address, semantic tags, visible bounds, collision bounds, and a material record. IDs are not added in a cleanup pass.

The runtime has two views:

- **Beauty mode:** the polished game world and player-facing UI.
- **Inspection mode:** grid cells, object IDs, bounds, collision proxies, material names, contact points, and validation issues.

An asset is created semantically before it is dressed visually. If the object is a bench, wall, vehicle, robot, or machine part, its material profile is chosen from that identity and its context. A bench can therefore be made from weathered wood, painted steel, or composite panels without the world receiving a random generic texture. Generated or photographed material sources are recorded so the result can be reproduced and inspected.

This system is for both players and agents. A human can say “the cargo rover is clipping into the gate at the north outpost,” and the exact object records, grid location, and screenshots can be found without requiring engine vocabulary.

## Example first-release run

Two players join from a PC and an Android phone. At the settlement, they assign the mechanic to vehicle repair, send the grower to food production, and choose the scout runner because they are looking for the missing signal component.

They follow a radio trace to a collapsed service station. A helpful carrier robot is trapped beneath debris, so one player frees it while the other searches the station. The rescue raises noise; buried undead emerge, and a hostile patrol robot arrives. The team uses the runner to create distance, repairs the carrier, and escapes with the signal component but leaves ordinary scrap behind.

Back home, the carrier robot joins the robot bay, the players install the signal component, and the builder completes a watch post. The new signal map reveals the Relay Warden's route. Before the next outing, the mechanic finishes the cargo rover and the team chooses whether to deploy the incomplete mech or save power for the boss trip.

That single run demonstrates the intended rhythm: prepare, travel, discover, make a human-readable risk decision, return with consequences, improve the community, and open a new possibility.

## Completion criteria for the first release

The first release is complete when a new group can:

- Join one shared session from PC, iPhone, or Android.
- Understand the settlement's four core resources without outside documentation.
- Assign NPC jobs and see the resulting settlement changes.
- Build and use the water, food, power, medical, defense, vehicle, robot, and mech facilities.
- Explore all three sectors on foot and in both vehicle frames.
- Scavenge useful materials, repair or recruit a helpful robot, and survive undead and hostile robot encounters.
- Build, configure, pilot, and recover the modular mech.
- Defeat both boss machines as a cooperative group.
- Reach a clear ending and continue in free play.
- Inspect the world in Beauty and Inspection modes with stable object IDs, grid locations, collision records, and validation output.
- Reconnect after a temporary disconnect without corrupting the shared settlement state.

## Expansion points after the first release

The first release leaves room for:

- Additional wasteland sectors with new traversal rules.
- More robot behaviours, robot communities, and relationship outcomes.
- Deeper NPC traits, family relationships, and settlement events.
- More vehicle frames and vehicle-mounted equipment.
- Additional mech chassis, simultaneous mech deployment, and cooperative mech roles.
- New undead ecologies, environmental hazards, and boss machines.
- Player trading, shared public settlements, dedicated servers, or larger groups.
- More elaborate farming, water networks, weather, and regional simulation.
- Community-authored or procedurally generated locations using the same spatial manifest contract.

These are extension seams, not requirements for calling the first release finished.

## Inspiration boundary

The project may learn from the high-level appeal of wasteland exploration and scavenging, player-built communities, survivor job roles, and modular combat machines. It must not carry over names, characters, factions, storylines, dialogue, maps, interface identity, art, sound, assets, or distinctive designs from Fallout, DayZ, State of Decay, or any other reference work. The setting, rules, presentation, and content of Wasteland Commons remain original.
