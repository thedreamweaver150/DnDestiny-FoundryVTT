const { NumberField, SchemaField, StringField, ArrayField, BooleanField, SetField } = foundry.data.fields;
const { getProperty } = foundry.utils;

const MODULE_ID = "dndestiny";
// Module-contributed Actor sub-types are namespaced by Foundry as
// "<module id>.<type>" (see documentTypes.Actor in module.json) - this is
// the actual system.type string a "Ghost" actor gets, not the bare "ghost"
// its module.json entry is keyed under.
const GHOST_ACTOR_TYPE = `${MODULE_ID}.ghost`;
// Ghost currently reuses dndestiny's own CharacterData/CharacterActorSheet
// outright and is meant to look/behave identically to a Player Character
// for now (see the "Ghost" actor type registration in the init hook) - so
// every one of this module's own character-only customizations (Shield
// meters, Grenades, Foundation, Core Light Abilities, etc.) needs to keep
// treating a Ghost actor the same as a "character" one, not skip it.
const isCharacterLikeActor = (actor) => actor?.type === "character" || actor?.type === GHOST_ACTOR_TYPE;
// Set in the "init" hook once the vanilla "Player Character" sheet class
// exists (see that registration below) - handleSheetRender checks this
// class identity to skip this whole module's customization injection
// pipeline entirely for any actor using it, so it stays genuine unmodified
// D&D5e rather than a half-Destiny-ified hybrid.
let VanillaCharacterActorSheet;
// Physical/inventory item types - the ones that actually show up in an
// actor's Inventory tab with a quantity - get a Memory Cost field for the
// Ghost sheet's Memory tracking (see injectGhostMemoryCard/
// injectGhostItemMemory). Feats/classes/spells/etc. aren't inventory items
// so they're left out.
const GHOST_MEMORY_ITEM_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];
// Flagged via a checkbox on the item's own sheet (see injectGhostBlockedField)
// - an item so marked can never end up in a Ghost's inventory, whether
// dragged there directly, imported from a compendium, or sent with the
// "Send to Ghost" button (see the preCreateItem hook and sendItemToActor).
const isGhostBlockedItem = (item) => GHOST_MEMORY_ITEM_TYPES.includes(item?.type) && !!item.system?.dndestinyGhostBlocked;
// Ghost Shells - a real CONFIG.DND5E.armorTypes entry (see the init hook),
// identical mechanically to Light/Medium/Heavy armor (AC/Dex cap/Str
// requirement/Stealth), just worn by the Ghost instead of the Guardian.
// Equipped via its own native inventory-row toggle like any other armor -
// see the AttributesFields#prepareArmorClass patch (Ghost's 12 + Dex
// unarmored AC) and the updateItem hook enforcing only one equipped at once.
const GHOST_SHELL_TYPE_KEY = "ghostShell";
const isGhostShellItem = (item) => item?.type === "equipment" && item.system?.type?.value === GHOST_SHELL_TYPE_KEY;
// Weapon Perks (Chapter 6: Customization) - a dedicated "Perk" Item type
// (see the init hook's registration) rather than reusing the native
// Feature/Feat type, so a perk never gets confused with a class feature in
// the Create Item dialog. See injectWeaponCustomizationTab/
// injectPerkDetailsFields for how these get authored and slotted.
const PERK_ITEM_TYPE = `${MODULE_ID}.perk`;
const isPerkItem = (item) => item?.type === PERK_ITEM_TYPE;
// Light Abilities/Grenades used to be authored as native "spell" items
// (with the item type globally relabeled "Light Ability" everywhere,
// including for actual spells) since this game had no real spellcasting to
// keep the native type around for. Real spells are back now, so Light
// Abilities get their own dedicated type instead - same reasoning and same
// pattern as PERK_ITEM_TYPE above (a Feature-based data model, not a
// from-scratch one - see the "init" hook registration). See
// isGrenadeItem/isAbilitySlotItem below and the one-time migration in the
// "ready" hook that moves every existing Light Ability/Grenade item
// (identified by having a dndestinyAbilitySlot set - real spells never do)
// from "spell" to this type.
const LIGHT_ABILITY_ITEM_TYPE = `${MODULE_ID}.lightAbility`;
const isLightAbilityTypeItem = (item) => item?.type === LIGHT_ABILITY_ITEM_TYPE;
// How many perk slots a weapon's Tier unlocks (Weapon Tiers table, Chapter
// 6) - cumulative, e.g. Tier 2 has both Slot 1 and Slot 2 available.
const WEAPON_TIER_SLOT_COUNTS = { 0: 0, 1: 1, 2: 2, 3: 3 };
// The 3 perk slot fields on a weapon, alongside the CSS class used for each
// slot's drop-target element in the Customization tab (see
// injectWeaponCustomizationTab).
const PERK_SLOT_FIELDS = [
  [1, "dndestinyPerkSlot1", "dndestiny-perk-slot-1"],
  [2, "dndestinyPerkSlot2", "dndestiny-perk-slot-2"],
  [3, "dndestinyPerkSlot3", "dndestiny-perk-slot-3"]
];
// Weapon classes a Perk can be tagged for (its dndestinyPerkWeaponClasses
// field - see injectPerkDetailsFields), keyed by that weapon's own
// "system.type.baseItem" (see CONFIG.DND5E.weaponIds) so tagging a perk
// means literally picking which of this module's weapons it fits, the same
// identifier dndestiny itself already uses to distinguish weapon base types.
// Add a weapon here as it's built - nothing else needs updating for a new
// weapon class to become taggable.
// Special sentinel weapon-class key for the "Melee Weapon (Any)" table -
// unlike every other entry here (one specific weapon's baseItem), this
// isn't tied to a single weapon at all; a perk tagged with this key is
// available on ANY melee weapon (system.type.value simpleM/martialM - see
// getPerkSlotForWeapon). Some of its own Slot 3 perks additionally require
// a specific weapon property (Finesse/Reach/etc, per Chapter 6) - that part
// isn't validated in code, just noted in the perk's own description, the
// same as every other rules nuance this module leaves to the table to
// self-enforce (see the List of Perks terminology).
const MELEE_ANY_WEAPON_CLASS = "anyMelee";
const WEAPON_CLASSES = [
  ["dndestinyAutoRfl", "Auto Rifle"],
  [MELEE_ANY_WEAPON_CLASS, "Melee Weapon (Any)"],
  ["dndestinyCmbtBow", "Combat Bow"],
  ["dndestinyFusionR", "Fusion Rifle"],
  ["dndestinyGrenLnc", "Grenade Launcher"],
  ["dndestinyHandCan", "Hand Cannon"],
  ["dndestinyLMG0000", "Light Machine Gun"],
  ["dndestinyLinFusR", "Linear Fusion Rifle"],
  ["dndestinyPulseRf", "Pulse Rifle"],
  ["dndestinyRockLnc", "Rocket Launcher"],
  ["dndestinyScoutRf", "Scout Rifle"],
  ["dndestinyShotgun", "Shotgun"],
  ["dndestinySidearm", "Sidearm"],
  ["dndestinySniperR", "Sniper Rifle"],
  ["dndestinySubmGun", "Submachine Gun"],
  ["dndestinyTraceRf", "Trace Rifle"]
];
// Weapon type values (system.type.value) that count as "melee" for
// MELEE_ANY_WEAPON_CLASS matching - the two native dndestiny melee weapon
// categories. Firearms/bows are never melee, so they're not listed here.
const MELEE_WEAPON_TYPE_VALUES = ["simpleM", "martialM"];
// Glimmer storage works like an item stack with an implicit Max Stack of
// 250,000 - every 250,000 (or fraction thereof) takes up 1 Memory, same as
// a physical item stack (see getGhostGlimmerMemory).
const GHOST_GLIMMER_PER_MEMORY = 250000;
// Flag (on a Character actor) storing the world Actor id of whichever Ghost
// is linked for quick sheet access from the Core Light Abilities tab - see
// injectCoreLightAbilitiesTab/getLinkedGhost.
const GHOST_LINK_FLAG = "linkedGhostId";
// "Jack of all Guns" Special Trait (see injectJackOfAllGunsTrait/the
// AttackActivity#getAttackData patch in the "init" hook) - a Foundry key
// (flags.dndestiny.jackOfAllGuns) usable directly in an Active Effect's
// change key to toggle it, the same way dndestiny's own "Jack of All Trades"
// is toggled via flags.dndestiny.jackOfAllTrades.
const JACK_OF_ALL_GUNS_FLAG = "jackOfAllGuns";
const editingHpActors = new Set();
// Whatever an actor's HP input currently shows while mid-edit (not yet
// committed via change/blur) - see bindMeterEvents/injectShieldMeters. A
// sheet re-render mid-edit (any actor update, ours or another module's,
// while the user is still typing) rebuilds this input from scratch; without
// this, that rebuild would silently discard the in-progress edit and show
// the old saved value instead.
const editingHpValues = new Map();

// World-scoped toggles, exposed in Foundry's Settings menu (see the
// game.settings.register calls in the init hook) so a GM can bring back
// content this module hides by default.
const SETTING_HIDE_SPELLS_TAB = "hideSpellsTab";
const SETTING_HIDE_HIT_DICE = "hideHitDice";
const SETTING_TRACK_AMMO = "trackAmmo";
const SETTING_SHOW_BASE_SPECIAL_TRAITS = "showBaseSpecialTraits";

// Weapon Properties checkbox-grid grouping (see injectWeaponPropertyGroups).
// Anything not listed here is a native dndestiny property and falls under
// "Default Weapon Properties" automatically - these three lists only need
// to name the custom dndestiny* ones that belong in a different group.
const GENERAL_WEAPON_PROPERTY_KEYS = [
  "dndestinyAgile", "dndestinyOneHanded", "dndestinyRange", "dndestinyCumbersome", "dndestinyElemental"
];
const FIREARM_PROPERTY_KEYS = [
  "dndestinyAutoFire", "dndestinyEnergyProjectiles", "dndestinyHighRecoil", "dndestinyPayload",
  "dndestinyShotCapacity", "dndestinyScope"
];
const SPECIAL_WEAPON_PROPERTY_KEYS = [
  "dndestinyCombatBow", "dndestinyGrenadeLauncher", "dndestinyTraceRifle"
];
const FIREARM_WEAPON_TYPES = ["simpleF", "martialF"];
const isFirearmItem = (item) => item?.type === "weapon" && FIREARM_WEAPON_TYPES.includes(item.system?.type?.value);

// Named Ammo Type pools a Consumable can be tagged as (see
// injectMagazineField), and which weapons draw from which pool on Reload
// (see getRequiredAmmoType/reloadWeapon). Rocket Launcher is the one
// exception carved out of the general Martial Magazine pool - every other
// Martial Firearm shares it, same as every Simple Firearm shares Simple
// Magazine.
const AMMO_TYPES = {
  simple: "Simple Magazine",
  martial: "Martial Magazine",
  rocket: "Rockets"
};
const ROCKET_LAUNCHER_BASE_ITEM = "dndestinyRockLnc";

// Utility Math Helpers
const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
const getPct = (val, max) => clamp(max > 0 ? (val / max) * 100 : 0, 0, 100);

// Safe DOM Root Resolver
const getRootElement = (target) => {
  if (!target) return null;
  if (typeof target.querySelector === "function") return target;
  if (target.element && typeof target.element.querySelector === "function") return target.element;
  if (target[0] && typeof target[0].querySelector === "function") return target[0];
  return null;
};

// The class item that determines an actor's per-class derived stats (Light
// Ability/Level, Shield Die). For a multiclassed actor, the class with the
// most levels invested wins.
const getPrimaryLightClass = (actor) => {
  const classes = actor?.items?.filter(i => i.type === "class") ?? [];
  if (!classes.length) return null;
  return classes.reduce((best, c) => (c.system?.levels ?? 0) > (best.system?.levels ?? 0) ? c : best);
};

// Light Level advances once every 4 levels of the primary Light class
// (1-4 -> 1, 5-8 -> 2, ...) - shown on the Core Light Abilities tab and
// exposed to roll formulas as @dndestiny.lightLevel (see the
// Actor5e#getRollData patch in the "init" hook), so e.g. an Attack or
// Damage formula can add it directly. Also drives the "Light Level" Damage
// Scaling mode (see the DamageData#scaledFormula patch in the "init" hook).
const getLightLevel = (actor) => {
  const classLevel = getPrimaryLightClass(actor)?.system?.levels;
  return classLevel != null ? Math.ceil(classLevel / 4) : null;
};

// The actor's Light Ability modifier - the ability score the primary Light
// class designates via its own Light Ability dropdown (system.lightAbility -
// see injectClassLightAbilityField), same source the Core Light Abilities
// tab's Attack/Save DC math already uses (see the Light Save DC activity
// patch below). Exposed to roll formulas as @dndestiny.lightAbilityMod (see
// the Actor5e#getRollData patch in the "init" hook) - native dndestiny's own
// @mod key resolves off the actor's spellcasting ability attribute, which
// these classes never set (they don't use dndestiny's native spellcasting
// system at all), so @mod alone silently comes out as 0 for a Light Ability.
const getLightAbilityMod = (actor) => {
  const abilityId = getPrimaryLightClass(actor)?.system?.lightAbility;
  return abilityId ? (actor?.system?.abilities?.[abilityId]?.mod ?? null) : null;
};

// Meter Configuration Map
const METER_CONFIG = [
  { key: "hp", label: "HIT POINTS", color: "#22c55e", path: "attributes.hp", defaultVal: 0, defaultMax: 10 },
  { key: "shield", label: "SHIELDS", color: "#ffffff", path: "shields", defaultVal: 0, defaultMax: 0 },
  { key: "overshield", label: "OVERSHIELDS", color: "#00bfff", path: "overshields", defaultVal: 0, defaultMax: 0 }
];

// Destiny Damage Types - defined at module scope (not just inside the init
// hook) so both the init hook (registers them on CONFIG.DND5E.damageTypes)
// and the ready hook (groups them for the trait selectors - see the
// "Paracausal Damage" categorization below) can reference the same objects.
const damageIcon = (key) => `systems/dndestiny/assets/icons/svg/damage/${key}.webp`;
const PARACAUSAL_DAMAGE_TYPES = {
  arc: { label: "Arc", icon: damageIcon("arc"), color: new Color(0x79E6F3) },
  solar: { label: "Solar", icon: damageIcon("solar"), color: new Color(0xFF8A3D) },
  void: { label: "Void", icon: damageIcon("void"), color: new Color(0xB185DE) },
  kinetic: { label: "Kinetic", icon: damageIcon("kinetic"), isPhysical: true, color: new Color(0xE0E0E0) },
  light: { label: "Light", icon: damageIcon("light"), color: new Color(0xFFF4D6) },
  darkness: { label: "Darkness", icon: damageIcon("darkness"), color: new Color(0x2B0033) }
};

// Destiny-specific status conditions, shown as their own toggleable section
// on the character sheet's Effects tab, right below dndestiny's native
// "Conditions" list (see injectDestinyConditions). Registered into
// CONFIG.DND5E.conditionTypes with pseudo: true (in the "init" hook) so each
// still gets a normal CONFIG.statusEffects entry - usable by
// ActiveEffect.fromStatusEffect and the token HUD, the same toggle mechanism
// dndestiny's own conditions use - without folding into the NATIVE list, which
// dndestiny builds from every non-pseudo conditionTypes entry.
// `desc` is placeholder tooltip copy (see injectDestinyConditions) - meant
// to be rewritten with real rules text later.
const DESTINY_CONDITIONS = [
  { id: "dndestinyActiveCamouflage", name: "Active Camouflage", img: "systems/dndestiny/icons/svg/statuses/invisible.svg", desc: "Placeholder description for Active Camouflage." },
  { id: "dndestinyAiming", name: "Aiming", img: "icons/svg/target.svg", desc: "Placeholder description for Aiming." },
  { id: "dndestinyBurning", name: "Burning (Destiny)", img: "systems/dndestiny/icons/svg/statuses/burning.svg", desc: "Placeholder description for Burning." },
  { id: "dndestinyCombatProne", name: "Combat-prone", img: "systems/dndestiny/icons/svg/statuses/prone.svg", desc: "Placeholder description for Combat-prone." },
  { id: "dndestinyElectrified", name: "Electrified", img: "icons/svg/lightning.svg", desc: "Placeholder description for Electrified." },
  { id: "dndestinyEmpowered", name: "Empowered", img: "icons/svg/aura.svg", desc: "Placeholder description for Empowered." },
  { id: "dndestinySuppressed", name: "Suppressed", img: "icons/svg/silenced.svg", desc: "Placeholder description for Suppressed." },
  { id: "dndestinyTethered", name: "Tethered", img: "icons/svg/anchor.svg", desc: "Placeholder description for Tethered." },
  { id: "dndestinyWeakened", name: "Weakened", img: "systems/dndestiny/icons/svg/statuses/exhaustion.svg", desc: "Placeholder description for Weakened." }
];

// Mirrors dndestiny's own internal staticID() (truncate/pad to 16 chars) - the
// convention actor.effects IDs use for condition toggle effects, so our
// custom conditions round-trip through the same ID scheme dndestiny's native
// condition-toggle handler uses. dndestiny's own call site prepends
// "dndestiny" itself (its own status ids are bare, e.g. "blinded"), but every
// id in DESTINY_CONDITIONS already includes that prefix (e.g.
// "dndestinyAiming") - callers here must NOT prepend it again, or every
// condition's id collapses to the same 16-char prefix ("dndestinydndesti")
// and they all end up sharing one ActiveEffect.
const dndestinyStaticID = (id) => (id.length >= 16 ? id.substring(0, 16) : id.padEnd(16, "0"));

async function toggleDestinyCondition(actor, conditionId) {
  const effectId = dndestinyStaticID(conditionId);
  const existing = actor.effects.get(effectId);
  if (existing) return existing.delete();
  const effect = await ActiveEffect.implementation.fromStatusEffect(conditionId);
  // fromStatusEffect computes its own _id as staticID(`dndestiny${conditionId}`)
  // internally (needed so its CONFIG.statusEffects lookup finds our
  // already-"dndestiny"-prefixed id), which independently reproduces the same
  // collision - every condition would otherwise share this effectId regardless.
  // effect is a DataModel instance here, not a plain object - assigning
  // effect._id directly is silently a no-op (verified live), so go through
  // toObject() first to get something the override actually sticks to.
  const effectData = effect.toObject();
  effectData._id = effectId;
  return ActiveEffect.implementation.create(effectData, { parent: actor, keepId: true });
}

// Injects a second "Conditions"-style section on the character sheet's
// Effects tab, right after dndestiny's own, listing DESTINY_CONDITIONS with the
// same look and toggle behavior as the native list. Binds its own click
// handling rather than relying on dndestiny's <dndestiny-effects> custom element
// picking up our injected rows for free - that element only wires up
// [data-action] listeners once, over whatever's present at its first
// connectedCallback, so anything injected afterward (like this) never gets
// noticed by it.
function injectDestinyConditions(actor, rootElement) {
  const nativeList = rootElement.querySelector(".conditions-list");
  if (!nativeList) return;

  let list = rootElement.querySelector(".dndestiny-conditions-list");
  if (!list) {
    const nativeSection = nativeList.closest("section.items-list");
    const section = document.createElement("section");
    section.className = "items-list";
    section.innerHTML = `
      <div class="items-section card">
        <div class="items-header header">
          <h3 class="item-name">Destiny Conditions</h3>
        </div>
        <ul class="conditions-list unlist dndestiny-conditions-list"></ul>
      </div>
    `;
    (nativeSection ?? nativeList).after(section);
    list = section.querySelector(".dndestiny-conditions-list");

    list.addEventListener("click", (e) => {
      const row = e.target.closest("[data-condition-id]");
      if (row) toggleDestinyCondition(actor, row.dataset.conditionId);
    });
  }

  list.innerHTML = DESTINY_CONDITIONS.map(c => {
    const effect = actor.effects.get(dndestinyStaticID(c.id));
    const disabled = !effect;
    return `
      <li class="condition ${disabled ? "" : "active"}" data-condition-id="${c.id}">
        <div class="icon"><dndestiny-icon src="${effect?.img ?? c.img}"></dndestiny-icon></div>
        <div class="name-stacked"><span class="title">${c.name}</span></div>
        <i class="fa-solid fa-toggle-${disabled ? "off" : "on"}"></i>
      </li>
    `;
  }).join("");

  DESTINY_CONDITIONS.forEach(c => {
    const row = list.querySelector(`[data-condition-id="${c.id}"]`);
    if (row) applyParchmentTooltip(row, buildRuleTooltipHtml(c.name, c.desc), "dndestiny-tooltip rule-tooltip dnd5e2");
  });
}

// Mirrors templates/journal/page-rule-tooltip.hbs (RuleJournalPageData#richTooltip)
// markup exactly, so a Destiny Condition's tooltip - applied with that same
// "dndestiny-tooltip rule-tooltip dnd5e2" class combo - renders pixel-identical
// to the native rule/condition tooltips (e.g. hovering "Unconscious" elsewhere
// on the sheet), rather than approximating their look with bespoke CSS.
function buildRuleTooltipHtml(name, desc) {
  return `
    <section class="content">
      <section class="header">
        <h2>${name}</h2>
        <ul class="pills">
          <li class="pill condition">Condition</li>
        </ul>
      </section>
      <section class="description">${desc}</section>
    </section>
  `;
}

// The custom "Brief Rest" option added to every native Recovery Period
// dropdown (system.uses.recovery.N.period on an item, uses.recovery.N.period
// on an activity) - see injectBriefRestPeriodOnItem/OnActivity. Unlike
// LIGHT_RECHARGE_PERIOD, this behaves exactly like a native period (a flat/
// formula recovery through the existing Type/Formula fields, no custom UI
// needed) and applies to every item/activity, not just Light Abilities - a
// Brief Rest is meant to be a general "quick breather", same as Short/Long
// Rest. See recoverBriefRestUses for how the button below actually
// processes it.
const BRIEF_REST_PERIOD = "dndestinyBriefRest";

// "Brief Rest" button - sits in its own row directly above the native
// Short/Long Rest buttons in the character sheet header, matching their
// icon-only "gold-button" styling. Unlike an actual Short/Long Rest, it only
// restores Shields (system.shields.value) back to max - Overshields are left
// alone, since in Destiny those are a temporary combat buff you're meant to
// lose over time, not something a quick breather gives back. Also recovers
// any item/activity Uses configured with the "Brief Rest" Recovery Period
// (see BRIEF_REST_PERIOD/recoverBriefRestUses).
function injectBriefRestButton(actor, rootElement) {
  if (!isCharacterLikeActor(actor)) return;

  const nativeButtons = rootElement.querySelector(".sheet-header-buttons:not(.dndestiny-brief-rest-row)");
  if (!nativeButtons || rootElement.querySelector(".dndestiny-brief-rest-row")) return;

  const row = document.createElement("div");
  row.className = "sheet-header-buttons dndestiny-brief-rest-row";
  row.innerHTML = `
    <button type="button" class="brief-rest gold-button" data-tooltip="Brief Rest" aria-label="Brief Rest">
      <i class="fa-solid fa-shield-halved" inert></i>
    </button>
  `;
  nativeButtons.before(row);

  row.querySelector("button").addEventListener("click", async () => {
    const max = actor.system.shields?.max ?? 0;
    await actor.update({ "system.shields.value": max });
    const recoveredRolls = await recoverBriefRestUses(actor);

    let content = `${actor.name} takes a Brief Rest and restores Shields to ${max}.`;
    for (const roll of recoveredRolls) content += `<br>${roll.options?.flavor ?? await roll.render()}`;
    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
  });
}

// Recovers every item's (and, since ActivitiesTemplate#recoverUses already
// walks an item's own activities internally, every activity's) Uses
// configured with the "Brief Rest" Recovery Period - the exact same
// UsesField#recoverUses pipeline Actor5e#_getRestItemUsesRecovery uses for a
// real Short/Long Rest, just triggered from the Brief Rest button instead of
// the native rest dialog, and scoped to only the BRIEF_REST_PERIOD period.
// Returns any recovery rolls (e.g. a formula-based Recovery) so the Brief
// Rest chat message can include them.
async function recoverBriefRestUses(actor) {
  const periods = new Map([[BRIEF_REST_PERIOD, 1]]);
  const updateItems = [];
  const deleteItems = [];
  const rolls = [];

  for (const item of actor.items) {
    if (item.isHidden || typeof item.system.recoverUses !== "function") continue;
    const { updates, rolls: itemRolls, destroy } = await item.system.recoverUses(periods);
    if (destroy) deleteItems.push(item.id);
    else if (updates && !foundry.utils.isEmpty(updates)) updateItems.push({ _id: item.id, ...updates });
    if (itemRolls?.length) rolls.push(...itemRolls);
  }

  if (updateItems.length) await actor.updateEmbeddedDocuments("Item", updateItems);
  if (deleteItems.length) await actor.deleteEmbeddedDocuments("Item", deleteItems);
  return rolls;
}

// Shared by injectBriefRestPeriodOnItem/OnActivity - adds "Brief Rest" to a
// single native Recovery Period <select> and, only the first time this
// particular <select> node is seen, corrects a freshly-rendered element's
// value if its actually-stored period is Brief Rest (a brand new <select>
// has no idea our option exists yet, so the browser defaults it to the
// first native option instead - same stale-value problem
// injectLightRechargeRecoveryOption solves the same way, and for the same
// reason: never re-forcing this on a node we've already bound, since a
// user's own in-progress change to THIS SAME select can still be mid-flight
// (item.update()/activity update is async) when this pipeline reruns from
// that very edit.
function addBriefRestPeriodOption(select, storedPeriod) {
  if (!select.querySelector(`option[value="${BRIEF_REST_PERIOD}"]`)) {
    const option = document.createElement("option");
    option.value = BRIEF_REST_PERIOD;
    option.textContent = "Brief Rest";
    select.appendChild(option);
  }

  if (!select.dataset.dndestinyBriefRestBound) {
    select.dataset.dndestinyBriefRestBound = "true";
    if (storedPeriod === BRIEF_REST_PERIOD && select.value !== storedPeriod) select.value = storedPeriod;
  }
}

// Adds "Brief Rest" to every Recovery Period dropdown on an item's own Uses
// config (Details tab) - every item type, not just Light Abilities (see
// BRIEF_REST_PERIOD). Registered as its own render hook (not part of the
// shared handleItemSheetRender pipeline) since that pipeline only reaches a
// handful of item types - this needs every one of them.
function injectBriefRestPeriodOnItem(app, rootElement) {
  const item = app?.document;
  if (!item || item.documentName !== "Item" || !rootElement) return;

  const selects = rootElement.querySelectorAll('select[name^="system.uses.recovery."][name$=".period"]');
  for (const select of selects) {
    const index = Number(select.closest("[data-index]")?.dataset.index);
    addBriefRestPeriodOption(select, item.system?.uses?.recovery?.[index]?.period);
  }
}

// Same as injectBriefRestPeriodOnItem, for an Activity's own Uses config
// (its Recovery Period fields are named "uses.recovery.N.period", with no
// "system." prefix, since they're relative to the activity's own data
// rather than the item's).
function injectBriefRestPeriodOnActivity(app, rootElement) {
  const activity = app?.activity;
  if (!activity || !rootElement) return;

  const selects = rootElement.querySelectorAll('select[name^="uses.recovery."][name$=".period"]');
  for (const select of selects) {
    const index = Number(select.closest("[data-index]")?.dataset.index);
    addBriefRestPeriodOption(select, activity.uses?.recovery?.[index]?.period);
  }
}

// Grenades are Spell items (renamed to "Light Ability" - see the i18nInit
// hook) flagged system.dndestinyAbilitySlot === "grenade" - selected from
// the same Core Ability Slot dropdown as Superclass/Melee/Super (see
// ABILITY_SLOT_CHOICES/injectAbilitySlotField). They're pulled out of the
// normal Spells list and shown on the Core Light Abilities tab instead.
const GRENADE_SLOT_KEY = "grenade";
const isGrenadeItem = (item) => isLightAbilityTypeItem(item) && item.system?.dndestinyAbilitySlot === GRENADE_SLOT_KEY;
const RECHARGE_DICE = ["d4", "d6", "d8", "d10", "d12", "d20"];
// Options for dndestinyDamageDenomination (see injectAbilitySlotField) - a
// plain numeric field (not a "dX" string like Recharge Die) so it lines up
// with dndestiny's own damage.parts.denomination values and CONFIG.DND5E.dieSteps,
// letting Active Effects step it up/down by +/-2 the same way dndestiny's native
// Versatile property does (see DamageData#steppedDenomination upstream).
const DAMAGE_DICE = [4, 6, 8, 10, 12];
const ACTIVE_GRENADE_FLAG = "activeGrenadeId";
const SOURCE_GRENADE_FLAG = "sourceGrenadeUuid";
const MAX_CLASS_GRENADES = 3;

// Foundations are Background items (system.dndestinyIsFoundation === true)
// - same underlying item type as a normal Background, just flagged so the
// two can coexist without a Foundation stealing the actor's single
// "official" system.details.background slot (see the _onCreate/_preDelete
// patch on the background data model, in the init hook).
const isFoundationItem = (item) => item?.type === "background" && item.system?.dndestinyIsFoundation === true;
const MAX_FOUNDATIONS = 2;

// Core ability slots - Superclass/Melee/Super Ability are Spell items
// flagged with system.dndestinyAbilitySlot (one of the keys below). Unlike
// Grenades, they're not tied to a class - the player picks one per slot
// freely (e.g. on level up), capped at 1 per slot (see CAPPED_ITEM_TYPES)
// with a single charge each (enforced on creation, see the preCreateItem
// hook).
const ABILITY_SLOTS = [
  { key: "superclass", label: "Superclass Ability" },
  { key: "melee", label: "Melee Ability" },
  { key: "super", label: "Super Ability" }
];
const isAbilitySlotItem = (item) => isLightAbilityTypeItem(item) && ABILITY_SLOTS.some(s => s.key === item.system?.dndestinyAbilitySlot);
// The Core Ability Slot dropdown's full option list (see
// injectAbilitySlotField) - Grenade is selectable there too, unifying it
// with the 3 true ability slots into a single dropdown, but deliberately
// left out of ABILITY_SLOTS itself so it doesn't pick up that array's 1-per-
// slot cap or its own row on the Core Light Abilities tab (grenades keep
// their existing up-to-MAX_CLASS_GRENADES/class-synced behavior instead).
const ABILITY_SLOT_CHOICES = [...ABILITY_SLOTS, { key: GRENADE_SLOT_KEY, label: "Grenade" }];
// Any Light Ability with a Core Ability Slot set at all - the 3 named
// slots or Grenade. All of them get a Recharge check (see
// injectLightRechargeRecoveryOption/renderAbilitySlotList) since the spell
// schema carries dndestinyRechargeDie/dndestinyRechargeThreshold
// unconditionally.
const hasAbilitySlot = (item) => isGrenadeItem(item) || isAbilitySlotItem(item);
// The custom "Light Ability Recharge" option added to the native Recovery
// period dropdown (system.uses.recovery.N.period) on hasAbilitySlot items -
// see injectLightRechargeRecoveryOption. A plain string, not a real entry
// in CONFIG.DND5E.limitedUsePeriods (that config's recoveryOptions getter
// is non-configurable, so it can't be patched) - the period field itself
// is just a free-form StringField with no choices restriction, so any
// string round-trips through save/load fine.
const LIGHT_RECHARGE_PERIOD = "dndestinyLightRecharge";

// Tool Descriptions Dictionary for Sheet Tooltips
const TOOL_DESCRIPTIONS = {
  armorsmithing:  "Used to forge, modify, and field-repair armor plating, exosuits, and defensive field generators.",
  climbing:       "Equipped with pitons, harness, and ascenders for navigating steep cliffs, shafts, and ruined structures.",
  cooking:        "Utilized to prepare field rations and specialized consumables during short or long rests.",
  electronics:    "Essential for hacking encryption nodes, splicing wiring, and repairing micro-avionics.",
  medical:        "Contains bio-foam, trauma kits, and surgical tools to stabilize and heal wounded allies.",
  scuba:          "Specialized breathing rebreathers and depth gear for aquatic and high-pressure environments.",
  sewing:         "Used to tailor, weave, and repair Hunter cloaks, Titan marks, Warlock bonds, and fabric gear.",
  thieves:        "Lockpicks, tension bars, and micro-mirrors for bypassing physical security locks and safe boxes.",
  vehicle:        "Tools for tuning, servicing, and field-repairing Sparrows, jumpships, and ground transport.",
  weaponsmithing: "Used to maintain, calibrate, assemble, and repair kinetic, energy, and power weapons.",
  whittling:      "Fine carving tools for crafting wooden components, stock fittings, and decorative emblems.",
  sparrows:       "Proficiency in maneuvering high-speed personal hover vehicles across land and rough terrain.",
  jumpships:      "Proficiency in piloting atmospheric, orbital, and interplanetary sub-light transport craft.",
  freighter:      "Proficiency in commanding and navigating heavy bulk transport freighters and cargo ships.",
  hawk:           "Proficiency in tactical VTOL flight operations, combat insertions, and air support dropships."
};

// ==========================================
// 1. SYSTEM INITIALIZATION & CONFIGURATION
// ==========================================
// Our hide/show logic re-runs on every sheet render (see
// bindInjectionPipeline) but toggling a world setting doesn't itself
// trigger one - this forces every currently-open Actor/Item sheet to
// re-render so a setting change is reflected immediately instead of only on
// the next natural re-render.
const refreshOpenSheets = () => {
  for (const app of foundry.applications.instances.values()) {
    if (app.actor || app.document?.documentName === "Item") app.render();
  }
};

