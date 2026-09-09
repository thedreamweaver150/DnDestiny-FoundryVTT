# Light & Abilities

## Core Light Abilities tab

Player Characters get a dedicated **Core Light Abilities** tab, pulled out of the native Spells tab (spells are hidden entirely by default — see [Settings](settings.md)). It shows:

- The 3 **Core Ability Slots**: **Superclass**, **Melee Ability**, and **Super Ability**.
- The character's **Grenades** (see below).
- The character's **Light Level** and **Light Ability** attack/save stats.
- Read-only Scale Value advancement from the primary class.

### Core Ability Slots

Each slot holds at most one Light Ability (a Spell item tagged with that slot via a dropdown on the item's own Details tab). An empty slot opens the Compendium Browser pre-filtered to abilities tagged for that slot; a filled slot can be used, right-clicked for the usual item context actions, or dragged off. Each shows its remaining charges and its recharge die/threshold.

### Light Level & the primary Light class

For a multiclassed character, the **primary Light class** is whichever class has the most levels invested. Two things derive from it:

- **Light Level** — advances once every 4 levels of the primary class (levels 1–4 → Light Level 1, 5–8 → 2, and so on). It's exposed to roll formulas as `@dndestiny.lightLevel` and also drives the "Light Level" damage-scaling mode.
- **Light Ability modifier** — the ability score the class's own **Light Ability** field designates (set on the class item's Details tab, e.g. Gunslinger → Charisma). This is what Light Attack rolls and Save DCs actually key off; the native `@mod` spellcasting key is *not* used, since these classes don't use dnd5e's native spellcasting ability at all.

### Recharge dice

Grenades and the 3 Core Ability slots don't use dnd5e's native "Recharge 5-6" mechanic (hardcoded to a d6). Instead, each has its own configurable **Recharge Die** and **Threshold**, set via a "Light Ability Recharge" option on the item's Recovery period dropdown. Rolling recharge (the d20-icon button on its row) rolls that die against the threshold and, on success, resets the item's charges to full.

Charges themselves are tracked through the item's normal Limited Uses, consumed automatically (1 per activation) the same way any native item's uses are — there's no separate custom charge-tracking logic to fight with.

## Grenades

Grenades are Spell items tagged with the Grenade slot (the same dropdown used for the 3 Core Ability slots). They're granted per-class: a class item has its own **Grenades** field (up to a fixed maximum) where a GM drags in Grenade features once — every character with that class automatically gets them mirrored onto their sheet.

Only one Grenade can be **Active** at a time (the star button on its row) — that's the one that actually gets used from the sheet, a macro, etc. Deleting a grenade from a character's list removes it from the *class's* roster instead, since the class is the actual source of truth; that removes it from everyone with that class, not just the one character.

## Foundation

**Foundation** is a Background flagged with a checkbox on its own Details tab. A Foundation is tracked and displayed separately from a character's main Background (up to a configured maximum at once) instead of occupying the single Background slot — added via its own "Add Foundation" flow, pre-filtered to Foundation-flagged backgrounds in the Compendium Browser.

## Shields & Overshields

Guardian sheets show **Shields** and **Overshields** as their own meters alongside HP, rather than as generic dnd5e resources:

- **Shields** — a class has its own **Shield Die**, rolled once per level after 1st (via the die button on the Shields meter) and added straight to max Shields. Not a spendable pool like Hit Dice.
- **Overshields** — a temporary combat buff, deliberately *not* restored by Brief Rest (see below) since in Destiny it's meant to fade rather than be topped off on demand.

### Brief Rest

A **Brief Rest** button sits above the native Short/Long Rest buttons on the Character/Ghost sheet header. Unlike an actual rest, it only restores **Shields** to max — Overshields are untouched.

## Damage types

This system adds Destiny's Paracausal damage types to `CONFIG.DND5E.damageTypes`: **Arc**, **Solar**, **Void**, **Kinetic** (flagged physical), **Light**, and **Darkness** — each with its own icon and color, usable anywhere a native damage type is (weapon/ability damage, resistances, etc.).
