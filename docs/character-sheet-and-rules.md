# Character Sheet & Rules Additions

## Destiny Conditions

A second "Destiny Conditions" section appears on the character sheet's Effects tab, right below the native Conditions list, with the same toggle behavior and rich tooltips (styled identically to native condition/rule tooltips):

- Active Camouflage
- Aiming
- Burning (Destiny)
- Combat-prone
- Electrified
- Empowered
- Suppressed
- Tethered
- Weakened

These are registered as their own status effects (usable from the token HUD like any condition) without being folded into dnd5e's native condition list. Their tooltip text is currently placeholder copy pending real rules text.

## Jack of all Guns

A **Special Trait** on the character sheet: when checked, adds half the character's Proficiency Bonus (rounded down) to attack rolls with any firearm they aren't already proficient with. This — plus the native trait sections, if enabled via the "Show Base D&D Special Traits" setting — lives in its own "Dungeons & Destiny" fieldset on the Special Traits tab.

## Class Summary journal — Tools & Vehicles

The native Class Summary journal page (generated from a class/subclass item) can only ever show one "Tools:" line, because dnd5e nests vehicle proficiencies under the same "tool" trait category — whichever Trait advancement happens to match first wins arbitrarily, and any others are silently dropped. This system recomputes that line correctly by aggregating every eligible tool-category Trait advancement and adds a separate **Vehicles:** line, splitting grants by their tool vs. vehicle subtype.

## Other sheet-level tweaks

- **Spells tab** and **Hit Dice** are hidden by default across the sheet, class items, and the Short Rest dialog (see [Settings](settings.md) to re-enable).
- Skill and Tool rows get rich tooltips describing what they cover.
- A Ghost's sidebar-collapse state is fixed to persist correctly per user (a native bug otherwise let it desync between tabs).
