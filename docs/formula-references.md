# Formula & Roll Data References

Beyond dnd5e's own roll data (`@mod`, `@prof`, `@item.*`, etc.), this system exposes a few of its own values that can be typed directly into any formula field — an Activity's Attack bonus, Damage parts, DC, and so on.

## Actor roll data

| Reference | Value | Notes |
|---|---|---|
| `@dndestiny.lightLevel` | Light Level | Advances once every 4 levels of the actor's primary Light class (see [Light & Abilities](light-and-abilities.md)). `null` if the actor has no class levels. Available on both Character and Ghost actors. |
| `@dndestiny.lightAbilityMod` | Light Ability modifier | The modifier for whichever ability score the actor's primary Light class designates via its own Light Ability field. Deliberately separate from `@mod` — dnd5e's native `@mod` resolves off the actor's spellcasting ability attribute, which these classes never set, so it silently reads 0 for a Light Ability formula. |

## Item roll data

| Reference | Value | Notes |
|---|---|---|
| `@item.dndestinyDamageDenomination` | A Light Ability's die size (4/6/8/10/12) | Kept as its own field, separate from a damage part's die *count*, so a class's scaling table can drive dice count while an Active Effect independently steps this up/down by ±2 to change die size — the same trick dnd5e's native Versatile property uses. Only meaningful if the Light Ability item's (`dndestiny.lightAbility` type — see [Light & Abilities](light-and-abilities.md)) Details tab actually sets it and its damage formula references it explicitly. |

Any other custom field cataloged in [Active Effect Keys](active-effect-keys.md) is also readable this same way (e.g. `@item.dndestinyShotCapacity`, `@actor.system.shields.value`) — those two above are just the ones actually meant to be typed into a formula by a rules author.

## Custom formula fields

Places this system adds where you type a formula yourself, rather than a fixed value you reference:

- **DC Bonus** — a freeform formula field on every Check/Save Activity, right under the native DC Formula field. Applied on top of whatever the DC Calculation dropdown already produced (native or the Light Save DC option below), regardless of mode — a general "add this on top" escape hatch. This is the field to type `@dndestiny.lightLevel` into if a Light Save DC ability needs to scale with Light Level, since the Light Save DC calculation itself is fixed at `8 + Proficiency + Light Ability modifier`.

## Automatic calculation options (not typed, but formula-adjacent)

These aren't tokens you type — they're dropdown choices this system adds that replace a hand-written formula with an automatic calculation:

- **Light Ability** — an option in a Check or Save Activity's DC "Calculation" dropdown (named to match the ability-score "Light Ability" option, not the more mechanic-sounding "Light Save DC" this used to be labeled). Computes `8 + Proficiency + Light Ability modifier` automatically, matching the DC shown on the Core Light Abilities tab, instead of requiring `8 + @prof + @abilities.xxx.mod` typed by hand (which would also need to be kept in sync if the class's Light Ability ever changed). Stack a DC Bonus formula (above) on top if it needs to scale further.
- **Light Level** — an option in a Damage part's "Scaling" dropdown (alongside dnd5e's native Whole/Half Level). Scales the damage part's dice by the actor's Light Level instead of character level or spell-slot upcasting.
- **Light** — an option in an Attack Activity's "Attack Classification" dropdown (alongside native Weapon/Spell/Unarmed). Doesn't affect a formula directly, but resolves as a normal weapon-style attack roll (not a spell attack) — the correct behavior for a Light Ability, which isn't a spell in this game's rules despite living on a Spell-derived item.

## Automatically-injected roll parts

- `@dndestinyJackOfAllGuns` — when the Jack of all Guns trait applies to a firearm attack, this part is pushed onto the attack roll automatically (with half Proficiency Bonus, rounded down, as its value). You'll see it in the roll breakdown, but there's nothing to configure — it's not meant to be referenced in a formula you write yourself.
