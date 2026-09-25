# Dungeons & Destiny

![Dungeons & Destiny](assets/ui/destiny-banner.webp)

A [Foundry Virtual Tabletop](https://foundryvtt.com/) game system for **Dungeons & Destiny**, a Destiny-themed tabletop RPG built on the 5th-edition SRD. This system is forked from Foundry's official [dnd5e](https://github.com/foundryvtt/dnd5e) system and extends it with the classes, races, gear, and mechanics unique to the Dungeons & Destiny setting.

# **Very Big Disclaimer**
This project uses AI (Claude Code) to help with development. Specifically, it helps produce the functionality for the system. I still test everything Claude writes into the system to make sure its not buggy/feels fine to use and i input the text from the books without the use of Claude to ensure accuracy.

**NO ART OR ASSETS ARE GENERATED WITH THE USE OF AI, ONLY CODE.**

That being said, i know this will be a deal breaker for most and that's fine. i did this for fun and to learn new things. i still encourage people to try it because i did pour a lot of time and love into it so other people could have a way to play this great system with their friends

## Features

Dungeons & Destiny keeps everything you already know from 5e-based systems and layers Destiny's own mechanics on top:

- **Guardians & Ghosts** — Player characters ("Guardians") get Light-based classes, and each can be linked to their own **Ghost**, a companion actor with its own sheet, inventory, and a Memory-based carrying capacity (in place of Strength-based Carrying Weight).
- **Light Abilities** — A dedicated ability system with three Core Ability slots (Superclass, Melee, and Super Ability), custom recharge dice, and a Light Level that advances alongside character level.
- **Shields & Light Meters** — Guardian-specific Shield/Light meters rendered directly on the character sheet, alongside HP.
- **Destiny Weapons & Perks** — New weapon classes (Auto Rifles, Hand Cannons, Pulse Rifles, Rocket Launchers, Sniper Rifles, and more), a dedicated **Perk** item type with up to three perk slots per weapon (unlocked by Weapon Tier), and Destiny-flavored weapon properties (Agile, High-Recoil, Payload, Scope, etc.).
- **Ammo & Reloading** — Optional ammo tracking for Shot Capacity weapons, with Reload activities that draw from Simple/Martial/Rocket ammo pools.
- **Glimmer** — Destiny's currency, replacing the standard 5e coinage.
- **Grenades & Special Traits** — Grenade features with their own charge tracking, plus a "Jack of all Guns" special trait alongside the base system's traits.

Most of this is implemented as a non-destructive customization layer (`scripts/customization.mjs`) on top of the core system bundle, so it can evolve independently as the base rules are ported over.

See the [docs](docs/README.md) for a deeper per-feature breakdown of how each of these works.

## Installation

**Manifest URL:**

```
https://raw.githubusercontent.com/thedreamweaver150/DnDestiny-FoundryVTT/main/system.json
```

1. In Foundry VTT, go to **Game Systems** → **Install System**.
2. Paste the manifest URL above into the **Manifest URL** field and click **Install**.
3. Create a new world using the **Dungeons & Destiny** system.

### Compatibility

| | |
|---|---|
| Minimum Foundry version | 14 |
| Verified Foundry version | 14 |

## Optional Rules & Settings

These world settings (**Game Settings → Configure Settings → Dungeons & Destiny**) let a GM tune which custom behaviors are active:

| Setting | Default | Description |
|---|---|---|
| Hide Spells Tab | On | Hides the Spells tab on character sheets. |
| Hide Hit Dice | On | Hides Hit Dice on the character sheet, class items, and the Short Rest dialog. |
| Track Weapon Ammo | On | Enables magazine size/remaining-shots tracking and Reload activities for Shot Capacity weapons. |
| Show Base D&D Special Traits | Off | Shows the native Feats/Racial Traits/Global Bonuses fields alongside this system's own Special Traits. |

See [docs/settings.md](docs/settings.md) for details on what each one gates.

## Content

Compendiums are included for character origins, classes and subclasses, backgrounds, equipment, monster features, light abilities, weapon perks, spells, rules, and a full Player's Guide, along with a set of pre-built starter Guardians.

## License

This system is a fork of [dnd5e](https://github.com/foundryvtt/dnd5e) and is distributed under the same MIT license — see [LICENSE](LICENSE) for details. Dungeons & Destiny content is used under the terms of the [Systems Reference Document 5.1](https://www.dndbeyond.com/srd) and Foundry Virtual Tabletop's [Limited License](LICENSE.txt).

**I AM IN NO WAY AFFILIATED WITH BUNGIE OR VELVET FANG.**

## Links

- [Source Code](https://github.com/thedreamweaver150/DnDestiny-FoundryVTT)