Hooks.once("init", () => {
  console.log("Dungeons & Destiny | Initializing System Modifications");

  // Exposed for PERK_MACRO_BRIDGE - Midi-QOL's "function.X" on-use macro
  // syntax calls this by name (see ensurePerkMacroBridge/runPerkMacro), so
  // it needs to be reachable as a real global expression, not just a
  // module-scoped function. Assigned as a property (not `game.dndestiny =
  // {...}`) because game.dndestiny IS game.system now that this system's
  // own id is "dndestiny" - replacing the whole object would wipe out
  // everything the engine's own init hook already attached to it
  // (bastion, tooltips, settings, etc.), breaking core dnd5e startup.
  game.dndestiny.runPerkMacro = runPerkMacro;

  game.settings.register(MODULE_ID, SETTING_HIDE_SPELLS_TAB, {
    name: "Hide Spells Tab",
    hint: "Hides the Spells tab on character sheets. Disable to show it again.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshOpenSheets
  });

  game.settings.register(MODULE_ID, SETTING_HIDE_HIT_DICE, {
    name: "Hide Hit Dice",
    hint: "Hides Hit Dice everywhere - the character sheet, a class item's Hit Dice field, and the Short "
      + "Rest dialog - reserved for a future dedicated character sheet. Disable to show them again.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshOpenSheets
  });

  game.settings.register(MODULE_ID, SETTING_TRACK_AMMO, {
    name: "Track Weapon Ammo",
    hint: "Optional rule: weapons flagged with the Shot Capacity property show a magazine size, shots "
      + "remaining, and a Reload Activity that consumes a matching Ammo Type item from the actor's inventory. "
      + "Disable to treat Shot Capacity as purely descriptive with no tracking UI.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: refreshOpenSheets
  });

  game.settings.register(MODULE_ID, SETTING_SHOW_BASE_SPECIAL_TRAITS, {
    name: "Show Base D&D Special Traits",
    hint: "The character sheet's Special Traits tab hides dndestiny's native Feats/Racial Traits/Global Bonuses "
      + "fieldsets by default, leaving just this module's own \"Jack of all Guns\" trait. Enable to show "
      + "the native ones again alongside it.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: refreshOpenSheets
  });

  // Renames dndestiny's own (fully customized-via-this-file) Character sheet
  // from its stock "D&D 5e Character Sheet" label to "Guardian", and adds the
  // genuinely original, unmodified dnd5e sheet back as a second selectable
  // option labeled "Player Character" - for anyone who wants a plain 5e
  // character sheet with none of this module's injected Ghost/Shield/Light
  // Ability/etc. UI. Both point at the exact same underlying
  // CharacterActorSheet class and template (this system never forked the
  // sheet class or its templates - every bit of "Destiny-ness" on it comes
  // from this file's render-hook injectors, confirmed by the stock label
  // above), so a trivial no-op subclass is registered under a second id
  // purely to give it a distinct class identity - handleSheetRender checks
  // `app.constructor === VanillaCharacterActorSheet` and skips the entire
  // injection pipeline for it, which is what actually makes it "vanilla"
  // rather than just a differently-labeled copy of Guardian.
  const CharacterActorSheet = dndestiny?.applications?.actor?.CharacterActorSheet;
  if (CharacterActorSheet) {
    VanillaCharacterActorSheet = class VanillaCharacterActorSheet extends CharacterActorSheet {};
    DocumentSheetConfig.registerSheet(Actor, MODULE_ID, CharacterActorSheet, {
      types: ["character"],
      makeDefault: true,
      label: "Guardian"
    });
    DocumentSheetConfig.registerSheet(Actor, MODULE_ID, VanillaCharacterActorSheet, {
      types: ["character"],
      makeDefault: false,
      label: "Player Character"
    });
  }

  // "Ghost" actor type - selectable alongside Character/NPC/Vehicle/Group
  // when creating a new Actor (see the "ghost" entry under documentTypes.Actor
  // in module.json, which is what makes Foundry recognize it as a valid
  // Actor sub-type in the first place - Foundry namespaces module-contributed
  // sub-types as "<module id>.<type>", hence GHOST_ACTOR_TYPE rather than a
  // bare "ghost"). For now this reuses dndestiny's own CharacterData model and
  // CharacterActorSheet outright - same data, same sheet, just a different
  // type/label - so it behaves identically to a Player Character until it's
  // deliberately built out into something distinct.
  const CharacterData = dndestiny?.dataModels?.actor?.CharacterData;
  if (CharacterData && CharacterActorSheet) {
    // CONFIG.Actor.typeLabels values are expected to be i18n KEYS, not
    // literal display text - ClientDocument.createDialog specifically does
    // `game.i18n.has(label) ? localize(label) : type` (falling back to the
    // raw "dndestiny.ghost" type string otherwise), confirmed by reading its
    // source - so this needs an actual registered key (see the i18nInit
    // hook below), the same as dndestiny's own "TYPES.Actor.character" etc.
    CONFIG.Actor.dataModels[GHOST_ACTOR_TYPE] = CharacterData;
    CONFIG.Actor.typeLabels[GHOST_ACTOR_TYPE] = "TYPES.Actor.dndestiny.ghost";
    DocumentSheetConfig.registerSheet(Actor, MODULE_ID, CharacterActorSheet, {
      types: [GHOST_ACTOR_TYPE],
      makeDefault: true,
      label: "Ghost Sheet"
    });

    // Default icon for new Ghost actors (and their token) - also what the
    // Create Actor dialog's type picker shows, since it calls
    // Actor5e.getDefaultArtwork({type}) for each type's icon rather than a
    // separate config.
    CONFIG.DND5E.defaultArtwork.Actor[GHOST_ACTOR_TYPE] = "systems/dndestiny/assets/icons/svg/ghost.svg";
  }

  // "Perk" Item type - a dedicated type (rather than reusing the native
  // "Feature" type) so a Weapon Perk never gets confused with a class
  // feature/feat in the Create Item dialog or an inventory list, per the
  // request that authoring a new perk should be unambiguous for someone
  // else coming into this module cold. Subclasses dndestiny's own FeatData
  // (rather than reusing that exact class) so the added
  // dndestinyPerkWeaponClasses field lands only on Perks,
  // not on every native Feature/Feat too - real Feats never touch this
  // subclass. Uses ItemSheet5e outright (registered with no "types" filter,
  // so it's already the default sheet for every item type) - same reasoning
  // and same "register as system-provided" trick as the Ghost actor type
  // above, so a Perk gets the exact same data preparation path (activities,
  // Active Effects, etc.) as a real Feature item. See PERK_ITEM_TYPE/
  // isPerkItem and injectPerkDetailsFields (which replaces the native
  // Feat-specific Details fieldset with a Perk-specific one: which Slot this
  // perk occupies, and which weapon classes it's available for) plus
  // injectWeaponCustomizationTab (which actually applies a slotted Perk's
  // Active Effects onto a weapon).
  const FeatData = dndestiny?.dataModels?.item?.FeatData;
  const MappingField = dndestiny?.dataModels?.fields?.MappingField;
  if (FeatData && MappingField) {
    class PerkData extends FeatData {
      static defineSchema() {
        const schema = super.defineSchema();
        // Maps each weapon class this perk is available for to the Slot
        // number it occupies ON THAT weapon class specifically (e.g.
        // { dndestinyAutoRfl: 1, dndestinyScoutRf: 2 }) - a perk's slot
        // genuinely isn't fixed across weapons (Take a Knee is Slot 3 on
        // Sniper Rifle's table but Slot 1 on Scout Rifle's), so this has to
        // be per weapon class rather than one scalar field. A weapon class
        // key's mere presence means "available for this weapon"; its value
        // is the slot. See injectPerkDetailsFields (the per-row checkbox +
        // slot select UI) and getPerkSlotForWeapon/validatePerkDrop (how a
        // drop looks this up to find the right slot automatically).
        schema.dndestinyPerkWeaponClasses = new MappingField(
          new NumberField({ integer: true, min: 1, max: 3, required: true }), { initial: {} }
        );
        return schema;
      }
    }

    CONFIG.Item.dataModels[PERK_ITEM_TYPE] = PerkData;
    CONFIG.Item.typeLabels[PERK_ITEM_TYPE] = "TYPES.Item.dndestiny.perk";
    CONFIG.Item.typeLabelsPlural ??= {};
    CONFIG.Item.typeLabelsPlural[PERK_ITEM_TYPE] = "TYPES.Item.dndestiny.perkPl";

    // Default icon for new Perk items (and the Create Item dialog's type
    // picker, via Item5e.getDefaultArtwork({type})).
    CONFIG.DND5E.defaultArtwork.Item[PERK_ITEM_TYPE] = "icons/svg/upgrade.svg";
  }

  // "Light Ability" Item type - see LIGHT_ABILITY_ITEM_TYPE above for the
  // full reasoning. Built on SpellData (not FeatData - an earlier version of
  // this split used FeatData, but that dropped the native Casting Time/
  // Range/Duration/Components details that Light Abilities still want to
  // show), so it keeps every bit of native Spell data prep (Activities,
  // Active Effects, Uses, the Spell Details fieldset, canScaleDamage, etc.)
  // while staying its own distinct type from real Spell items - the four
  // custom fields below layer on top unchanged from before. Also uses
  // ItemSheet5e outright (no "types" filter, so it's already the default),
  // same as Perk, so injectClassLightAbilityField and friends still inject
  // their own Recharge/Ability Slot/Damage Denomination fields into its
  // Details tab exactly as before, alongside the native Spell fields rather
  // than replacing them.
  const SpellDataForLightAbility = dndestiny?.dataModels?.item?.SpellData;
  if (SpellDataForLightAbility) {
    class LightAbilityData extends SpellDataForLightAbility {
      static defineSchema() {
        const schema = super.defineSchema();
        schema.dndestinyRechargeDie = new StringField({ initial: "d6", blank: true });
        schema.dndestinyRechargeThreshold = new NumberField({ initial: 6, integer: true, min: 1 });
        schema.dndestinyAbilitySlot = new StringField({ initial: "", blank: true });
        schema.dndestinyDamageDenomination = new NumberField({ integer: true, min: 4 });
        return schema;
      }

      // Drops the inherited "1st Level" tag from the usage chat card - real
      // spells have a slot level worth calling out, but Light Abilities
      // don't (their "level" field is unused fallout from subclassing
      // SpellData - see the class comment above), so it's just noise there.
      get chatProperties() {
        return super.chatProperties.filter(p => p.type !== "level");
      }
    }

    CONFIG.Item.dataModels[LIGHT_ABILITY_ITEM_TYPE] = LightAbilityData;
    CONFIG.Item.typeLabels[LIGHT_ABILITY_ITEM_TYPE] = "TYPES.Item.dndestiny.lightAbility";
    CONFIG.Item.typeLabelsPlural ??= {};
    CONFIG.Item.typeLabelsPlural[LIGHT_ABILITY_ITEM_TYPE] = "TYPES.Item.dndestiny.lightAbilityPl";

    CONFIG.DND5E.defaultArtwork.Item[LIGHT_ABILITY_ITEM_TYPE] = "icons/svg/sun.svg";

    // Lets the Grant Items/Item Choice class & subclass advancements target
    // Light Ability items - both share one static VALID_TYPES Set
    // (ItemChoiceAdvancement extends ItemGrantAdvancement without
    // overriding it, confirmed live), so patching it once here covers both
    // advancement types. Without this, granting a Light Ability through
    // either fails with "Light Ability items cannot be added with this
    // advancement type."
    const ItemGrantAdvancementClass = CONFIG.DND5E.advancementTypes?.ItemGrant?.documentClass;
    ItemGrantAdvancementClass?.VALID_TYPES?.add(LIGHT_ABILITY_ITEM_TYPE);
  }

  // Registers the actual translation for "TYPES.Actor.dndestiny.ghost"/
  // "TYPES.Item.dndestiny.perk"/"TYPES.Item.dndestiny.lightAbility" (see
  // above), plus "DNDESTINY.Activity.Reload.Title"/"Hint" for the Reload
  // Activity's own metadata (see the ReloadActivity registration above).
  // i18n keys are dot-path lookups, so - since our types themselves contain
  // a "." - this needs real nesting (TYPES.Actor.dndestiny.ghost), not a
  // flat "dndestiny.ghost" key.
  //
  // Reload's metadata.title/.hint deliberately point at these keys rather
  // than holding "Reload"/its hint text directly - PseudoDocument's own
  // _createDialogData (what actually builds the "Add Activity" type list)
  // does `game.i18n.has(label) ? _loc(label) : type` to tell a real locale
  // key apart from a raw literal (native activity types all pass a locale
  // key here, e.g. "DND5E.ATTACK.Title") - a literal string like "Reload"
  // makes game.i18n.has() return false, so that dialog silently fell back
  // to showing the raw type key "dndestinyReload" instead.
  Hooks.once("i18nInit", () => {
    foundry.utils.mergeObject(game.i18n.translations, {
      TYPES: {
        Actor: { dndestiny: { ghost: "Ghost" } },
        Item: {
          dndestiny: {
            perk: "Weapon Perk", perkPl: "Weapon Perks",
            lightAbility: "Light Ability", lightAbilityPl: "Light Abilities"
          }
        }
      },
      DNDESTINY: {
        Activity: {
          Reload: {
            Title: "Reload",
            Hint: "Consumes 1 matching Ammo Type item from this weapon's actor and refills its Shot Capacity. "
              + "Attached to a non-weapon item (e.g. a Superclass Ability), it instead asks which Shot Capacity "
              + "weapon on the actor to reload."
          }
        }
      }
    });
  });

  // Custom Categorized Languages. selectable: false on each category drops
  // its own "All <Category> Languages" checkbox from the trait selector
  // (dndestiny only renders that checkbox when a category counts as
  // selectable, per Trait's internal choices() helper) while leaving the
  // category as a plain group heading with all its individual languages
  // still listed and selectable underneath - confirmed live in the
  // Configure Languages dialog.
  CONFIG.DND5E.languages = {
    modern: {
      label: "Modern Human Languages",
      selectable: false,
      children: {
        chinese: "Chinese", english: "English", citycommon: "City Common",
        risen: "Risen", rsl: "Risen Sign Language (RSL)", russian: "Russian",
        spanish: "Spanish", speech: "Speech"
      }
    },
    ancient: {
      label: "Ancient Human Languages",
      selectable: false,
      children: {
        arabic: "Arabic", french: "French", german: "German",
        hebrew: "Hebrew", japanese: "Japanese", taiwanese: "Taiwanese Hokkien"
      }
    },
    alien: {
      label: "Alien Languages",
      selectable: false,
      children: {
        eliksni: "Eliksni", hexinary: "Hexinary", krill: "Krill", ulurant: "Ulurant"
      }
    }
  };

  if (CONFIG.DND5E.traits?.languages) {
    delete CONFIG.DND5E.traits.languages.choices;
    // Removes the native "All Languages" checkbox from every Language trait
    // selector (Proficiencies tab, item-level language grants, etc.) - it's
    // only ever offered because traits.languages.labels.all is set, so
    // deleting that one label is enough (see Trait.choices in dndestiny.mjs).
    // Doesn't touch the same "ALL" mechanic on other trait categories
    // (weapons/armor/tools/damage types), which still make sense there.
    delete CONFIG.DND5E.traits.languages.labels?.all;
  }

  // Custom Skills
  CONFIG.DND5E.skills["tec"] = {
    label: "Technology",
    ability: "int",
    fullKey: "technology",
    icon: "icons/sundries/devices/key-gold.webp",
    description: "Operate, hack, repair, or bypass modern and alien technological hardware and electronic systems."
  };

  // Custom Toolkits & Vehicles Configuration
  CONFIG.DND5E.tools = {};
  CONFIG.DND5E.toolIds = {};

  CONFIG.DND5E.toolProficiencies = {
    toolkit: {
      label: "Toolkits",
      children: {
        armorsmithing:  "Armorsmithing toolkit",
        climbing:       "Climbing toolkit",
        cooking:        "Cooking toolkit",
        electronics:    "Electronics toolkit",
        medical:        "Medical toolkit",
        scuba:          "SCUBA toolkit",
        sewing:         "Sewing toolkit",
        thieves:        "Thieves' toolkit",
        vehicle:        "Vehicle toolkit",
        weaponsmithing: "Weaponsmithing toolkit",
        whittling:      "Whittling toolkit"
      }
    },
    veh: {
      label: "Vehicles",
      children: {
        sparrows:  "Sparrows",
        jumpships: "Jumpships",
        freighter: "Bulk Freighter",
        hawk:      "Hawk"
      }
    }
  };

  CONFIG.DND5E.vehicleTypes = {
    sparrows:  "Sparrows",
    jumpships: "Jumpships",
    freighter: "Bulk Freighter",
    hawk:      "Hawk"
  };

  const getToolUuid = (itemId) => `Compendium.${MODULE_ID}.equipment.Item.${itemId}`;

  const toolItemMap = {
    armorsmithing:  { label: "Armorsmithing toolkit",  ability: "str", category: "toolkit", itemId: "" },
    climbing:       { label: "Climbing toolkit",       ability: "str", category: "toolkit", itemId: "REAL_ID_CLIMB" },
    cooking:        { label: "Cooking toolkit",        ability: "wis", category: "toolkit", itemId: "REAL_ID_COOK" },
    electronics:    { label: "Electronics toolkit",    ability: "int", category: "toolkit", itemId: "REAL_ID_ELEC" },
    medical:        { label: "Medical toolkit",        ability: "wis", category: "toolkit", itemId: "REAL_ID_MED" },
    scuba:          { label: "SCUBA toolkit",          ability: "con", category: "toolkit", itemId: "REAL_ID_SCUBA" },
    sewing:         { label: "Sewing toolkit",         ability: "dex", category: "toolkit", itemId: "REAL_ID_SEW" },
    thieves:        { label: "Thieves' toolkit",       ability: "dex", category: "toolkit", itemId: "REAL_ID_THIEF" },
    vehicle:        { label: "Vehicle toolkit",        ability: "dex", category: "toolkit", itemId: "REAL_ID_VEH" },
    weaponsmithing: { label: "Weaponsmithing toolkit", ability: "str", category: "toolkit", itemId: "REAL_ID_WEAP" },
    whittling:      { label: "Whittling toolkit",      ability: "dex", category: "toolkit", itemId: "REAL_ID_WHIT" },
    sparrows:       { label: "Sparrows",               ability: "dex", category: "veh",     itemId: "REAL_ID_SPAR" },
    jumpships:      { label: "Jumpships",              ability: "dex", category: "veh",     itemId: "REAL_ID_JUMP" },
    freighter:      { label: "Bulk Freighter",         ability: "str", category: "veh",     itemId: "REAL_ID_FREI" },
    hawk:           { label: "Hawk",                   ability: "dex", category: "veh",     itemId: "REAL_ID_HAWK" }
  };

  for (const [key, data] of Object.entries(toolItemMap)) {
    const uuid = getToolUuid(data.itemId);
    CONFIG.DND5E.tools[key] = { label: data.label, ability: data.ability, category: data.category, id: uuid };
    CONFIG.DND5E.toolIds[key] = uuid;
  }

  if (CONFIG.DND5E.traits?.tool) delete CONFIG.DND5E.traits.tool.choices;

  Object.assign(CONFIG.DND5E.creatureTypes, {
    cabal: { label: "Cabal" }, risen: { label: "Risen" }, eliksni: { label: "Eliksni" },
    ghost: { label: "Ghost" }, vex: { label: "Vex" }, hive: { label: "Hive" },
    psion: { label: "Psion" }, taken: { label: "Taken" }
  });

  if (CONFIG.DND5E.healingTypes) {
    CONFIG.DND5E.healingTypes.shields = { label: "Shields", color: "#ffffff" };
    CONFIG.DND5E.healingTypes.overshields = { label: "Overshields", color: "#00bfff" };
  }

  // Destiny Damage Types (added alongside the existing D&D types rather
  // than replacing them, since ordinary physical/elemental damage still
  // makes sense for plenty of weapons and effects). Grouping them under a
  // "Paracausal Damage" header in the trait selectors happens later, on the
  // "ready" hook - see below.
  Object.assign(CONFIG.DND5E.damageTypes, PARACAUSAL_DAMAGE_TYPES);

  // Destiny Conditions (see DESTINY_CONDITIONS/injectDestinyConditions) -
  // pseudo: true keeps them out of dndestiny's own native "Conditions" toggle
  // list on the sheet, while still registering a normal CONFIG.statusEffects
  // entry for each at the "setup" hook (dndestiny builds that list from every
  // conditionTypes entry regardless of pseudo).
  if (CONFIG.DND5E.conditionTypes) {
    for (const condition of DESTINY_CONDITIONS) {
      CONFIG.DND5E.conditionTypes[condition.id] = { name: condition.name, img: condition.img, pseudo: true };
    }
  }

  // Single Currency: Glimmer
  // Mutated in place (not reassigned) because dndestiny's actor currency field
  // is a MappingField built with {initialKeys: CONFIG.DND5E.currencies},
  // which is read live every time actor data is prepared - mutating the
  // existing object means every actor's currency (old pp/gp/ep/sp/cp keys
  // included) automatically collapses down to just "glimmer" with no
  // migration needed. dndestiny also auto-generates the currency icon CSS from
  // this same config on the "setup" hook, which fires after this one, so
  // the box picks up our icon with none of our own CSS required.
  for (const key of Object.keys(CONFIG.DND5E.currencies)) delete CONFIG.DND5E.currencies[key];
  CONFIG.DND5E.currencies.glimmer = {
    label: "Glimmer",
    abbreviation: "GLM",
    conversion: 1,
    icon: `systems/dndestiny/assets/icons/currency/glimmer.webp`
  };
  CONFIG.DND5E.defaultCurrency = "glimmer";

  // Schema Injection for Vitals (Light Ability/Level are derived from the
  // character's class item instead of being stored on the actor - see
  // getPrimaryLightClass)
  const characterModel = CONFIG.Actor.dataModels?.character;
  if (characterModel) {
    characterModel.defineSchema = (function (original) {
      return function () {
        const schema = original.call(this);
        const shieldSchema = () => new SchemaField({
          value: new NumberField({ initial: 0, integer: true, min: 0 }),
          max: new NumberField({ initial: 0, integer: true, min: 0 })
        });
        schema.shields = shieldSchema();
        schema.overshields = shieldSchema();
        return schema;
      };
    })(characterModel.defineSchema);
  }

  // Schema Injection for the class item's Light Ability (set per-class on the
  // class item's sheet, e.g. Gunslinger -> Charisma), its 3 Grenade options
  // (e.g. Gunslinger -> Incendiary/Swarm/Tripmine), stored as UUIDs pointing
  // at the actual Grenade Feature items, and its Shield Die size (rolled on
  // the actor sheet each level after 1st, added to max Shields - see
  // rollShieldDie).
  const classModel = CONFIG.Item.dataModels?.class;
  if (classModel) {
    classModel.defineSchema = (function (original) {
      return function () {
        const schema = original.call(this);
        schema.lightAbility = new StringField({ initial: "", blank: true });
        schema.dndestinyGrenades = new ArrayField(new StringField({ blank: true }), { initial: [] });
        schema.dndestinyShieldDie = new StringField({ initial: "d6", blank: true });
        return schema;
      };
    })(classModel.defineSchema);
  }

  // Core Light Abilities (Superclass/Melee/Super Ability, Grenade) live on
  // their own dedicated Light Ability item type (see LIGHT_ABILITY_ITEM_TYPE
  // and the registration below, further down this same hook) rather than on
  // real Spell items directly - this used to patch the native "spell"
  // DataModel itself to add the 4 custom fields (back when Light Abilities
  // WERE spell items), but that would now leak Light-Ability-only fields
  // onto genuine Spell items, so it's been replaced by LightAbilityData's
  // own schema instead. Recharge is custom since dndestiny's native recharge
  // recovery is hardcoded to a d6; Casting Time/Range/Duration/Components
  // and everything else Spell-shaped come along for free since
  // LightAbilityData extends SpellData.

  // Firearms - two new weapon types (Simple/Martial Firearms) alongside
  // dndestiny's existing Simple/Martial Melee and Martial Ranged, using the same
  // attack type (ranged) dndestiny's own simpleR/martialR use so attack rolls
  // work exactly the same way for them. Proficiency is intentionally its
  // own category (see weaponProficienciesMap below) rather than folding
  // into the generic Simple/Martial Weapon proficiencies - being trained
  // with a sword doesn't make you trained with a rifle.
  Object.assign(CONFIG.DND5E.weaponTypes, {
    simpleF: "Simple Firearms",
    martialF: "Martial Firearms"
  });
  Object.assign(CONFIG.DND5E.weaponTypeMap, { simpleF: "ranged", martialF: "ranged" });

  // Simple Firearms/Martial Firearms as their own selectable entries in the
  // actor's Weapon Proficiencies trait list (Traits tab) - self-mapped
  // rather than pointing at "sim"/"mar" so firearm proficiency has to be
  // picked up separately from the generic Simple/Martial Weapon categories.
  // "sim"/"mar" themselves are renamed from dnd5e's stock "Simple"/"Martial"
  // to "Simple Melee"/"Martial Melee" here too - now that Firearms (above)
  // and Bows/thrown weapons carry their own distinct proficiency tracks,
  // the bare "Simple"/"Martial" labels read as if they covered every weapon
  // in that tier, when in practice sim/mar are what melee weapons actually
  // train (see weaponProficienciesMap below - simpleM/martialM still map
  // here, simpleR/martialR technically still do too for the rare non-Bow
  // ranged weapon, but melee is what players overwhelmingly pick these up
  // for). This is a straight override of the CONFIG object dnd5e's own init
  // hook populates from its "DND5E.WeaponSimpleProficiency"/
  // "DND5E.WeaponMartialProficiency" locale strings - every UI (Traits tab
  // picker, Class Summary proficiency list, Special Traits config, etc.)
  // reads CONFIG.DND5E.weaponProficiencies directly rather than those raw
  // locale keys, so overriding it here is enough to relabel everywhere.
  CONFIG.DND5E.weaponProficiencies.sim = "Simple Melee";
  CONFIG.DND5E.weaponProficiencies.mar = "Martial Melee";
  Object.assign(CONFIG.DND5E.weaponProficiencies, {
    simpleF: "Simple Firearms",
    martialF: "Martial Firearms"
  });
  Object.assign(CONFIG.DND5E.weaponProficienciesMap, { simpleF: "simpleF", martialF: "martialF" });

  // Named base weapons under each Firearm proficiency category (mirrors how
  // dndestiny nests e.g. Longsword under Martial Weapons) - these are real Items
  // living in the module's Equipment compendium (see packs/equipment.db),
  // matched to their category by their own system.type.value. Letting a
  // player pick one specifically (via the Weapon Base dropdown, or directly
  // in the Weapon Proficiencies trait picker) grants proficiency with just
  // that archetype without requiring the broader Simple/Martial Firearms
  // proficiency.
  Object.assign(CONFIG.DND5E.weaponIds, {
    dndestinyAutoRfl: "Compendium.dndestiny.equipment.Item.dndestinyAutoRfl",
    dndestinyHandCan: "Compendium.dndestiny.equipment.Item.dndestinyHandCan",
    dndestinyPulseRf: "Compendium.dndestiny.equipment.Item.dndestinyPulseRf",
    dndestinyScoutRf: "Compendium.dndestiny.equipment.Item.dndestinyScoutRf",
    dndestinySidearm: "Compendium.dndestiny.equipment.Item.dndestinySidearm",
    dndestinySubmGun: "Compendium.dndestiny.equipment.Item.dndestinySubmGun",
    dndestinyTraceRf: "Compendium.dndestiny.equipment.Item.dndestinyTraceRf",
    dndestinyFusionR: "Compendium.dndestiny.equipment.Item.dndestinyFusionR",
    dndestinyGrenLnc: "Compendium.dndestiny.equipment.Item.dndestinyGrenLnc",
    dndestinyLMG0000: "Compendium.dndestiny.equipment.Item.dndestinyLMG0000",
    dndestinyLinFusR: "Compendium.dndestiny.equipment.Item.dndestinyLinFusR",
    dndestinyRockLnc: "Compendium.dndestiny.equipment.Item.dndestinyRockLnc",
    dndestinyShotgun: "Compendium.dndestiny.equipment.Item.dndestinyShotgun",
    dndestinySniperR: "Compendium.dndestiny.equipment.Item.dndestinySniperR"
  });

  // Combat Bow - unlike the Firearms above, this is a native Martial Ranged
  // weapon (system.type.value "martialR", same as a stock Longbow), not one
  // of this module's own Firearm categories, so it needs proficiency with
  // Martial Weapons rather than a separate Firearm proficiency and doesn't
  // hide its native Range field the way Firearms do (see
  // hideFirearmRangeField/isFirearmItem) - it's still registered here the
  // same way so it shows up as a named Base Weapon option.
  Object.assign(CONFIG.DND5E.weaponIds, {
    dndestinyCmbtBow: "Compendium.dndestiny.equipment.Item.dndestinyCmbtBow"
  });

  // Smallsword - a native Martial Melee weapon (system.type.value "martialM"),
  // same reasoning as Combat Bow above: registered here purely so it shows up
  // as a named Base Weapon option under Martial Melee, not because it needs
  // any Firearm-style special handling. The item itself (in the module's
  // Equipment compendium, see packs/equipment.db) is currently just a
  // placeholder - real stats/description/icon still need filling in.
  Object.assign(CONFIG.DND5E.weaponIds, {
    dndestinySmalSwd: "Compendium.dndestiny.equipment.Item.dndestinySmalSwd"
  });

  // Clears out dnd5e's stock "Class Feature Type" options (Arcane Shot,
  // Channel Divinity, Fighting Style, Metamagic Option, etc.) from the
  // Feature item sheet's subtype dropdown when Feature Type is set to
  // "Class Feature" - none of them apply to dndestiny's own classes, and
  // they'd otherwise sit there implying they do. Deleting the whole
  // "subtypes" key (rather than emptying it to {}) makes the dropdown not
  // render at all, same as "Background Feature"/"Race Feature"/etc. above,
  // which have no subtypes entry of their own either - dndestiny's own
  // subtype list goes back in here once it exists.
  delete CONFIG.DND5E.featureTypes.class?.subtypes;

  // Destiny Armor - replaces dndestiny's stock PHB armor examples (armorIds)
  // with Destiny-reskinned equivalents, one-for-one at the same AC/Dex cap/
  // Str requirement/Stealth/weight/price slot (Padded and Leather keep their
  // original names outright; the rest are renamed) - see packs/equipment.db
  // for the actual items, created by cloning each vanilla armor's full stat
  // block. A full replacement (not merged alongside), matching how Currency
  // above replaces gp/sp/etc. with just Glimmer.
  CONFIG.DND5E.armorIds = {
    padded: "Compendium.dndestiny.equipment.Item.qhkjJABJKkEn5kye",
    leather: "Compendium.dndestiny.equipment.Item.M0LysDw4FLK0RbPC",
    spinweave: "Compendium.dndestiny.equipment.Item.XdRYRF1Fn0si1efl",
    makeshift: "Compendium.dndestiny.equipment.Item.enfG6UdvfRhmsHyd",
    spinwire: "Compendium.dndestiny.equipment.Item.kaXxsoQ78B0pyAMr",
    reinforced: "Compendium.dndestiny.equipment.Item.0Q3HiNfdI5QUvl2h",
    plastwire: "Compendium.dndestiny.equipment.Item.wjogxfysmBStnW7H",
    spinplate: "Compendium.dndestiny.equipment.Item.WtNMvxGfNFVd6ho8",
    halfplast: "Compendium.dndestiny.equipment.Item.kQuVOlsgAxiwYyET",
    plasteel: "Compendium.dndestiny.equipment.Item.qNNZBkAs01eSt79o",
    fortified: "Compendium.dndestiny.equipment.Item.FEvt7P9Ao7Zg6KJk",
    relic: "Compendium.dndestiny.equipment.Item.FuI3kSYFgCuY8YAn"
  };

  // "Ghost Shell" as a full Armor Type (see GHOST_SHELL_TYPE_KEY) - mechanically
  // identical to Light/Medium/Heavy (same AC/Dex cap/Str requirement/Stealth
  // fields on the item sheet, picked up by the same native
  // AttributesFields#prepareArmorClass equipped-armor logic), just worn by
  // the Ghost instead of the Guardian - equipped via its own native
  // inventory-row toggle, and the prepareArmorClass patch above covers the
  // Ghost's default (unarmored) 12 + Dex AC.
  CONFIG.DND5E.armorTypes.ghostShell = "Ghost Shell";
  CONFIG.DND5E.armorProficienciesMap.ghostShell = "ghs";
  Object.assign(CONFIG.DND5E.armorProficiencies, { ghs: "Ghost Shells" });

  // Custom weapon properties, on top of dndestiny's own (Heavy, Light, Thrown,
  // etc.). dndestiny's own properties aren't restricted below the item-type
  // level either - it's a flat per-type list (see
  // CONFIG.DND5E.validProperties.weapon) with no built-in concept of "only
  // for this weapon subtype" - so registration follows that same
  // convention; actual visibility grouping/filtering (General/Firearm/
  // Special Weapons, and hiding the Firearm group on non-Firearm weapons)
  // happens entirely client-side in injectWeaponPropertyGroups.
  Object.assign(CONFIG.DND5E.itemProperties, {
    // General Weapon Properties
    dndestinyAgile: { label: "Agile" },
    dndestinyOneHanded: { label: "One-Handed" },
    dndestinyRange: { label: "Range" },
    dndestinyCumbersome: { label: "Cumbersome" },
    dndestinyElemental: { label: "Elemental" },
    // Firearm Properties
    dndestinyAutoFire: { label: "Automatic Fire" },
    dndestinyEnergyProjectiles: { label: "Energy Projectiles" },
    dndestinyHighRecoil: { label: "High Recoil" },
    dndestinyPayload: { label: "Payload" },
    dndestinyScope: { label: "Scope" },
    dndestinyShotCapacity: { label: "Shot Capacity" },
    // Special Weapons
    dndestinyCombatBow: { label: "Combat Bow" },
    dndestinyGrenadeLauncher: { label: "Grenade Launcher" },
    dndestinyTraceRifle: { label: "Trace Rifle" }
  });
  for (const key of [...GENERAL_WEAPON_PROPERTY_KEYS, ...FIREARM_PROPERTY_KEYS, ...SPECIAL_WEAPON_PROPERTY_KEYS]) {
    CONFIG.DND5E.validProperties.weapon.add(key);
  }

  // Adamantine/Silvered aren't used in this module - drop them from the
  // weapon Properties checklist entirely rather than just hiding them, so
  // they can never end up silently set on a weapon via that UI.
  CONFIG.DND5E.validProperties.weapon.delete("ada");
  CONFIG.DND5E.validProperties.weapon.delete("sil");

  // Scope Effective/Extended/Maximum values and Range Band (Close/Medium/
  // Long) on every weapon, shown via injectWeaponRangeFields. Each scope
  // distance is its own NumberField (rather than one free-text field) so it
  // has its own "system.dndestinyScopeXxx" key for Active Effects to target.
  const weaponModel = CONFIG.Item.dataModels?.weapon;
  if (weaponModel) {
    weaponModel.defineSchema = (function (original) {
      return function () {
        const schema = original.call(this);
        schema.dndestinyScopeEffective = new NumberField({ initial: null, integer: true, min: 0 });
        schema.dndestinyScopeExtended = new NumberField({ initial: null, integer: true, min: 0 });
        schema.dndestinyScopeMaximum = new NumberField({ initial: null, integer: true, min: 0 });
        schema.dndestinyRangeBand = new StringField({ initial: "", blank: true, choices: ["close", "medium", "long"] });
        // Magazine size and current rounds loaded - only shown/used when the
        // weapon carries the Shot Capacity property and SETTING_TRACK_AMMO
        // is on (see injectWeaponShotCapacityField/reloadWeapon).
        schema.dndestinyShotCapacity = new NumberField({ initial: null, integer: true, min: 0 });
        schema.dndestinyShotsRemaining = new NumberField({ initial: null, integer: true, min: 0 });
        // Explicit Ammo Type override (see getRequiredAmmoType) - blank
        // means "auto-detect from Weapon Type" (Simple/Martial Firearm, or
        // Rocket Launcher specifically), a value here overrides that.
        schema.dndestinyAmmoType = new StringField({ initial: "", blank: true, choices: Object.keys(AMMO_TYPES) });
        // Weapon Tier (Chapter 6: Customization) - unlocks perk slots
        // cumulatively (see WEAPON_TIER_SLOT_COUNTS) but grants no other
        // bonus on its own. Each slot stores the UUID of whichever Perk
        // Item is currently applying its Active Effects to this weapon (see
        // injectWeaponCustomizationTab/applyPerkToSlot) - blank means empty.
        schema.dndestinyWeaponTier = new NumberField({ initial: 0, integer: true, min: 0, max: 3 });
        for (const [, key] of PERK_SLOT_FIELDS) schema[key] = new StringField({ initial: "", blank: true });
        return schema;
      };
    })(weaponModel.defineSchema);

    // Adds a "Scope Effective/Extended/Maximum" tag to a weapon's rich
    // tooltip (the card shown on hover in an inventory list - see
    // Item5e#getCardData, which reads this getter), the same way dndestiny's own
    // Range/Reach show up there. cardProperties is inherited from a shared
    // mixin rather than defined directly on WeaponData, so the existing
    // getter has to be located up the prototype chain before being wrapped.
    let proto = weaponModel.prototype;
    let cardPropertiesDescriptor = null;
    while (proto && !cardPropertiesDescriptor) {
      cardPropertiesDescriptor = Object.getOwnPropertyDescriptor(proto, "cardProperties");
      proto = Object.getPrototypeOf(proto);
    }
    if (cardPropertiesDescriptor?.get) {
      const originalCardProperties = cardPropertiesDescriptor.get;
      Object.defineProperty(weaponModel.prototype, "cardProperties", {
        get() {
          const properties = originalCardProperties.call(this) ?? [];
          const { dndestinyScopeEffective: eff, dndestinyScopeExtended: ext, dndestinyScopeMaximum: max } = this;
          if ((eff ?? ext ?? max) != null) {
            const fmt = (v) => v ?? "—";
            properties.push(`Scope ${fmt(eff)}/${fmt(ext)}/${fmt(max)}`);
          }
          return properties;
        },
        configurable: true
      });
    }
  }

  // Suppresses the "Range" tag an Attack activity normally adds to a
  // weapon's rich tooltip (see BaseAttackActivityData#activationLabels,
  // which reads system.range regardless of whether it's actually set - even
  // with range.value/long nulled out, as hideFirearmRangeField does for
  // Firearms, dndestiny's own Weapon#hasRange is still true for any ranged
  // weapon and formats the null value as "0 ft" rather than omitting it).
  // Firearms show Scope Effective/Extended/Maximum instead (see the
  // cardProperties patch above) - every other weapon type is untouched.
  const AttackActivity = CONFIG.DND5E.activityTypes?.attack?.documentClass;
  if (AttackActivity) {
    let activityProto = AttackActivity.prototype;
    let activationLabelsDescriptor = null;
    while (activityProto && !activationLabelsDescriptor) {
      activationLabelsDescriptor = Object.getOwnPropertyDescriptor(activityProto, "activationLabels");
      activityProto = Object.getPrototypeOf(activityProto);
    }
    if (activationLabelsDescriptor?.get) {
      const originalActivationLabels = activationLabelsDescriptor.get;
      Object.defineProperty(AttackActivity.prototype, "activationLabels", {
        get() {
          const labels = originalActivationLabels.call(this);
          if (labels && isFirearmItem(this.item)) labels.range = null;
          return labels;
        },
        configurable: true
      });
    }
  }

  // Ammo Type - a Consumable item tagged with one of AMMO_TYPES (see
  // reloadWeapon/getRequiredAmmoType), consumed 1-per-reload from the
  // actor's inventory by a matching weapon's Reload Activity.
  const consumableModel = CONFIG.Item.dataModels?.consumable;
  if (consumableModel) {
    consumableModel.defineSchema = (function (original) {
      return function () {
        const schema = original.call(this);
        schema.dndestinyAmmoType = new StringField({ initial: "", blank: true, choices: Object.keys(AMMO_TYPES) });
        return schema;
      };
    })(consumableModel.defineSchema);
  }

  // Memory Cost - how much of a Ghost's Memory (see injectGhostMemoryCard)
  // one unit of this item takes up - and Maximum Stack, the most of this
  // item a single inventory slot can hold before adding more spills into a
  // new slot (see enforceGhostStackLimit). Both live on every physical/
  // inventory item type (see GHOST_MEMORY_ITEM_TYPES) since any of them
  // could end up in a Ghost's inventory, but are only ever displayed/used
  // by the Ghost sheet - a Player Character's inventory ignores them
  // entirely. Maximum Stack left blank means unlimited (no splitting).
  // dndestinyGhostBlocked flags an item as unable to be stored on a Ghost
  // at all (see isGhostBlockedItem) - enforced on both the "Send to Ghost"
  // button and any direct drag/drop or compendium import onto a Ghost's
  // sheet (see the preCreateItem hook further down).
  for (const itemType of GHOST_MEMORY_ITEM_TYPES) {
    const itemModel = CONFIG.Item.dataModels?.[itemType];
    if (!itemModel) continue;
    itemModel.defineSchema = (function (original) {
      return function () {
        const schema = original.call(this);
        schema.dndestinyGhostMemory = new NumberField({ initial: 0, integer: true, min: 0 });
        schema.dndestinyGhostMaxStack = new NumberField({ initial: null, integer: true, min: 1 });
        schema.dndestinyGhostBlocked = new BooleanField({ initial: false });
        return schema;
      };
    })(itemModel.defineSchema);
  }

  // Foundation - a Background item flagged with dndestinyIsFoundation (see
  // isFoundationItem). Background's own data model (a) only allows a single
  // Background-type item per character at all (metadata.singleton, enforced
  // in _preCreate) and (b) unconditionally claims the actor's single
  // system.details.background reference slot whenever a Background-type
  // item is created, clearing that slot whenever any Background-type item
  // is deleted (_onCreate/_preDelete). Foundations need to bypass (a)
  // entirely and never trigger (b) - they're tracked by isFoundationItem
  // lookups, not that reference field. _onCreate/_preDelete still call the
  // original logic (skipping them entirely risks losing other mixed-in base
  // behavior) and correct the reference field afterward; _preCreate skips
  // the singleton check outright since there's no side effect to undo
  // there, just a creation that must not be blocked in the first place.
  const backgroundModel = CONFIG.Item.dataModels?.background;
  if (backgroundModel) {
    backgroundModel.defineSchema = (function (original) {
      return function () {
        const schema = original.call(this);
        schema.dndestinyIsFoundation = new BooleanField({ initial: false });
        return schema;
      };
    })(backgroundModel.defineSchema);

    // The original _onCreate/_preDelete fire their actor.update() as a
    // fire-and-forget call tied to the server round-trip that delivers the
    // create/delete broadcast back to this client - confirmed live to take
    // anywhere from ~100ms up to ~1s here, not something reliably beaten
    // with one fixed delay. Retries a few times with backoff instead of
    // guessing a single "safe" number.
    const restoreRealBackground = (item, attempt = 0) => {
      setTimeout(() => {
        const actor = item.actor;
        if (!actor?.system?.isCharacter) return;
        const real = actor.items.find(i => i.type === "background" && i.id !== item.id && !i.system?.dndestinyIsFoundation);
        const expected = real?.id ?? null;
        if (actor.system.details.background?.id === expected) return;
        actor.update({ "system.details.background": expected });
        if (attempt < 4) restoreRealBackground(item, attempt + 1);
      }, 250 * (attempt + 1));
    };

    const originalOnCreate = backgroundModel.prototype._onCreate;
    backgroundModel.prototype._onCreate = function (data, options, userId) {
      originalOnCreate.call(this, data, options, userId);
      if (this.dndestinyIsFoundation && (game.user.id === userId)) restoreRealBackground(this.parent);
    };

    const originalPreDelete = backgroundModel.prototype._preDelete;
    backgroundModel.prototype._preDelete = function (options, user) {
      const result = originalPreDelete.call(this, options, user);
      if (this.dndestinyIsFoundation) restoreRealBackground(this.parent);
      return result;
    };

    // dndestiny also hard-blocks creating more than one Background-type item per
    // character at all (BackgroundData's metadata.singleton, enforced in its
    // own _preCreate before ours ever runs, by checking
    // actor.itemTypes.background.length). That check can't just be bypassed
    // for Foundations, because it would then also count Foundations against
    // a REAL Background's own one-per-character limit (confirmed live: with
    // 2 Foundations present, creating a genuine Background was rejected).
    // So this replaces the check entirely rather than wrapping it - same
    // singleton rule, just counting only non-Foundation backgrounds against
    // it - and always runs the same advancement setup the original
    // _preCreate would have.
    backgroundModel.prototype._preCreate = async function (data, options, user) {
      const isFoundationCreate = !!foundry.utils.getProperty(data, "system.dndestinyIsFoundation");
      const actor = this.parent.actor;

      if (!isFoundationCreate && actor?.system.isCharacter) {
        const hasRealBackground = actor.items.some(i => i.type === "background" && !i.system?.dndestinyIsFoundation);
        if (hasRealBackground) {
          ui.notifications.error("DND5E.ACTOR.Warning.Singleton", {
            format: {
              itemType: game.i18n.localize(CONFIG.Item.typeLabels.background),
              actorType: game.i18n.localize(CONFIG.Actor.typeLabels[actor.type])
            }
          });
          return false;
        }
      }

      await this.preCreateAdvancement(data, options);
    };
  }

  // Exposes Light Level and the Light Ability modifier (see getLightLevel/
  // getLightAbilityMod) to roll formulas as @dndestiny.lightLevel and
  // @dndestiny.lightAbilityMod - e.g. typed directly into an Activity's
  // Attack or Damage bonus field. Patched onto the Actor document class
  // itself rather than CharacterData, so it's picked up for both Character
  // and Ghost actors alike (Ghost reuses CharacterData/CharacterActorSheet -
  // see the "ghost" actor type registration above).
  const ActorDocumentClass = CONFIG.Actor.documentClass;
  if (ActorDocumentClass) {
    const originalGetRollData = ActorDocumentClass.prototype.getRollData;
    ActorDocumentClass.prototype.getRollData = function (options) {
      const data = originalGetRollData.call(this, options);
      if (isCharacterLikeActor(this)) {
        data.dndestiny = {
          ...data.dndestiny,
          lightLevel: getLightLevel(this),
          lightAbilityMod: getLightAbilityMod(this)
        };
      }
      return data;
    };
  }

  // Routes "Shields"/"Overshields" healing-type damage parts (see
  // CONFIG.DND5E.healingTypes.shields/.overshields registration above) into
  // the custom meters instead of the actor's real HP. This used to be a
  // dndestiny.applyActivityDamage hook listener, but that hook doesn't exist
  // in this dnd5e version - Actor5e#applyDamage/#calculateDamage were
  // restructured to apply every DamageDescription generically to HP, with
  // only "healing"/"temphp"/"maximum" (dnd5e's own native types) getting
  // special-cased. Left unhandled, a "Shields" healing part wouldn't just be
  // a no-op - #calculateDamage only negates entries literally typed
  // "healing", so a positive "Shields" roll would fall through as ordinary
  // positive damage and directly reduce the character's real HP instead of
  // restoring shields. So this has to intercept before the original method
  // ever sees those entries, not just supplement it afterward. Patched here
  // (inside "init", after ActorDocumentClass is captured above) rather than
  // at module top-level - CONFIG.Actor.documentClass isn't Actor5e yet at
  // top-level evaluation time, since dnd5e's own init hook is what sets it.
  if (ActorDocumentClass) {
    const CUSTOM_HEALING_TYPES = ["shields", "overshields"];
    const originalApplyDamage = ActorDocumentClass.prototype.applyDamage;
    ActorDocumentClass.prototype.applyDamage = async function (damages, options = {}) {
      if (!Array.isArray(damages) || !isCharacterLikeActor(this)) {
        return originalApplyDamage.call(this, damages, options);
      }

      const customEntries = damages.filter(d => CUSTOM_HEALING_TYPES.includes(d.type));
      const remainingEntries = damages.filter(d => !CUSTOM_HEALING_TYPES.includes(d.type));

      if (customEntries.length) {
        const multiplier = options.multiplier ?? 1;
        const totals = {};
        for (const d of customEntries) {
          // Unlike dnd5e's native healing types (folded into one shared
          // damage.amount bucket as a negative, since it's the same
          // hp.value field damage itself uses), Shields/Overshields have
          // their own dedicated fields - a positive roll value just adds
          // directly.
          totals[d.type] = (totals[d.type] ?? 0) + (d.value * multiplier);
        }
        const updates = {};
        for (const [key, amount] of Object.entries(totals)) {
          if (!amount) continue;
          const current = this.system?.[key]?.value ?? 0;
          const max = this.system?.[key]?.max ?? 0;
          updates[`system.${key}.value`] = Math.clamp(current + amount, 0, max);
        }
        if (Object.keys(updates).length) await this.update(updates);
      }

      if (!remainingEntries.length) return this;
      return originalApplyDamage.call(this, remainingEntries, options);
    };
  }

  // "Explosive Damage" type modifier (see injectExplosiveDamageToggle for the
  // per-activity checkbox that flags an activity's damage as Explosive, and
  // the CONFIG.DND5E.damageTypeCategories.explosive registration in the
  // "ready" hook below for how "Explosive" becomes a selectable option in the
  // Resistances/Immunities/Vulnerabilities pickers). Per the sourcebook,
  // Explosive isn't a standalone damage type - it's a modifier that pairs
  // with a base type (e.g. "explosive kinetic"), and a creature's
  // resistance/immunity/vulnerability to Explosive damage applies equally
  // regardless of that base type.
  //
  // #changeHasEffect (the actual dr/di/dv check, further down the call stack
  // inside #calculateDamage) is a true private class method and only ever
  // compares a single damage.type string against the trait's value Set -
  // there's no way to make it also consider a second type from outside the
  // class, and no way to call it directly either. Rather than reimplementing
  // that private logic (bypasses, "ALL" damage, downgrade options, etc. all
  // live there too), this temporarily adds the damage part's own base type
  // into the relevant trait's value Set - in-memory only on the prepared
  // data, never persisted, reverted immediately after - whenever the actor
  // has "explosive" in that Set AND the damage part itself is flagged
  // explosive (via an "explosive" roll property - see the
  // BaseActivityData#_processDamagePart patch below for how that property
  // gets there). The untouched original method then does the real work and
  // naturally treats the part as if it were already resisted/immune/
  // vulnerable via its base type.
  if (ActorDocumentClass) {
    const originalCalculateDamage = ActorDocumentClass.prototype.calculateDamage;
    ActorDocumentClass.prototype.calculateDamage = function (damages, options = {}) {
      const traits = this.system?.traits ?? {};
      const restore = [];
      if (Array.isArray(damages)) {
        for (const category of ["di", "dr", "dv"]) {
          const value = traits[category]?.value;
          if (!(value instanceof Set) || !value.has("explosive")) continue;
          for (const d of damages) {
            if (!d.type || value.has(d.type)) continue;
            const properties = d.properties instanceof Set ? d.properties : new Set(d.properties ?? []);
            if (!properties.has("explosive")) continue;
            value.add(d.type);
            restore.push(() => value.delete(d.type));
          }
        }
      }
      try {
        return originalCalculateDamage.call(this, damages, options);
      } finally {
        restore.forEach(fn => fn());
      }
    };
  }

  // "Jack of all Guns" Special Trait (see JACK_OF_ALL_GUNS_FLAG/
  // injectJackOfAllGunsTrait for the checkbox itself). Patches
  // AttackActivity#getAttackData - the method both the quick-roll and
  // dialog-configured attack roll paths pull their roll parts from - to add
  // half the actor's Proficiency Bonus (rounded down, same rounding as
  // dndestiny's own native "Jack of All Trades") to any firearm attack that
  // doesn't already get a proficiency bonus.
  const AttackActivityClass = CONFIG.DND5E.activityTypes?.attack?.documentClass;
  if (AttackActivityClass) {
    const originalGetAttackData = AttackActivityClass.prototype.getAttackData;
    AttackActivityClass.prototype.getAttackData = function (config) {
      const result = originalGetAttackData.call(this, config);

      const actor = this.actor;
      const item = this.item;
      const hasTrait = actor?.getFlag(MODULE_ID, JACK_OF_ALL_GUNS_FLAG);
      if (hasTrait && isFirearmItem(item) && !item.system?.prof?.hasProficiency) {
        const bonus = Math.floor((actor.system?.attributes?.prof ?? 0) / 2);
        if (bonus) {
          result.parts.push("@dndestinyJackOfAllGuns");
          result.data.dndestinyJackOfAllGuns = bonus;
        }
      }

      return result;
    };

    // Adds "Light Ability" to an Attack activity's own Attack Ability
    // dropdown, alongside the native "Spellcasting" option it sits next to.
    // Two parts, mirroring exactly how "Spellcasting" itself resolves:
    //  - AttackSheet#_prepareEffectContext (the config sheet) needs the
    //    extra dropdown entry, since dndestiny builds that list from a fixed
    //    array rather than CONFIG.DND5E.abilities.
    //  - BaseAttackActivityData#prepareFinalData needs to actually resolve
    //    "lightAbility" into a real ability key and add it to
    //    this.attack.abilities (the Set the roll math reads) - the same way
    //    it resolves "spellcasting" into this.spellcastingAbility, just
    //    using the primary Light class's own Light Ability key instead (see
    //    getPrimaryLightClass/the Light Save DC patch below, which resolves
    //    the same key for the same reason).
    const AttackSheetClass = AttackActivityClass.metadata?.sheetClass;
    if (AttackSheetClass) {
      const originalPrepareEffectContext = AttackSheetClass.prototype._prepareEffectContext;
      AttackSheetClass.prototype._prepareEffectContext = async function (context, options) {
        context = await originalPrepareEffectContext.call(this, context, options);
        const index = context.abilityOptions?.findIndex(o => o.value === "spellcasting");
        if (index >= 0) {
          // Swap "Spellcasting" out for "Light Ability" in place, same slot -
          // this game has no native spellcasting to keep the option around
          // for (see the "Light Ability" item-type rename in the i18nInit
          // hook), Light Abilities replace it entirely.
          context.abilityOptions.splice(index, 1, { value: "lightAbility", label: "Light Ability" });
        }
        return context;
      };
    }

    const originalAttackPrepareFinalData = AttackActivityClass.prototype.prepareFinalData;
    AttackActivityClass.prototype.prepareFinalData = function (rollData) {
      if (this.attack.ability === "lightAbility") {
        const lightAbility = getPrimaryLightClass(this.actor)?.system?.lightAbility;
        if (lightAbility) this.attack.abilities.add(lightAbility);
      }
      return originalAttackPrepareFinalData.call(this, rollData);
    };

    // Adds "Light" to the Attack activity's Attack Classification dropdown
    // (native Weapon/Spell/Unarmed) - AttackSheet builds that list straight
    // from this CONFIG object (context.attackClassificationOptions =
    // Object.entries(CONFIG.DND5E.attackClassifications)...), so this alone
    // is enough to make it selectable, no sheet patch needed. Only
    // "spell" gets special-cased into an "sak" (spell attack) actionType
    // (see BaseAttackActivityData#actionType) - everything else, "light"
    // included, resolves as a normal "wak" (weapon attack), which is
    // correct here: a Light Ability attack still isn't a spell attack in
    // this game's rules, it's its own thing that happens to roll like a
    // weapon attack.
    CONFIG.DND5E.attackClassifications.light = { label: "Light" };
  }

  // "Light Save DC" option for Check AND Save activities - see
  // injectLightSaveDcOption for the dropdown option itself. This patches the
  // actual DC computation so selecting it uses 8 + prof + the actor's Light
  // Ability modifier (see getPrimaryLightClass), matching the formula shown
  // on the Core Light Abilities tab. Both activity types need their own
  // patch since they store the computed DC on different fields
  // (this.check.dc.value vs this.save.dc.value) - Save activities in
  // particular are what every AoE Grenade (Chapter 6) actually uses, since
  // "each creature must make a saving throw" is a save, not a check.
  const computeLightSaveDc = (activity) => {
    const actor = activity.actor;
    const primaryClass = actor ? getPrimaryLightClass(actor) : null;
    const lightAbilityKey = primaryClass?.system?.lightAbility || null;
    if (!actor || !lightAbilityKey) return null;
    const prof = actor.system?.attributes?.prof ?? 0;
    const abilityMod = actor.system?.abilities?.[lightAbilityKey]?.mod ?? 0;
    return 8 + prof + abilityMod;
  };

  // "DC Bonus" - a freeform formula field added directly under the native
  // "DC Formula" field (see templates/activity/parts/check-details.hbs and
  // save-details.hbs) on every Check/Save activity, stored on the
  // activity's own flags (DocumentFlagsField - every Activity has one, same
  // as the Trait advancement's Special Trait Proficiency flag earlier) since
  // there's no schema field to bind to otherwise. Applied on top of whatever
  // the DC Calculation dropdown already computed, regardless of which mode
  // that is - it's meant as a general "add this on top" escape hatch (e.g.
  // @dndestiny.lightLevel, to let a Light Save DC ability scale with Light
  // Level - see the Razor's Edge/Skip Grenade/Blade Barrage fix, which is
  // exactly what this was added for), not something specific to Light Save
  // DC alone. Returns whether it actually changed anything, so callers know
  // whether a dependent label needs recomputing.
  const applyDcBonus = (activity, dc, rollData) => {
    const bonus = activity.flags?.dndestiny?.dcBonus;
    if (!dc || !bonus) return false;
    const amount = dndestiny.utils.simplifyBonus(bonus, rollData ?? activity.getRollData());
    if (!amount) return false;
    dc.value = (dc.value ?? 0) + amount;
    return true;
  };

  const CheckActivityClass = CONFIG.DND5E.activityTypes?.check?.documentClass;
  if (CheckActivityClass) {
    const originalPrepareFinalData = CheckActivityClass.prototype.prepareFinalData;
    CheckActivityClass.prototype.prepareFinalData = function (rollData) {
      originalPrepareFinalData.call(this, rollData);
      if (this.check?.dc?.calculation === LIGHT_SAVE_DC_CALCULATION) {
        const dc = computeLightSaveDc(this);
        if (dc !== null) this.check.dc.value = dc;
      }
      applyDcBonus(this, this.check?.dc, rollData);
    };
  }

  const SaveActivityClass = CONFIG.DND5E.activityTypes?.save?.documentClass;
  if (SaveActivityClass) {
    const originalSavePrepareFinalData = SaveActivityClass.prototype.prepareFinalData;
    SaveActivityClass.prototype.prepareFinalData = function (rollData) {
      originalSavePrepareFinalData.call(this, rollData);
      let changed = false;
      if (this.save?.dc?.calculation === LIGHT_SAVE_DC_CALCULATION) {
        const dc = computeLightSaveDc(this);
        if (dc !== null) {
          this.save.dc.value = dc;
          changed = true;
        }
      }
      if (applyDcBonus(this, this.save?.dc, rollData)) changed = true;
      if (changed) {
        this.labels.save = game.i18n.format("DND5E.SaveDC", {
          dc: this.save.dc.value, ability: CONFIG.DND5E.abilities[this.ability]?.label ?? ""
        });
      }
    };
  }

  // "Light Level" Damage Scaling mode - registers directly into dndestiny's own
  // CONFIG.DND5E.damageScalingModes, the CONFIG map its Activity sheet
  // template reads to populate the Scaling dropdown in a Damage part's
  // config (rendered only when that Activity actually has a Damage section -
  // see `if (context.activity.damage?.parts)` in dndestiny's own template code).
  // Registering here means the option appears automatically on every
  // Activity type that has this section and nowhere else, with no per-sheet
  // injection needed (contrast injectLightSaveDcOption above, which has to
  // inject a raw <option> by hand because Check DC Calculation isn't a
  // similarly registrable CONFIG map).
  //
  // Selecting it scales damage the same way native "Whole Level" scales by
  // character level - one extra scaling step (this part's Scaling Number)
  // per level above 1st - just counting Light Level instead. DamageData's
  // own scaledFormula() only recognizes "whole"/"half"/none, so this
  // reimplements it rather than wrapping, adding a third "light" case that
  // computes its own increase from the actor's Light Level up front instead
  // of trusting the increase it was called with (which reflects spell-slot
  // upcasting or native cantrip scaling - meaningless for Light Abilities).
  CONFIG.DND5E.damageScalingModes.light = { label: "Light Level", labelCantrip: "Light Level" };

  const DamageDataClass = dndestiny?.dataModels?.shared?.DamageData;
  const ScalingClass = dndestiny?.documents?.Scaling;
  if (DamageDataClass && ScalingClass) {
    DamageDataClass.prototype.scaledFormula = function (increase) {
      let mode = this.scaling.mode;

      if (mode === "light") {
        const actor = this.parent?.actor;
        const lightLevel = actor ? getLightLevel(actor) : null;
        increase = lightLevel != null ? Math.max(0, lightLevel - 1) : 0;
      } else {
        if (increase instanceof ScalingClass) increase = increase.increase;
        switch (mode) {
          case "whole": break;
          case "half": increase = Math.floor(increase * .5); break;
          default: increase = 0; break;
        }
      }

      if (!increase) return this.formula;
      let formula;

      const dieIncrease = (this.scaling.number ?? 0) * increase;
      if (this.custom.enabled) {
        formula = this.custom.formula;
        formula = formula.replace(/^(\d)+d/, (match, number) => `${Number(number) + dieIncrease}d`);
      } else {
        formula = this._automaticFormula(dieIncrease);
      }

      if (this.scaling.formula) {
        let roll = new Roll(this.scaling.formula);
        roll = roll.alter(increase, 0, { multiplyNumeric: true });
        formula = formula ? `${formula} + ${roll.formula}` : roll.formula;
      }

      return formula;
    };
  }

  // Special Range text - dndestiny's own RangeField.prepareData only ever shows
  // the generic word "Special" on the Range summary line (Description tab's
  // Casting Time/Range/Duration strip) when Range is set to Special,
  // regardless of what's typed into that "Condition" text box below it (the
  // Details tab's own special-range field, always visible - see
  // dndestiny.field-range.hbs). Same story for Duration's own Special text, so
  // this is consistent dndestiny behavior, not a bug - just not what's wanted
  // here. Wrapping so the summary line shows the actual typed text instead,
  // falling back to "Special" only when that box is empty.
  const RangeFieldClass = dndestiny?.dataModels?.shared?.RangeField;
  if (RangeFieldClass) {
    const originalRangePrepareData = RangeFieldClass.prepareData;
    RangeFieldClass.prepareData = function (rollData, labels) {
      originalRangePrepareData.call(this, rollData, labels);
      if ((this.range.units === "spec") && this.range.special) {
        this.range.labels.range = this.range.special;
        // The original already copied its generic "Special" word into the
        // outer labels object (with ||=, which won't touch it again now that
        // it's already set) - this is the object description.hbs's
        // spell-block partial actually reads (item.labels.range), so it
        // needs the override too, not just this.range.labels.range.
        if (labels) labels.range = this.range.special;
      }
    };
  }

  // "Shield Die" Advancement type - a class-level Advancement (like dndestiny's
  // own Hit Points) that shows up as its own step in the native level-up
  // wizard for every level after 1st, rolling the class's Shield Die (see
  // injectClassShieldDieField/dndestinyShieldDie) and adding the result to
  // max Shields, with a "Take Average" option mirroring HitPointsAdvancement's
  // own (average = floor(die/2) + 1, same formula dndestiny uses for HP).
  // Modeled closely on dndestiny's own HitPointsAdvancement/HitPointsConfig/
  // HitPointsFlow, just without the ability-modifier handling HP needs (this
  // is a flat roll-and-add, no level 1 grant).
  const Advancement = dndestiny?.documents?.advancement?.Advancement;
  const AdvancementConfigV2 = dndestiny?.applications?.advancement?.AdvancementConfigV2;
  const AdvancementFlowV2 = dndestiny?.applications?.advancement?.AdvancementFlowV2;

  if (Advancement && AdvancementConfigV2 && AdvancementFlowV2) {
    class ShieldDieAdvancement extends Advancement {
      static get metadata() {
        return foundry.utils.mergeObject(super.metadata, {
          order: 11,
          icon: "icons/magic/defensive/shield-barrier-blue.webp",
          typeIcon: "icons/magic/defensive/shield-barrier-blue.webp",
          title: "Shield Die",
          hint: "1st level: starting Shields equal to the Shield Die's face value (e.g. a d8 grants 8). Every "
            + "level after that: roll the Shield Die and add the result to max Shields.",
          multiLevel: true,
          apps: { config: ShieldDieConfig, flow: ShieldDieFlow }
        });
      }

      get levels() {
        return Array.fromRange(CONFIG.DND5E.maxLevel + 1).slice(1);
      }

      get shieldDie() {
        return this.item.system?.dndestinyShieldDie || "d6";
      }

      get shieldDieValue() {
        return Number(this.shieldDie.substring(1));
      }

      // Same "half the die, rounded up" formula dndestiny uses for HitPoints'
      // own Take Average option.
      get average() {
        return Math.floor(this.shieldDieValue / 2) + 1;
      }

      // 1st level is a flat grant of the die's face value (e.g. d8 -> 8), not
      // a roll - matches Hit Points' "max at 1st level" treatment.
      isStartingLevel(level) {
        return (level === 1) && this.item.isOriginalClass;
      }

      // Resolves a level's stored value ("avg", a rolled integer, or unset)
      // to the actual number to apply - mirrors HitPointsAdvancement's own
      // static valueForLevel(data, hitDieValue, level).
      static valueForLevel(data, shieldDieValue, level) {
        const value = data[level];
        if (value === "avg") return Math.floor(shieldDieValue / 2) + 1;
        return Number.isInteger(value) ? value : null;
      }

      valueForLevel(level) {
        return this.constructor.valueForLevel(this.value, this.shieldDieValue, level);
      }

      configuredForLevel(level) {
        return this.value[level] !== undefined;
      }

      titleForLevel(level, { configMode = false, legacyDisplay = false } = {}) {
        const value = this.valueForLevel(level);
        if (!value || configMode || !legacyDisplay) return this.title;
        return `${this.title}: <strong>${value}</strong>`;
      }

      static availableForItem(item) {
        return !item.advancement.byType.ShieldDie?.length;
      }

      async automaticApplicationValue(level) {
        if (this.isStartingLevel(level)) return { [level]: this.shieldDieValue };
        return false;
      }

      async apply(level, data, options = {}) {
        const raw = this.isStartingLevel(level) ? this.shieldDieValue : data[level];
        const numericValue = this.constructor.valueForLevel({ [level]: raw }, this.shieldDieValue, level);
        if (numericValue === null || numericValue === undefined) return;
        if (this.configuredForLevel(level)) await this.reverse(level);
        this.updateSource({ value: { [level]: raw } });
        this.actor.updateSource({
          "system.shields.max": (this.actor.system.shields?.max ?? 0) + numericValue
        });
      }

      async restore(level, data, options = {}) {
        await this.apply(level, data, options);
      }

      async reverse(level, options = {}) {
        if (!this.configuredForLevel(level)) return;
        const numericValue = this.valueForLevel(level);
        const source = { [level]: this.value[level] };
        this.updateSource({ [`value.-=${level}`]: null });
        this.actor.updateSource({
          "system.shields.max": (this.actor.system.shields?.max ?? 0) - numericValue
        });
        return source;
      }
    }

    class ShieldDieConfig extends AdvancementConfigV2 {
      static DEFAULT_OPTIONS = { classes: ["shield-die"] };

      static PARTS = {
        ...super.PARTS,
        shieldDie: { template: `systems/dndestiny/templates/advancement/shield-die-config.hbs` }
      };

      async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.shieldDie = this.advancement.shieldDie;
        return context;
      }
    }

    class ShieldDieFlow extends AdvancementFlowV2 {
      static DEFAULT_OPTIONS = {
        actions: { rollShieldDie: ShieldDieFlow.#rollShieldDie }
      };

      static PARTS = {
        ...super.PARTS,
        content: { template: `systems/dndestiny/templates/advancement/shield-die-flow.hbs` }
      };

      async _prepareContentContext(context, options) {
        context = await super._prepareContentContext(context, options);
        const isStartingLevel = this.advancement.isStartingLevel(this.level);
        const rawValue = isStartingLevel ? this.advancement.shieldDieValue : this.advancement.value[this.level];
        const value = rawValue === "avg" ? this.advancement.average : rawValue;
        const previous = Object.keys(this.advancement.value).reduce((total, lvl) => {
          if (Number(lvl) === this.level) return total;
          return total + (this.advancement.valueForLevel(Number(lvl)) ?? 0);
        }, 0);

        context.data = {
          value: Number.isInteger(value) ? value : "",
          useAverage: rawValue === "avg"
        };
        context.shields = {
          previous,
          total: Number.isInteger(value) ? previous + value : "—"
        };
        context.shieldDie = this.advancement.shieldDie;
        context.isStartingLevel = isStartingLevel;
        context.manual = !isStartingLevel && (rawValue !== "avg");
        return context;
      }

      static async #rollShieldDie() {
        const die = this.advancement.shieldDie;
        const roll = await new Roll(`1${die}`).evaluate();
        await roll.toMessage({
          speaker: ChatMessage.getSpeaker({ actor: this.advancement.actor }),
          flavor: `${this.advancement.actor.name} - Shield Die (${die})`
        });
        await this.advancement.apply(this.level, { [this.level]: roll.total });
        this.render();
      }

      async _handleForm(event, form, formData) {
        if (this.advancement.isStartingLevel(this.level)) {
          await this.advancement.apply(this.level, {});
          return;
        }

        let newValue;
        if (event.target?.name === "useAverage") {
          newValue = event.target.checked ? "avg" : null;
        } else if (event.target?.name === "value") {
          newValue = Number.isInteger(event.target.valueAsNumber) ? event.target.valueAsNumber : null;
        } else {
          return;
        }

        if (((typeof newValue === "string") && newValue) || Number.isInteger(newValue)) {
          await this.advancement.apply(this.level, { [this.level]: newValue });
        } else {
          await this.advancement.reverse(this.level);
        }
      }
    }

    CONFIG.DND5E.advancementTypes.ShieldDie = {
      documentClass: ShieldDieAdvancement,
      validItemTypes: new Set(["class"])
    };

    // "Destiny Hit Points" Advancement type - a from-scratch HP formula that
    // replaces what actually drives system.attributes.hp.max on the
    // character sheet (see the AttributesFields.prepareHitPoints patch
    // below), while leaving dndestiny's own "Hit Points"/Hit Dice advancement
    // completely alone so Hit Dice keep working for a future sheet. Formula:
    // level 1 = a per-class base number (configured on the advancement) +
    // CON modifier; every level after that adds the CON modifier again,
    // floored at 0 so a negative CON never removes HP on level-up. Fully
    // deterministic (no roll, no choice), so the wizard step is read-only -
    // clicking Next just confirms the level.
    class DestinyHitPointsConfigurationData extends foundry.abstract.DataModel {
      static defineSchema() {
        return {
          baseHitPoints: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
        };
      }
    }

    class DestinyHitPointsAdvancement extends Advancement {
      static get metadata() {
        return foundry.utils.mergeObject(super.metadata, {
          dataModels: { configuration: DestinyHitPointsConfigurationData },
          order: 9,
          icon: "icons/magic/life/heart-cross-purple-orange.webp",
          typeIcon: "icons/magic/life/heart-cross-purple-orange.webp",
          title: "Destiny Hit Points",
          hint: "1st level: base Hit Points (set below) + Constitution modifier. Every level after that: "
            + "Constitution modifier (minimum 0).",
          multiLevel: true,
          apps: { config: DestinyHitPointsConfig, flow: DestinyHitPointsFlow }
        });
      }

      get levels() {
        return Array.fromRange(CONFIG.DND5E.maxLevel + 1).slice(1);
      }

      // The actual HP contribution for a single level, given a CON modifier -
      // shared by getAdjustedTotal (actor sheet) and the flow's breakdown.
      perLevelValue(level, mod) {
        if ((level === 1) && this.item.isOriginalClass) return (this.configuration.baseHitPoints ?? 0) + mod;
        return Math.max(mod, 0);
      }

      // Total HP this advancement contributes across every level that's been
      // confirmed so far - mirrors HitPointsAdvancement#getAdjustedTotal's
      // role, just with this class's own formula instead of a stored roll.
      getAdjustedTotal(mod) {
        return Object.keys(this.value).reduce((total, level) => {
          return this.value[level] ? total + this.perLevelValue(Number(level), mod) : total;
        }, 0);
      }

      configuredForLevel(level) {
        return !!this.value[level];
      }

      titleForLevel(level, { configMode = false, legacyDisplay = false } = {}) {
        if (configMode || !legacyDisplay || !this.value[level]) return this.title;
        const abilityId = CONFIG.DND5E.defaultAbilities.hitPoints || "con";
        const mod = this.actor?.system?.abilities?.[abilityId]?.mod ?? 0;
        return `${this.title}: <strong>${this.perLevelValue(level, mod)}</strong>`;
      }

      static availableForItem(item) {
        return !item.advancement.byType.DestinyHitPoints?.length;
      }

      // No roll, no choice - always safe to auto-apply, including during
      // bulk/automatic level-up.
      async automaticApplicationValue(level) {
        return {};
      }

      async apply(level, data, options = {}) {
        if (this.value[level]) return;
        const abilityId = CONFIG.DND5E.defaultAbilities.hitPoints || "con";
        const mod = this.actor.system.abilities?.[abilityId]?.mod ?? 0;
        const delta = this.perLevelValue(level, mod);
        this.updateSource({ value: { [level]: true } });
        this.actor.updateSource({
          "system.attributes.hp.value": (this.actor.system.attributes.hp.value ?? 0) + delta
        });
      }

      async restore(level, data, options = {}) {
        await this.apply(level, data, options);
      }

      async reverse(level, options = {}) {
        if (!this.value[level]) return;
        const abilityId = CONFIG.DND5E.defaultAbilities.hitPoints || "con";
        const mod = this.actor.system.abilities?.[abilityId]?.mod ?? 0;
        const delta = this.perLevelValue(level, mod);
        const source = { [level]: this.value[level] };
        this.updateSource({ [`value.-=${level}`]: null });
        this.actor.updateSource({
          "system.attributes.hp.value": (this.actor.system.attributes.hp.value ?? 0) - delta
        });
        return source;
      }
    }

    class DestinyHitPointsConfig extends AdvancementConfigV2 {
      static DEFAULT_OPTIONS = { classes: ["destiny-hit-points"] };

      static PARTS = {
        ...super.PARTS,
        destinyHp: { template: `systems/dndestiny/templates/advancement/destiny-hp-config.hbs` }
      };
    }

    class DestinyHitPointsFlow extends AdvancementFlowV2 {
      static PARTS = {
        ...super.PARTS,
        content: { template: `systems/dndestiny/templates/advancement/destiny-hp-flow.hbs` }
      };

      async _prepareContentContext(context, options) {
        context = await super._prepareContentContext(context, options);

        const abilityId = CONFIG.DND5E.defaultAbilities.hitPoints || "con";
        const mod = this.advancement.actor.system.abilities?.[abilityId]?.mod ?? 0;
        const isFirstLevel = (this.level === 1) && this.advancement.item.isOriginalClass;
        const gained = this.advancement.perLevelValue(this.level, mod);
        const previous = Object.keys(this.advancement.value).reduce((total, lvl) => {
          if (Number(lvl) === this.level) return total;
          return this.advancement.value[lvl] ? total + this.advancement.perLevelValue(Number(lvl), mod) : total;
        }, 0);

        context.hp = {
          isFirstLevel,
          modifierLabel: CONFIG.DND5E.abilities[abilityId]?.abbreviation ?? "",
          gained,
          previous,
          total: previous + gained
        };
        return context;
      }
    }

    CONFIG.DND5E.advancementTypes.DestinyHitPoints = {
      documentClass: DestinyHitPointsAdvancement,
      validItemTypes: new Set(["class"])
    };

    // Makes DestinyHitPoints (when present on any of an actor's classes) the
    // one that actually drives system.attributes.hp.max, instead of dndestiny's
    // own Hit Dice-based calculation - see AttributesFields.prepareHitPoints.
    // Falls through to native behavior untouched for any actor/class that
    // doesn't have this advancement, so dndestiny's own Hit Points/Hit Dice
    // keep working exactly as before wherever this isn't in use.
    const AttributesFields = dndestiny?.dataModels?.actor?.AttributesFields;
    if (AttributesFields) {
      const originalPrepareHitPoints = AttributesFields.prepareHitPoints;
      AttributesFields.prepareHitPoints = function (hp, options = {}) {
        const actor = this.parent;
        const advancements = isCharacterLikeActor(actor)
          ? Object.values(actor.classes).map(c => c.advancement.byType.DestinyHitPoints?.[0]).filter(a => a)
          : [];

        // Native prepareHitPoints's own hp.value = Math.min(hp.value, hp.effectiveMax)
        // clamps against whatever hp.max IT computes (0, since these classes
        // never carry a native HitPoints advancement) - once that clamps
        // value down, our own corrected hp.max below can't undo it (min()
        // only ever shrinks). So this has to fully replace the native call
        // rather than run it first and layer on top, or every manually-set
        // HP value silently gets zeroed out on the very next data prep.
        if (!advancements.length) {
          originalPrepareHitPoints.call(this, hp, options);
          return;
        }

        const mod = options.mod ?? 0;
        hp.max = advancements.reduce((total, adv) => total + adv.getAdjustedTotal(mod), 0);
        if (actor.hasConditionEffect?.("halfHealth")) hp.max *= 0.5;
        hp.max = Math.floor(hp.max);

        hp.effectiveMax = Math.max(hp.max + (hp.tempmax ?? 0), 0);
        hp.value = Math.min(hp.value, hp.effectiveMax);
        hp.damage = hp.effectiveMax - hp.value;
        hp.pct = Math.clamp(hp.effectiveMax ? (hp.value / hp.effectiveMax) * 100 : 0, 0, 100);
      };

      // A Ghost's unarmored AC is 12 + Dex mod instead of dndestiny's usual 10 +
      // Dex mod (see CONFIG.DND5E.armorClasses.default.formula, unchanged -
      // just the starting "armor" value it adds Dex to). Only kicks in while
      // AC is actually on the native "default" calc and no Ghost Shell (see
      // GHOST_SHELL_TYPE_KEY/isGhostShellItem) is equipped - the moment one
      // is, prepareArmorClass's own native logic overwrites ac.armor with
      // that shell's real AC value exactly like any other equipped armor,
      // since Ghost Shell is registered as a real CONFIG.DND5E.armorTypes
      // entry (see the armorTypes registration above).
      const originalPrepareArmorClass = AttributesFields.prepareArmorClass;
      AttributesFields.prepareArmorClass = function (rollData) {
        const actor = this.parent;
        if ((actor?.type === GHOST_ACTOR_TYPE) && (this.attributes.ac.calc === "default")) {
          const hasShellEquipped = actor.itemTypes.equipment.some(i => i.system.equipped && isGhostShellItem(i));
          if (!hasShellEquipped) this.attributes.ac.armor = 12;
        }
        originalPrepareArmorClass.call(this, rollData);
      };
    }
  }

  // "Reload" Activity type - lets a Shot Capacity weapon's reload show up as
  // a normal usable Activity (in the item's Activities list, and in the
  // expanded inventory row alongside Attack/Damage) so it produces a chat
  // card like any other activity, instead of living behind a Details tab
  // button. See ensureReloadActivity for how this gets added to/removed
  // from weapons automatically as the Shot Capacity property is toggled.
  const ActivityMixin = dndestiny?.documents?.activity?.ActivityMixin;
  const BaseActivityData = dndestiny?.dataModels?.activity?.BaseActivityData;
  const ActivitySheet = dndestiny?.applications?.activity?.ActivitySheet;

  if (ActivityMixin && BaseActivityData && ActivitySheet) {
    class ReloadActivity extends ActivityMixin(BaseActivityData) {
      static metadata = Object.freeze(
        foundry.utils.mergeObject(super.metadata, {
          type: "dndestinyReload",
          img: "icons/svg/regen.svg",
          title: "DNDESTINY.Activity.Reload.Title",
          hint: "DNDESTINY.Activity.Reload.Hint",
          sheetClass: ActivitySheet
        }, { inplace: false })
      );

      // Runs the actual reload instead of the generic consumption pipeline -
      // there's no fixed "target item" to configure ahead of time (see
      // reloadWeapon, which picks whichever Magazine is available at use
      // time), so the usual Consumption tab targets don't apply here.
      async consume(usageConfig, messageConfig) {
        const item = this.actor?.items.get(this.item.id) ?? this.item;

        if (!game.settings.get(MODULE_ID, SETTING_TRACK_AMMO)) {
          ui.notifications.warn("Weapon Ammo tracking is disabled in this world's Module Settings.");
          return false;
        }

        // Self-reloads when attached to the weapon it belongs to. Attached
        // to anything else (e.g. a Superclass Ability like Hunter's Dodge),
        // there's no fixed weapon to reload, so ask which of the actor's
        // Shot Capacity weapons to reload instead (see promptReloadTarget).
        let target;
        if (item.type === "weapon") {
          if (!item.system?.properties?.has("dndestinyShotCapacity")) {
            ui.notifications.warn(`${item.name} doesn't have the Shot Capacity property - nothing to reload.`);
            return false;
          }
          target = item;
        } else {
          target = await promptReloadTarget(this.actor);
          if (!target) return false;
        }

        const outcome = await reloadWeapon(target);
        if (!outcome.ok) return false;

        foundry.utils.setProperty(messageConfig, "data.flavor", outcome.flavor);
        return { rolls: [], activity: {}, actor: {}, create: [], delete: [], item: [] };
      }
    }

    CONFIG.DND5E.activityTypes.dndestinyReload = { documentClass: ReloadActivity };
  }

  // Propagates the Explosive Damage flag onto every damage roll an
  // explosive-flagged activity produces, by adding "explosive" to that
  // roll's properties - the same properties Set dnd5e's own
  // physical-damage-bypass (magical/silvered/adamantine) rides on, and the
  // one the ActorDocumentClass#calculateDamage patch above reads to know
  // which damage parts to treat as Explosive. Two flags feed this, either
  // one is enough:
  //  - flags.dndestiny.explosiveDamage.<activityId> - the per-activity
  //    checkbox (see injectExplosiveDamageToggle), for authoring a
  //    specific activity as explosive by hand.
  //  - flags.dndestiny.explosiveWeapon - a whole-item override with no
  //    activity id needed, meant as the Active Effect/enchantment key (an
  //    activity's own randomly-generated _id isn't practical to reference
  //    from an effect's Attribute Key field) - e.g. "Explosive Rounds" ammo
  //    or a perk that makes every damage-dealing activity on the item
  //    explosive while applied. Boolean, Override mode, value true.
  // Patched on BaseActivityData directly (rather than
  // AttackActivity/DamageActivity/SaveActivity separately) since every
  // activity type that deals damage inherits _processDamagePart from here
  // unchanged - see getDamageConfig/rollDamage further up this same class.
  if (BaseActivityData) {
    const originalProcessDamagePart = BaseActivityData.prototype._processDamagePart;
    BaseActivityData.prototype._processDamagePart = function (damage, rollConfig, rollData, index, opts) {
      const result = originalProcessDamagePart.call(this, damage, rollConfig, rollData, index, opts);
      if (this.item?.getFlag("dndestiny", "explosiveWeapon")
        || this.item?.getFlag("dndestiny", `explosiveDamage.${this.id}`)) {
        result.options ??= {};
        const properties = new Set(result.options.properties ?? []);
        properties.add("explosive");
        result.options.properties = Array.from(properties);
      }
      return result;
    };
  }
});

