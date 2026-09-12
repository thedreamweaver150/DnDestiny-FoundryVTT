# Dungeons & Destiny — Documentation

Deeper reference for the Destiny-specific mechanics this system layers on top of dnd5e. Start with the main [README](../README.md) for installation; these pages cover how each custom feature actually works.

- [Guardians & Ghosts](guardians-and-ghosts.md) — the Character↔Ghost link, Memory-based inventory, Glimmer, sending items between the two.
- [Light & Abilities](light-and-abilities.md) — Core Ability Slots, Light Level, Shields/Overshields, Grenades, Foundations.
- [Weapons & Customization](weapons-and-customization.md) — weapon classes, properties, Weapon Tiers, and the Perk slot system.
- [Ammo & Reloading](ammo-and-reloading.md) — Shot Capacity, Ammo Types, and the Reload activity.
- [Character Sheet & Rules Additions](character-sheet-and-rules.md) — Destiny Conditions, Jack of all Guns, and other sheet-level changes.
- [Settings](settings.md) — every world setting this system adds, what it gates, and its default.
- [Active Effect Keys](active-effect-keys.md) — every custom `system.*`/`flags.*` key this system adds, for authoring Active Effects.
- [Formula & Roll Data References](formula-references.md) — custom `@dndestiny.*`/`@item.*` values usable inside formula fields, plus the automatic DC/Scaling options this system adds.
- [Known Issues](known-issues.md) — dnd5e-inherited features known not to work correctly in this fork.

All of this is implemented in [`scripts/customization.mjs`](../scripts/customization.mjs) as a layer on top of the core `dndestiny.mjs` bundle (a fork of dnd5e), so it can be iterated on independently as more of the system gets built out.
