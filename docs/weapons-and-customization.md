# Weapons & Customization

## Weapon classes

Destiny-specific weapon base types are available on the Weapon item's Type field, each with its own icon/identifier: Auto Rifle, Combat Bow, Fusion Rifle, Grenade Launcher, Hand Cannon, Light Machine Gun, Linear Fusion Rifle, Pulse Rifle, Rocket Launcher, Scout Rifle, Shotgun, Sidearm, Sniper Rifle, Submachine Gun, and Trace Rifle.

## Weapon properties, grouped

A weapon's Properties checkbox grid is split into up to four labeled groups instead of one flat list:

- **Default Weapon Properties** — dnd5e's own native properties (whatever's left after the groups below are pulled out).
- **General Weapon Properties** — Agile, One-Handed, Range, Cumbersome, Elemental.
- **Firearm Properties** — Auto-Fire, Energy Projectiles, High-Recoil, Payload, Shot Capacity, Scope. Only shown when the weapon's Type is a Simple or Martial Firearm.
- **Special Weapons** — Combat Bow, Grenade Launcher, Trace Rifle.

## Scope & Range

Every weapon gets a **Scope & Range** fieldset: three Scope distances (Effective / Extended / Maximum) and a Close/Medium/Long **Range Band**. Firearms use this in place of dnd5e's native Range fieldset (Normal/Long/Reach + unit), which is hidden entirely for them — any leftover native range value on a Firearm is cleared out since there'd be no way to edit it back through the UI.

## Weapon Tiers & Perk slots

Every weapon has a **Customization** tab (Chapter 6: Customization) with:

- A **Weapon Tier** (0–3). Tier grants no bonus on its own — it only determines how many Perk slots are unlocked (Tier 1 → Slot 1, Tier 2 → Slots 1–2, Tier 3 → Slots 1–3).
- Up to 3 **Perk slots**, shown/hidden based on the current Tier.

### The Perk item type

**Perk** is its own item type (not reused from Feature/Feat), so it never gets confused with a class feature. A Perk's Details tab only asks for what actually matters:

- Which **Weapon Classes** it's available for (checkboxes over the full weapon class list above, plus a special "Melee Weapon (Any)" entry for perks that fit any melee weapon).
- For each checked weapon class, **which Slot** it occupies — the same perk can be a different slot on different weapons (e.g. a perk might be Slot 3 on Sniper Rifle but Slot 1 on Scout Rifle).

A Perk's own Effects tab holds ordinary Active Effects, authored with plain `system.xxx` keys as if already applied to the weapon — these are what actually get copied onto a weapon when the perk is slotted. Perks have no Activation, so their Activities/Advancement tabs are hidden and their sheet subtitle reads "Perk" instead of the native fallback "Passive".

### Slotting a perk

Drag a Perk onto any of a weapon's Customization tab slot boxes — it automatically resolves to the correct slot for *that specific weapon* (not necessarily the box it was dropped on) using the perk's own Weapon Class/Slot mapping. Dropping into a slot higher than the weapon's current Tier unlocks is rejected. Slotting a perk clones its Active Effects onto the weapon (clearing whatever was in that slot first); removing a perk deletes those cloned effects again.

### Explosive damage

A weapon (or any other item with a damage-dealing Activity) can be flagged so its damage counts as **Explosive** — a modifier that pairs with the damage's own base type rather than replacing it, so a creature's resistance/immunity/vulnerability to Explosive damage applies regardless of that base type. The practical use here is an Active Effect or enchantment (e.g. "Explosive Rounds" ammo, or a perk) setting `flags.dndestiny.explosiveWeapon` to flag every damage activity on the item at once. See [Light & Abilities](light-and-abilities.md#explosive-damage) for the full mechanic and [Active Effect Keys](active-effect-keys.md) for the exact key.

### Automated (conditional) perks

Most perks are flat, always-on modifiers and need nothing beyond an Active Effect. A few are conditional/situational (per the List of Perks terminology in Chapter 6) and can't be expressed as a plain effect — these are automated in code via a Midi-QOL on-use macro bridge, wired onto a weapon automatically the first time its Customization tab is opened. Currently automated: **Hip Fire**, **Outlaw**, **Take a Knee**, and **Hidden Hand** (each only their flat attack-bonus half where relevant — a damage-bonus half with no equivalent native field stays as descriptive text on the perk itself). Adding a new automated perk means adding a handler in code; authoring an ordinary perk never requires touching it.