// Groups the Destiny damage types under a "Paracausal Damage" header in the
// Damage Immunities/Resistances/Vulnerabilities/Modification trait
// selectors. Deferred with setTimeout inside "ready" - not just "ready" on
// its own - because at least one other installed module also has its own
// "ready" hook that touches CONFIG.DND5E.traits[trait].configKey and runs
// after ours in registration order, reverting our change back to
// "damageTypes" before any sheet opened. Hooks.callAll fires every "ready"
// listener synchronously in one pass, so wrapping ours in setTimeout pushes
// it to the next macrotask - after that whole synchronous pass (every
// module's "ready" handler, whatever order they're in) has already
// finished - so nothing runs after us to stomp on it again.
//
// This needs its own config key rather than nesting the types directly in
// CONFIG.DND5E.damageTypes, because di/dr/dv/dm all read that object
// directly (unlike e.g. tools, which already has a display-only
// toolProficiencies map separate from the flat CONFIG.DND5E.tools) -
// nesting them there would also make "Paracausal Damage" itself show up as
// a selectable damage type everywhere else that iterates
// CONFIG.DND5E.damageTypes flatly (damage rolls, activity dropdowns).
Hooks.once("ready", () => {
  setTimeout(() => {
    CONFIG.DND5E.damageTypeCategories = foundry.utils.deepClone(CONFIG.DND5E.damageTypes);
    for (const key of Object.keys(PARACAUSAL_DAMAGE_TYPES)) delete CONFIG.DND5E.damageTypeCategories[key];
    CONFIG.DND5E.damageTypeCategories.paracausal = { label: "Paracausal Damage", children: PARACAUSAL_DAMAGE_TYPES };

    // "Explosive" (see the ActorDocumentClass#calculateDamage and
    // BaseActivityData#_processDamagePart patches in the "init" hook above)
    // is a damage type *modifier*, not a real damage type - it never appears
    // on a damage roll's Type field and is never itself rolled. It only needs
    // to be selectable here, in the Resistances/Immunities/Vulnerabilities
    // pickers (damageTypeCategories), which is exactly why those live in
    // their own config key instead of CONFIG.DND5E.damageTypes - adding it
    // there instead would also make "Explosive" a selectable damage TYPE on
    // every damage formula's Type field, which isn't what it is.
    CONFIG.DND5E.damageTypeCategories.explosive = {
      label: "Explosive", icon: "icons/svg/explosion.svg", color: new Color(0xFF4500)
    };

    for (const trait of ["di", "dr", "dv", "dm"]) {
      if (CONFIG.DND5E.traits?.[trait]) CONFIG.DND5E.traits[trait].configKey = "damageTypeCategories";
    }
  }, 1000);
});

