# Guardians & Ghosts

## The Ghost actor type

**Ghost** is its own Actor type (`dndestiny.ghost`), separate from Character and NPC. Mechanically it currently reuses the Character sheet and data model outright, so a Ghost looks and plays like a Player Character — every character-only customization below (Shield meters, Grenades, Foundation, Core Light Abilities, Light Ability slots, etc.) treats a Ghost the same as a Character.

### Linking a Ghost to a Guardian

A Character sheet has a **Ghost** card next to the Light Abilities section. Drag a Ghost actor onto it to link the two; click the linked portrait to open the Ghost's sheet, or the X to unlink. The link is one-directional data (stored as a flag on the Character pointing at the Ghost), and drives:

- The **Send to Ghost** / **Send to Player** buttons on each actor's Inventory tab (see below).
- Quick access to the Ghost's sheet from the Character sheet.

## Memory (Ghost inventory capacity)

A Ghost doesn't use Strength-based Carrying Weight. Instead, its Inventory tab shows a **Memory** meter in place of the native Encumbrance card:

- **Total Memory** = 15 × the Ghost's Intelligence **score** (not modifier).
- Every physical/inventory item (Weapon, Equipment, Consumable, Tool, Loot, Container) has its own **Memory Cost**, set on the item's Details tab. This is charged **per item slot held, not per unit** — a full stack of 99 of something with Memory Cost 1 still only costs 1 Memory, the same as holding a single one.
- An item can optionally set a **Maximum Stack** size; dropping more onto a Ghost than that automatically splits the excess into a new stack (its own Memory slot).
- An item can be flagged **"Cannot be stored in a Ghost's inventory"** on its own sheet — blocked whether dragged directly onto a Ghost, sent via the Send to Ghost button, or imported from a compendium.

### Glimmer

Glimmer (Destiny's currency, replacing standard coinage) behaves like a stacked item for Memory purposes: every 250,000 Glimmer (or fraction of it) costs 1 Memory. The Glimmer field on a Ghost's Inventory tab is restyled into its own "Glimmer Storage" card with comma-formatted numbers; the native "Manage Currency" conversion button is removed since a Ghost only ever holds Glimmer.

## Sending items between Character and Ghost

Once a Character and Ghost are linked, each physical inventory row gets a **Send to Ghost** (Character sheet) or **Send to Player** (Ghost sheet) button alongside the native item controls. This moves the item (and any contents, if it's a container) to the other actor — the same underlying move used by a normal drag between two actor sheets, so nested containers and stacking rules are respected. An item flagged as Ghost-blocked can't be sent to a Ghost this way.

## Ghost Shells

**Ghost Shells** are a real armor type (`ghostShell`), mechanically identical to Light/Medium/Heavy armor (AC, Dex cap, Strength requirement, Stealth) but categorized separately so they read correctly as something worn by the Ghost rather than the Guardian. Equipped the same way as any other armor — the inventory row's native equip toggle — with the same "only one equipped at once" rule enforced. A Ghost's unarmored AC is 12 + Dex.
