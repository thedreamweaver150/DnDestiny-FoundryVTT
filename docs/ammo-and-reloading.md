# Ammo & Reloading

This is an optional layer on top of the **Shot Capacity** weapon property, gated by the **Track Weapon Ammo** world setting (on by default — see [Settings](settings.md)). With that setting off, Shot Capacity is purely descriptive text with no tracking UI at all.

## Ammo Types

Consumable items can be tagged with an **Ammo Type** on their Details tab:

| Ammo Type | Used by |
|---|---|
| Simple Magazine | Simple Firearms |
| Martial Magazine | Martial Firearms (except Rocket Launcher) |
| Rockets | Rocket Launcher |

A weapon's Type implies a default Ammo Type automatically (Simple Firearm → Simple Magazine, Martial Firearm → Martial Magazine, Rocket Launcher → Rockets) — shown as "Auto (...)" on the weapon's own Ammo Type dropdown. That default can be overridden explicitly per weapon.

## Magazine fields

While a weapon has the Shot Capacity property (and tracking is on), its Details tab shows:

- **Capacity** — the magazine size.
- **Remaining** — shots left before a reload is needed.
- **Ammo Type** — defaults to "Auto" (see above) or can be set explicitly.

The weapon's Inventory row also shows a Remaining/Capacity badge.

## Reloading

A weapon with Shot Capacity automatically gets a **Reload** activity (added/removed to match the Track Weapon Ammo setting and the property itself, with no manual setup needed). Using it:

1. Looks for a Consumable in the actor's inventory matching the weapon's required Ammo Type (falling back to any tagged ammo if the weapon has no type resolved).
2. Consumes 1 from that Consumable's quantity (deleting the item entirely if it hits 0).
3. Refills the weapon's Remaining back to its Capacity.

If a Reload activity is attached to something other than the weapon itself (e.g. granted by a Superclass Ability), using it prompts for which Shot Capacity weapon on the actor to reload — skipped automatically if there's only one candidate.