// One-time migration for existing Grenade feature items created before
// Grenade moved from a native Feature Type (system.type.value === "grenade")
// to the unified Core Ability Slot dropdown (system.dndestinyAbilitySlot ===
// "grenade" - see GRENADE_SLOT_KEY/isGrenadeItem). GM-only so every
// connected client doesn't race to update the same items.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  const migrateItem = (item) => item.update({
    "system.dndestinyAbilitySlot": GRENADE_SLOT_KEY,
    "system.type.value": ""
  });

  const worldMigrations = game.items
    .filter(i => i.type === "feat" && i.system?.type?.value === "grenade")
    .map(migrateItem);

  const actorMigrations = game.actors.contents.flatMap(actor =>
    actor.items
      .filter(i => i.type === "feat" && i.system?.type?.value === "grenade")
      .map(migrateItem)
  );

  const results = await Promise.allSettled([...worldMigrations, ...actorMigrations]);
  const migrated = results.filter(r => r.status === "fulfilled").length;
  if (migrated) console.log(`Dungeons & Destiny | Migrated ${migrated} Grenade feature(s) to the unified Core Ability Slot dropdown.`);
});

// One-time migration for Core Light Ability items created before they
// moved from Feature items to their own dedicated type (see
// GRENADE_SLOT_KEY/ABILITY_SLOTS/isGrenadeItem/isAbilitySlotItem/
// LIGHT_ABILITY_ITEM_TYPE) - converts any leftover Feature item with a Core
// Ability Slot set directly into a Light Ability item, carrying its slot
// and (for Grenades) Recharge fields across the type change. Targets
// LIGHT_ABILITY_ITEM_TYPE directly rather than hopping through "spell"
// first (which is what this used to do, back when Light Abilities were
// themselves spell items) - one type change instead of two for any old data
// that still needs this. Must run after the migration above, since that one
// can newly set dndestinyAbilitySlot on Feature items this one then needs
// to catch. GM-only so every connected client doesn't race to update the
// same items.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  // Reads item._source rather than item.system throughout - dndestinyAbilitySlot
  // is no longer part of the feat schema (it moved to Light Ability's - see
  // the init hook), so the live prepared item.system silently no longer
  // exposes it at all for a feat item, even though the raw stored value is
  // still sitting right there in _source untouched.
  const needsMigration = (item) => item.type === "feat" && !!item._source.system?.dndestinyAbilitySlot;

  // Foundry requires the entire system object to be replaced wholesale
  // (via the ForcedReplacement operator) when a Document's type changes -
  // a normal dotted-path update only merges into the OLD type's schema.
  // Starting from the item's own raw system source (rather than just the 3
  // custom fields) carries over whatever else transfers cleanly between
  // the two types (description, activities, uses, source, etc.); Foundry's
  // own LightAbilityData DataModel silently drops whatever doesn't apply.
  const migrateItem = (item) => {
    const rawSystem = item._source.system;
    return item.update({
      type: LIGHT_ABILITY_ITEM_TYPE,
      system: foundry.data.operators.ForcedReplacement.create({
        ...rawSystem,
        dndestinyRechargeDie: rawSystem.dndestinyRechargeDie || "d6",
        dndestinyRechargeThreshold: rawSystem.dndestinyRechargeThreshold ?? 6
      })
    });
  };

  const worldMigrations = game.items.filter(needsMigration).map(migrateItem);
  const actorMigrations = game.actors.contents.flatMap(actor =>
    actor.items.filter(needsMigration).map(migrateItem)
  );

  const results = await Promise.allSettled([...worldMigrations, ...actorMigrations]);
  const migrated = results.filter(r => r.status === "fulfilled").length;
  if (migrated) {
    console.log(`Dungeons & Destiny | Migrated ${migrated} Core Light Ability item(s) from Feature to the Light Ability type.`);
  }
});

// One-time migration for existing Light Ability/Grenade items still sitting
// on the native "spell" type from before LIGHT_ABILITY_ITEM_TYPE existed
// (when Light Abilities were spell items with the item type itself globally
// relabeled "Light Ability" - see the removed i18nInit override). Real
// spells never set dndestinyAbilitySlot, so filtering on that can't
// misfire on them. Unlike the migrations above, Light Abilities live in a
// real content compendium (dndestiny.light-abilities) as well as scattered
// world/actor items, so this also walks every Item compendium - unlocking
// and relocking each one only around its own updates, leaving whichever
// lock state it was actually stored with untouched afterward. GM-only, same
// race-avoidance reasoning as the migrations above.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  const needsMigration = (item) => item.type === "spell" && !!item._source.system?.dndestinyAbilitySlot;
  const migrateItem = (item) => item.update({
    type: LIGHT_ABILITY_ITEM_TYPE,
    system: foundry.data.operators.ForcedReplacement.create({ ...item._source.system })
  });

  const worldMigrations = game.items.filter(needsMigration).map(migrateItem);
  const actorMigrations = game.actors.contents.flatMap(actor =>
    actor.items.filter(needsMigration).map(migrateItem)
  );

  let compendiumMigrated = 0;
  for (const pack of game.packs.filter(p => p.documentName === "Item")) {
    const index = await pack.getIndex({ fields: ["type", "system.dndestinyAbilitySlot"] });
    const toMigrate = index.filter(e => (e.type === "spell") && !!e.system?.dndestinyAbilitySlot);
    if (!toMigrate.length) continue;

    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });
    for (const entry of toMigrate) {
      const doc = await pack.getDocument(entry._id);
      await migrateItem(doc);
      compendiumMigrated++;
    }
    if (wasLocked) await pack.configure({ locked: true });
  }

  const results = await Promise.allSettled([...worldMigrations, ...actorMigrations]);
  const migrated = results.filter(r => r.status === "fulfilled").length + compendiumMigrated;
  if (migrated) {
    console.log(`Dungeons & Destiny | Migrated ${migrated} Light Ability item(s) from "spell" to the dedicated Light Ability type.`);
  }
});

// ==========================================
// 2. COMBAT & DAMAGE PIPELINE
// ==========================================
function floatShieldText(actor, text, color) {
  try {
    const tokens = (actor?.getActiveTokens() || []).filter(t => t?.visible && t?.renderable);
    for (const token of tokens) {
      canvas.interface.createScrollingText(token.center, text, {
        anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
        direction: CONST.TEXT_ANCHOR_POINTS.TOP,
        fill: color,
        stroke: 0x000000,
        strokeThickness: 4,
        fontSize: 28,
        fontFamily: "Signika",
        fontWeight: "bold",
        jitter: 0.25
      });
    }
  } catch (err) {
    console.warn("D&Destiny | Floating text error:", err);
  }
}

Hooks.on("preUpdateActor", (actor, updateData) => {
  if (!isCharacterLikeActor(actor)) return;

  const processShieldUpdate = (key, hexColor) => {
    if (updateData.system?.[key]?.value === undefined) return;
    const current = actor.system?.[key]?.value ?? 0;
    const max = updateData.system?.[key]?.max ?? actor.system?.[key]?.max ?? 10;
    const clamped = clamp(Number(updateData.system[key].value), 0, max);
    
    updateData.system[key].value = clamped;
    if (clamped > current) floatShieldText(actor, `+${clamped - current}`, hexColor);
  };

  processShieldUpdate("shields", "#ffffff");
  processShieldUpdate("overshields", "#00bfff");

  const newHpTarget = updateData.system?.attributes?.hp?.value;
  if (newHpTarget === undefined) return;

  const currentHp = actor.system?.attributes?.hp?.value ?? 0;
  if (newHpTarget >= currentHp || editingHpActors.has(actor.id)) return;

  let incomingDamage = currentHp - newHpTarget;
  let tempOvershields = actor.system?.overshields?.value ?? 0;
  let tempShields = actor.system?.shields?.value ?? 0;

  const consumeBuffer = (currentVal) => {
    if (incomingDamage <= 0 || currentVal <= 0) return { damageTaken: 0, remaining: currentVal };
    const damageTaken = Math.min(incomingDamage, currentVal);
    incomingDamage -= damageTaken;
    return { damageTaken, remaining: currentVal - damageTaken };
  };

  const osResult = consumeBuffer(tempOvershields);
  if (osResult.damageTaken > 0) {
    foundry.utils.setProperty(updateData, "system.overshields.value", osResult.remaining);
    floatShieldText(actor, `-${osResult.damageTaken}`, "#00bfff");
  }

  const sResult = consumeBuffer(tempShields);
  if (sResult.damageTaken > 0) {
    foundry.utils.setProperty(updateData, "system.shields.value", sResult.remaining);
    setTimeout(() => floatShieldText(actor, `-${sResult.damageTaken}`, "#ffffff"), osResult.damageTaken > 0 ? 150 : 0);
  }

  // Direct assignment is safe here (unlike shields/overshields above) since
  // updateData.system.attributes.hp is already known to exist - newHpTarget
  // was read from it via optional chaining without bailing out above.
  updateData.system.attributes.hp.value = currentHp - incomingDamage;
});

// Auto-deducts a weapon's Shot Capacity "Remaining" count on every attack it
// makes - gated the same way as the Shot Capacity UI itself (see
// injectWeaponShotCapacityField): only weapons carrying the Shot Capacity
// property, and only while SETTING_TRACK_AMMO is on. Fires after the attack
// roll (and any native ammo consumption) has already completed.
Hooks.on("dndestiny.postRollAttack", (rolls, { subject }) => {
  const item = subject?.item;
  if (!item || item.type !== "weapon") return;
  if (!item.system?.properties?.has("dndestinyShotCapacity")) return;
  if (!game.settings.get(MODULE_ID, SETTING_TRACK_AMMO)) return;

  const remaining = item.system?.dndestinyShotsRemaining;
  if (!Number.isInteger(remaining)) return;

  if (remaining <= 0) {
    ui.notifications.warn(`${item.name} is out of ammo! Reload before firing again.`);
    return;
  }

  item.update({ "system.dndestinyShotsRemaining": remaining - 1 });
});

// ==========================================
// 3. UI METER COMPONENTS & EVENT BINDINGS
// ==========================================
function createMeterBlock({ label, color, key, val, max, shieldDie }) {
  const pct = getPct(val, max);
  const borderRightStyle = pct < 100 ? `2px solid ${color}` : "none";

  return `
    <div class="dndestiny-meter-wrapper-${key}">
      <div class="dndestiny-meter-label" style="color: ${color};">
        <span>${label}</span>
        <div class="dndestiny-meter-label-actions">
          ${shieldDie ? `
          <button type="button" class="dndestiny-meter-roll-shield-die unbutton" data-key="${key}"
                  data-tooltip="Roll Shield Die (${shieldDie})" aria-label="Roll Shield Die">
            <i class="fas fa-dice-d20" inert></i>
          </button>
          ` : ""}
          <button type="button" class="dndestiny-meter-config config-button unbutton" data-key="${key}"
                  data-tooltip="Configure ${label}" aria-label="Configure ${label}">
            <i class="fas fa-cog" inert></i>
          </button>
        </div>
      </div>
      <div class="dndestiny-meter-frame" style="border: 1px solid ${color};">
        <div class="dndestiny-${key}-fill dndestiny-meter-fill" style="width: ${pct}%; background: ${color}40; border-right: ${borderRightStyle};"></div>
        <div class="dndestiny-meter-content">
          <input type="number" class="dndestiny-${key}-val dndestiny-meter-input" value="${val}" min="0" max="${max}" />
          <span style="color: ${color}80; font-size: 16px; font-weight: 300;">/</span>
          <input type="number" class="dndestiny-${key}-max dndestiny-meter-input" value="${max}" min="0" />
        </div>
      </div>
    </div>
  `;
}

// Opens a configuration menu for a vitals meter, matching dndestiny's own cog
// buttons elsewhere on the sheet (e.g. AC, Initiative). HP reuses dndestiny's
// real Hit Points config; Shields/Overshields are custom fields with no
// native equivalent, so they get a small Value/Max dialog instead.
function openMeterConfigDialog(key, actor, sheetApp) {
  if (key === "hp") {
    const HitPointsConfig = dndestiny?.applications?.actor?.HitPointsConfig;
    if (HitPointsConfig && typeof sheetApp?._renderChild === "function") {
      sheetApp._renderChild(new HitPointsConfig({ document: actor }));
      return;
    }
  }

  const cfg = METER_CONFIG.find(c => c.key === key);
  if (!cfg) return;

  const val = getProperty(actor, `system.${cfg.path}.value`) ?? cfg.defaultVal;
  const max = getProperty(actor, `system.${cfg.path}.max`) ?? cfg.defaultMax;

  foundry.applications.api.DialogV2.prompt({
    window: { title: `Configure ${cfg.label}` },
    position: { width: 320 },
    content: `
      <div class="form-group">
        <label>Current</label>
        <div class="form-fields"><input type="number" name="value" value="${val}" min="0" /></div>
      </div>
      <div class="form-group">
        <label>Maximum</label>
        <div class="form-fields"><input type="number" name="max" value="${max}" min="0" /></div>
      </div>
    `,
    ok: {
      label: "Save",
      callback: (event, button) => {
        const data = new foundry.applications.ux.FormDataExtended(button.form).object;
        const newMax = Math.max(0, Number(data.max));
        const newVal = clamp(Number(data.value), 0, newMax);
        actor.update({
          [`system.${cfg.path}.max`]: newMax,
          [`system.${cfg.path}.value`]: newVal
        });
      }
    }
  });
}

function bindMeterEvents(container, key, actorPath, actor, sheetApp) {
  const fill = container.querySelector(`.dndestiny-${key}-fill`);
  const valInput = container.querySelector(`.dndestiny-${key}-val`);
  const maxInput = container.querySelector(`.dndestiny-${key}-max`);
  const configBtn = container.querySelector(`.dndestiny-meter-config[data-key="${key}"]`);

  if (configBtn && !configBtn.dataset.dndestinyBound) {
    configBtn.dataset.dndestinyBound = "true";
    configBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMeterConfigDialog(key, actor, sheetApp);
    });
  }

  const rollDieBtn = container.querySelector(`.dndestiny-meter-roll-shield-die[data-key="${key}"]`);
  if (rollDieBtn && !rollDieBtn.dataset.dndestinyBound) {
    rollDieBtn.dataset.dndestinyBound = "true";
    rollDieBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      rollShieldDie(actor);
    });
  }

  if (!valInput || !maxInput) return;

  valInput.addEventListener("focus", () => {
    if (key === "hp") editingHpActors.add(actor.id);
  });

  valInput.addEventListener("blur", () => {
    if (key !== "hp") return;
    editingHpValues.delete(actor.id);
    setTimeout(() => editingHpActors.delete(actor.id), 200);
  });

  valInput.addEventListener("input", () => {
    if (key === "hp") editingHpValues.set(actor.id, valInput.value);

    const val = clamp(Number(valInput.value), 0, Number(maxInput.value));
    const pct = getPct(val, Number(maxInput.value));
    fill.style.width = `${pct}%`;
    fill.style.borderRight = pct < 100 ? "2px solid currentColor" : "none";
  });

  valInput.addEventListener("change", (e) => {
    if (key === "hp") editingHpValues.delete(actor.id);

    const max = getProperty(actor, `system.${actorPath}.max`) ?? 10;
    const clampedVal = clamp(Number(e.target.value), 0, max);
    e.target.value = clampedVal;
    actor.update({ [`system.${actorPath}.value`]: clampedVal });
  });

  maxInput.addEventListener("change", (e) => {
    const newMax = Math.max(0, Number(e.target.value));
    const currentVal = getProperty(actor, `system.${actorPath}.value`) ?? 0;
    const clampedVal = Math.min(currentVal, newMax);

    valInput.max = newMax;
    valInput.value = clampedVal;

    actor.update({
      [`system.${actorPath}.max`]: newMax,
      [`system.${actorPath}.value`]: clampedVal
    });
  });
}

// Rolls the primary class's Shield Die (see getPrimaryLightClass and the
// class item's dndestinyShieldDie field) and adds the result straight to
// max Shields - unlike Hit Dice, this isn't a spendable pool, just a bump
// the player triggers manually. Formula is (Light Level) dice of the Shield
// Die, plus the Light Ability modifier added once to the total - e.g. Light
// Level 3, d8 Shield Die, +2 Light Ability mod rolls "3d8 + 2".
async function rollShieldDie(actor) {
  const die = getPrimaryLightClass(actor)?.system?.dndestinyShieldDie || "d6";
  const lightLevel = getLightLevel(actor) ?? 1;
  const mod = getLightAbilityMod(actor) ?? 0;
  const formula = `${lightLevel}${die} + ${mod}`;

  const roll = await new Roll(formula).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${actor.name} - Shield Die (${formula})`
  });

  const currentMax = actor.system?.shields?.max ?? 0;
  await actor.update({ "system.shields.max": currentMax + roll.total });
}

// ==========================================
// 4. SHEET INJECTION ENGINE
// ==========================================
function injectShieldMeters(sheetApp, rootElement) {
  if (!sheetApp?.actor || !isCharacterLikeActor(sheetApp.actor) || !rootElement) return;

  const actor = sheetApp.actor;

  const nativeHpMeter = rootElement.querySelector('dndestiny-meter[name="system.attributes.hp.value"]') 
                        || rootElement.querySelector('.meter.hit-points, .meter[data-property="attributes.hp"]');
                        
  if (!nativeHpMeter) return;

  const nativeHpContainer = nativeHpMeter.closest('.meter-container, li, .attribute.health') || nativeHpMeter;
  nativeHpContainer.style.display = "none";

  const nativeLabel = nativeHpContainer.parentElement?.querySelector('label, .label, [data-property="attributes.hp"] label');
  if (nativeLabel && nativeLabel !== nativeHpContainer) {
    nativeLabel.style.display = "none";
  }

  const tempSelectors = [
    'dndestiny-meter[name="system.attributes.hp.temp"]',
    '.meter.temp', '.meter.tempmax',
    '[data-property="attributes.hp.temp"]',
    '[data-property="attributes.hp.tempmax"]',
    '.attribute.health .temp',
    'input[name="system.attributes.hp.temp"]'
  ].join(',');

  rootElement.querySelectorAll(tempSelectors).forEach((node) => {
    const parent = node.closest('li, .meter-container, .attribute');
    if (parent) parent.style.display = "none";
    else node.style.display = "none";
  });

  if (rootElement.querySelector(".dndestiny-vitals-group")) return;

  const container = document.createElement("div");
  container.classList.add("dndestiny-vitals-group");

  const shieldDie = getPrimaryLightClass(actor)?.system?.dndestinyShieldDie || "d6";
  const isEditingHp = editingHpValues.has(actor.id);

  // Ghost doesn't use Shields/Overshields - Hit Points only.
  const metersForActor = actor.type === GHOST_ACTOR_TYPE
    ? METER_CONFIG.filter(cfg => cfg.key === "hp")
    : METER_CONFIG;

  container.innerHTML = metersForActor.map(cfg => {
    // If this actor's HP is mid-edit (uncommitted, pre-blur), a re-render
    // here would otherwise rebuild the input from the actor's last saved
    // value and silently drop whatever the user was still typing.
    const val = (cfg.key === "hp" && isEditingHp)
      ? editingHpValues.get(actor.id)
      : getProperty(actor, `system.${cfg.path}.value`) ?? cfg.defaultVal;
    const max = getProperty(actor, `system.${cfg.path}.max`) ?? cfg.defaultMax;
    return createMeterBlock({
      label: cfg.label, color: cfg.color, key: cfg.key, val, max,
      shieldDie: cfg.key === "shield" ? shieldDie : null
    });
  }).join('');

  metersForActor.forEach(cfg => {
    bindMeterEvents(container, cfg.key, cfg.path, actor, sheetApp);
  });

  nativeHpContainer.after(container);

  if (isEditingHp) {
    const hpInput = container.querySelector(".dndestiny-hp-val");
    if (hpInput) {
      hpInput.focus();
      hpInput.select();
    }
  }
}

function buildParchmentTooltipHtml(title, tag, desc, descLabel = "Examples") {
  return `
    <div class="tooltip-header">
      <h3>${title}</h3>
      <span class="pill">${tag}</span>
    </div>
    <div class="description">
      ${descLabel ? `<strong>${descLabel}:</strong> ` : ""}${desc}
    </div>
  `;
}

// Replaces whatever tooltip an element (and its children) already carry
// with our own parchment-styled one - used for both the Technology skill
// row and each tool/vehicle proficiency row.
function applyParchmentTooltip(el, html, tooltipClass = "dndestiny-parchment-tooltip") {
  el.querySelectorAll('*').forEach(child => {
    child.removeAttribute("data-tooltip");
    child.removeAttribute("title");
  });

  el.setAttribute("data-tooltip", html);
  el.setAttribute("data-tooltip-class", tooltipClass);
  el.setAttribute("data-tooltip-direction", "LEFT");
}

function injectSkillTooltips(rootElement) {
  if (!rootElement) return;

  const desc = CONFIG.DND5E.skills["tec"]?.description;
  if (!desc) return;

  const tecSkillRow = rootElement.querySelector('[data-key="tec"], [data-skill="tec"], .skill[data-key="tec"]');
  if (tecSkillRow) applyParchmentTooltip(tecSkillRow, buildParchmentTooltipHtml("Technology", "SKILL", desc));
}

function injectToolTooltips(rootElement) {
  if (!rootElement) return;

  for (const [key, desc] of Object.entries(TOOL_DESCRIPTIONS)) {
    const toolData = CONFIG.DND5E.tools[key];
    const label = toolData?.label || key;
    const categoryTag = toolData?.category === "veh" ? "VEHICLE" : "TOOLKIT";
    const tooltipHtml = buildParchmentTooltipHtml(label, categoryTag, desc);

    const selectors = [
      `[data-key="${key}"]`,
      `[data-tool="${key}"]`,
      `.tool[data-key="${key}"]`,
      `li.trait-item[data-key="${key}"]`
    ].join(',');

    rootElement.querySelectorAll(selectors).forEach(el => applyParchmentTooltip(el, tooltipHtml));
  }
}

// Mirrors an actor's class's configured grenades (system.dndestinyGrenades -
// no longer editable from the class item's own sheet, see the removed
// "Grenades" section, but the field and this sync still work if set another
// way) onto the actor as real embedded items, so each
// character tracks its own independent charges/uses through dndestiny's normal
// item machinery instead of everyone sharing one global item. Embedded
// copies are tagged with flags.dndestiny.sourceGrenadeUuid so this can tell
// "grenades that belong here" apart from anything else, and reconciles by
// creating whatever's missing and removing whatever no longer belongs
// (class changed, or a grenade was removed from the class's list).
const grenadeSyncInProgress = new Set();
async function syncActorGrenades(actor) {
  if (grenadeSyncInProgress.has(actor.id)) return;
  grenadeSyncInProgress.add(actor.id);

  try {
    const primaryClass = getPrimaryLightClass(actor);
    const wantedUuids = primaryClass?.system?.dndestinyGrenades ?? [];

    const syncedItems = actor.items.filter(i => isGrenadeItem(i) && i.getFlag(MODULE_ID, SOURCE_GRENADE_FLAG));
    const syncedUuids = new Set(syncedItems.map(i => i.getFlag(MODULE_ID, SOURCE_GRENADE_FLAG)));

    const toDelete = syncedItems
      .filter(i => !wantedUuids.includes(i.getFlag(MODULE_ID, SOURCE_GRENADE_FLAG)))
      .map(i => i.id);
    if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);

    const toCreateUuids = wantedUuids.filter(uuid => !syncedUuids.has(uuid));
    if (toCreateUuids.length) {
      const newItemsData = [];
      for (const uuid of toCreateUuids) {
        const source = await fromUuid(uuid);
        if (!isGrenadeItem(source)) continue;
        const data = source.toObject();
        delete data._id;
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.${SOURCE_GRENADE_FLAG}`, uuid);
        newItemsData.push(data);
      }
      if (newItemsData.length) await actor.createEmbeddedDocuments("Item", newItemsData);
    }
  } finally {
    grenadeSyncInProgress.delete(actor.id);
  }
}

// Core Light Abilities (Superclass/Melee/Super Ability, Grenade) are Spell
// items and live on the Core Light Abilities tab instead of the normal
// Spells list, so hide them (and any Spells section left empty as a
// result) from the native Spells tab - relevant if a GM ever re-enables
// that tab (see SETTING_HIDE_SPELLS_TAB), since it's hidden entirely by
// default anyway. Character-only, same as injectCoreLightAbilitiesTab
// itself - Ghost doesn't get that tab, so its Spells tab should show these
// items normally instead of hiding them with nowhere else to go.
function hideCoreAbilitySpells(actor, rootElement) {
  if (actor?.type !== "character") return;

  const spellsTab = rootElement.querySelector('.tab[data-tab="spells"]');
  if (!spellsTab) return;

  const sections = new Set();
  for (const item of actor.items) {
    if (!isGrenadeItem(item) && !isAbilitySlotItem(item)) continue;
    const li = spellsTab.querySelector(`[data-item-id="${item.id}"]`);
    if (!li) continue;
    li.style.display = "none";
    const section = li.closest('li.items-section, .items-section');
    if (section) sections.add(section);
  }

  sections.forEach(section => {
    const visibleItems = section.querySelectorAll('.item:not([style*="display: none"])');
    section.style.display = visibleItems.length ? "" : "none";
  });
}

// Every Light Ability item (not just ones already slotted into a Core
// Ability Slot or flagged as a Grenade - any dndestiny.lightAbility item at
// all) falls into the native Features tab by default, the same generic
// bucket real Feature/Feat items land in - dndestiny's sheet has no idea this
// is its own type with a dedicated tab. Hides them there (and any Features
// section left empty as a result), the same pattern/reasoning as
// hideCoreAbilitySpells above, just targeting Features instead of Spells and
// matching every Light Ability rather than only the ones with a slot set,
// since an unconfigured one still has nowhere better to show than the Core
// Light Abilities tab's own empty-slot prompts.
function hideLightAbilitiesFromFeatures(actor, rootElement) {
  if (actor?.type !== "character") return;

  const featuresTab = rootElement.querySelector('.tab[data-tab="features"]');
  if (!featuresTab) return;

  const sections = new Set();
  for (const item of actor.items) {
    if (!isLightAbilityTypeItem(item)) continue;
    const li = featuresTab.querySelector(`[data-item-id="${item.id}"]`);
    if (!li) continue;
    li.style.display = "none";
    const section = li.closest('li.items-section, .items-section');
    if (section) sections.add(section);
  }

  sections.forEach(section => {
    const visibleItems = section.querySelectorAll('.item:not([style*="display: none"])');
    section.style.display = visibleItems.length ? "" : "none";
  });
}

// Gated behind SETTING_HIDE_SPELLS_TAB (see the init hook) - hides the
// native Spells tab button and content entirely, restorable via that
// setting for casters that come later.
function applySpellsTabVisibility(rootElement) {
  const hide = game.settings.get(MODULE_ID, SETTING_HIDE_SPELLS_TAB);
  const navBtn = rootElement.querySelector('nav.tabs [data-tab="spells"]');
  const tabSection = rootElement.querySelector('.tab[data-tab="spells"]');
  if (navBtn) navBtn.style.display = hide ? "none" : "";
  if (tabSection) tabSection.style.display = hide ? "none" : "";
}

// Gated behind SETTING_HIDE_HIT_DICE (see the init hook) - hides the
// character sheet's Hit Dice meter (see character-sidebar.hbs). The class
// item field and Short Rest dialog have their own injectors below. Ghost
// sheets always show Hit Dice regardless of the setting - it's the "future
// dedicated character sheet" the setting's hint refers to.
function applyHitDiceVisibility(actor, rootElement) {
  const hide = actor?.type !== GHOST_ACTOR_TYPE && game.settings.get(MODULE_ID, SETTING_HIDE_HIT_DICE);
  const meterGroup = rootElement.querySelector('.meter.hit-dice')?.closest('.meter-group');
  if (meterGroup) meterGroup.style.display = hide ? "none" : "";
}

// dndestiny's own native fieldsets on the Special Traits tab - "Feats" and
// "Racial Traits" are its built-in flag sections (see
// CONFIG.DND5E.characterFlags, where every entry's `section` is one of
// these two), and "Global Bonuses" is a separate hardcoded template
// section (system.bonuses.*) rather than flag-driven at all. Deliberately
// NOT a general "hide everything but Class" rule - other modules
// contribute their own sections the exact same way dndestiny does (e.g. Midi
// QOL's own entries share this same tab under a "Midi QOL" section), and
// those should stay visible regardless of this module's own setting.
const BASE_SPECIAL_TRAITS_SECTIONS = ["Feats", "Racial Traits", "Global Bonuses"];

// Shared by injectJackOfAllGunsTrait (Guardian) and the Player Character
// pipeline (see handleSheetRender) - hides dndestiny's own native fieldsets
// on the Special Traits tab (see BASE_SPECIAL_TRAITS_SECTIONS) unless
// SETTING_SHOW_BASE_SPECIAL_TRAITS is enabled, leaving everything else
// (other modules' own contributed sections) alone. Split out on its own so
// Player Character can get a genuinely clear/empty Special Traits tab
// without also picking up Jack of all Guns, which is Destiny-specific.
function hideBaseSpecialTraitsSections(rootElement) {
  const tab = rootElement.querySelector('.tab[data-tab="specialTraits"]');
  if (!tab) return;

  const showBase = game.settings.get(MODULE_ID, SETTING_SHOW_BASE_SPECIAL_TRAITS);
  for (const fieldset of tab.querySelectorAll(":scope > fieldset")) {
    const legend = fieldset.querySelector(":scope > legend")?.textContent.trim();
    if (!BASE_SPECIAL_TRAITS_SECTIONS.includes(legend)) continue;
    fieldset.style.display = showBase ? "" : "none";
  }
}

// Adds a "Jack of all Guns" checkbox (see JACK_OF_ALL_GUNS_FLAG/the
// AttackActivity#getAttackData patch in the "init" hook) to the character
// sheet's native Special Traits tab, and hides dndestiny's own native
// fieldsets there (see hideBaseSpecialTraitsSections) leaving everything
// else (this module's own trait, "Class", and any other module's
// contributed sections) alone.
function injectJackOfAllGunsTrait(actor, rootElement) {
  const tab = rootElement.querySelector('.tab[data-tab="specialTraits"]');
  if (!tab) return;

  hideBaseSpecialTraitsSections(rootElement);

  let fieldset = tab.querySelector(".dndestiny-special-traits-field");
  const current = !!actor.getFlag(MODULE_ID, JACK_OF_ALL_GUNS_FLAG);

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("card", "dndestiny-special-traits-field");
    fieldset.innerHTML = `
      <legend>Dungeons & Destiny</legend>
      <div class="form-group">
        <label>Jack of all Guns</label>
        <div class="form-fields">
          <dndestiny-checkbox class="dndestiny-jack-of-all-guns-checkbox"></dndestiny-checkbox>
        </div>
        <p class="hint">Adds half your Proficiency Bonus (rounded down) to attack rolls with any firearm
          you aren't already proficient with.</p>
      </div>
    `;
    tab.insertBefore(fieldset, tab.firstChild);

    fieldset.querySelector(".dndestiny-jack-of-all-guns-checkbox").addEventListener("change", (e) => {
      actor.setFlag(MODULE_ID, JACK_OF_ALL_GUNS_FLAG, e.target.checked);
    });
  }

  const checkbox = fieldset.querySelector(".dndestiny-jack-of-all-guns-checkbox");
  if (checkbox && checkbox.checked !== current) checkbox.checked = current;
}

// Opens dndestiny's own Compendium Browser, filtered to Background items
// flagged as Foundations, and imports whichever one is picked onto the
// actor - the same flow the native "Add Background" pill uses
// (CharacterActorSheet.#findItem -> CompendiumBrowser.selectOne), just
// pre-filtered to Foundations instead of every Background. Confirmed live
// that the arbitrary filter clause correctly excludes plain Backgrounds
// sitting in the same compendium.
async function addFoundationFromCompendium(actor) {
  const CompendiumBrowser = dndestiny?.applications?.CompendiumBrowser;
  if (!CompendiumBrowser) {
    ui.notifications.error("Compendium Browser is unavailable.");
    return;
  }

  const uuid = await CompendiumBrowser.selectOne({
    filters: {
      locked: {
        types: new Set(["background"]),
        arbitrary: [{ k: "system.dndestinyIsFoundation", v: true }]
      }
    }
  });
  if (!uuid) return;

  const source = await fromUuid(uuid);
  if (!isFoundationItem(source)) {
    ui.notifications.warn(`${source?.name ?? "That item"} is not a Foundation.`);
    return;
  }

  const [created] = await actor.createEmbeddedDocuments("Item", [
    game.items.fromCompendium(source, { keepId: true })
  ]);
  created?.sheet.render(true);
}

// Same flow as addFoundationFromCompendium, but for the Core Ability slots -
// pre-filtered to Light Ability items flagged for the given slot (see
// ABILITY_SLOTS/isAbilitySlotItem).
async function addAbilitySlotFromCompendium(actor, slotKey) {
  const slot = ABILITY_SLOTS.find(s => s.key === slotKey);
  if (!slot) return;

  const CompendiumBrowser = dndestiny?.applications?.CompendiumBrowser;
  if (!CompendiumBrowser) {
    ui.notifications.error("Compendium Browser is unavailable.");
    return;
  }

  const uuid = await CompendiumBrowser.selectOne({
    filters: {
      locked: {
        types: new Set([LIGHT_ABILITY_ITEM_TYPE]),
        arbitrary: [{ k: "system.dndestinyAbilitySlot", v: slotKey }]
      }
    }
  });
  if (!uuid) return;

  const source = await fromUuid(uuid);
  if (source?.system?.dndestinyAbilitySlot !== slotKey) {
    ui.notifications.warn(`${source?.name ?? "That item"} is not a ${slot.label}.`);
    return;
  }

  await actor.createEmbeddedDocuments("Item", [
    game.items.fromCompendium(source, { keepId: true })
  ]);
}

