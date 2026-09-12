# Active Effect Keys

Beyond every native dnd5e `system.*` key, this system adds its own data fields to several document types. Any of these can be targeted from an Active Effect's **Attribute Key** field, same as a native key.

## Character (Actor)

| Key | Type | Notes |
|---|---|---|
| `system.shields.value` | Number | Current Shields. |
| `system.shields.max` | Number | Max Shields. |
| `system.overshields.value` | Number | Current Overshields. |
| `system.overshields.max` | Number | Max Overshields. |
| `flags.dndestiny.jackOfAllGuns` | Boolean | Toggles the Jack of all Guns special trait — same pattern as dnd5e's own `flags.dndestiny.jackOfAllTrades`. |

Ghost actors share the Character data model, so the same keys apply to them.

## Class item

| Key | Type | Notes |
|---|---|---|
| `system.lightAbility` | String | Ability score key (e.g. `"cha"`) the class's Light Abilities key off of. |
| `system.dndestinyShieldDie` | String | Shield Die denomination (e.g. `"d8"`). |
| `system.dndestinyGrenades` | Array of UUIDs | The class's granted Grenade features. Awkward to target with a single Active Effect change (it's a full array, not a scalar) but technically overridable. |

## Light Ability item (Superclass/Melee/Super Ability, Grenade)

Its own dedicated Item type (`dndestiny.lightAbility`, Feature-based) as of the Light Ability/Spell split - previously these were native "spell" items with that type globally relabeled. Real Spell items are unaffected and carry none of these keys.

| Key | Type | Notes |
|---|---|---|
| `system.dndestinyRechargeDie` | String | Recharge die (e.g. `"d6"`). |
| `system.dndestinyRechargeThreshold` | Number | Roll needed on the recharge die to succeed. |
| `system.dndestinyAbilitySlot` | String | Which Core Ability Slot this occupies (`superclass`/`melee`/`super`/`grenade`). |
| `system.dndestinyDamageDenomination` | Number | Die size (4/6/8/10/12) used by a damage formula referencing `@item.dndestinyDamageDenomination`. Deliberately kept as its own field (not the die-count field) so an Active Effect can step it up/down by ±2, the same way dnd5e's native Versatile property steps a weapon's damage die. |

## Weapon item

| Key | Type | Notes |
|---|---|---|
| `system.dndestinyScopeEffective` | Number | Scope Effective distance. |
| `system.dndestinyScopeExtended` | Number | Scope Extended distance. |
| `system.dndestinyScopeMaximum` | Number | Scope Maximum distance. |
| `system.dndestinyRangeBand` | String | `close` / `medium` / `long`. |
| `system.dndestinyShotCapacity` | Number | Magazine size. |
| `system.dndestinyShotsRemaining` | Number | Shots left before reload. |
| `system.dndestinyAmmoType` | String | Ammo Type override (`simple`/`martial`/`rocket`, blank = auto). |
| `system.dndestinyWeaponTier` | Number | 0–3; unlocks Perk slots. |
| `system.dndestinyPerkSlot1` / `dndestinyPerkSlot2` / `dndestinyPerkSlot3` | String (UUID) | The Perk item currently slotted in each slot. Normally managed by dragging a Perk onto the Customization tab rather than set directly. |

## Consumable item

| Key | Type | Notes |
|---|---|---|
| `system.dndestinyAmmoType` | String | Tags this Consumable as an Ammo Type pool (`simple`/`martial`/`rocket`). |

## Any physical/inventory item (Weapon, Equipment, Consumable, Tool, Loot, Container)

| Key | Type | Notes |
|---|---|---|
| `system.dndestinyGhostMemory` | Number | Memory Cost when held by a Ghost. |
| `system.dndestinyGhostMaxStack` | Number | Max stack size before a Ghost splits the excess into a new slot (blank = unlimited). |
| `system.dndestinyGhostBlocked` | Boolean | Prevents this item from ever being stored in a Ghost's inventory. |

## Any item with a damage-dealing Activity (Weapon, Spell/Light Ability, Grenade, etc.)

| Key | Type | Notes |
|---|---|---|
| `flags.dndestiny.explosiveWeapon` | Boolean | Marks every Attack/Damage/Save Activity on this item as dealing Explosive damage while active — a creature's resistance/immunity/vulnerability to Explosive damage applies regardless of the activity's own base damage type(s). Boolean, Override mode, value `true`. This is the key an enchantment or perk should target; the per-activity "Explosive" checkbox on an Activity's Effect tab (`flags.dndestiny.explosiveDamage.<activityId>`) does the same thing for one specific activity, but its key embeds that activity's random `_id` and isn't practical to reference from an Active Effect. |

## Background item

| Key | Type | Notes |
|---|---|---|
| `system.dndestinyIsFoundation` | Boolean | Marks this Background as a Foundation (tracked separately from the main Background slot). |

## Perk item

| Key | Type | Notes |
|---|---|---|
| `system.dndestinyPerkWeaponClasses` | Mapping (weapon class → slot number) | Which weapon classes this perk is available for and which slot it occupies on each. A mapping field, not a scalar — not a practical single Active Effect target; edited via the Perk's own Details tab instead. |

A Perk's own Effects tab is where most perks actually live: an ordinary Active Effect using plain `system.xxx` weapon keys (from the Weapon table above, or any native weapon key) as if it were already applied to the weapon — see [Weapons & Customization](weapons-and-customization.md) for how slotting copies those onto the weapon.