// Shows each Shot Capacity weapon's Remaining/Capacity in the Inventory
// tab in its own "Shots" column, reusing the .item-capacity CSS class
// dndestiny already ships (styled 200px wide in dndestiny.css) purely for
// its width - that class isn't actually part of the Weapons section's own
// header template (it belongs to a different section, e.g. Consumables'
// native capacity meter), so both the header cell AND the row cell have to
// be injected here; neither exists natively for weapons. Deliberately kept
// separate from the "charges" column (unlike an earlier version of this
// function) so Charges stays free for actual limited-use tracking later.
// Gated behind SETTING_TRACK_AMMO, same as the rest of the Shot Capacity UI.
function injectWeaponAmmoBadge(actor, rootElement) {
  const trackingOn = game.settings.get(MODULE_ID, SETTING_TRACK_AMMO);

  for (const item of actor.items) {
    if (item.type !== "weapon") continue;
    const row = rootElement.querySelector(`li[data-item-id="${item.id}"]`);
    if (!row) continue;
    const chargesCell = row.querySelector(".item-detail.item-uses");
    let capacityCell = row.querySelector(".item-detail.item-capacity");

    const hasProperty = !!item.system?.properties?.has("dndestinyShotCapacity");
    if (!hasProperty || !trackingOn) {
      if (capacityCell?.dataset.dndestinyAmmo) capacityCell.remove();
      continue;
    }

    const capacity = item.system?.dndestinyShotCapacity ?? 0;
    const remaining = item.system?.dndestinyShotsRemaining ?? capacity;

    if (!capacityCell) {
      // This row's own section header (Weapons rows can also appear nested
      // under an Activity's own sub-list, which has no header of its own -
      // in that case there's nothing to label, only the row cell matters).
      const sectionHeader = row.closest(".items-section")?.querySelector(".items-header");
      if (sectionHeader && !sectionHeader.querySelector(".item-header.item-capacity")) {
        const headerCell = document.createElement("div");
        headerCell.className = "item-header item-capacity";
        headerCell.dataset.columnId = "capacity";
        headerCell.dataset.dndestinyAmmo = "true";
        headerCell.textContent = "Shots";
        const chargesHeader = sectionHeader.querySelector(".item-header.item-charges");
        if (chargesHeader) chargesHeader.before(headerCell);
        else sectionHeader.querySelector(".item-header.item-controls")?.before(headerCell);
      }

      capacityCell = document.createElement("div");
      capacityCell.className = "item-detail item-capacity";
      capacityCell.dataset.columnId = "capacity";
      capacityCell.dataset.dndestinyAmmo = "true";
      capacityCell.innerHTML = `
        <input type="text" class="always-interactive dndestiny-ammo-remaining" inputmode="numeric"
               pattern="^\\d*$" aria-label="Shots Remaining">
        <span class="separator">&sol;</span>
        <span class="max dndestiny-ammo-capacity"></span>
      `;
      // Insert where "capacity" sits in the header's column order (right
      // before "charges") so it lines up under its own header regardless of
      // this row otherwise having no cell there at all.
      if (chargesCell) chargesCell.before(capacityCell);
      else row.querySelector(".item-detail.item-controls")?.before(capacityCell);

      capacityCell.querySelector(".dndestiny-ammo-remaining").addEventListener("change", (e) => {
        const max = item.system?.dndestinyShotCapacity ?? 0;
        const clamped = clamp(Number(e.target.value) || 0, 0, max);
        item.update({ "system.dndestinyShotsRemaining": clamped });
      });
    }

    // Skip refreshing the input while it's focused so a re-render mid-edit
    // doesn't clobber an uncommitted value (see the HP meter fix).
    const remainingInput = capacityCell.querySelector(".dndestiny-ammo-remaining");
    if (remainingInput && document.activeElement !== remainingInput && remainingInput.value !== String(remaining)) {
      remainingInput.value = remaining;
    }

    const capacitySpan = capacityCell.querySelector(".dndestiny-ammo-capacity");
    if (capacitySpan && capacitySpan.textContent !== String(capacity)) capacitySpan.textContent = capacity;
  }
}

// Displays up to MAX_FOUNDATIONS Foundations as pills next to the native
// Background pill in the Details tab, matching its look exactly (same
// .pill-lg classes dndestiny itself uses for Race/Background) - filled pills
// open the Foundation's sheet, empty ones create a new one. Character-only,
// not Ghost - see hideGhostBackgroundButton for the matching Background
// removal.
function injectFoundationPills(actor, rootElement) {
  if (actor?.type !== "character") return;

  const pillsContainer = rootElement.querySelector('[data-action="findItem"][data-item-type="background"]')?.closest(".pills-lg");
  if (!pillsContainer) return;

  pillsContainer.querySelectorAll(".dndestiny-foundation-pill").forEach(el => el.remove());

  const foundations = actor.items.filter(isFoundationItem);
  const slots = Math.max(foundations.length, Math.min(foundations.length + 1, MAX_FOUNDATIONS));

  for (let i = 0; i < slots; i++) {
    const foundation = foundations[i];
    const pill = document.createElement("div");
    pill.classList.add("dndestiny-foundation-pill");

    if (foundation) {
      pill.classList.add("draggable", "pill-lg", "texture");
      pill.dataset.itemId = foundation.id;
      pill.dataset.action = "dndestinyOpenFoundation";
      pill.setAttribute("draggable", "true");
      pill.innerHTML = `
        <img class="gold-icon" src="${foundation.img}" alt="${foundation.name}">
        <div class="name name-stacked">
          <span class="title">${foundation.name}</span>
          <span class="subtitle">Foundation</span>
        </div>
      `;
    } else {
      pill.classList.add("pill-lg", "empty", "roboto-upper");
      pill.dataset.action = "dndestinyAddFoundation";
      pill.textContent = "Add Foundation";
    }

    pillsContainer.appendChild(pill);
  }

  if (!pillsContainer.dataset.dndestinyBound) {
    pillsContainer.dataset.dndestinyBound = "true";
    pillsContainer.addEventListener("click", async (e) => {
      const target = e.target.closest(".dndestiny-foundation-pill");
      if (!target) return;

      if (target.dataset.action === "dndestinyOpenFoundation") {
        actor.items.get(target.dataset.itemId)?.sheet.render(true);
      } else if (target.dataset.action === "dndestinyAddFoundation") {
        const currentCount = actor.items.filter(isFoundationItem).length;
        if (currentCount >= MAX_FOUNDATIONS) {
          ui.notifications.warn(`${actor.name} already has ${MAX_FOUNDATIONS} Foundations.`);
          return;
        }
        await addFoundationFromCompendium(actor);
      }
    });
  }
}

// Hides the native "Add Background" pill (and any already-set Background
// pill) from a Ghost's Details tab - Ghost doesn't use Backgrounds at all.
function hideGhostBackgroundButton(actor, rootElement) {
  if (actor?.type !== GHOST_ACTOR_TYPE) return;

  const backgroundPill = rootElement.querySelector('[data-action="findItem"][data-item-type="background"]');
  if (backgroundPill) backgroundPill.style.display = "none";
}

// Works around a dndestiny core bug that made the sidebar (portrait/traits
// column) snap back open on every item update on a Ghost sheet - e.g.
// clicking a Quantity +/- button in the Inventory tab. Root cause: dndestiny's
// CharacterActorSheet persists the collapsed sidebar as a per-user flag
// keyed by `sheetPrefs.${this.actor.type}.tabs.${tab}.collapseSidebar`
// (see _sidebarCollapsedKeyPath in dndestiny.mjs). Foundry flag paths are
// dot-delimited, and our actor type "dndestiny.ghost" contains a literal
// dot, so that key path expands into two extra nesting levels
// (sheetPrefs -> dndestiny -> ghost -> ...) that dndestiny's own flags data
// model doesn't recognize - confirmed live that game.user.update() with
// that key silently strips the write down to an empty
// `sheetPrefs.dndestiny: {}`, so the flag never actually persists. Every
// render after that reads the flag back as false and force-expands the
// sidebar again. Since we can't rename dndestiny's own key path, this stores
// the same per-tab preference under our own module's flag scope instead
// (immune to the collision) and reapplies it after dndestiny's _onRender has
// already reset the class, every render.
function fixGhostSidebarCollapse(actor, app, rootElement) {
  if (actor?.type !== GHOST_ACTOR_TYPE) return;

  const tab = app.tabGroups?.primary;
  if (tab) {
    const collapsed = !!game.user.getFlag(MODULE_ID, `ghostSidebarCollapsed.${tab}`);
    rootElement.classList.toggle("sidebar-collapsed", collapsed);
  }

  if (rootElement.dataset.dndestinyGhostSidebarBound) return;
  rootElement.dataset.dndestinyGhostSidebarBound = "true";

  rootElement.addEventListener("click", (event) => {
    if (!event.target.closest('[data-action="toggleSidebar"]')) return;
    const currentTab = app.tabGroups?.primary;
    if (!currentTab) return;
    const key = `ghostSidebarCollapsed.${currentTab}`;
    game.user.setFlag(MODULE_ID, key, !game.user.getFlag(MODULE_ID, key));
  });
}

// Total Memory a Ghost has to work with - 15x its Intelligence SCORE (not
// modifier).
function getGhostTotalMemory(actor) {
  const intScore = actor.system?.abilities?.int?.value ?? 10;
  return 15 * intScore;
}

// Memory Cost is charged per SLOT, not per unit - an item's Max Stack (see
// distributeGhostStack) already caps how many units share one slot/item
// document, so a full stack of 99 Handcuffs (Memory Cost 1, Max Stack 99)
// costs 1 Memory total, same as a single Handcuffs would. Only the number
// of item documents matters here, not their quantity.
function getGhostUsedMemory(actor) {
  const itemMemory = actor.items.reduce((total, item) => {
    if (!GHOST_MEMORY_ITEM_TYPES.includes(item.type)) return total;
    return total + (item.system?.dndestinyGhostMemory ?? 0);
  }, 0);
  return itemMemory + getGhostGlimmerMemory(actor);
}

// Glimmer works the same way as a physical item stack, just with a fixed
// Memory Cost of 1 and an implicit Max Stack of GHOST_GLIMMER_PER_MEMORY -
// every 250,000 Glimmer (or fraction thereof) takes up 1 Memory.
function getGhostGlimmerMemory(actor) {
  const glimmer = actor.system?.currency?.glimmer ?? 0;
  return glimmer > 0 ? Math.ceil(glimmer / GHOST_GLIMMER_PER_MEMORY) : 0;
}

// Injects a "Memory" card into a Ghost's Inventory tab, right alongside the
// native Encumbrance card - reuses its exact classes (.encumbrance.card,
// .meter.progress, .info) so it inherits dndestiny's own styling for free,
// just with Memory's numbers instead of carrying weight.
function injectGhostMemoryCard(actor, rootElement) {
  if (actor?.type !== GHOST_ACTOR_TYPE) return;

  const top = rootElement.querySelector('.tab[data-tab="inventory"] .top');
  if (!top) return;
  top.classList.add("dndestiny-ghost-inventory-top");

  // The native .containers list defaults to flex-grow:1 to share the row
  // with the Carry Weight card - with that card removed (see
  // hideGhostCarryWeightCard) an empty .containers list would otherwise eat
  // the whole row as an invisible spacer, defeating the centering above.
  // Only strips its grow when actually empty - a Ghost with real containers
  // still lays them out natively.
  const containers = top.querySelector(":scope > .containers");
  if (containers) containers.classList.toggle("dndestiny-empty-containers-spacer", containers.childElementCount === 0);

  const total = getGhostTotalMemory(actor);
  const used = getGhostUsedMemory(actor);
  const remaining = total - used;
  const pct = getPct(used, total);

  let card = top.querySelector(".dndestiny-memory-card");
  if (!card) {
    card = document.createElement("div");
    card.classList.add("encumbrance", "card", "dndestiny-memory-card");
    card.innerHTML = `
      <div class="meter progress dndestiny-memory-meter" role="meter" aria-valuemin="0">
        <div class="label">
          <i class="fa-solid fa-brain" inert></i>
          <span class="value dndestiny-memory-used"></span>
          <span class="separator">&sol;</span>
          <span class="max dndestiny-memory-total"></span>
        </div>
      </div>
      <div class="info">
        <div class="strength">
          <span class="label">Total Memory</span>
          <span class="value dndestiny-memory-total-2"></span>
        </div>
        <div class="size">
          <span class="label">Memory Remaining</span>
          <span class="value dndestiny-memory-remaining"></span>
        </div>
      </div>
    `;
    top.insertBefore(card, top.firstChild);
  }

  const meter = card.querySelector(".dndestiny-memory-meter");
  meter.setAttribute("aria-valuenow", used);
  meter.setAttribute("aria-valuetext", used);
  meter.setAttribute("aria-valuemax", total);
  meter.style.setProperty("--bar-percentage", `${pct}%`);

  card.querySelector(".dndestiny-memory-used").textContent = used;
  card.querySelector(".dndestiny-memory-total").textContent = total;
  card.querySelector(".dndestiny-memory-total-2").textContent = total;
  card.querySelector(".dndestiny-memory-remaining").textContent = remaining;
}

// Removes the native Carry Weight card (Strength/Size/Multiplier) from a
// Ghost's Inventory tab - Ghosts track storage through Memory instead, so
// carry weight isn't relevant. Only targets the plain native card, not the
// Memory card injected above it (which reuses the same .encumbrance.card
// classes for its own styling).
function hideGhostCarryWeightCard(actor, rootElement) {
  if (actor?.type !== GHOST_ACTOR_TYPE) return;

  const top = rootElement.querySelector('.tab[data-tab="inventory"] .top');
  if (!top) return;

  const card = top.querySelector(".encumbrance.card:not(.dndestiny-memory-card)");
  if (card) card.remove();
}

// Shows each inventory item's Memory Cost/Quantity (e.g. "4/1") in a Ghost's
// Inventory tab rows - a dedicated column since Memory Cost isn't anything
// native dndestiny already has a slot for. Read-only display; Memory Cost
// itself is only editable from the item's own sheet (see
// injectGhostMemoryField) since it's a property of the item, not a per-use
// value like Shot Capacity's Remaining.
function injectGhostItemMemory(actor, rootElement) {
  if (actor?.type !== GHOST_ACTOR_TYPE) return;

  const inventoryTab = rootElement.querySelector('.tab[data-tab="inventory"]');
  if (!inventoryTab) return;

  inventoryTab.querySelectorAll(".items-header").forEach(header => {
    if (header.querySelector(".dndestiny-memory-header")) return;
    const controls = header.querySelector('[data-column-id="controls"]');
    const cell = document.createElement("div");
    cell.className = "item-header dndestiny-memory-header";
    cell.style.flex = "0 0 70px";
    cell.textContent = "Memory";
    if (controls) controls.before(cell);
    else header.appendChild(cell);
  });

  for (const item of actor.items) {
    if (!GHOST_MEMORY_ITEM_TYPES.includes(item.type)) continue;
    const row = inventoryTab.querySelector(`[data-item-id="${item.id}"]`);
    if (!row) continue;
    const itemRow = row.querySelector(".item-row") ?? row;

    let cell = itemRow.querySelector(".dndestiny-memory-detail");
    if (!cell) {
      cell = document.createElement("div");
      cell.className = "item-detail dndestiny-memory-detail";
      cell.style.flex = "0 0 70px";
      cell.style.fontWeight = "bold";
      const controls = itemRow.querySelector('[data-column-id="controls"]');
      if (controls) controls.before(cell);
      else itemRow.appendChild(cell);
    }

    // Static per-item spec (Memory Cost/Maximum Stack), not live quantity -
    // dndestiny's own native Quantity column already shows how many are
    // actually held.
    const cost = item.system?.dndestinyGhostMemory ?? 0;
    const maxStack = item.system?.dndestinyGhostMaxStack;
    const text = `${cost}/${maxStack ? maxStack : "∞"}`;
    if (cell.textContent !== text) cell.textContent = text;
  }
}

// Formats a raw Glimmer amount with thousand separators for display (e.g.
// 1000 -> "1,000"); parseGlimmerInput reverses this back to a plain integer
// when reading whatever the user typed/pasted back out.
function formatGlimmerDisplay(value) {
  return Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("en-US");
}
function parseGlimmerInput(value) {
  const digits = String(value).replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

// Restyles the native Glimmer currency section on a Ghost's Inventory tab
// into a labeled card (Glimmer works like a stacked item - see
// getGhostGlimmerMemory - so it gets the same visual treatment as the
// Memory/Encumbrance cards above it): drops the "Manage Currency" button
// (a Ghost only ever holds Glimmer, nothing to convert between), adds a
// "Glimmer Storage" label on top, and widens the input. Also takes the
// input off dndestiny's native name-based form binding (which would choke on
// the comma-formatted display value) in favor of manually formatting it
// with commas, parsed back out on blur. dndestiny-inventory recreates this
// section's HTML from scratch on ANY inventory update - including an
// unrelated item's Quantity +/- click - which used to make this card
// visibly jump on every such click: for one JS tick, the browser paints
// dndestiny's fresh, un-enhanced native section (button still present, input
// capped at its native max-width: 80px, right-aligned) before this
// function gets a chance to run and restyle it. Marking the sheet root
// with .dndestiny-ghost-sheet (once; the root element itself is never
// replaced, only its contents) lets dndestiny.css apply the card look,
// button removal, input sizing and the "Glimmer Storage" label (as a pure
// CSS ::before, so it doesn't need a JS-inserted element at all) via plain
// structural selectors the instant the native section exists - no waiting
// on this function. All that's left here is what genuinely can't be done
// in CSS: stripping the name/dtype so dndestiny's own binding doesn't fight
// the comma-formatted value, and the number formatting/parsing itself.
//
// Deliberately does NOT swap to a shorter, comma-free value on focus (an
// earlier version did) - the centered text's width changes with the
// digit/comma count, so swapping formats on focus/blur shifted the visual
// center by a couple pixels each time, which read as the value "jumping"
// on every edit. Keeping the same comma-formatted string displayed at all
// times (focused or not) avoids that entirely; parseGlimmerInput already
// strips non-digit characters, so stray commas mid-edit don't matter.
function injectGhostGlimmerCard(actor, rootElement) {
  if (actor?.type !== GHOST_ACTOR_TYPE) return;
  rootElement.classList.add("dndestiny-ghost-sheet");

  const currencySection = rootElement.querySelector('.tab[data-tab="inventory"] .currency');
  if (!currencySection) return;

  currencySection.classList.add("card", "dndestiny-glimmer-card");

  currencySection.querySelector('[data-action="currency"]')?.remove();

  const input = currencySection.querySelector('input[name="system.currency.glimmer"]');
  if (!input) return;

  input.classList.add("dndestiny-glimmer-input");
  input.removeAttribute("name");
  input.removeAttribute("data-dtype");

  if (document.activeElement !== input) {
    input.value = formatGlimmerDisplay(actor.system?.currency?.glimmer ?? 0);
  }

  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", () => {
    const parsed = parseGlimmerInput(input.value);
    if (parsed !== (actor.system?.currency?.glimmer ?? 0)) actor.update({ "system.currency.glimmer": parsed });
    else input.value = formatGlimmerDisplay(parsed);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
}

// Character-only, not Ghost - see the removal request that scoped this tab
// back to just the standard Player Character sheet.
function injectCoreLightAbilitiesTab(sheetApp, rootElement) {
  if (!sheetApp?.actor || sheetApp.actor.type !== "character" || !rootElement) return;
  
  const actor = sheetApp.actor;
  const TAB_ID = "core-light-abilities";

  const nav = rootElement.querySelector('aside.sidebar nav.tabs, nav.tabs[data-group="primary"], nav.sheet-navigation');
  if (!nav) return;

  // Must resolve to the tab-body column nested inside .main-content (next to
  // .sidebar), not an ancestor like .sheet-body - otherwise the injected
  // section renders full-width and overlaps the sidebar's HP/Shield meters.
  const body = rootElement.querySelector('.main-content .tab-body')
    || rootElement.querySelector('.tab-body')
    || rootElement.querySelector('main.main-content')
    || rootElement.querySelector('main')
    || rootElement.querySelector('.sheet-body');
  if (!body) return;

  // 1. Create or retrieve custom button
  let customBtn = nav.querySelector(`[data-tab="${TAB_ID}"]`);
  if (!customBtn) {
    customBtn = document.createElement("a");
    customBtn.classList.add("item", "tab-button");
    customBtn.dataset.tab = TAB_ID;
    customBtn.dataset.group = "primary";
    customBtn.setAttribute("data-tooltip", "Core Light Abilities");
    customBtn.setAttribute("aria-label", "Core Light Abilities");
    customBtn.innerHTML = `<i class="fa-solid fa-sun"></i>`;
    nav.appendChild(customBtn);
  }

  // 2. Create or retrieve custom section
  let customSection = body.querySelector(`.tab.${TAB_ID}`);
  if (!customSection) {
    customSection = document.createElement("section");
    customSection.classList.add("tab", TAB_ID);
    customSection.dataset.tab = TAB_ID;
    customSection.dataset.group = "primary";
    body.appendChild(customSection);
  }

  // Check state tracking across re-renders
  const isCustomTabActive = sheetApp.tabGroups?.primary === TAB_ID;

  if (isCustomTabActive) {
    nav.querySelectorAll('.item, [data-tab]').forEach(el => el.classList.remove('active'));
    body.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    customBtn.classList.add('active');
    customSection.classList.add('active');
  }

  // 3. Isolated Event Listener for custom tab activation
  if (!customBtn.dataset.dndestinyBound) {
    customBtn.dataset.dndestinyBound = "true";

    customBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (sheetApp.tabGroups) {
        sheetApp.tabGroups.primary = TAB_ID;
      }

      nav.querySelectorAll('.item, [data-tab]').forEach(el => el.classList.remove('active'));
      body.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));

      customBtn.classList.add('active');
      customSection.classList.add('active');
    });
  }

  // 4. Native button listener to release custom tab state
  // Note: dndestiny's own click handler on these buttons already updates
  // sheetApp.tabGroups.primary and toggles the native active classes - we
  // must not also assign tabGroups.primary here, since doing so before that
  // handler runs makes it think the tab hasn't changed, causing it to skip
  // applying the active state entirely.
  const nativeButtons = nav.querySelectorAll(`[data-tab]:not([data-tab="${TAB_ID}"])`);
  nativeButtons.forEach(btn => {
    if (!btn.dataset.dndestinyCleanBound) {
      btn.dataset.dndestinyCleanBound = "true";
      btn.addEventListener("click", () => {
        customBtn.classList.remove('active');
        customSection.classList.remove('active');
      });
    }
  });

  // 5. Render/Refresh Inner Content - Light Ability & Level are derived from
  // whichever class item is providing the actor's Light powers (see
  // getPrimaryLightClass), not stored/edited on the actor directly.
  const primaryClass = getPrimaryLightClass(actor);
  const lightAbilityKey = primaryClass?.system?.lightAbility || null;
  const classLevel = primaryClass?.system?.levels ?? null;
  const lightLevel = getLightLevel(actor);
  const hasLight = !!(primaryClass && lightAbilityKey);

  const prof = actor.system?.attributes?.prof ?? 2;
  const abilityMod = hasLight ? (actor.system?.abilities?.[lightAbilityKey]?.mod ?? 0) : 0;
  const lightSaveDc = hasLight ? 8 + prof + abilityMod : null;
  const lightAttackMod = hasLight ? (abilityMod >= 0 ? `+${abilityMod + prof}` : `${abilityMod + prof}`) : null;

  const sourceHint = !primaryClass
    ? "No class item found - add a class to configure Light abilities."
    : !lightAbilityKey
      ? `${primaryClass.name} has no Light Ability set - open the class item and set one.`
      : `Powers keyed from ${primaryClass.name}`;

  const abilityLabel = hasLight ? (CONFIG.DND5E.abilities[lightAbilityKey]?.label || lightAbilityKey.toUpperCase()) : "Unconfigured";

  // Mirrors the native dnd5e2 "card" component (see .card / .card .header /
  // .card .info in dndestiny.css) so this matches the rest of the sheet.
  customSection.innerHTML = `
    <div class="dndestiny-light-tab-inner">
      <div class="dndestiny-light-cards-row">
        <div class="dndestiny-light-card card">
          <div class="header">
            <h3>Light Abilities</h3>
            <span class="subtitle">${abilityLabel}</span>
          </div>
          <div class="info">
            <div class="ability">
              <span class="label">Ability</span>
              <span class="value">${hasLight ? lightAbilityKey.toUpperCase() : "—"}</span>
            </div>
            <div class="attack">
              <span class="label">Attack</span>
              <span class="value">${hasLight ? lightAttackMod : "—"}</span>
            </div>
            <div class="save">
              <span class="label">Save DC</span>
              <span class="value">${hasLight ? lightSaveDc : "—"}</span>
            </div>
            <div class="level">
              <span class="label">Level</span>
              <span class="value">${primaryClass ? lightLevel : "—"}</span>
            </div>
          </div>

          ${renderScaleValueList(primaryClass, classLevel)}
        </div>

        ${renderGhostLinkCard(actor)}
      </div>

      <p class="dndestiny-light-source-hint">${sourceHint}</p>

      <div class="dndestiny-light-abilities-body">
        <h3 class="dndestiny-light-section-heading">Core Abilities</h3>
        ${renderAbilitySlotList(actor)}

        <h3 class="dndestiny-light-section-heading">Grenades</h3>
        ${renderGrenadeList(actor)}
      </div>
    </div>
  `;

  bindAbilitySlotListEvents(customSection, actor);
  bindGrenadeListEvents(customSection, actor);
  bindGhostLinkCardEvents(customSection, actor);
}

// The world Actor linked via GHOST_LINK_FLAG, if it's still a valid Ghost -
// a Ghost actor could've been deleted, or (implausibly, since the drop
// handler only ever accepts Ghosts) retyped since being linked.
function getLinkedGhost(actor) {
  const id = actor.getFlag(MODULE_ID, GHOST_LINK_FLAG);
  if (!id) return null;
  const ghost = game.actors.get(id);
  return ghost?.type === GHOST_ACTOR_TYPE ? ghost : null;
}

// Moves a physical item (and its contents, if it's a container) to another
// actor - same underlying flow dndestiny itself uses for a "move" drag between
// two actor sheets (create on the target via
// Item5e.createWithContents/createDocuments, then delete the originals),
// just triggered by a button instead of an actual drag. Reusing dndestiny's
// own helper means container contents, nested depth limits, etc. are
// handled the same way a real drag-move would. Creating through the
// target's normal document lifecycle also means our own Ghost
// stack-splitting hook (preCreateItem -> distributeGhostStack) still
// applies exactly as if the item had been dropped there by hand, whenever
// the target happens to be a Ghost.
async function sendItemToActor(item, targetActor) {
  if (targetActor.type === GHOST_ACTOR_TYPE && isGhostBlockedItem(item)) {
    ui.notifications.warn(`${item.name} can't be stored in a Ghost's inventory.`);
    return;
  }

  const ItemCls = CONFIG.Item.documentClass;
  const toCreate = await ItemCls.createWithContents([item]);
  await ItemCls.createDocuments(toCreate, { parent: targetActor, keepId: true });
  await item.delete({ deleteContents: true });
  ui.notifications.info(`Sent ${item.name} to ${targetActor.name}.`);
}

// The Character actor linked to a given Ghost (the reverse of
// getLinkedGhost) - powers the Ghost sheet's own "Send to Player" button.
// If more than one Character somehow links the same Ghost, this just
// picks whichever one game.actors happens to iterate to first; the flag is
// meant to be a 1:1 pairing, so that's not expected to come up.
function getLinkedCharacterForGhost(ghost) {
  return game.actors.find(a => a.type === "character" && a.getFlag(MODULE_ID, GHOST_LINK_FLAG) === ghost.id) ?? null;
}

// Shared by injectSendToGhostButton/injectSendToPlayerButton - adds a
// "Send to X" button to each physical item row in rootElement's Inventory
// tab, next to the native equip/expand/menu controls. Only shows once
// getTarget() resolves to an actor (i.e. once the Character<->Ghost link
// exists) - otherwise there'd be nothing to send to and no name for the
// tooltip. getTarget is called fresh at click time too, in case the link
// changed since this row was last rendered.
function injectSendItemButton(actor, rootElement, { getTarget, cssSuffix, icon, isBlocked }) {
  const inventoryTab = rootElement.querySelector('.tab[data-tab="inventory"]');
  if (!inventoryTab) return;

  const target = getTarget();
  const btnClass = `dndestiny-send-to-${cssSuffix}`;

  for (const item of actor.items) {
    if (!GHOST_MEMORY_ITEM_TYPES.includes(item.type)) continue;
    const row = inventoryTab.querySelector(`[data-item-id="${item.id}"]`);
    if (!row) continue;

    // Containers render as a compact icon tile (see the Containers list on
    // both the Ghost and Character sheets) with no column-based controls
    // row to slot into, unlike every other physical item type - so the
    // button becomes a small overlay badge on the tile itself instead.
    const isContainerTile = row.matches("li.container");
    const controls = isContainerTile ? row : row.querySelector('[data-column-id="controls"]');
    if (!controls) continue;

    let btn = controls.querySelector(`.${btnClass}`);
    if (!target || isBlocked?.(item)) {
      btn?.remove();
      continue;
    }

    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = isContainerTile
        ? `unbutton always-interactive ${btnClass} dndestiny-send-to-actor-container`
        : `unbutton config-button item-control item-action always-interactive ${btnClass}`;
      btn.innerHTML = `<i class="fa-solid ${icon}" inert></i>`;
      if (isContainerTile) controls.appendChild(btn);
      else controls.insertBefore(btn, controls.firstChild);

      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const liveTarget = getTarget();
        if (liveTarget) sendItemToActor(item, liveTarget);
      });
    }

    btn.setAttribute("data-tooltip", `Send to ${target.name}`);
    btn.setAttribute("aria-label", `Send to ${target.name}`);
  }
}

function injectSendToGhostButton(actor, rootElement) {
  if (actor?.type !== "character") return;
  injectSendItemButton(actor, rootElement, {
    getTarget: () => getLinkedGhost(actor),
    cssSuffix: "ghost",
    icon: "fa-ghost",
    isBlocked: isGhostBlockedItem
  });
}

// Mirror of injectSendToGhostButton for the other direction - a Ghost
// sending an item back to whichever Character has it linked.
function injectSendToPlayerButton(actor, rootElement) {
  if (actor?.type !== GHOST_ACTOR_TYPE) return;
  injectSendItemButton(actor, rootElement, {
    getTarget: () => getLinkedCharacterForGhost(actor),
    cssSuffix: "player",
    icon: "fa-user"
  });
}

// Renders the "next to the Light Abilities card" drop zone for linking a
// Ghost actor for quick sheet access - drop target when empty, portrait +
// name (click to open the Ghost's sheet) once one's linked. Same card
// look as .dndestiny-light-card (see its own comment) so the two sit
// consistently side by side.
function renderGhostLinkCard(actor) {
  const linkedGhost = getLinkedGhost(actor);

  const body = linkedGhost ? `
    <div class="dndestiny-ghost-link-filled" data-action="openGhost" data-tooltip="Open ${linkedGhost.name}'s sheet">
      <div class="dndestiny-ghost-link-portrait">
        <img src="${linkedGhost.img}" alt="">
      </div>
      <div class="dndestiny-ghost-link-name">${linkedGhost.name}</div>
    </div>
    <button type="button" class="unbutton dndestiny-ghost-link-clear" data-action="clearGhostLink"
            data-tooltip="Unlink Ghost" aria-label="Unlink Ghost">
      <i class="fa-solid fa-xmark" inert></i>
    </button>
  ` : `
    <div class="dndestiny-ghost-link-dropzone">
      <img class="dndestiny-ghost-link-placeholder-icon" src="systems/dndestiny/assets/icons/svg/ghost.svg" alt="">
      <span>Drag a Ghost here</span>
    </div>
  `;

  return `
    <div class="dndestiny-ghost-link-card card">
      <div class="header">
        <h3>Ghost</h3>
      </div>
      <div class="dndestiny-ghost-link-body">
        ${body}
      </div>
    </div>
  `;
}

function bindGhostLinkCardEvents(rootElement, actor) {
  const card = rootElement.querySelector(".dndestiny-ghost-link-card");
  if (!card) return;

  // Stops propagation on every drag/drop event, not just "drop" - dndestiny's
  // own actor-sheet drop handling (which is what pops the "transform this
  // actor" prompt when an Actor is dropped onto another actor's sheet) is
  // bound higher up via Foundry's DragDrop helper and would otherwise still
  // see the same event bubble past this card and process it a second time.
  card.addEventListener("dragenter", (event) => event.stopPropagation());
  card.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.add("drag-hover");
  });
  card.addEventListener("dragleave", (event) => {
    event.stopPropagation();
    card.classList.remove("drag-hover");
  });
  card.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove("drag-hover");

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (data?.type !== "Actor" || !data.uuid) return;

    const dropped = await fromUuid(data.uuid);
    if (!dropped) {
      ui.notifications.warn("Couldn't resolve the dropped actor.");
      return;
    }
    if (dropped.type !== GHOST_ACTOR_TYPE) {
      ui.notifications.warn(`${dropped.name} isn't a Ghost.`);
      return;
    }

    await actor.setFlag(MODULE_ID, GHOST_LINK_FLAG, dropped.id);
  });

  card.querySelectorAll('[data-action="openGhost"]').forEach(el => {
    el.addEventListener("click", () => getLinkedGhost(actor)?.sheet.render(true));
  });

  card.querySelector('[data-action="clearGhostLink"]')?.addEventListener("click", async (event) => {
    event.stopPropagation();
    await actor.unsetFlag(MODULE_ID, GHOST_LINK_FLAG);
  });
}

// Displays the 3 Core Ability slots (see ABILITY_SLOTS), each holding at
// most 1 Light Ability item (dropped onto the actor sheet like any other
// item) - pulled out of the native Spells list here instead, same as
// Grenades (see hideCoreAbilitySpells). Filled rows can be used/removed;
// empty rows open the Compendium Browser pre-filtered to that slot.
function renderAbilitySlotList(actor) {
  const rows = ABILITY_SLOTS.map(({ key, label }) => {
    const item = actor.items.find(i => isLightAbilityTypeItem(i) && i.system?.dndestinyAbilitySlot === key);

    if (!item) {
      return `
        <li class="dndestiny-ability-slot-row empty">
          <button type="button" class="unbutton dndestiny-ability-slot-add" data-action="add" data-slot="${key}">
            <i class="fa-solid fa-plus" inert></i> Add ${label}
          </button>
        </li>
      `;
    }

    const uses = item.system?.uses ?? {};
    const usesLabel = uses.max ? `${Math.max(0, (uses.max ?? 0) - (uses.spent ?? 0))}/${uses.max}` : "—";
    const die = item.system?.dndestinyRechargeDie || "d6";
    const threshold = item.system?.dndestinyRechargeThreshold ?? 6;

    return `
      <li class="dndestiny-ability-slot-row" data-item-id="${item.id}" draggable="true">
        <img class="dndestiny-ability-slot-icon" src="${item.img}" alt="${item.name}" />
        <div class="dndestiny-ability-slot-name" data-action="use" data-item-id="${item.id}" data-tooltip="Use ${label}">
          <span class="title">${item.name}</span>
          <span class="subtitle">${label}</span>
        </div>
        <div class="dndestiny-ability-slot-uses" data-tooltip="Charges Remaining">${usesLabel}</div>
        <div class="dndestiny-ability-slot-recharge" data-tooltip="Recharge">${die.toUpperCase()} (${threshold}+)</div>
        <button type="button" class="unbutton dndestiny-ability-slot-btn" data-action="recharge" data-item-id="${item.id}"
                data-tooltip="Roll Recharge" aria-label="Roll Recharge">
          <i class="fas fa-dice-d20" inert></i>
        </button>
        <button type="button" class="unbutton dndestiny-ability-slot-delete" data-action="delete" data-item-id="${item.id}"
                data-tooltip="Remove ${label}" aria-label="Remove ${label}">
          <i class="fa-solid fa-trash" inert></i>
        </button>
      </li>
    `;
  }).join("");

  return `<ul class="dndestiny-ability-slot-list">${rows}</ul>`;
}

// Lets a Light Ability/Grenade row (see renderAbilitySlotList/
// renderGrenadeList - neither uses dndestiny's native item-row markup, so
// they don't pick up its sheet-level drag handling for free) be
// click-held-and-dragged out to anywhere Foundry accepts a dropped Item -
// a journal/chat text editor, an Enchant Activity's item-restriction
// picker, another actor's sheet, etc. Mirrors the same {type: "Item", uuid}
// payload Item5e#toDragData() produces natively.
function handleAbilityRowDragStart(event, actor) {
  const row = event.target.closest("[data-item-id]");
  const item = row ? actor.items.get(row.dataset.itemId) : null;
  if (!item) return;
  event.dataTransfer.effectAllowed = "copyLink";
  event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
}

// Right-click menu for a Light Ability/Grenade row, mirroring the same
// entries dndestiny's own Features/Inventory rows offer (View/Edit/Duplicate/
// Delete/Post to Chat/Favorite/Concentration Break) via its native
// <inventory-element>'s _getContextOptions - our rows don't use that
// component at all, so none of it comes for free.
function getAbilityRowContextOptions(item, actor) {
  const ItemSheet5e = dndestiny.applications.item.ItemSheet5e;

  const options = [
    {
      name: "DND5E.ItemView",
      icon: '<i class="fa-solid fa-eye fa-fw"></i>',
      callback: () => item.sheet.render(true, { mode: ItemSheet5e.MODES.PLAY })
    },
    {
      name: "DND5E.ContextMenuActionEdit",
      icon: '<i class="fa-solid fa-edit fa-fw"></i>',
      condition: () => item.isOwner,
      callback: () => item.sheet.render(true, { mode: ItemSheet5e.MODES.EDIT })
    },
    {
      name: "DND5E.ContextMenuActionDuplicate",
      icon: '<i class="fa-solid fa-copy fa-fw"></i>',
      condition: () => item.canDuplicate && item.isOwner,
      callback: () => item.clone({ name: game.i18n.format("DOCUMENT.CopyOf", { name: item.name }) },
        { save: true, addSource: true })
    },
    {
      name: "DND5E.ContextMenuActionDelete",
      icon: '<i class="fa-solid fa-trash fa-fw"></i>',
      condition: () => item.canDelete && item.isOwner,
      callback: () => item.deleteDialog({ sheet: actor.sheet })
    },
    {
      name: "DND5E.DisplayCard",
      icon: '<i class="fa-solid fa-message"></i>',
      condition: () => !!item.actor,
      callback: () => item.displayCard()
    }
  ];

  if (!actor || actor.system.isGroup) return options;

  const favoriteId = item.getRelativeUUID(actor);
  const favorited = actor.system.hasFavorite?.(favoriteId);
  options.push(
    {
      name: favorited ? "DND5E.FavoriteRemove" : "DND5E.Favorite",
      icon: '<i class="fa-solid fa-bookmark fa-fw"></i>',
      condition: () => ("favorites" in actor.system) && item.isOwner,
      callback: () => favorited ? actor.system.removeFavorite(favoriteId) : actor.system.addFavorite({ type: "item", id: favoriteId })
    },
    {
      name: "DND5E.ConcentrationBreak",
      icon: '<dndestiny-icon src="systems/dndestiny/icons/svg/break-concentration.svg"></dndestiny-icon>',
      condition: () => actor.concentration?.items.has(item),
      callback: () => actor.endConcentration(item)
    }
  );

  return options;
}

// Binds a right-click ContextMenu5e to every row matching rowSelector inside
// container, resolving the clicked row back to its Item via data-item-id -
// shared by the Light Ability slot list and the Grenade list.
function bindAbilityRowContextMenu(container, rowSelector, actor) {
  new dndestiny.applications.ContextMenu5e(container, rowSelector, [], {
    onOpen: (element) => {
      const item = actor.items.get(element.dataset.itemId);
      if (!item) return;
      ui.context.menuItems = getAbilityRowContextOptions(item, actor);
    },
    jQuery: false
  });
}

function bindAbilitySlotListEvents(customSection, actor) {
  const list = customSection.querySelector('.dndestiny-ability-slot-list');
  if (!list || list.dataset.dndestinyBound) return;
  list.dataset.dndestinyBound = "true";

  list.addEventListener("dragstart", (e) => handleAbilityRowDragStart(e, actor));
  bindAbilityRowContextMenu(list, ".dndestiny-ability-slot-row[data-item-id]", actor);

  list.addEventListener("click", async (e) => {
    const addBtn = e.target.closest('[data-action="add"][data-slot]');
    if (addBtn) {
      await addAbilitySlotFromCompendium(actor, addBtn.dataset.slot);
      return;
    }

    const target = e.target.closest('[data-action][data-item-id]');
    if (!target) return;
    const item = actor.items.get(target.dataset.itemId);
    if (!item) return;

    switch (target.dataset.action) {
      case "use":
        item.use({ event: e });
        break;
      case "recharge":
        await rollAbilityRecharge(item);
        break;
      case "delete":
        await item.delete();
        break;
    }
  });
}

// Read-only display of every Scale Value advancement (see
// CONFIG.DND5E.advancementTypes.ScaleValue) configured on the actor's
// primary Light class - e.g. a Gunslinger's "Trick Shot Dice" or similar
// per-level scaling feature. Not something managed from here (that's still
// done on the class item's own Advancement tab); this just surfaces
// whatever's there, evaluated at the class's current level. Rendered into
// the bottom of the "Light Abilities" card itself, below its Ability/
// Attack/Save DC/Level stats row (see the card markup in
// injectCoreLightAbilitiesTab) - renders nothing at all if the class has
// no Scale Value advancements, so classes that don't use one don't get an
// empty strip at the bottom of the card.
function renderScaleValueList(primaryClass, classLevel) {
  if (!primaryClass || classLevel == null) return "";

  const scaleValues = primaryClass.advancement?.byType?.ScaleValue ?? [];
  if (!scaleValues.length) return "";

  const rows = scaleValues.map(sv => {
    const value = sv.valueForLevel(classLevel)?.display ?? "—";
    return `
      <li class="dndestiny-scale-value-row">
        <span class="dndestiny-scale-value-name">${sv.title}</span>
        <span class="dndestiny-scale-value-value">${value}</span>
      </li>
    `;
  }).join("");

  return `<ul class="dndestiny-scale-value-list">${rows}</ul>`;
}

// Grenades (dropped onto the actor sheet like any other item) are
// rendered here instead of the native Spells tab - see hideCoreAbilitySpells.
function renderGrenadeList(actor) {
  const grenades = actor.items.filter(isGrenadeItem);
  if (!grenades.length) {
    return `<p class="dndestiny-grenade-empty">No grenades. Drag a Grenade feature onto this sheet to add one.</p>`;
  }

  const activeId = actor.getFlag(MODULE_ID, ACTIVE_GRENADE_FLAG) ?? null;

  const rows = grenades.map(g => {
    const uses = g.system?.uses ?? {};
    const usesLabel = uses.max ? `${Math.max(0, (uses.max ?? 0) - (uses.spent ?? 0))}/${uses.max}` : "—";
    const die = g.system?.dndestinyRechargeDie || "d6";
    const threshold = g.system?.dndestinyRechargeThreshold ?? 6;
    const isActive = g.id === activeId;
    const activation = g.labels?.activation || "—";
    const duration = g.labels?.duration || "—";

    return `
      <li class="dndestiny-grenade-item${isActive ? " active" : ""}" data-item-id="${g.id}" draggable="true">
        <img class="dndestiny-grenade-icon" src="${g.img}" alt="${g.name}" />
        <div class="dndestiny-grenade-name" data-action="use" data-item-id="${g.id}" data-tooltip="Use Grenade">
          <span class="title">${g.name}</span>
          <span class="subtitle">${activation} &bull; ${duration}</span>
        </div>
        <div class="dndestiny-grenade-uses" data-tooltip="Charges Remaining">${usesLabel}</div>
        <div class="dndestiny-grenade-recharge" data-tooltip="Recharge">${die.toUpperCase()} (${threshold}+)</div>
        <button type="button" class="unbutton dndestiny-grenade-btn" data-action="recharge" data-item-id="${g.id}"
                data-tooltip="Roll Recharge" aria-label="Roll Recharge">
          <i class="fas fa-dice-d20" inert></i>
        </button>
        <button type="button" class="unbutton dndestiny-grenade-btn dndestiny-grenade-select${isActive ? " active" : ""}"
                data-action="select" data-item-id="${g.id}"
                data-tooltip="${isActive ? "Active Grenade" : "Set as Active"}" aria-label="Set as Active">
          <i class="fa-solid fa-star" inert></i>
        </button>
        <button type="button" class="unbutton dndestiny-grenade-btn dndestiny-grenade-delete" data-action="delete" data-item-id="${g.id}"
                data-tooltip="Remove from Class" aria-label="Remove from Class">
          <i class="fa-solid fa-trash" inert></i>
        </button>
      </li>
    `;
  }).join('');

  return `<ul class="dndestiny-grenade-list">${rows}</ul>`;
}

function bindGrenadeListEvents(customSection, actor) {
  const list = customSection.querySelector('.dndestiny-grenade-list');
  if (!list || list.dataset.dndestinyBound) return;
  list.dataset.dndestinyBound = "true";

  list.addEventListener("dragstart", (e) => handleAbilityRowDragStart(e, actor));
  bindAbilityRowContextMenu(list, ".dndestiny-grenade-item[data-item-id]", actor);

  list.addEventListener("click", async (e) => {
    const target = e.target.closest('[data-action][data-item-id]');
    if (!target) return;

    const item = actor.items.get(target.dataset.itemId);
    if (!item) return;

    switch (target.dataset.action) {
      case "use":
        item.use({ event: e });
        break;
      case "recharge":
        await rollAbilityRecharge(item);
        break;
      case "select":
        await actor.setFlag(MODULE_ID, ACTIVE_GRENADE_FLAG, item.id);
        break;
      case "delete": {
        // Grenades here are mirrored from the class's roster (see
        // syncActorGrenades), so removing one removes it from the class's
        // list - the actual source of truth - which then removes it from
        // every character with that class, not just this one.
        const sourceUuid = item.getFlag(MODULE_ID, SOURCE_GRENADE_FLAG);
        const primaryClass = getPrimaryLightClass(actor);
        if (sourceUuid && primaryClass) {
          const current = primaryClass.system?.dndestinyGrenades ?? [];
          await primaryClass.update({ "system.dndestinyGrenades": current.filter(u => u !== sourceUuid) });
        } else {
          await item.delete();
        }
        break;
      }
    }
  });
}

// Rolls a Light Ability's custom recharge die against its threshold
// (dndestiny's native "recharge" recovery is hardcoded to a d6, so this can't
// reuse it) and resets the item's Limited Uses if it succeeds. Used by
// both Grenades and the 3 Core Ability slots.
async function rollAbilityRecharge(item) {
  const die = item.system?.dndestinyRechargeDie || "d6";
  const threshold = item.system?.dndestinyRechargeThreshold ?? 6;

  const roll = await new Roll(`1${die}`).evaluate();
  const success = roll.total >= threshold;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: item.actor }),
    flavor: `${item.name} - Recharge Check (need ${threshold}+ on ${die.toUpperCase()}) - ${success ? "Success!" : "Failed"}`
  });

  if (success) await item.update({ "system.uses.spent": 0 });
}

// Grenades and the 3 Core Ability slots (see hasAbilitySlot) track charges
// via their own Limited Uses (system.uses.max/spent), same as any native
// item - see ensureAbilityUsesConsumption, which auto-configures each
// Activity's own Consumption to spend 1 Item Use per activation, so
// blocking/spending is handled by dndestiny's real consumption pipeline
// instead of a custom hook reimplementing it. This hook is left with just
// the one thing that pipeline has no concept of: restricting grenade use
// to whichever one is flagged Active.
Hooks.on("dndestiny.preUseActivity", (activity) => {
  const item = activity.item;
  if (!item || activity.type === "dndestinyReload" || !isGrenadeItem(item)) return;

  // Of an actor's grenades (there can be more than one - see
  // renderGrenadeList/MAX_CLASS_GRENADES), only the one flagged
  // ACTIVE_GRENADE_FLAG (via the list's "Set as Active" star button) can
  // actually be used - keeps the character sheet's Attack/Damage rolls,
  // any macro, etc. all pointed at whichever grenade the player actually
  // has "in hand" instead of any grenade they happen to be carrying.
  const activeId = item.actor?.getFlag(MODULE_ID, ACTIVE_GRENADE_FLAG) ?? null;
  if (item.id !== activeId) {
    ui.notifications.warn(`${item.name} isn't the Active Grenade - set it as active on the Core Light Abilities tab first.`);
    return false;
  }
});

// Auto-configures every non-Reload Activity on a hasAbilitySlot item (a
// Grenade or one of the 3 Core Ability slots) to consume 1 of the item's
// own Limited Uses (system.uses) per activation, via dndestiny's real
// Consumption target ("Item Uses", self) - the same mechanism any native
// item with limited uses relies on, rather than a custom hook manually
// checking/decrementing system.uses.spent. dndestiny's own consumption
// pipeline then handles both blocking the roll (with its own warning) once
// spent, and the actual decrement, atomically with the rest of the
// activation. Only adds the target if one isn't already there, so it
// doesn't stomp a value a GM has customized. Excludes "dndestinyReload"
// specifically - e.g. Hunter's Dodge can carry a Reload Activity of its
// own (see ReloadActivity) alongside being a Melee Ability itself, and
// firing that Reload shouldn't burn a Melee Ability charge.
function ensureAbilityUsesConsumption(item) {
  const activities = item.system?.activities;
  if (!activities || !hasAbilitySlot(item)) return;

  for (const activity of activities) {
    if (activity.type === "dndestinyReload") continue;

    const targets = activity.consumption?.targets ?? [];
    if (targets.some(t => t.type === "itemUses")) continue;

    activity.update({ "consumption.targets": [...targets, { type: "itemUses", target: "", value: "1" }] });
  }
}

// One-time migration companion to ensureAbilityUsesConsumption - that
// function only ever runs when an item's own sheet renders, so this
// retroactively wires Consumption on every existing Grenade/Core Ability
// Slot item (world items and ones already embedded on an actor) without
// requiring their sheets be opened once first. GM-only so every connected
// client doesn't race to update the same items.
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  const items = [...game.items, ...game.actors.contents.flatMap(a => a.items.contents)].filter(hasAbilitySlot);
  for (const item of items) ensureAbilityUsesConsumption(item);
});

// Item flavors capped at a fixed count per character, enforced below
// regardless of how a new one would arrive (drag-and-drop, compendium
// import, macro, etc.) - preCreateItem fires for all of them. Adding another
// capped item type later is a one-entry addition here rather than a whole
// new Hook registration.
const CAPPED_ITEM_TYPES = [
  {
    label: "grenades",
    max: MAX_CLASS_GRENADES,
    matches: isGrenadeItem,
    // syncActorGrenades's own creations are exempt since they're already
    // bounded by the class's own slot cap; this only needs to stop manual
    // drops from stacking on top of that.
    exempt: (item) => !!item.getFlag(MODULE_ID, SOURCE_GRENADE_FLAG)
  },
  {
    label: "Foundations",
    max: MAX_FOUNDATIONS,
    matches: isFoundationItem,
    exempt: () => false
  },
  ...ABILITY_SLOTS.map(({ key, label }) => ({
    label,
    max: 1,
    matches: (item) => isLightAbilityTypeItem(item) && item.system?.dndestinyAbilitySlot === key,
    exempt: () => false
  }))
];

Hooks.on("preCreateItem", (item) => {
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor" || !isCharacterLikeActor(actor)) return;

  for (const { label, max, matches, exempt } of CAPPED_ITEM_TYPES) {
    if (!matches(item) || exempt(item)) continue;
    const currentCount = actor.items.filter(matches).length;
    if (currentCount >= max) {
      ui.notifications.warn(`${actor.name} already has ${max} ${label}. Remove one before adding another.`);
      return false;
    }
  }

  // Core ability slot items only ever have a single charge available.
  if (isAbilitySlotItem(item)) {
    item.updateSource({ "system.uses.max": "1", "system.uses.spent": 0 });
  }
});

// Ghost inventory stack-splitting (see injectGhostMemoryField for Maximum
// Stack itself, and GHOST_MEMORY_ITEM_TYPES for which item types carry it).
// Two items count as "the exact same item" for stacking purposes if their
// type, name, Memory Cost, and Maximum Stack all match - deliberately loose
// (name-based) since custom items have no other shared identity to compare.
function ghostStackMatch(a, b) {
  return a.type === b.type
    && a.name === b.name
    && (a.system?.dndestinyGhostMaxStack || null) === (b.system?.dndestinyGhostMaxStack || null)
    && (a.system?.dndestinyGhostMemory || 0) === (b.system?.dndestinyGhostMemory || 0);
}

// Spends `itemData.system.quantity` units of it across the actor's existing
// matching stacks (topping each off to maxStack first) before creating
// however many brand-new stacks are needed for whatever's left over - e.g.
// adding 150 Handcuffs (Maximum Stack 99) to an actor already holding 40
// tops that stack to 99 (59 spent) and creates one new stack of 91.
async function distributeGhostStack(actor, itemData, maxStack) {
  let remaining = itemData.system?.quantity ?? 1;

  const existing = actor.items.filter(i => ghostStackMatch(i, itemData));
  for (const stack of existing) {
    if (remaining <= 0) break;
    const room = maxStack - (stack.system?.quantity ?? 0);
    if (room <= 0) continue;
    const add = Math.min(room, remaining);
    await stack.update(
      { "system.quantity": (stack.system?.quantity ?? 0) + add },
      { dndestinyGhostStackSplit: true }
    );
    remaining -= add;
  }

  const newStacks = [];
  while (remaining > 0) {
    const qty = Math.min(maxStack, remaining);
    newStacks.push(foundry.utils.mergeObject(itemData, { system: { quantity: qty } }, { inplace: false }));
    remaining -= qty;
  }
  if (newStacks.length) await actor.createEmbeddedDocuments("Item", newStacks, { dndestinyGhostStackSplit: true });
}

// Items flagged "Cannot be Stored in a Ghost" (see injectGhostBlockedField)
// are rejected outright, however they'd arrive - drag-and-drop, compendium
// import, macro, etc. The "Send to Ghost" button separately checks this
// itself (see sendItemToActor) so it can warn without deleting the item
// from its source first, but this is the backstop for every other path.
Hooks.on("preCreateItem", (item) => {
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor" || actor.type !== GHOST_ACTOR_TYPE) return;
  if (!isGhostBlockedItem(item)) return;

  ui.notifications.warn(`${item.name} can't be stored in a Ghost's inventory.`);
  return false;
});

// Adding an item (drag-and-drop, compendium, macro, etc.) that would push a
// matching stack past its Maximum Stack - or that has nowhere to merge and
// is itself larger than Maximum Stack - gets rerouted through
// distributeGhostStack instead of created as-is.
Hooks.on("preCreateItem", (item, data, options) => {
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor" || actor.type !== GHOST_ACTOR_TYPE) return;
  if (!GHOST_MEMORY_ITEM_TYPES.includes(item.type) || options.dndestinyGhostStackSplit) return;

  const maxStack = item.system?.dndestinyGhostMaxStack;
  if (!maxStack || maxStack <= 0) return;

  const incomingQty = item.system?.quantity ?? 1;
  const hasRoomInExisting = actor.items.some(i => ghostStackMatch(i, item) && (i.system?.quantity ?? 0) < maxStack);
  if (!hasRoomInExisting && incomingQty <= maxStack) return;

  const itemData = item.toObject();
  setTimeout(() => distributeGhostStack(actor, itemData, maxStack), 0);
  return false;
});

// Growing an existing stack past its Maximum Stack (the native "+" quantity
// button, or typing a bigger number directly) clamps that item back to the
// max and spins the overflow into another stack via distributeGhostStack.
Hooks.on("preUpdateItem", (item, changes, options) => {
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor" || actor.type !== GHOST_ACTOR_TYPE) return;
  if (!GHOST_MEMORY_ITEM_TYPES.includes(item.type) || options.dndestinyGhostStackSplit) return;

  const newQty = foundry.utils.getProperty(changes, "system.quantity");
  if (newQty === undefined) return;

  const maxStack = item.system?.dndestinyGhostMaxStack;
  if (!maxStack || maxStack <= 0 || newQty <= maxStack) return;

  foundry.utils.setProperty(changes, "system.quantity", maxStack);
  const overflow = newQty - maxStack;
  const itemData = foundry.utils.mergeObject(item.toObject(), { system: { quantity: overflow } }, { inplace: false });
  setTimeout(() => distributeGhostStack(actor, itemData, maxStack), 0);
});

// Only one Ghost Shell can be equipped at a time (see GHOST_SHELL_TYPE_KEY) -
// whenever one gets equipped (via its own native inventory-row toggle),
// unequip every other Ghost Shell on the same actor.
Hooks.on("updateItem", (item, changes) => {
  if (!isGhostShellItem(item) || foundry.utils.getProperty(changes, "system.equipped") !== true) return;

  const actor = item.parent;
  if (!actor) return;

  const others = actor.items.filter(i => isGhostShellItem(i) && (i.id !== item.id) && i.system.equipped);
  if (others.length) actor.updateEmbeddedDocuments("Item", others.map(i => ({ _id: i.id, "system.equipped": false })));
});

const LIGHT_ABILITY_OPTIONS = [
  ["", "—"], ["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"],
  ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]
];

const RANGE_BAND_OPTIONS = [["", "—"], ["close", "Close"], ["medium", "Medium"], ["long", "Long"]];

// Shared by every item-sheet field injector below: resolves the item + its
// Details tab (the common place each one adds its own fieldset), gated on
// the item matching the given type (a type string or a predicate).
function getItemDetailsTab(app, rootElement, typeCheck) {
  const item = app?.document;
  if (!item || item.documentName !== "Item" || !rootElement) return null;
  const matches = typeof typeCheck === "function" ? typeCheck(item) : item.type === typeCheck;
  if (!matches) return null;
  const detailsTab = rootElement.querySelector('.tab[data-tab="details"], section.tab.details');
  return detailsTab ? { item, detailsTab } : null;
}

// New fieldsets go right after the tab's first (native) one, so our custom
// fields consistently land near the top rather than at the very bottom.
function insertFieldset(detailsTab, fieldset) {
  const firstFieldset = detailsTab.querySelector("fieldset");
  if (firstFieldset) firstFieldset.after(fieldset);
  else detailsTab.appendChild(fieldset);
}

// Gated behind SETTING_HIDE_HIT_DICE (see the init hook) - hides a class
// item's native Hit Dice field (denomination + spent).
function applyClassHitDiceVisibility(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "class");
  if (!ctx) return;

  const hide = game.settings.get(MODULE_ID, SETTING_HIDE_HIT_DICE);
  const formGroup = ctx.detailsTab.querySelector('[name*="hd.denomination"]')?.closest(".form-group");
  if (formGroup) formGroup.style.display = hide ? "none" : "";
}

// Injects a "Light Ability" field into a class item's Details tab, so a GM
// can set e.g. Gunslinger -> Charisma once on the class itself. Read by
// getPrimaryLightClass/injectCoreLightAbilitiesTab on the actor sheet.
function injectClassLightAbilityField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "class");
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  let fieldset = detailsTab.querySelector(".dndestiny-light-ability-field");
  const current = item.system?.lightAbility || "";

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-light-ability-field");
    fieldset.innerHTML = `
      <legend>Light Abilities</legend>
      <div class="form-group">
        <label>Light Ability</label>
        <div class="form-fields">
          <select class="dndestiny-class-light-ability-select">
            ${LIGHT_ABILITY_OPTIONS.map(([val, label]) => `<option value="${val}">${label}</option>`).join("")}
          </select>
        </div>
        <p class="hint">Ability score this class's Light powers key off of (Light Save DC, Light Attack Modifier).</p>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    fieldset.querySelector(".dndestiny-class-light-ability-select").addEventListener("change", (e) => {
      item.update({ "system.lightAbility": e.target.value });
    });
  }

  const select = fieldset.querySelector(".dndestiny-class-light-ability-select");
  if (select && select.value !== current) select.value = current;
}

// Injects a "Shield Die" field into a class item's Details tab, mirroring
// dndestiny's own Hit Dice field. Read by rollShieldDie on the actor sheet -
// unlike Hit Dice, this isn't a spendable pool; it's rolled once per level
// after 1st and added straight to max Shields.
function injectClassShieldDieField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "class");
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  let fieldset = detailsTab.querySelector(".dndestiny-shield-die-field");
  const current = item.system?.dndestinyShieldDie || "d6";

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-shield-die-field");
    fieldset.innerHTML = `
      <legend>Shield Die</legend>
      <div class="form-group">
        <label>Denomination</label>
        <div class="form-fields">
          <select class="dndestiny-class-shield-die-select">
            ${CONFIG.DND5E.hitDieTypes.map(d => `<option value="${d}">${d}</option>`).join("")}
          </select>
        </div>
        <p class="hint">Rolled once per level after 1st (see the Shields meter's die button on the character
          sheet) and added directly to max Shields.</p>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    fieldset.querySelector(".dndestiny-class-shield-die-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyShieldDie": e.target.value });
    });
  }

  const select = fieldset.querySelector(".dndestiny-class-shield-die-select");
  if (select && select.value !== current) select.value = current;
}

// Adds a "Light Ability Recharge" choice to the native Recovery period
// dropdown (system.uses.recovery.N.period) on every Recovery profile row of
// a hasAbilitySlot item's Details tab, alongside dndestiny's own built-in
// "Recharge" choice - a separate option, not a replacement for it. dndestiny's
// native Recharge recovery is hardcoded to a d6 (e.g. "Recharge 5-6"), so
// picking ours instead swaps that row's native Type/Formula fields out for
// our own Recharge Die + Threshold pair (see syncLightRechargeRecoveryRow),
// still backed by the same system.dndestinyRechargeDie/
// dndestinyRechargeThreshold fields rollAbilityRecharge/renderAbilitySlotList/
// renderGrenadeList already read.
function injectLightRechargeRecoveryOption(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, hasAbilitySlot);
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  const periodSelects = detailsTab.querySelectorAll('select[name^="system.uses.recovery."][name$=".period"]');
  for (const select of periodSelects) {
    if (!select.querySelector(`option[value="${LIGHT_RECHARGE_PERIOD}"]`)) {
      const option = document.createElement("option");
      option.value = LIGHT_RECHARGE_PERIOD;
      option.textContent = "Light Ability Recharge";
      select.appendChild(option);
    }

    // Only a genuinely fresh <select> (dndestiny re-rendered this row from
    // scratch) needs its value corrected - its own template has no idea our
    // option exists, so a saved Light Ability Recharge period is left
    // unmarked and the browser defaults a fresh element to its first native
    // option instead. This must never re-run against a node we've already
    // bound: this pipeline also reruns from our OWN DOM edits (see
    // bindInjectionPipeline), and by the time one of those reruns lands,
    // item.system.uses.recovery can still briefly lag a user's own change to
    // THIS SAME select (item.update() is async) - re-forcing the value from
    // that stale read would stomp their in-progress pick back to whatever
    // was last saved before it round-trips. A brand new node, by contrast,
    // only ever appears once dndestiny has already re-rendered from confirmed
    // data, so there's nothing stale left to read.
    if (!select.dataset.dndestinyBound) {
      select.dataset.dndestinyBound = "true";

      const index = Number(select.closest("[data-index]")?.dataset.index);
      const storedPeriod = item.system?.uses?.recovery?.[index]?.period;
      if (storedPeriod === LIGHT_RECHARGE_PERIOD && select.value !== storedPeriod) {
        select.value = storedPeriod;
      }

      select.addEventListener("change", () => syncLightRechargeRecoveryRow(select, item));
    }

    syncLightRechargeRecoveryRow(select, item);
  }
}

// Shows/hides a single Recovery row's native Type/Formula fields and our
// own Recharge Die/Threshold fields based on that row's Period selection -
// called on render and again immediately on the Period select's own
// "change" event so switching to/from Light Ability Recharge updates the
// row without waiting on a full sheet re-render.
function syncLightRechargeRecoveryRow(periodSelect, item) {
  const row = periodSelect.closest("[data-index]");
  const fields = row?.querySelector(":scope > .form-fields");
  if (!fields) return;

  const isLightRecharge = periodSelect.value === LIGHT_RECHARGE_PERIOD;
  const typeGroup = fields.querySelector('select[name$=".type"]')?.closest(".form-group.label-top");
  const formulaGroup = fields.querySelector('[name$=".formula"]')?.closest(".form-group.label-top");
  if (typeGroup) typeGroup.style.display = isLightRecharge ? "none" : "";
  if (formulaGroup) formulaGroup.style.display = isLightRecharge ? "none" : "";

  let block = row.querySelector(".dndestiny-light-recharge-fields");
  if (!isLightRecharge) {
    block?.remove();
    return;
  }

  if (!block) {
    block = document.createElement("div");
    block.className = "dndestiny-light-recharge-fields";
    block.innerHTML = `
      <div class="form-group label-top">
        <label>Recharge Die</label>
        <div class="form-fields">
          <select class="dndestiny-recharge-die-select">
            ${RECHARGE_DICE.map(d => `<option value="${d}">${d.toUpperCase()}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-group label-top">
        <label>Threshold</label>
        <div class="form-fields">
          <input type="number" class="dndestiny-recharge-threshold-input" min="1" step="1" />
        </div>
      </div>
    `;
    const deleteBtn = fields.querySelector('[data-action="deleteRecovery"]');
    fields.insertBefore(block, deleteBtn);

    block.querySelector(".dndestiny-recharge-die-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyRechargeDie": e.target.value });
    });
    block.querySelector(".dndestiny-recharge-threshold-input").addEventListener("change", (e) => {
      item.update({ "system.dndestinyRechargeThreshold": Math.max(1, Number(e.target.value) || 1) });
    });
  }

  const die = item.system?.dndestinyRechargeDie || "d6";
  const threshold = item.system?.dndestinyRechargeThreshold ?? 6;

  const dieSelect = block.querySelector(".dndestiny-recharge-die-select");
  if (dieSelect && document.activeElement !== dieSelect && dieSelect.value !== die) dieSelect.value = die;

  const thresholdInput = block.querySelector(".dndestiny-recharge-threshold-input");
  if (thresholdInput && document.activeElement !== thresholdInput && Number(thresholdInput.value) !== threshold) {
    thresholdInput.value = threshold;
  }
}

// Removes dndestiny's native "Spellcasting" fieldset (Progression/Ability/
// Preparation Formula) from Class and Subclass item Details tabs - a class
// grants Light Abilities through the Core Light Abilities tab instead (see
// LIGHT_ABILITY_ITEM_TYPE), not native spell slot progression, so this
// configuration isn't meaningful there even with real Spell items back.
// Shared by both item types (details-spellcasting.hbs is the same partial
// either way), regenerated fresh on every render, so this has to remove it
// every time rather than once.
function hideNativeSpellcastingSection(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, (item) => item.type === "class" || item.type === "subclass");
  if (!ctx) return;

  const legend = Array.from(ctx.detailsTab.querySelectorAll(":scope > fieldset > legend"))
    .find(l => l.textContent.trim() === "Spellcasting");
  legend?.closest("fieldset")?.remove();
}

// Adds a "Recharge:" line to a Light Ability item's Description tab summary
// strip (Casting Time/Range/Duration), directly above Duration, showing
// this item's Recharge Die/Threshold (see
// injectLightRechargeRecoveryOption/syncLightRechargeRecoveryRow) in the same
// "D6 (6+)" format used on the Core Light Abilities tab (see
// renderAbilitySlotList). Only shown once a Recovery entry is actually
// configured for the "Light Ability Recharge" period - otherwise these fields
// aren't meaningful, so the line is removed.
function injectRechargeSummaryLine(app, rootElement) {
  const item = app?.document;
  if (!item || item.documentName !== "Item" || !isLightAbilityTypeItem(item) || !rootElement) return;

  const summary = rootElement.querySelector(".spell-block");
  if (!summary) return;

  const isLightRecharge = (item.system?.uses?.recovery ?? []).some(r => r.period === LIGHT_RECHARGE_PERIOD);
  let rechargeLi = summary.querySelector(".dndestiny-recharge-summary-line");

  if (!isLightRecharge) {
    rechargeLi?.remove();
    return;
  }

  if (!rechargeLi) {
    rechargeLi = document.createElement("li");
    rechargeLi.className = "dndestiny-recharge-summary-line";
    rechargeLi.innerHTML = `<strong>Recharge:</strong> <span class="value"></span>`;
    const durationLi = Array.from(summary.querySelectorAll(":scope > li"))
      .find(li => li.querySelector("strong")?.textContent.trim() === "Duration:");
    if (durationLi) durationLi.before(rechargeLi);
    else summary.appendChild(rechargeLi);
  }

  const die = item.system?.dndestinyRechargeDie || "d6";
  const threshold = item.system?.dndestinyRechargeThreshold ?? 6;
  const label = `${die.toUpperCase()} (${threshold}+)`;

  const valueSpan = rechargeLi.querySelector(".value");
  if (valueSpan && valueSpan.textContent !== label) valueSpan.textContent = label;
}

// Replaces the "Components:" line in a Light Ability item's Description tab
// summary strip (same strip injectRechargeSummaryLine adds "Recharge:" to)
// with a "Cost:" line showing which Core Ability Slot charge using this
// ability spends - e.g. "1 grenade ability charge" for a Grenade, "1 super
// ability charge" for a Super Ability. Light Abilities don't have spell
// components, but the charge they cost is exactly the kind of at-a-glance
// info this summary strip is for. Uses the slot key itself as the charge's
// name (superclass/melee/super/grenade - see ABILITY_SLOT_CHOICES), since
// it already matches system.dndestinyAbilitySlot verbatim. Removed
// entirely if no slot is set - there's nothing to spend yet.
function injectAbilityCostSummaryLine(app, rootElement) {
  const item = app?.document;
  if (!item || item.documentName !== "Item" || !isLightAbilityTypeItem(item) || !rootElement) return;

  const summary = rootElement.querySelector(".spell-block");
  if (!summary) return;

  const componentsLi = Array.from(summary.querySelectorAll(":scope > li"))
    .find(li => li.querySelector("strong")?.textContent.trim() === "Components:");
  componentsLi?.remove();

  const slot = item.system?.dndestinyAbilitySlot;
  let costLi = summary.querySelector(".dndestiny-ability-cost-summary-line");

  if (!slot) {
    costLi?.remove();
    return;
  }

  if (!costLi) {
    costLi = document.createElement("li");
    costLi.className = "dndestiny-ability-cost-summary-line";
    costLi.innerHTML = `<strong>Cost:</strong> <span class="value"></span>`;
    const rangeLi = Array.from(summary.querySelectorAll(":scope > li"))
      .find(li => li.querySelector("strong")?.textContent.trim() === "Range:");
    if (rangeLi) rangeLi.after(costLi);
    else summary.appendChild(costLi);
  }

  const label = `1 ${slot} ability charge`;
  const valueSpan = costLi.querySelector(".value");
  if (valueSpan && valueSpan.textContent !== label) valueSpan.textContent = label;
}

// Injects "Light Ability Details" into every Light Ability item's Details
// tab, in place of the native "Spell Details" fieldset (hidden for this type
// only - see details-spell.hbs - since Spell Level/School/Materials/
// Preparation Method aren't meaningful here). The Casting/Targets/Area/
// Usage/Recovery fieldsets are untouched and still show (Casting Time/
// Range/Duration etc. - see LIGHT_ABILITY_ITEM_TYPE/LightAbilityData).
// Holds the Core Ability Slot dropdown - Superclass/Melee/Super Ability plus
// Grenade, all unified into one dropdown (see ABILITY_SLOT_CHOICES) -
// Requires Concentration and Identifier (both salvaged from the native
// Spell Details fieldset this replaces, since hiding that fieldset took its
// whole Components checkbox grid - Concentration included - down with it,
// and every item still wants an Identifier), and the Damage Die field. The
// Recharge check itself lives in the native Recovery section instead (see
// injectLightRechargeRecoveryOption).
function injectAbilitySlotField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, LIGHT_ABILITY_ITEM_TYPE);
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  ensureAbilityUsesConsumption(item);

  let fieldset = detailsTab.querySelector(".dndestiny-ability-slot-field");
  const current = item.system?.dndestinyAbilitySlot || "";

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-ability-slot-field");
    fieldset.innerHTML = `
      <legend>Light Ability Details</legend>
      <div class="form-group">
        <label>Core Ability Slot</label>
        <div class="form-fields">
          <select class="dndestiny-ability-slot-select">
            <option value="">None</option>
            ${ABILITY_SLOT_CHOICES.map(s => `<option value="${s.key}">${s.label}</option>`).join("")}
          </select>
        </div>
        <p class="hint">Places this Light Ability in one of the 3 Core Ability slots or as a Grenade on the
          Core Light Abilities tab, instead of the normal Spells list (Core Ability slots are capped at 1
          each with a single charge; Grenade isn't). Add a Recovery profile below and set its Period to
          "Light Ability Recharge" to configure its Recharge check.</p>
      </div>
      <div class="form-group">
        <label>Requires Concentration</label>
        <div class="form-fields">
          <dndestiny-checkbox class="dndestiny-concentration-checkbox"></dndestiny-checkbox>
        </div>
      </div>
      <div class="form-group">
        <label>Identifier</label>
        <div class="form-fields">
          <input type="text" class="dndestiny-light-ability-identifier-input">
        </div>
        <p class="hint">An identifier can only contain letters (a-z), numbers (0-9), dashes (-), and
          underscores (_).</p>
      </div>
      <div class="form-group">
        <label>Damage Die</label>
        <div class="form-fields">
          <select class="dndestiny-damage-die-select">
            <option value="">None</option>
            ${DAMAGE_DICE.map(d => `<option value="${d}">D${d}</option>`).join("")}
          </select>
        </div>
        <p class="hint">Only needed if this ability's damage formula references it as
          <code>@item.dndestinyDamageDenomination</code> (e.g. to let a class's scaling table drive dice
          <em>count</em> while keeping the die <em>size</em> a separate value Active Effects can step up or
          down independently - add/subtract 2 to step one die size).</p>
      </div>
    `;
    // Placed as the tab's literal first child (not via the shared
    // insertFieldset helper, which inserts after whatever the native first
    // fieldset happens to be) so this sits above the native "Spell Details"
    // fieldset rather than wherever the DOM happens to order them.
    detailsTab.insertBefore(fieldset, detailsTab.firstChild);

    fieldset.querySelector(".dndestiny-ability-slot-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyAbilitySlot": e.target.value });
    });
    // Concentration is a native dndestiny spell property (system.properties has
    // "concentration"), normally exposed via the "Spell Components" checkbox
    // grid on the native "Spell Details" fieldset - which is hidden entirely
    // for Light Ability items (see details-spell.hbs), taking that grid down
    // with it. Re-exposed here directly against that same Set instead of
    // reviving the native grid just for this one checkbox.
    fieldset.querySelector(".dndestiny-concentration-checkbox").addEventListener("change", (e) => {
      const properties = new Set(item.system.properties);
      if (e.target.checked) properties.add("concentration");
      else properties.delete("concentration");
      item.update({ "system.properties": Array.from(properties) });
    });
    fieldset.querySelector(".dndestiny-light-ability-identifier-input").addEventListener("change", (e) => {
      item.update({ "system.identifier": e.target.value });
    });
    fieldset.querySelector(".dndestiny-damage-die-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyDamageDenomination": e.target.value ? Number(e.target.value) : null });
    });
  }

  const select = fieldset.querySelector(".dndestiny-ability-slot-select");
  if (select && select.value !== current) select.value = current;

  const concentrationCheckbox = fieldset.querySelector(".dndestiny-concentration-checkbox");
  const hasConcentration = !!item.system?.properties?.has("concentration");
  if (concentrationCheckbox && concentrationCheckbox.checked !== hasConcentration) {
    concentrationCheckbox.checked = hasConcentration;
  }

  const identifierInput = fieldset.querySelector(".dndestiny-light-ability-identifier-input");
  const currentIdentifier = item.system?.identifier ?? "";
  if (identifierInput && document.activeElement !== identifierInput && identifierInput.value !== currentIdentifier) {
    identifierInput.value = currentIdentifier;
  }

  const damageDieSelect = fieldset.querySelector(".dndestiny-damage-die-select");
  const currentDie = item.system?.dndestinyDamageDenomination != null ? String(item.system.dndestinyDamageDenomination) : "";
  if (damageDieSelect && damageDieSelect.value !== currentDie) damageDieSelect.value = currentDie;

  // Swap the sheet header's type subtitle (normally the spell's level/
  // school, e.g. "1st Level Evocation") to read the slot's label instead -
  // or hide it entirely when no slot is set, since Light Abilities aren't
  // meaningfully "leveled" the way real spells are (same treatment as
  // Foundation's Background -> Foundation swap, but with nothing to fall
  // back to here).
  const subtitleSpan = rootElement.querySelector(".subtitles li span");
  if (subtitleSpan) {
    const label = ABILITY_SLOT_CHOICES.find(s => s.key === current)?.label ?? "";
    if (subtitleSpan.textContent !== label) subtitleSpan.textContent = label;
    const subtitleItem = subtitleSpan.closest("li");
    if (subtitleItem) subtitleItem.hidden = !label;
  }
}

// Injects a "This is a Foundation" checkbox into a Background item's
// Details tab. See isFoundationItem and the background data model patch in
// the init hook for how this flag changes the item's behavior.
function injectFoundationField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "background");
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  let fieldset = detailsTab.querySelector(".dndestiny-foundation-field");
  const current = !!item.system?.dndestinyIsFoundation;

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-foundation-field");
    fieldset.innerHTML = `
      <legend>Foundation</legend>
      <div class="form-group">
        <label>This is a Foundation</label>
        <div class="form-fields">
          <dndestiny-checkbox class="dndestiny-foundation-checkbox"></dndestiny-checkbox>
        </div>
        <p class="hint">Foundations display and are tracked separately from a character's main Background
          (up to ${MAX_FOUNDATIONS} at a time), instead of occupying the Background slot.</p>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    fieldset.querySelector(".dndestiny-foundation-checkbox").addEventListener("change", (e) => {
      item.update({ "system.dndestinyIsFoundation": e.target.checked });
    });
  }

  const checkbox = fieldset.querySelector(".dndestiny-foundation-checkbox");
  if (checkbox && checkbox.checked !== current) checkbox.checked = current;

  // Swap the sheet header's type subtitle (normally "Background", right
  // under the item's name) to read "Foundation" instead while checked.
  const subtitleSpan = rootElement.querySelector(".subtitles li span");
  if (subtitleSpan) {
    if (!subtitleSpan.dataset.dndestinyOriginalText) subtitleSpan.dataset.dndestinyOriginalText = subtitleSpan.textContent;
    const label = current ? "Foundation" : subtitleSpan.dataset.dndestinyOriginalText;
    if (subtitleSpan.textContent !== label) subtitleSpan.textContent = label;
  }
}

// Injects a "Cannot be stored in a Ghost's inventory" checkbox into every
// physical/inventory item's Details tab (see GHOST_MEMORY_ITEM_TYPES).
// Enforced on both the "Send to Ghost" button (sendItemToActor) and any
// direct drag/drop or compendium import onto a Ghost's sheet (see the
// preCreateItem hook below) - checking it here is the single source of
// truth for both paths.
function injectGhostBlockedField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, (item) => GHOST_MEMORY_ITEM_TYPES.includes(item.type));
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  let fieldset = detailsTab.querySelector(".dndestiny-ghost-blocked-field");
  const current = !!item.system?.dndestinyGhostBlocked;

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-ghost-blocked-field");
    fieldset.innerHTML = `
      <legend>Ghost Storage</legend>
      <div class="form-group">
        <label>Cannot be Stored in a Ghost</label>
        <div class="form-fields">
          <dndestiny-checkbox class="dndestiny-ghost-blocked-checkbox"></dndestiny-checkbox>
        </div>
        <p class="hint">Prevents this item from ever being placed in a Ghost's inventory - dragged there
          directly, imported from a compendium, or sent with the "Send to Ghost" button.</p>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    fieldset.querySelector(".dndestiny-ghost-blocked-checkbox").addEventListener("change", (e) => {
      item.update({ "system.dndestinyGhostBlocked": e.target.checked });
    });
  }

  const checkbox = fieldset.querySelector(".dndestiny-ghost-blocked-checkbox");
  if (checkbox && checkbox.checked !== current) checkbox.checked = current;
}

// Splits the native flat weapon Properties checkbox-grid into four labeled
// groups: "Default Weapon Properties" (dndestiny's own, native, keys - whatever
// is left after the three custom lists below are pulled out), "General
// Weapon Properties", "Firearm Properties" (hidden entirely unless the
// weapon's Type is Simple or Martial Firearm), and "Special Weapons".
//
// The MutationObserver-based injection pipeline (see bindInjectionPipeline)
// reruns every injector on every DOM mutation, including ones this function
// itself causes by moving checkbox <label> nodes around - so this can't
// naively tear down and rebuild the split on every call, or a second pass
// racing in behind the first (before dndestiny has actually re-rendered
// anything) would delete the sibling groups it just moved those <label>
// nodes into, permanently losing them (they only exist in the DOM tree,
// nowhere else). Instead, the native grid gets a marker once split; later
// calls against that same (unreplaced) native grid node only resync the
// Firearm group's visibility. dndestiny fully regenerates the native grid as a
// new DOM node on any real re-render (e.g. after changing weapon Type), so
// the marker naturally disappears then and this rebuilds from scratch.
function injectWeaponPropertyGroups(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "weapon");
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  const nativeGrid = detailsTab.querySelector(".checkbox-grid");
  if (!nativeGrid) return;

  const isFirearm = FIREARM_WEAPON_TYPES.includes(item.system?.type?.value);

  if (nativeGrid.dataset.dndestinyGrouped) {
    const firearmGroup = detailsTab.querySelector('.dndestiny-weapon-property-group[data-dndestiny-role="firearm"]');
    if (firearmGroup) firearmGroup.style.display = isFirearm ? "" : "none";
    return;
  }

  const nativeFields = nativeGrid.querySelector(".form-fields");
  if (!nativeFields) return;
  nativeGrid.dataset.dndestinyGrouped = "true";

  // Leftover sibling groups from the now-replaced previous native grid.
  detailsTab.querySelectorAll(".dndestiny-weapon-property-group").forEach(el => el.remove());

  const nativeLabel = nativeGrid.querySelector(":scope > label");
  if (nativeLabel) nativeLabel.textContent = "Default Weapon Properties";

  const addGroup = (title, role) => {
    const group = document.createElement("div");
    group.className = `${nativeGrid.className} dndestiny-weapon-property-group`;
    group.dataset.dndestinyRole = role;
    group.innerHTML = `<label>${title}</label><div class="form-fields"></div>`;
    nativeGrid.after(group);
    return group;
  };
  // Each addGroup() lands immediately after nativeGrid, so building these in
  // reverse of the desired visual order leaves them in the right order.
  const specialGroup = addGroup("Special Weapons", "special");
  const firearmGroup = addGroup("Firearm Properties", "firearm");
  const generalGroup = addGroup("General Weapon Properties", "general");

  const moveInto = (keys, group) => {
    const fields = group.querySelector(".form-fields");
    for (const key of keys) {
      const label = nativeFields.querySelector(`dndestiny-checkbox[name="system.properties.${key}"]`)
        ?.closest("label.checkbox");
      if (label) fields.appendChild(label);
    }
  };
  moveInto(GENERAL_WEAPON_PROPERTY_KEYS, generalGroup);
  moveInto(FIREARM_PROPERTY_KEYS, firearmGroup);
  moveInto(SPECIAL_WEAPON_PROPERTY_KEYS, specialGroup);

  firearmGroup.style.display = isFirearm ? "" : "none";

  for (const group of [generalGroup, specialGroup]) {
    if (!group.querySelector(".form-fields").children.length) group.remove();
  }
}

// Scope's 3 distances, each its own field (see the weapon schema injection
// above) so each has its own "system.dndestinyScopeXxx" key for Active
// Effects, plus the CSS class used for its input and a short placeholder.
const SCOPE_DISTANCE_FIELDS = [
  ["Effective", "dndestinyScopeEffective", "dndestiny-weapon-scope-effective-input"],
  ["Extended", "dndestinyScopeExtended", "dndestiny-weapon-scope-extended-input"],
  ["Maximum", "dndestinyScopeMaximum", "dndestiny-weapon-scope-maximum-input"]
];

// Injects Scope and Range Band fields into a weapon item's Details tab.
// Scope is 3 separate Effective/Extended/Maximum distance fields (see
// SCOPE_DISTANCE_FIELDS), shown side by side separated by "/". Range Band is
// a fixed Close/Medium/Long choice. Available on every weapon type, matching
// how dndestiny's own weapon properties aren't restricted by weapon subtype
// either.
function injectWeaponRangeFields(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "weapon");
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  let fieldset = detailsTab.querySelector(".dndestiny-weapon-range-field");
  const currentBand = item.system?.dndestinyRangeBand || "";

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-weapon-range-field");
    fieldset.innerHTML = `
      <legend>Scope &amp; Range</legend>
      <div class="form-group split-group">
        <label>Scope</label>
        <div class="form-fields">
          ${SCOPE_DISTANCE_FIELDS.map(([label, , cls], i) => `
            ${i > 0 ? '<span class="sep">/</span>' : ""}
            <div class="form-group label-top">
              <label>${label}</label>
              <input type="number" class="${cls}" step="1" min="0" />
            </div>
          `).join("")}
        </div>
      </div>
      <div class="form-group">
        <label>Range Band</label>
        <div class="form-fields">
          <select class="dndestiny-weapon-range-band-select">
            ${RANGE_BAND_OPTIONS.map(([val, label]) => `<option value="${val}">${label}</option>`).join("")}
          </select>
        </div>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    for (const [, key, cls] of SCOPE_DISTANCE_FIELDS) {
      fieldset.querySelector(`.${cls}`).addEventListener("change", (e) => {
        item.update({ [`system.${key}`]: e.target.value === "" ? null : Number(e.target.value) });
      });
    }
    fieldset.querySelector(".dndestiny-weapon-range-band-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyRangeBand": e.target.value });
    });
  }

  // Skip refreshing an input while it's focused so a re-render mid-edit
  // doesn't clobber an uncommitted value (see the HP meter fix).
  for (const [, key, cls] of SCOPE_DISTANCE_FIELDS) {
    const input = fieldset.querySelector(`.${cls}`);
    const currentValue = item.system?.[key] ?? "";
    if (input && document.activeElement !== input && input.value !== String(currentValue)) {
      input.value = currentValue;
    }
  }

  const bandSelect = fieldset.querySelector(".dndestiny-weapon-range-band-select");
  if (bandSelect && bandSelect.value !== currentBand) bandSelect.value = currentBand;
}

// Removes dndestiny's native "Range" fieldset (Normal/Long/Reach distance +
// Unit) from a Firearm's Details tab - Firearms use Scope Effective/
// Extended/Maximum brackets and a Range Band instead (see
// injectWeaponRangeFields/isFirearmItem). Kept as-is for every other weapon
// type. dndestiny regenerates this fieldset fresh on every render, so this
// has to remove it every time rather than
// once.
function hideFirearmRangeField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "weapon");
  if (!ctx) return;
  const { item, detailsTab } = ctx;
  if (!isFirearmItem(item)) return;

  const legend = Array.from(detailsTab.querySelectorAll(":scope > fieldset > legend"))
    .find(l => l.textContent.trim() === "Range");
  legend?.closest("fieldset")?.remove();

  // Blanks out any Distance value already on a Firearm - with the field
  // hidden there's no way to edit it back to a real value through the UI, so
  // any lingering data (set before this weapon became a Firearm, or before
  // this field was hidden) is stale and would otherwise keep showing up in
  // this item's rich tooltip (see the cardProperties Scope tag above).
  if (item.isOwner && ((item.system?.range?.value ?? null) !== null || (item.system?.range?.long ?? null) !== null)) {
    item.update({ "system.range.value": null, "system.range.long": null });
  }
}

// Replaces a Perk item's Details tab with the fields that actually matter
// for a Weapon Perk: which weapon classes it's available for, and which
// Slot it occupies on each one (see WEAPON_CLASSES/PERK_ITEM_TYPE) - a
// perk's slot genuinely isn't fixed across every weapon it's on (e.g. Take
// a Knee is Slot 3 on Sniper Rifle's table but Slot 1 on Scout Rifle's), so
// checking a weapon class reveals a Slot dropdown just for that weapon
// (see PerkData's schema comment for the underlying data shape). The
// native Feat-specific fieldset here (Feature Type/Prerequisites/
// Properties) doesn't apply to a Perk and is hidden rather than left to
// confuse someone authoring one - everything a perk actually needs to
// define is: this Weapon Class/Slot targeting here, its rules text on the
// Description tab, and (for whatever part of it is a flat, always-on
// modifier rather than a conditional/situational one - see the List of
// Perks terminology) an ordinary Active Effect on this same item's Effects
// tab, using plain "system.xxx" keys as if it were already on the weapon -
// that's all copied onto the weapon when this perk gets slotted (see
// injectWeaponCustomizationTab/applyPerkToSlot).
function injectPerkDetailsFields(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, isPerkItem);
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  // dndestiny's own per-type Details partial doesn't know about our type string,
  // so nothing native should render here - but if a future dndestiny update
  // changes that lookup and something native does show up, hide it rather
  // than show irrelevant Feat fields on a Perk.
  for (const fieldset of detailsTab.querySelectorAll(":scope > fieldset")) {
    if (!fieldset.classList.contains("dndestiny-perk-details-field")) fieldset.remove();
  }

  let fieldset = detailsTab.querySelector(".dndestiny-perk-details-field");
  const currentClasses = item.system?.dndestinyPerkWeaponClasses ?? {};

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-perk-details-field");
    fieldset.innerHTML = `
      <legend>Perk Details</legend>
      <div class="form-group stacked">
        <label>Weapon Classes</label>
        <div class="form-fields dndestiny-perk-weapon-class-list">
          ${WEAPON_CLASSES.map(([key, label]) => `
            <div class="dndestiny-perk-weapon-class-row" data-weapon-class="${key}">
              <label class="checkbox">
                <input type="checkbox" class="dndestiny-perk-weapon-class-input" value="${key}">
                ${label}
              </label>
              <select class="dndestiny-perk-weapon-class-slot-select" data-weapon-class="${key}">
                <option value="1">Slot 1</option>
                <option value="2">Slot 2</option>
                <option value="3">Slot 3</option>
              </select>
            </div>
          `).join("")}
        </div>
        <p class="hint">Which weapons this perk is available for, and which slot it occupies on each.</p>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    fieldset.querySelectorAll(".dndestiny-perk-weapon-class-input").forEach(input => {
      input.addEventListener("change", () => {
        const classes = { ...item.system.dndestinyPerkWeaponClasses };
        if (input.checked) {
          const slotSelect = fieldset.querySelector(
            `.dndestiny-perk-weapon-class-slot-select[data-weapon-class="${input.value}"]`
          );
          classes[input.value] = Number(slotSelect?.value ?? 1);
        } else {
          delete classes[input.value];
        }
        item.update({ "system.dndestinyPerkWeaponClasses": classes });
      });
    });
    fieldset.querySelectorAll(".dndestiny-perk-weapon-class-slot-select").forEach(select => {
      select.addEventListener("change", () => {
        const key = select.dataset.weaponClass;
        const classes = { ...item.system.dndestinyPerkWeaponClasses };
        if (!(key in classes)) return;
        classes[key] = Number(select.value);
        item.update({ "system.dndestinyPerkWeaponClasses": classes });
      });
    });
  }

  fieldset.querySelectorAll(".dndestiny-perk-weapon-class-row").forEach(row => {
    const key = row.dataset.weaponClass;
    const checked = key in currentClasses;
    row.querySelector(".dndestiny-perk-weapon-class-input").checked = checked;
    row.classList.toggle("dndestiny-perk-weapon-class-active", checked);
    if (checked) row.querySelector(".dndestiny-perk-weapon-class-slot-select").value = String(currentClasses[key]);
  });
}

// Sheet-wide (not just Details-tab) cleanup for a Perk item:
// - dndestiny's header subtitle falls back to "Passive" for a Feat with no
//   Activation type set (which every Perk has, since they're never
//   activated directly) - that reads as a stray leftover Feat concept on a
//   Perk, so it's forced to just say "Perk" instead.
// - The Activities and Advancement tabs are native Feat machinery a Perk
//   has no use for (a Perk isn't activated and isn't gained through
//   leveling) - hidden entirely rather than left empty and confusing.
function cleanUpPerkSheet(app, rootElement) {
  const item = app?.document;
  if (!item || item.documentName !== "Item" || !isPerkItem(item) || !rootElement) return;

  const subtitle = rootElement.querySelector(".sheet-header .subtitles");
  if (subtitle && subtitle.textContent.trim() !== "Perk") subtitle.innerHTML = "<li><span>Perk</span></li>";

  for (const tabId of ["activities", "advancement"]) {
    rootElement.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.style.setProperty("display", "none"));
  }
}

// Copies a Perk's own Active Effects onto a weapon (see injectPerkDetailsFields
// for how a Perk defines those - plain "system.xxx" keys authored on the
// Perk's own Effects tab exactly like any other Active Effect, since they're
// simply cloned onto the weapon rather than interpreted specially). Clears
// whatever was already in that slot first, so swapping a perk cleanly
// removes the old one's effects before applying the new one's. The clone is
// tagged with flags.dndestiny.perkSlot/perkSourceUuid so
// removePerkFromSlot can find exactly these effects again later, and
// nothing else this weapon might separately have.
async function applyPerkToSlot(weapon, slotNumber, perk) {
  await removePerkFromSlot(weapon, slotNumber);

  const slotKey = PERK_SLOT_FIELDS.find(([n]) => n === slotNumber)[1];
  const effectsData = perk.effects.contents.map(effect => {
    const data = effect.toObject();
    delete data._id;
    data.origin = perk.uuid;
    // Item5e#allApplicableEffects() (what actually decides which effects on
    // an item apply to that item's own data) only yields effects whose
    // applicableType getter resolves to "Item" - which for an
    // EnchantmentData effect (data.type: "enchantment") means its isApplied
    // getter needs to be true, which just checks `this.parent.transfer &&
    // !!this.item` (see EnchantmentData#isApplied/#applicableType). transfer
    // normally means "also apply this effect to the wielding actor," but
    // EnchantmentData's own applicableType never resolves to "Actor" no
    // matter what transfer is set to, so setting it true here only makes
    // the effect apply to the weapon itself, same as intended - it doesn't
    // also leak onto the actor the way a transfer:true "base"-type effect
    // would. Perks are authored as ordinary effects on the perk (type
    // "base" by default, since there's no reason to make someone building a
    // perk think about any of this), so this has to force both fields when
    // cloning onto the weapon.
    data.transfer = true;
    data.type = "enchantment";
    foundry.utils.setProperty(data, "flags.dndestiny.perkSlot", slotNumber);
    foundry.utils.setProperty(data, "flags.dndestiny.perkSourceUuid", perk.uuid);
    return data;
  });
  if (effectsData.length) await weapon.createEmbeddedDocuments("ActiveEffect", effectsData);
  await weapon.update({ [`system.${slotKey}`]: perk.uuid });
}

// Removes whatever perk is currently in a weapon's slot - both the Active
// Effects that perk's own copy applied (see applyPerkToSlot) and the slot's
// stored UUID.
async function removePerkFromSlot(weapon, slotNumber) {
  const slotKey = PERK_SLOT_FIELDS.find(([n]) => n === slotNumber)[1];
  const toDelete = weapon.effects.filter(e => e.flags?.dndestiny?.perkSlot === slotNumber).map(e => e.id);
  if (toDelete.length) await weapon.deleteEmbeddedDocuments("ActiveEffect", toDelete);
  if (weapon.system?.[slotKey]) await weapon.update({ [`system.${slotKey}`]: "" });
}

// Looks up which Slot a dropped Perk belongs in for this specific weapon
// (see PerkData's dndestinyPerkWeaponClasses schema comment - the same
// perk can map to a different Slot on a different weapon class, e.g. Take
// a Knee is Slot 3 on Sniper Rifle but Slot 1 on Scout Rifle), warning and
// returning null rather than silently doing nothing so a rejected drop is
// never a mystery. This is what lets a perk be dropped anywhere on a
// weapon's Customization tab and land in the correct slot automatically,
// rather than requiring the slot it's dropped onto to already match.
function getPerkSlotForWeapon(weapon, perk) {
  if (!isPerkItem(perk)) {
    ui.notifications.warn(`${perk?.name ?? "That item"} is not a Weapon Perk.`);
    return null;
  }
  const classes = perk.system.dndestinyPerkWeaponClasses ?? {};
  const weaponClass = weapon.system?.type?.baseItem;
  let slot = classes[weaponClass];
  // Fall back to the "any melee weapon" mapping (see MELEE_ANY_WEAPON_CLASS)
  // if this weapon's own baseItem isn't tagged directly but it's a melee
  // weapon and the perk is tagged for any melee weapon.
  if (slot === undefined && MELEE_WEAPON_TYPE_VALUES.includes(weapon.system?.type?.value)) {
    slot = classes[MELEE_ANY_WEAPON_CLASS];
  }
  if (slot === undefined) {
    ui.notifications.warn(`${perk.name} isn't available for ${weapon.name}.`);
    return null;
  }
  return slot;
}

// Weapon Perks whose effects are conditional/triggered (see the List of
// Perks terminology in Chapter 6 - "situational benefits" and the like)
// rather than a flat, always-on modifier can't be expressed as a plain
// Active Effect - see the module-level dependency on Midi-QOL/DAE this adds
// them for. Each entry here is keyed by a Perk's own "identifier" field
// (dndestiny auto-slugifies this from the perk's Name - "Hip Fire" becomes
// "hip-fire" - so nothing extra needs setting on the perk item itself for
// this to find it) and receives { actor, item, activity, workflow,
// macroPass } every time PERK_MACRO_BRIDGE fires on a weapon carrying that
// perk in any slot (see runPerkMacro/ensurePerkMacroBridge below). A new
// automated perk is added here, in code, rather than by asking a perk
// author to write Midi-QOL macro script themselves - authoring a perk
// itself never requires touching this file.
// Adds a flat bonus to the activity's own attack.bonus FormulaField (see
// getAttackData in dndestiny.mjs, which reads this field directly when building
// the actual attack roll's parts) - shared by every perk that just needs a
// flat "+N to attack while <condition>" (see PERK_MACRO_HANDLERS).
function addAttackBonus(activity, bonus) {
  const current = activity.attack.bonus || "";
  activity.attack.bonus = current ? `${current} + ${bonus}` : String(bonus);
}

const PERK_MACRO_HANDLERS = {
  "hip-fire": ({ actor, activity, macroPass }) => {
    if (macroPass !== "preAttackRoll") return;
    if (actor.statuses?.has("dndestinyAiming")) return;
    addAttackBonus(activity, 2);
  },
  // Outlaw's other half (+2 damage while not Aiming) isn't automated here -
  // there's no equivalent flat "damage.bonus" field on an Attack activity
  // to mutate the way attack.bonus works (damage comes from a list of
  // DamageField parts instead), so that half stays descriptive text on the
  // perk itself for now.
  "outlaw": ({ actor, activity, macroPass }) => {
    if (macroPass !== "preAttackRoll") return;
    if (!actor.statuses?.has("dndestinyAiming")) return;
    addAttackBonus(activity, 2);
  },
  // Take a Knee's damage half isn't automated for the same reason as
  // Outlaw's - no flat damage.bonus field on an Attack activity to mutate.
  "take-a-knee": ({ actor, activity, macroPass }) => {
    if (macroPass !== "preAttackRoll") return;
    if (!actor.statuses?.has("dndestinyCombatProne")) return;
    addAttackBonus(activity, 1);
  },
  "hidden-hand": ({ actor, activity, macroPass }) => {
    if (macroPass !== "preAttackRoll") return;
    if (!actor.statuses?.has("dndestinyAiming")) return;
    addAttackBonus(activity, 2);
  }
};

// The Midi-QOL on-use macro passes every weapon needs wired up for
// PERK_MACRO_HANDLERS to ever actually fire - kept broad (rather than only
// whichever pass today's handlers need) so adding a new handler for a
// different pass later doesn't also require re-wiring every existing
// weapon's flag.
const PERK_MACRO_PASSES = ["preAttackRoll", "preDamageRoll", "postDamageRoll"];
// What a weapon's own flags.midi-qol.onUseMacroName needs to be for
// PERK_MACRO_PASSES to all call game.dndestiny.runPerkMacro - "function.X"
// is Midi-QOL's own syntax for calling a bare global function/expression by
// name instead of looking up a Macro document (see OnUseMacro/
// resolveFunctionMacro in midi-qol.js), which is what lets this stay a
// plain function in this module instead of a separate Macro document
// someone could rename or delete out from under it.
const PERK_MACRO_BRIDGE = PERK_MACRO_PASSES.map(pass => `[${pass}]function.game.dndestiny.runPerkMacro`).join(",");

// Ensures a weapon has the Midi-QOL bridge above wired up - called every
// time the Customization tab renders (see injectWeaponCustomizationTab) so
// it's set automatically the first time any weapon's Customization tab is
// opened, with no manual macro configuration for a player/GM to do.
function ensurePerkMacroBridge(weapon) {
  if (!weapon.isOwner) return;
  const current = weapon.flags?.["midi-qol"]?.onUseMacroName ?? "";
  if (current === PERK_MACRO_BRIDGE) return;
  weapon.update({ "flags.midi-qol.onUseMacroName": PERK_MACRO_BRIDGE });
}

// Called via the "function.game.dndestiny.runPerkMacro" bridge (see
// PERK_MACRO_BRIDGE) at every Midi-QOL on-use macro pass a weapon is wired
// for. Looks at whichever Perks are actually slotted on the weapon being
// used (see PERK_SLOT_FIELDS) and, for each one with a registered handler
// (see PERK_MACRO_HANDLERS), runs it - a handler decides for itself whether
// the current macroPass/situation is one it cares about.
async function runPerkMacro({ actor, item, workflow }) {
  if (!workflow?.activity || item?.type !== "weapon") return;
  const macroPass = workflow.macroPass;
  const activity = workflow.activity;

  for (const [, slotKey] of PERK_SLOT_FIELDS) {
    const uuid = item.system?.[slotKey];
    if (!uuid) continue;
    const perk = await fromUuid(uuid);
    const handler = PERK_MACRO_HANDLERS[perk?.system?.identifier];
    if (handler) await handler({ actor, item, activity, workflow, macroPass });
  }
}

// Injects the "Customization" tab (Chapter 6) into a weapon's item sheet -
// a Tier dropdown (see WEAPON_TIER_SLOT_COUNTS) and the 3 perk slots it
// unlocks. Follows the same manual tab-button/tab-section pattern as
// injectCoreLightAbilitiesTab on the actor sheet (dndestiny's own tab-switching
// doesn't know about a tab we invented, so activating/deactivating it has
// to be handled by hand rather than relying on the native click handler).
function injectWeaponCustomizationTab(app, rootElement) {
  const item = app?.document;
  if (!item || item.documentName !== "Item" || item.type !== "weapon" || !rootElement) return;

  ensurePerkMacroBridge(item);

  const TAB_ID = "dndestiny-customization";
  const nav = rootElement.querySelector('nav.sheet-tabs.tabs, nav.tabs[data-group="primary"], nav.tabs');
  const body = rootElement.querySelector("form") ?? rootElement;
  if (!nav || !body) return;

  let customBtn = nav.querySelector(`[data-tab="${TAB_ID}"]`);
  if (!customBtn) {
    customBtn = document.createElement("a");
    customBtn.dataset.action = "tab";
    customBtn.dataset.group = "primary";
    customBtn.dataset.tab = TAB_ID;
    customBtn.innerHTML = `<span>Customization</span>`;
    nav.appendChild(customBtn);
  }

  let section = body.querySelector(`.tab.${TAB_ID}`);
  if (!section) {
    section = document.createElement("div");
    section.classList.add("tab", TAB_ID);
    section.dataset.tab = TAB_ID;
    section.dataset.group = "primary";
    section.innerHTML = `
      <fieldset>
        <legend>Weapon Tier</legend>
        <div class="form-group">
          <label>Tier</label>
          <div class="form-fields">
            <select class="dndestiny-weapon-tier-select">
              <option value="0">Tier 0</option>
              <option value="1">Tier 1</option>
              <option value="2">Tier 2</option>
              <option value="3">Tier 3</option>
            </select>
          </div>
        </div>
        <p class="hint">Higher tiers unlock more perk slots below - they grant no bonus on their own.</p>
      </fieldset>
      <fieldset class="dndestiny-perk-slots-fieldset">
        <legend>Perks</legend>
        <div class="dndestiny-perk-slots">
          ${PERK_SLOT_FIELDS.map(([n]) => `
            <div class="dndestiny-perk-slot" data-slot="${n}">
              <div class="dndestiny-perk-slot-label">Slot ${n}</div>
              <div class="dndestiny-perk-slot-content"></div>
            </div>
          `).join("")}
        </div>
      </fieldset>
    `;
    body.appendChild(section);

    section.querySelector(".dndestiny-weapon-tier-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyWeaponTier": Number(e.target.value) });
    });

    // Every slot box accepts a drop and routes it to whichever Slot the
    // perk actually maps to for THIS weapon (see getPerkSlotForWeapon) -
    // not necessarily the box it was dropped onto - so which of the 3
    // boxes a perk lands on is automatic, matching the request that
    // dropping a perk should "just work" without having to already know
    // its slot for this specific weapon.
    section.querySelectorAll(".dndestiny-perk-slot").forEach(slotEl => {
      slotEl.addEventListener("dragover", (e) => e.preventDefault());
      slotEl.addEventListener("drop", async (e) => {
        e.preventDefault();
        let data;
        try {
          data = foundry.applications.ux.TextEditor.implementation.getDragEventData(e);
        } catch (err) { return; }
        if (data?.type !== "Item" || !data.uuid) return;

        const perk = await fromUuid(data.uuid);
        const slotNumber = getPerkSlotForWeapon(item, perk);
        if (slotNumber === null) return;
        if (slotNumber > (item.system?.dndestinyWeaponTier ?? 0)) {
          ui.notifications.warn(`Slot ${slotNumber} requires a higher Weapon Tier.`);
          return;
        }
        await applyPerkToSlot(item, slotNumber, perk);
      });

      slotEl.addEventListener("click", async (e) => {
        const slotNumber = Number(slotEl.dataset.slot);
        if (e.target.closest(".dndestiny-perk-slot-remove")) {
          e.preventDefault();
          await removePerkFromSlot(item, slotNumber);
          return;
        }
        const uuid = item.system?.[PERK_SLOT_FIELDS.find(([n]) => n === slotNumber)[1]];
        if (uuid) (await fromUuid(uuid))?.sheet?.render(true);
      });
    });
  }

  // Check state tracking across re-renders, same as injectCoreLightAbilitiesTab.
  const isCustomTabActive = app.tabGroups?.primary === TAB_ID;
  if (isCustomTabActive) {
    nav.querySelectorAll("[data-tab]").forEach(el => el.classList.remove("active"));
    body.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
    customBtn.classList.add("active");
    section.classList.add("active");
  }

  if (!customBtn.dataset.dndestinyBound) {
    customBtn.dataset.dndestinyBound = "true";
    customBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (app.tabGroups) app.tabGroups.primary = TAB_ID;
      nav.querySelectorAll("[data-tab]").forEach(el => el.classList.remove("active"));
      body.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
      customBtn.classList.add("active");
      section.classList.add("active");
    });
  }

  const nativeButtons = nav.querySelectorAll(`[data-tab]:not([data-tab="${TAB_ID}"])`);
  nativeButtons.forEach(btn => {
    if (!btn.dataset.dndestinyCleanBound) {
      btn.dataset.dndestinyCleanBound = "true";
      btn.addEventListener("click", () => {
        customBtn.classList.remove("active");
        section.classList.remove("active");
      });
    }
  });

  // Refresh content every render - Tier, slot contents, and lock state can
  // all change from outside this tab (e.g. an Active Effect on the Tier
  // field) as well as from within it.
  const tier = item.system?.dndestinyWeaponTier ?? 0;
  const tierSelect = section.querySelector(".dndestiny-weapon-tier-select");
  if (tierSelect && Number(tierSelect.value) !== tier) tierSelect.value = String(tier);

  const perksFieldset = section.querySelector(".dndestiny-perk-slots-fieldset");
  if (perksFieldset) perksFieldset.style.display = tier === 0 ? "none" : "";

  for (const [slotNumber, slotKey] of PERK_SLOT_FIELDS) {
    const slotEl = section.querySelector(`.dndestiny-perk-slot[data-slot="${slotNumber}"]`);
    const content = slotEl?.querySelector(".dndestiny-perk-slot-content");
    if (!content) continue;

    const locked = slotNumber > tier;
    slotEl.classList.toggle("dndestiny-perk-slot-locked", locked);
    slotEl.style.display = locked ? "none" : "";
    if (locked) continue;

    const uuid = item.system?.[slotKey];
    if (!uuid) {
      content.innerHTML = `<p class="hint">Drag a perk here</p>`;
    } else {
      // Resolving fromUuid is async but this render pass isn't - render a
      // placeholder immediately, then fill in once the perk document
      // actually loads (it's already cached after the first render).
      content.innerHTML = `<p class="hint">Loading…</p>`;
      fromUuid(uuid).then(perk => {
        if (!content.isConnected) return;
        if (!perk) {
          content.innerHTML = `<p class="hint dndestiny-perk-slot-missing">Missing perk</p>`;
          return;
        }
        content.innerHTML = `
          <img class="dndestiny-perk-slot-icon" src="${perk.img}" alt="${perk.name}">
          <span class="dndestiny-perk-slot-name">${perk.name}</span>
          <a class="dndestiny-perk-slot-remove" data-tooltip="Remove" aria-label="Remove">
            <i class="fas fa-times"></i>
          </a>
        `;
      });
    }
  }
}

// The Ammo Type a weapon's Type implies by default (Rocket Launcher
// specifically implies Rockets, every other Martial Firearm implies the
// general Martial Magazine, every Simple Firearm implies the general
// Simple Magazine) - what "Auto" resolves to on the Ammo Type dropdown (see
// injectWeaponShotCapacityField) when nothing's explicitly chosen. Returns
// null if the weapon's Type doesn't imply any of the three.
function getDefaultAmmoType(item) {
  if (item.system?.type?.baseItem === ROCKET_LAUNCHER_BASE_ITEM) return "rocket";
  if (item.system?.type?.value === "simpleF") return "simple";
  if (item.system?.type?.value === "martialF") return "martial";
  return null;
}

// Which Ammo Type key (see AMMO_TYPES) a Shot Capacity weapon draws from on
// Reload. The weapon's own Ammo Type field (see injectWeaponShotCapacityField)
// wins if explicitly set; otherwise this falls back to getDefaultAmmoType.
// Returns null if nothing applies (e.g. the Shot Capacity property added to
// some other weapon type with no Ammo Type chosen), in which case
// reloadWeapon falls back to matching any tagged ammo item.
function getRequiredAmmoType(item) {
  return item.system?.dndestinyAmmoType || getDefaultAmmoType(item);
}

// Weapons on the actor carrying the Shot Capacity property - the choices
// offered when a Reload Activity is used from an item that isn't itself a
// weapon (see ReloadActivity.consume/promptReloadTarget below).
function getReloadableWeapons(actor) {
  return actor?.items.filter(i => i.type === "weapon" && i.system?.properties?.has("dndestinyShotCapacity")) ?? [];
}

// Asks which of the actor's Shot Capacity weapons to reload - used when a
// Reload Activity is attached to something other than the weapon itself
// (e.g. a Superclass Ability like Hunter's Dodge), so there's no fixed
// weapon to default to. Skips the prompt entirely when there's only one
// candidate. Resolves to the chosen Item, or null if there's nothing to
// reload or the player cancels.
async function promptReloadTarget(actor) {
  const weapons = getReloadableWeapons(actor);
  if (!weapons.length) {
    ui.notifications.warn(`${actor?.name ?? "This actor"} has no Shot Capacity weapon to reload.`);
    return null;
  }
  if (weapons.length === 1) return weapons[0];

  const options = weapons.map(w => `<option value="${w.id}">${w.name}</option>`).join("");
  const chosenId = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Reload Weapon" },
    position: { width: 320 },
    content: `
      <div class="form-group">
        <label>Weapon</label>
        <div class="form-fields">
          <select name="weaponId">${options}</select>
        </div>
      </div>
    `,
    ok: {
      label: "Reload",
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object.weaponId
    },
    rejectClose: false
  });

  return weapons.find(w => w.id === chosenId) ?? null;
}

// Consumes 1 matching Ammo Type item (see AMMO_TYPES/getRequiredAmmoType)
// from the weapon's actor and refills shots remaining to capacity. Picks
// the first matching item found with quantity > 0; doesn't try to match a
// *specific* item instance to this weapon beyond the Ammo Type - that's
// left to the player/GM to sort out. Triggered by the weapon's "Reload"
// Activity (see ReloadActivity below) rather than a Details tab button, so
// this returns an outcome the activity can turn into a chat card flavor
// line instead of just firing notifications.
async function reloadWeapon(item) {
  const actor = item.actor;
  if (!actor) return { ok: false };

  const requiredType = getRequiredAmmoType(item);
  const magazine = actor.items.find(i => i.type === "consumable"
    && (requiredType ? i.system?.dndestinyAmmoType === requiredType : !!i.system?.dndestinyAmmoType)
    && (i.system?.quantity ?? 0) > 0);

  if (!magazine) {
    const ammoLabel = requiredType ? AMMO_TYPES[requiredType] : "matching Ammo";
    ui.notifications.warn(`No ${ammoLabel} available in ${actor.name}'s inventory to reload ${item.name}.`);
    return { ok: false };
  }

  const remainingQty = (magazine.system.quantity ?? 1) - 1;
  if (remainingQty > 0) await magazine.update({ "system.quantity": remainingQty });
  else await magazine.delete();

  const capacity = item.system?.dndestinyShotCapacity ?? 0;
  await item.update({ "system.dndestinyShotsRemaining": capacity });
  ui.notifications.info(`${item.name} reloaded from ${magazine.name} (${remainingQty} left).`);
  return {
    ok: true,
    flavor: `Reloaded to ${capacity}/${capacity} shots - ${remainingQty}x ${magazine.name} left.`
  };
}

// Tracks items currently mid-flight for ensureReloadActivity so a rapid
// double-render (e.g. toggling the Shot Capacity property while the sheet
// is open) can't race and create two Reload activities before the first
// createActivity's own update+re-render round-trip has settled. This only
// guards against a race WITHIN one client, though - it's an in-memory Set,
// not anything server-authoritative, so it can't stop two different
// sessions (e.g. two players, or a GM and a player, with the same weapon's
// sheet open) from both seeing "no existing Reload activity" at the same
// moment and both creating one. Confirmed live: exactly this produced a
// duplicated Reload activity on a weapon during multi-session testing.
// Rather than trying to build real cross-client locking (Foundry's update
// API has no compare-and-swap to make that safe), this self-heals instead:
// if more than one Reload activity is ever found, every client that
// notices deletes all but one - deterministically the same one everywhere
// (lowest _id), so two clients racing to clean up just both harmlessly
// no-op on whichever ids the other already removed (deleteActivity is a
// no-op for an id that's already gone).
const pendingReloadActivitySync = new Set();

// Auto-manages a "Reload" Activity (see ReloadActivity below) on a weapon:
// added while it carries the Shot Capacity property and SETTING_TRACK_AMMO
// is on, removed otherwise. Keeps this in sync with the same gate used for
// the Capacity/Remaining fields themselves rather than requiring anyone to
// add/remove it by hand.
async function ensureReloadActivity(item) {
  const activities = item.system?.activities;
  if (!activities || !CONFIG.DND5E.activityTypes.dndestinyReload) return;
  if (pendingReloadActivitySync.has(item.id)) return;

  const hasProperty = !!item.system?.properties?.has("dndestinyShotCapacity");
  const trackingOn = game.settings.get(MODULE_ID, SETTING_TRACK_AMMO);
  const existingAll = activities.filter(a => a.type === "dndestinyReload")
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  if (hasProperty && trackingOn) {
    if (existingAll.length === 1) return;

    pendingReloadActivitySync.add(item.id);
    try {
      if (!existingAll.length) {
        await item.createActivity("dndestinyReload", { name: "Reload" }, { renderSheet: false });
      } else {
        // Duplicates from a cross-session race - keep the first (lowest
        // id, same choice on every client) and remove the rest one at a
        // time, since deleteActivity itself does a full document update
        // and firing several in parallel against the same item would just
        // create a same-document version of the exact race this is meant
        // to clean up.
        for (const extra of existingAll.slice(1)) await item.deleteActivity(extra.id);
      }
    } finally {
      pendingReloadActivitySync.delete(item.id);
    }
  } else if (existingAll.length) {
    pendingReloadActivitySync.add(item.id);
    try {
      for (const activity of existingAll) await item.deleteActivity(activity.id);
    } finally {
      pendingReloadActivitySync.delete(item.id);
    }
  }
}

// Injects Magazine Capacity/Shots Remaining fields into a weapon's Details
// tab - only while the weapon carries the Shot Capacity property (see
// CONFIG.DND5E.itemProperties.dndestinyShotCapacity) and SETTING_TRACK_AMMO
// is on; otherwise Shot Capacity is purely a descriptive property tag with
// no tracking UI at all. Reloading itself happens via the weapon's "Reload"
// Activity (see ensureReloadActivity/ReloadActivity), not from here.
function injectWeaponShotCapacityField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "weapon");
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  ensureReloadActivity(item);

  const hasProperty = !!item.system?.properties?.has("dndestinyShotCapacity");
  const trackingOn = game.settings.get(MODULE_ID, SETTING_TRACK_AMMO);
  const existing = detailsTab.querySelector(".dndestiny-weapon-shots-field");

  if (!hasProperty || !trackingOn) {
    existing?.remove();
    return;
  }

  const capacity = item.system?.dndestinyShotCapacity ?? "";
  const remaining = item.system?.dndestinyShotsRemaining ?? "";
  const ammoType = item.system?.dndestinyAmmoType ?? "";
  const defaultAmmoType = getDefaultAmmoType(item);
  const autoOptionLabel = defaultAmmoType ? `Auto (${AMMO_TYPES[defaultAmmoType]})` : "Auto (none)";

  let fieldset = existing;
  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-weapon-shots-field");
    const ammoOptions = [`<option value="">${autoOptionLabel}</option>`]
      .concat(Object.entries(AMMO_TYPES).map(([key, label]) => `<option value="${key}">${label}</option>`))
      .join("");
    fieldset.innerHTML = `
      <legend>Shot Capacity</legend>
      <div class="form-group split-group">
        <label>Magazine</label>
        <div class="form-fields">
          <div class="form-group label-top">
            <label>Capacity</label>
            <div class="form-fields">
              <input type="number" class="dndestiny-weapon-capacity-input" min="0" step="1" />
            </div>
          </div>
          <div class="form-group label-top">
            <label>Remaining</label>
            <div class="form-fields">
              <input type="number" class="dndestiny-weapon-remaining-input" min="0" step="1" />
            </div>
          </div>
          <div class="form-group label-top">
            <label>Ammo Type</label>
            <div class="form-fields">
              <select class="dndestiny-weapon-ammo-type-select">${ammoOptions}</select>
            </div>
          </div>
        </div>
        <p class="hint">Reload from this weapon's "Reload" Activity - consumes 1 matching Ammo Type item
          from this weapon's actor and refills Remaining to Capacity. "Auto" picks a default from the
          weapon's Type; choose one explicitly to override it.</p>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    fieldset.querySelector(".dndestiny-weapon-capacity-input").addEventListener("change", (e) => {
      const newCapacity = Math.max(0, Number(e.target.value) || 0);
      const currentRemaining = item.system?.dndestinyShotsRemaining;
      const updates = { "system.dndestinyShotCapacity": newCapacity };
      // First time capacity is set, or remaining now exceeds it - keep remaining sane.
      if (!Number.isInteger(currentRemaining) || currentRemaining > newCapacity) {
        updates["system.dndestinyShotsRemaining"] = newCapacity;
      }
      item.update(updates);
    });

    fieldset.querySelector(".dndestiny-weapon-remaining-input").addEventListener("change", (e) => {
      const max = item.system?.dndestinyShotCapacity ?? 0;
      const clamped = clamp(Number(e.target.value) || 0, 0, max);
      item.update({ "system.dndestinyShotsRemaining": clamped });
    });

    fieldset.querySelector(".dndestiny-weapon-ammo-type-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyAmmoType": e.target.value });
    });
  }

  // The "Auto (...)" label depends on the weapon's Type, which can change
  // without the fieldset itself being torn down and rebuilt - keep it fresh.
  const autoOption = fieldset.querySelector('.dndestiny-weapon-ammo-type-select option[value=""]');
  if (autoOption && autoOption.textContent !== autoOptionLabel) autoOption.textContent = autoOptionLabel;

  const ammoTypeSelect = fieldset.querySelector(".dndestiny-weapon-ammo-type-select");
  if (ammoTypeSelect && document.activeElement !== ammoTypeSelect && ammoTypeSelect.value !== ammoType) {
    ammoTypeSelect.value = ammoType;
  }

  const capacityInput = fieldset.querySelector(".dndestiny-weapon-capacity-input");
  if (capacityInput && document.activeElement !== capacityInput && Number(capacityInput.value) !== capacity) {
    capacityInput.value = capacity;
  }

  const remainingInput = fieldset.querySelector(".dndestiny-weapon-remaining-input");
  if (remainingInput && document.activeElement !== remainingInput && Number(remainingInput.value) !== remaining) {
    remainingInput.value = remaining;
  }
}

// Injects an "Ammo Type" dropdown into a Consumable item's Details tab,
// tagging it as one of the named ammo pools (see AMMO_TYPES) a matching
// weapon's Reload Activity draws from (see reloadWeapon/
// getRequiredAmmoType).
function injectMagazineField(app, rootElement) {
  const ctx = getItemDetailsTab(app, rootElement, "consumable");
  if (!ctx) return;
  const { item, detailsTab } = ctx;

  const current = item.system?.dndestinyAmmoType ?? "";
  let fieldset = detailsTab.querySelector(".dndestiny-ammo-type-field");

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.classList.add("dndestiny-ammo-type-field");
    const options = [`<option value="">Not Ammo</option>`]
      .concat(Object.entries(AMMO_TYPES).map(([key, label]) => `<option value="${key}">${label}</option>`))
      .join("");
    fieldset.innerHTML = `
      <legend>Ammo Type</legend>
      <div class="form-group">
        <label>Ammo Type</label>
        <div class="form-fields">
          <select class="dndestiny-ammo-type-select">${options}</select>
        </div>
        <p class="hint">Consumed by a matching weapon's Reload Activity - 1 per reload, from this item's
          Quantity.</p>
      </div>
    `;
    insertFieldset(detailsTab, fieldset);

    fieldset.querySelector(".dndestiny-ammo-type-select").addEventListener("change", (e) => {
      item.update({ "system.dndestinyAmmoType": e.target.value });
    });
  }

  const select = fieldset.querySelector(".dndestiny-ammo-type-select");
  if (select && document.activeElement !== select && select.value !== current) select.value = current;
}

// Injects a "Memory Cost (Ghost)" field into any physical item's Details
// tab (see GHOST_MEMORY_ITEM_TYPES) - lives on the item regardless of who
// owns it (a GM stats out gear once, independent of which actor ends up
// holding it), but is only ever read by a Ghost's Inventory tab (see
// injectGhostMemoryCard/injectGhostItemMemory) - a Player Character's
// inventory ignores this value entirely.
// Injects Memory Cost + Maximum Stack fields into a physical item's sheet
// HEADER, right beneath the Glimmer (price) field - reuses the exact
// "price" row styling (same .common-fields classes dndestiny already uses for
// Quantity/Weight/Price) so it looks like a native stat, with Maximum
// Stack sitting in the second slot of that row the same way Price's
// currency dropdown does (just another number input instead of a select -
// Maximum Stack has no denomination to pick either). See
// enforceGhostStackLimit for what Maximum Stack actually does.
function injectGhostMemoryField(app, rootElement) {
  const item = app?.document;
  if (!item || item.documentName !== "Item" || !GHOST_MEMORY_ITEM_TYPES.includes(item.type) || !rootElement) return;

  const priceRow = rootElement.querySelector(".sheet-header .common-fields.physical .price");
  if (!priceRow) return;

  const currentCost = item.system?.dndestinyGhostMemory ?? 0;
  const currentMaxStack = item.system?.dndestinyGhostMaxStack ?? null;
  // dndestiny's own header fields (Quantity/Weight/Price) swap between plain
  // read-only <span>s (play mode) and editable <input>s (edit mode) the
  // same way - matching that here rather than always showing raw inputs.
  const isEditMode = rootElement.classList.contains("editable");

  let row = priceRow.parentElement.querySelector(".dndestiny-ghost-memory");
  if (row && row.dataset.mode !== (isEditMode ? "edit" : "play")) {
    row.remove();
    row = null;
  }

  if (!row) {
    row = document.createElement("div");
    row.className = "price dndestiny-ghost-memory";
    row.dataset.mode = isEditMode ? "edit" : "play";

    if (isEditMode) {
      row.innerHTML = `
        <input type="number" class="dndestiny-ghost-memory-input" min="0" step="1" placeholder="Memory Cost" />
        <input type="number" class="dndestiny-ghost-maxstack-input" min="1" step="1" placeholder="Max Stack" />
      `;
      priceRow.after(row);

      row.querySelector(".dndestiny-ghost-memory-input").addEventListener("change", (e) => {
        const value = Math.max(0, Number(e.target.value) || 0);
        item.update({ "system.dndestinyGhostMemory": value });
      });
      row.querySelector(".dndestiny-ghost-maxstack-input").addEventListener("change", (e) => {
        const raw = e.target.value.trim();
        item.update({ "system.dndestinyGhostMaxStack": raw ? Math.max(1, Number(raw) || 1) : null });
      });
    } else {
      row.innerHTML = `
        <span class="dndestiny-ghost-memory-label">Memory Cost:</span>
        <span class="value dndestiny-ghost-memory-static"></span>
      `;
      priceRow.after(row);
    }
  }

  if (!isEditMode) {
    const maxStackText = currentMaxStack ? currentMaxStack : "&infin;";
    const text = `${currentCost}/${maxStackText}`;
    const span = row.querySelector(".dndestiny-ghost-memory-static");
    if (span && span.innerHTML !== text) span.innerHTML = text;
    return;
  }

  // 0/blank displays as an empty field (showing the placeholder) rather
  // than a literal "0", so the label reads as a prompt until filled in
  // instead of permanently overlapping a zero.
  const costInput = row.querySelector(".dndestiny-ghost-memory-input");
  const costDisplay = currentCost > 0 ? String(currentCost) : "";
  if (costInput && document.activeElement !== costInput && costInput.value !== costDisplay) {
    costInput.value = costDisplay;
  }

  const maxStackInput = row.querySelector(".dndestiny-ghost-maxstack-input");
  const maxStackDisplay = currentMaxStack ? String(currentMaxStack) : "";
  if (maxStackInput && document.activeElement !== maxStackInput && maxStackInput.value !== maxStackDisplay) {
    maxStackInput.value = maxStackDisplay;
  }
}

const LIGHT_SAVE_DC_CALCULATION = "dndestinyLightSaveDc";

// Adds "Light Ability" as an option in a Check or Save activity's DC
// Calculation dropdown - named to match the "Light Ability" option already
// added to the Attack activity's Attack Ability dropdown, and the
// "Spellcasting Ability"/ability-name entries already in this same dropdown,
// rather than the more mechanic-sounding "Light Save DC" this used to be
// labeled (Check-only, before Save got the same treatment). The actual
// computed value is patched into CheckActivity/SaveActivity's
// prepareFinalData (see below); this just makes the option selectable on
// both activity types' sheets.
const LIGHT_DC_CALCULATION_FIELDS = { check: "check.dc.calculation", save: "save.dc.calculation" };
function injectLightAbilityDcOption(app, rootElement) {
  const activity = app?.activity;
  const fieldName = LIGHT_DC_CALCULATION_FIELDS[activity?.type];
  if (!fieldName || !rootElement) return;

  const select = rootElement.querySelector(`select[name="${fieldName}"]`);
  if (!select || select.querySelector(`option[value="${LIGHT_SAVE_DC_CALCULATION}"]`)) return;

  const option = document.createElement("option");
  option.value = LIGHT_SAVE_DC_CALCULATION;
  option.textContent = "Light Ability";

  const spellcastingOption = select.querySelector('option[value="spellcasting"]');
  if (spellcastingOption) spellcastingOption.after(option);
  else select.appendChild(option);

  if (activity[activity.type]?.dc?.calculation === LIGHT_SAVE_DC_CALCULATION) select.value = LIGHT_SAVE_DC_CALCULATION;
}

// Adds an "Explosive" checkbox to the Damage fieldset of any activity that
// deals damage (Attack/Damage/Save - anything with a system.damage.parts
// list). Stored as flags.dndestiny.explosiveDamage.<activityId> on the
// ITEM rather than a new field on the activity's own schema - Activities are
// PseudoDocuments with a fixed compiled schema (unlike Actor/Item, dndestiny
// itself never extended this one with a custom field), so there's no schema
// field to bind to. The item's flags namespace is the same mechanism
// dndestiny's own native code already uses for other per-activity extras
// (see e.g. `last.<activityId>.damageType` in BaseActivityData - grep
// dndestiny.mjs for it), so this just follows that precedent. See the
// BaseActivityData#_processDamagePart patch (in the "init" hook) for how
// this flag actually affects damage rolls, and the
// ActorDocumentClass#calculateDamage patch for how it affects
// resistance/immunity/vulnerability.
function injectExplosiveDamageToggle(app, rootElement) {
  const activity = app?.activity;
  if (!activity?.damage || !rootElement) return;
  const item = activity.item;

  // Legend text varies by activity type - plain "Damage" on a Damage
  // activity, but "Attack Damage" / "Save Damage" on Attack/Save activities
  // (verified live) - so match on the trailing "Damage" rather than an exact
  // string.
  const legend = Array.from(rootElement.querySelectorAll("fieldset > legend"))
    .find(l => l.querySelector("span")?.textContent.trim().endsWith("Damage"));
  const fieldset = legend?.closest("fieldset");
  if (!fieldset) return;

  let group = fieldset.querySelector(":scope > .dndestiny-explosive-damage-group");
  const current = !!item?.getFlag("dndestiny", `explosiveDamage.${activity.id}`);

  if (!group) {
    group = document.createElement("div");
    group.classList.add("form-group", "dndestiny-explosive-damage-group");
    group.innerHTML = `
      <label>Explosive</label>
      <div class="form-fields">
        <dndestiny-checkbox class="dndestiny-explosive-damage-checkbox"></dndestiny-checkbox>
      </div>
      <p class="hint">This activity's damage is Explosive. A creature's resistance, immunity, or
        vulnerability to Explosive damage applies to it regardless of its base damage type(s).</p>
    `;
    legend.after(group);

    group.querySelector(".dndestiny-explosive-damage-checkbox").addEventListener("change", (e) => {
      item?.setFlag("dndestiny", `explosiveDamage.${activity.id}`, e.target.checked);
    });
  }

  const checkbox = group.querySelector(".dndestiny-explosive-damage-checkbox");
  if (checkbox && checkbox.checked !== current) checkbox.checked = current;
}

// Wires up the "Special Trait Proficiency"/"Addon Text" fields added directly
// to templates/advancement/trait-config-details.hbs (a real template file on
// disk, not compiled into dndestiny.mjs, so it's edited in place rather than
// DOM-injected like everything else in this pipeline). Stored on the
// Advancement's own flags (BaseAdvancementData gives every Advancement type a
// real flags field, same as any Document) rather than item flags, so it
// travels with the advancement itself - see injectTraitProficiencyTags below
// for how the actor sheet reads these back out once a player actually picks
// their trait(s).
function injectSpecialTraitProficiencyFields(app, rootElement) {
  const advancement = app?.advancement;
  if (advancement?.type !== "Trait" || !rootElement) return;

  const checkbox = rootElement.querySelector(".dndestiny-special-trait-proficiency-checkbox");
  const textGroup = rootElement.querySelector(".dndestiny-special-trait-proficiency-text-group");
  const textInput = rootElement.querySelector(".dndestiny-special-trait-proficiency-text");
  if (!checkbox || !textGroup || !textInput) return;

  const enabled = !!advancement.flags?.dndestiny?.specialTraitProficiency;
  const text = advancement.flags?.dndestiny?.specialTraitProficiencyText ?? "";

  if (checkbox.checked !== enabled) checkbox.checked = enabled;
  textGroup.hidden = !enabled;
  if (document.activeElement !== textInput && textInput.value !== text) textInput.value = text;

  if (!checkbox.dataset.dndestinyBound) {
    checkbox.dataset.dndestinyBound = "true";
    checkbox.addEventListener("change", (e) => {
      advancement.item.update({
        [`system.advancement.${advancement.id}.flags.dndestiny.specialTraitProficiency`]: e.target.checked
      });
    });
    textInput.addEventListener("change", (e) => {
      advancement.item.update({
        [`system.advancement.${advancement.id}.flags.dndestiny.specialTraitProficiencyText`]: e.target.value
      });
    });
  }
}

// Shows the "Addon Text" configured above (see injectSpecialTraitProficiencyFields)
// next to whichever skill/tool a player actually chose for a Trait advancement
// flagged as a Special Trait Proficiency - e.g. a Bladedancer's Trick of the
// Trade choosing Stealth shows the addon text right on the Stealth row. Reads
// every owned "class" item's Trait-type advancements rather than just the
// primary class, so a multiclassed character with more than one such
// advancement gets every applicable tag. Trait keys are formatted
// "<category>:<key>" (see Advancement#apply in dndestiny.mjs) - "skills:acr",
// "tool:thief", etc. - category maps directly to which .skills/.tools list on
// the sheet to look in; anything else (languages, armor, weapon, saves, dr/di/
// dv/dm/ci) isn't a per-row list this applies to and is skipped.
function injectTraitProficiencyTags(actor, rootElement) {
  if (!rootElement) return;

  rootElement.querySelectorAll(".dndestiny-trait-proficiency-tag").forEach(el => el.remove());

  const categoryLists = { skills: ".skills", tool: ".tools" };
  for (const classItem of actor.items) {
    if (classItem.type !== "class") continue;
    for (const advancement of Object.values(classItem.advancement?.byId ?? {})) {
      if (advancement.type !== "Trait" || !advancement.flags?.dndestiny?.specialTraitProficiency) continue;
      const text = advancement.flags?.dndestiny?.specialTraitProficiencyText?.trim();
      if (!text) continue;

      for (const chosenKey of advancement.value?.chosen ?? []) {
        const [category, key] = chosenKey.split(":");
        const listSelector = categoryLists[category];
        if (!listSelector) continue;

        const row = rootElement.querySelector(`${listSelector} li[data-key="${key}"]`);
        const anchor = row?.querySelector(".name");
        if (!anchor) continue;

        const tag = document.createElement("span");
        tag.classList.add("dndestiny-trait-proficiency-tag");
        tag.textContent = text;
        anchor.after(tag);
      }
    }
  }
}

// ==========================================
// 5. RENDER HOOK REGISTRATIONS & OBSERVERS
// ==========================================
// Runs every injector immediately, then re-runs all of them on every DOM
// mutation inside rootElement (debounced) so injected UI survives Foundry's
// own partial re-renders. Shared by every sheet type we inject into (actor,
// item, activity) instead of each keeping its own copy-pasted
// MutationObserver wiring - only the injector list and the dataset flag
// (so each element is only ever observed once) differ per sheet type.
function bindInjectionPipeline(rootElement, observedFlag, injectors) {
  const runAll = () => injectors.forEach(inject => inject());
  runAll();

  if (rootElement.dataset[observedFlag]) return;
  rootElement.dataset[observedFlag] = "true";

  let isMutating = false;
  const observer = new MutationObserver(() => {
    if (isMutating) return;
    isMutating = true;

    try {
      runAll();
    } finally {
      setTimeout(() => { isMutating = false; }, 50);
    }
  });

  observer.observe(rootElement, { childList: true, subtree: true });
}

// The native Spells tab's label is globally renamed "Light Abilities" (see
// the i18nInit hook's TYPES.Item.spell/spellPl override), which made sense
// while it was the only place that name showed up - now every sheet gets
// this reverted back to the plain native "Spells" label instead: NPCs never
// had a separate Core Light Abilities tab to distinguish it from and can
// still use native spellcasting; Player Character is meant to read as
// genuine unmodified dnd5e; and Guardian has its own dedicated Core Light
// Abilities tab already carrying that name, so the native tab underneath it
// no longer needs to borrow it too (see SETTING_HIDE_SPELLS_TAB for whether
// it's actually shown - this only fixes the label for whenever it is).
function renameSpellsTabLabel(rootElement) {
  const nav = rootElement.querySelector('nav.tabs [data-tab="spells"]');
  if (!nav) return;
  if (nav.getAttribute("aria-label") === "Light Abilities") nav.setAttribute("aria-label", "Spells");
  if (nav.getAttribute("data-tooltip") === "Light Abilities") nav.setAttribute("data-tooltip", "Spells");
}

// Swaps two sibling-or-not DOM nodes' positions in place, wherever each
// currently lives - used below to trade the Spells tab's nav button/content
// section with Core Light Abilities' without caring which one currently
// comes first.
function swapElements(a, b) {
  if (!a || !b || a === b) return;
  const placeholder = document.createComment("dndestiny-swap");
  a.parentNode.insertBefore(placeholder, a);
  b.parentNode.insertBefore(a, b);
  placeholder.parentNode.insertBefore(b, placeholder);
  placeholder.remove();
}

// Guardian-only - see injectCoreLightAbilitiesTab (always appends its nav
// button/section at the very end) and renameSpellsTabLabel above. Trades the
// native Spells tab and Core Light Abilities tab's positions - both the nav
// buttons and their tab-body sections - so Core Light Abilities sits where
// Spells natively does (alongside Features, near the top) and Spells moves
// to the end, rather than Core Light Abilities always trailing after every
// other tab regardless of how many a character has.
function swapCoreLightAbilitiesAndSpellsTabs(rootElement) {
  const nav = rootElement.querySelector('aside.sidebar nav.tabs, nav.tabs[data-group="primary"], nav.sheet-navigation');
  if (!nav) return;
  const spellsNav = nav.querySelector(':scope > [data-tab="spells"]');
  const lightNav = nav.querySelector(':scope > [data-tab="core-light-abilities"]');
  if (spellsNav && lightNav && spellsNav.dataset.dndestinySwapped !== "true") {
    swapElements(spellsNav, lightNav);
    spellsNav.dataset.dndestinySwapped = "true";
  }

  const spellsSection = rootElement.querySelector(':scope .tab[data-tab="spells"]')
    ?? rootElement.querySelector('.tab[data-tab="spells"]');
  const lightSection = rootElement.querySelector('.tab.core-light-abilities');
  if (spellsSection && lightSection && spellsSection.dataset.dndestinySwapped !== "true") {
    swapElements(spellsSection, lightSection);
    spellsSection.dataset.dndestinySwapped = "true";
  }
}

const handleSheetRender = (app, html) => {
  const actor = app.actor || app.document;

  if (actor?.type === "npc") {
    const npcRoot = getRootElement(html);
    if (!npcRoot || typeof npcRoot.querySelector !== "function") return;
    bindInjectionPipeline(npcRoot, "dndestinyNpcObserved", [() => renameSpellsTabLabel(npcRoot)]);
    return;
  }
  if (!isCharacterLikeActor(actor)) return;

  const root = getRootElement(html);
  if (!root || typeof root.querySelector !== "function") return;

  // "Player Character" (see the VanillaCharacterActorSheet registration in
  // the "init" hook) is meant to be genuinely vanilla dnd5e - skip this
  // module's full injection pipeline for it, but still apply the handful of
  // deviations explicitly asked for: hide the native Spells tab (globally
  // relabeled "Light Abilities" via the i18nInit hook - Core Light Abilities
  // live on their own dedicated tab instead, which - like everything else
  // this module injects - correctly does NOT appear here), clear the native
  // Special Traits tab (no Jack of all Guns either, that's Destiny-specific),
  // and keep Destiny Conditions available on the Effects tab.
  if (app.constructor === VanillaCharacterActorSheet) {
    bindInjectionPipeline(root, "dndestinyObserved", [
      () => applySpellsTabVisibility(root),
      () => renameSpellsTabLabel(root),
      () => hideBaseSpecialTraitsSections(root),
      () => injectDestinyConditions(actor, root)
    ]);
    return;
  }

  syncActorGrenades(actor);
  bindInjectionPipeline(root, "dndestinyObserved", [
    () => injectShieldMeters(app, root),
    () => injectSkillTooltips(root),
    () => injectToolTooltips(root),
    () => injectCoreLightAbilitiesTab(app, root),
    () => renameSpellsTabLabel(root),
    () => swapCoreLightAbilitiesAndSpellsTabs(root),
    () => hideCoreAbilitySpells(actor, root),
    () => hideLightAbilitiesFromFeatures(actor, root),
    () => injectFoundationPills(actor, root),
    () => hideGhostBackgroundButton(actor, root),
    () => fixGhostSidebarCollapse(actor, app, root),
    () => injectGhostMemoryCard(actor, root),
    () => hideGhostCarryWeightCard(actor, root),
    () => injectGhostItemMemory(actor, root),
    () => injectGhostGlimmerCard(actor, root),
    () => injectWeaponAmmoBadge(actor, root),
    () => injectSendToGhostButton(actor, root),
    () => injectSendToPlayerButton(actor, root),
    () => applySpellsTabVisibility(root),
    () => applyHitDiceVisibility(actor, root),
    () => injectJackOfAllGunsTrait(actor, root),
    () => injectDestinyConditions(actor, root),
    () => injectBriefRestButton(actor, root),
    () => injectTraitProficiencyTags(actor, root)
  ]);
};

const handleItemSheetRender = (app, html) => {
  const item = app.document;
  if (!item || item.documentName !== "Item"
    || !(item.type === "class" || item.type === "subclass" || item.type === LIGHT_ABILITY_ITEM_TYPE
      || item.type === "background"
      || item.type === PERK_ITEM_TYPE || GHOST_MEMORY_ITEM_TYPES.includes(item.type))) return;

  const root = getRootElement(html);
  if (!root || typeof root.querySelector !== "function") return;

  bindInjectionPipeline(root, "dndestinyItemObserved", [
    () => applyClassHitDiceVisibility(app, root),
    () => injectClassLightAbilityField(app, root),
    () => injectClassShieldDieField(app, root),
    () => hideNativeSpellcastingSection(app, root),
    () => injectAbilitySlotField(app, root),
    () => injectLightRechargeRecoveryOption(app, root),
    () => injectRechargeSummaryLine(app, root),
    () => injectAbilityCostSummaryLine(app, root),
    () => injectFoundationField(app, root),
    () => injectWeaponPropertyGroups(app, root),
    () => injectWeaponRangeFields(app, root),
    () => hideFirearmRangeField(app, root),
    () => injectWeaponShotCapacityField(app, root),
    () => injectMagazineField(app, root),
    () => injectGhostMemoryField(app, root),
    () => injectGhostBlockedField(app, root),
    () => injectPerkDetailsFields(app, root),
    () => cleanUpPerkSheet(app, root),
    () => injectWeaponCustomizationTab(app, root)
  ]);
};

const handleActivitySheetRender = (app, html) => {
  const activity = app.activity;
  if (!activity) return;

  const root = getRootElement(html);
  if (!root || typeof root.querySelector !== "function") return;

  bindInjectionPipeline(root, "dndestinyActivityObserved", [
    () => injectLightAbilityDcOption(app, root),
    () => injectExplosiveDamageToggle(app, root),
    () => injectBriefRestPeriodOnActivity(app, root)
  ]);
};

const handleItemBriefRestPeriodRender = (app, html) => {
  const item = app.document;
  if (!item || item.documentName !== "Item") return;

  const root = getRootElement(html);
  if (!root || typeof root.querySelector !== "function") return;

  bindInjectionPipeline(root, "dndestinyBriefRestPeriodObserved", [
    () => injectBriefRestPeriodOnItem(app, root)
  ]);
};

const handleTraitConfigRender = (app, html) => {
  if (app.advancement?.type !== "Trait") return;

  const root = getRootElement(html);
  if (!root || typeof root.querySelector !== "function") return;

  bindInjectionPipeline(root, "dndestinyTraitConfigObserved", [
    () => injectSpecialTraitProficiencyFields(app, root)
  ]);
};

// Lets the player switch their Active Grenade (see ACTIVE_GRENADE_FLAG/
// isGrenadeItem) from the Short/Long Rest dialog - the normal way to do it
// now that the "Set as Active" star on the Core Light Abilities tab is
// Edit-Mode-only (see the CSS hiding .dndestiny-grenade-select outside
// .editable). Applies immediately on change via the same actor flag the
// star button sets, independent of whether the player actually confirms
// the rest afterward - this is just picking a loadout, not a rest effect.
function injectActiveGrenadePicker(app, rootElement) {
  const actor = app.actor;
  if (!actor || !["short", "long"].includes(app.config?.type)) return;

  const grenades = actor.items.filter(isGrenadeItem);
  if (!grenades.length) return;

  const section = rootElement.querySelector("section.flexcol") ?? rootElement;

  let fieldset = section.querySelector(".dndestiny-active-grenade-field");
  const activeId = actor.getFlag(MODULE_ID, ACTIVE_GRENADE_FLAG) ?? "";

  if (!fieldset) {
    fieldset = document.createElement("fieldset");
    fieldset.className = "dndestiny-active-grenade-field";
    const options = [`<option value="">None</option>`]
      .concat(grenades.map(g => `<option value="${g.id}">${g.name}</option>`))
      .join("");
    fieldset.innerHTML = `
      <legend>Active Grenade</legend>
      <div class="form-group">
        <label>Set Active Grenade</label>
        <div class="form-fields">
          <select class="dndestiny-active-grenade-select">${options}</select>
        </div>
        <p class="hint">Only the Active Grenade can be used - swap it here, or from the Core Light
          Abilities tab in Edit Mode.</p>
      </div>
    `;
    // Lands right after dndestiny's own blue "note info" banner (e.g. "On a
    // short rest you may spend remaining Hit Dice...") rather than above
    // everything, so that context reads first.
    const notice = section.querySelector(".note.info");
    if (notice) notice.after(fieldset);
    else section.insertBefore(fieldset, section.firstChild);

    fieldset.querySelector(".dndestiny-active-grenade-select").addEventListener("change", (e) => {
      actor.setFlag(MODULE_ID, ACTIVE_GRENADE_FLAG, e.target.value || null);
    });
  }

  const select = fieldset.querySelector(".dndestiny-active-grenade-select");
  if (select && select.value !== activeId) select.value = activeId;
}

// Gated behind SETTING_HIDE_HIT_DICE - hides the Hit Dice fieldset (denom
// select + roll button) from the Short Rest dialog. Also injects the
// Active Grenade picker (see injectActiveGrenadePicker) into both Short and
// Long Rest dialogs. Rest dialogs are single-shot renders (re-run through
// this same hook on every internal re-render), so this doesn't need the
// MutationObserver-based pipeline the persistent sheets use.
const handleRestDialogRender = (app, html) => {
  const root = getRootElement(html);
  if (!root || typeof root.querySelector !== "function") return;

  const fieldset = root.querySelector('select[name="denom"]')?.closest("fieldset");
  if (fieldset) fieldset.style.display = game.settings.get(MODULE_ID, SETTING_HIDE_HIT_DICE) ? "none" : "";

  injectActiveGrenadePicker(app, root);
};

// ==========================================
// Journal "Class Summary" Page - Split Tool/Vehicle Proficiencies
// ==========================================
// The native Class Summary journal page (see dndestiny.mjs's
// _getAdvancement/makeTrait) can only ever show ONE "Tools:" line, because
// CONFIG.DND5E.traits nests vehicle proficiencies as a child of the "tool"
// trait category rather than a distinct top-level type - representedTraits()
// only looks at the segment before the first ":" in a grant key, so
// "tool:veh:jumpships" resolves to "tool" same as "tool:toolkit:whatever".
// Whichever single-purpose Trait advancement happens to match first wins
// arbitrarily, and any other tool/vehicle advancement's grants are silently
// dropped from the summary. This recomputes the Tools line correctly and
// adds a separate Vehicles line, aggregating every eligible tool-category
// Trait advancement's grants (and choice pools) and splitting them by their
// "veh" vs non-"veh" subtype.
function isEligibleToolTrait(advancement) {
  if (advancement.type !== "Trait") return false;
  if (advancement.classRestriction === "secondary") return false;
  if (advancement.level !== 1) return false;
  if (advancement.configuration.mode !== "default") return false;
  const rep = advancement.representedTraits();
  return rep.size === 1 && rep.first() === "tool";
}

// dndestiny.documents.Trait.localizedList is the same formatter the native
// Armor/Weapons/Saves/Skills lines use, reached via the public namespace the
// system exposes it under (not exported as a normal ES module binding).
function summarizeToolKeys(keys) {
  if (!keys.length) return game.i18n.localize("COMMON.None");
  return dndestiny.documents.Trait.localizedList({ grants: new Set(keys), choices: [] });
}

async function injectVehicleProficiencyLine(entry, rootElement) {
  const classPages = entry.pages.filter(p => ["class", "subclass"].includes(p.type));
  for (const page of classPages) {
    // The sidebar table-of-contents also has an <li data-page-id="..."> for
    // this page, appearing earlier in the DOM than the actual content
    // <article> - scope to .journal-entry-page so querySelector can't match
    // the nav entry instead (which has no proficiency lines to find).
    const container = rootElement.querySelector(`.journal-entry-page[data-page-id="${page.id}"]`);
    if (!container || !page.system.item) continue;

    const linked = await fromUuid(page.system.item);
    if (!linked) continue;

    const toolTraits = (linked.advancement?.byType?.Trait ?? []).filter(isEligibleToolTrait);
    if (!toolTraits.length) continue;

    const allKeys = toolTraits.flatMap(a => [
      ...a.configuration.grants, ...a.configuration.choices.flatMap(c => Array.from(c.pool))
    ]);
    const toolKeys = allKeys.filter(k => k.split(":")[1] !== "veh");
    const vehicleKeys = allKeys.filter(k => k.split(":")[1] === "veh");

    const toolsStrong = Array.from(container.querySelectorAll("strong"))
      .find(el => el.textContent.trim().replace(/:$/, "") === game.i18n.localize("TYPES.Item.toolPl"));
    if (!toolsStrong) continue;

    // Correct the native line in place - it may have arbitrarily matched a
    // vehicle-only advancement instead, since both share the "tool" type.
    let node = toolsStrong.nextSibling;
    while (node && node.nodeName !== "BR" && node.nodeName !== "STRONG") {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    toolsStrong.insertAdjacentText("afterend", ` ${summarizeToolKeys(toolKeys)}`);

    container.querySelector(".dndestiny-vehicle-line")?.remove();
    const line = document.createElement("span");
    line.className = "dndestiny-vehicle-line";
    line.innerHTML = `<br><strong>Vehicles:</strong> ${summarizeToolKeys(vehicleKeys)}`;
    toolsStrong.parentElement.appendChild(line);
  }
}

// Journal sheets render every page's content into the DOM at once (see
// injectVehicleProficiencyLine), so a single pass on render is enough - no
// MutationObserver-based pipeline needed, matching handleRestDialogRender.
const handleJournalPageRender = (app, html) => {
  const entry = app.document;
  if (!entry || entry.documentName !== "JournalEntry") return;
  if (!entry.pages.some(p => ["class", "subclass"].includes(p.type))) return;

  const root = getRootElement(html);
  if (!root || typeof root.querySelector !== "function") return;

  injectVehicleProficiencyLine(entry, root);
};

Hooks.on("renderActorSheet", handleSheetRender);
Hooks.on("renderActorSheet2", handleSheetRender);
Hooks.on("renderApplicationV2", handleSheetRender);
Hooks.on("renderApplicationV2", handleItemSheetRender);
Hooks.on("renderApplicationV2", handleItemBriefRestPeriodRender);
Hooks.on("renderApplicationV2", handleActivitySheetRender);
Hooks.on("renderApplicationV2", handleTraitConfigRender);
Hooks.on("renderApplicationV2", handleRestDialogRender);
Hooks.on("renderApplicationV2", handleJournalPageRender);
Hooks.on("renderItemSheet", handleItemSheetRender);
Hooks.on("renderItemSheet", handleItemBriefRestPeriodRender);
Hooks.on("renderItemSheet2", handleItemSheetRender);
Hooks.on("renderItemSheet2", handleItemBriefRestPeriodRender);

// "Create Scroll" (right-click a spell in the Items sidebar or a
// compendium - see Item5e.addDirectoryContextOptions) used to be removed
// here, back when Light Abilities were themselves "spell" items and this
// game had no real spellcasting for a scroll to make sense for. Now that
// Light Abilities are their own type (see LIGHT_ABILITY_ITEM_TYPE) and real
// spells are back, that native option is native dnd5e's own
// `item.type === "spell"` check already - it can't fire for a Light
// Ability regardless, so there's nothing left to filter out here.