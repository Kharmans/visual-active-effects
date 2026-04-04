import { HIDE_DISABLED, HIDE_PASSIVE, MODULE, PLAYER_CLICKS } from "./constants.mjs";

const { HandlebarsApplicationMixin, Application } = foundry.applications.api;

export default class VisualActiveEffects extends HandlebarsApplicationMixin(Application) {
  /** @inheritdoc */
  static DEFAULT_OPTIONS = {
    actions: {
      deleteEffect: {
        handler: VisualActiveEffects.#deleteEffect,
        buttons: [2],
      },
    },
    classes: [MODULE, "panel", "themed", "theme-light"],
    id: MODULE,
    window: {
      frame: false,
      minimizable: false,
      positioned: false,
      resizable: false,
    },
  };

  /* -------------------------------------------------- */

  /** @inheritdoc */
  static PARTS = {
    main: {
      template: `modules/${MODULE}/templates/${MODULE}.hbs`,
      templates: [
        `modules/${MODULE}/templates/effect.hbs`,
        `modules/${MODULE}/templates/tooltip.hbs`,
      ],
      root: true,
    },
  };

  /* -------------------------------------------------- */

  /**
   * Array of buttons for other modules.
   * @type {object[]}
   */
  buttons = [];

  /* -------------------------------------------------- */

  /**
   * The currently selected token's actor, otherwise the user's assigned actor.
   * @type {foundry.documents.Actor|null}
   */
  get actor() {
    let actor;
    if (game.canvas.ready) actor = canvas.tokens.controlled[0]?.actor;
    return actor ?? game.user.character;
  }

  /* -------------------------------------------------- */

  /** @inheritdoc */
  async _prepareContext(options) {
    if (!this.actor) return {};

    const effects = {
      primary: {
        enabled: [],
        disabled: [],
        passive: [],
      },
      secondary: {
        enabled: [],
        disabled: [],
      },
    };

    const hideDisabled = game.settings.get(MODULE, HIDE_DISABLED);
    const hidePassive = game.settings.get(MODULE, HIDE_PASSIVE);

    const skipping = effect => {
      // Suppressed or 'always hide' effects are always hidden.
      if (effect.isSuppressed || (effect.showIcon === CONST.ACTIVE_EFFECT_SHOW_ICON.NEVER)) return true;

      // 'Always show' effects are always shown.
      if (effect.showIcon === CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS) return false;

      if (!effect.isTemporary && hidePassive) return true;
      if (effect.disabled && hideDisabled) return true;

      return false;
    };

    // Set up primary effects.
    for (const effect of this.actor.allApplicableEffects()) {
      if (skipping(effect)) continue;

      const context = await this.#prepareEffect(effect);
      if (!context) continue;

      if (effect.disabled) effects.primary.disabled.push(context);
      else if (effect.isTemporary) effects.primary.enabled.push(context);
      else effects.primary.passive.push(context);
    }

    // Set up secondary effects.
    if (game.system.id !== "dnd5e") return effects;
    for (const item of this.actor.items) {
      for (const effect of item.allApplicableEffects()) {
        if (skipping(effect, true)) continue;

        const context = await this.#prepareEffect(effect);
        if (!context) continue;
        if (effect.disabled) effects.secondary.disabled.push(context);
        else effects.secondary.enabled.push(context);
      }
    }

    return effects;
  }

  /* -------------------------------------------------- */

  /**
   * Prepare context for an effect.
   * @param {foundry.documents.ActiveEffect} effect
   * @returns {Promise<object|null>}
   */
  async #prepareEffect(effect) {
    const context = {
      strings: {
        intro: "",
        content: "",
      },
    };

    if (effect.isTemporary) {
      context.isExpired = effect.duration.expired;
      context.isInfinite = !effect.isTemporary;
      context.durationLabel = effect.isTemporary ? effect.duration.label : _loc("VISUAL_ACTIVE_EFFECTS.TIME.UNLIMITED");
    }

    const buttons = [];

    /**
     * A hook that is called for other modules to add buttons to the pannel.
     * Each button must have `label` and a `callback` function.
     * @param {ActiveEffect} effect     The effect.
     * @param {object[]} buttons        The button.
     */
    Hooks.callAll(`${MODULE}.createEffectButtons`, effect, buttons);

    context.buttons = buttons.filter(button => {
      if ((typeof button.label !== "string") || (typeof button.callback !== "function")) return false;

      button.id = foundry.utils.randomID();
      this.buttons.push(button);

      return true;
    });

    context.buttonHeight = buttons.length * 32 + (buttons.length - 1) * 3;

    // Get roll data.
    let rollData;
    try {
      if (effect.origin) {
        let origin = fromUuidSync(effect.origin);
        if (origin?.documentName === "ActiveEffect") origin = origin.parent;
        if (origin?.inCompendium) origin = effect.parent;
        if (typeof origin?.getRollData === "function") rollData = origin.getRollData();
      }
      if (!rollData) rollData = effect.parent?.getRollData?.() ?? {};
    } catch (err) {
      rollData = {};
    }

    const intro = effect.description;
    if (intro) context.strings.intro = await CONFIG.ux.TextEditor.enrichHTML(intro, { rollData, relativeTo: effect });
    context.hasText = !!intro;
    context.effect = effect;

    const allowed = Hooks.call(`${MODULE}.prepareActiveEffectContext`, effect, context);
    if (allowed === false) return null;

    context.tooltip = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE}/templates/tooltip.hbs`,
      context,
    );

    return context;
  }

  /* -------------------------------------------------- */

  /** @inheritdoc */
  _insertElement(element) {
    const existing = document.getElementById(element.id);
    if (existing) existing.replaceWith(element);
    else document.querySelector("#interface").insertAdjacentElement("afterbegin", element);
  }

  /* -------------------------------------------------- */

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);

    if (game.user.isGM || game.settings.get(MODULE, PLAYER_CLICKS)) {
      for (const element of this.element.querySelectorAll(".effect-icon")) {
        element.addEventListener("dblclick", VisualActiveEffects.#toggleEffect.bind(this));
      }
    }
  }

  /* -------------------------------------------------- */
  /*   Event handlers                                   */
  /* -------------------------------------------------- */

  /**
   * Delete an effect.
   * @this {VisualActiveEffects}
   * @param {PointerEvent} event    The initiating click event.
   * @param {HTMLElement} target    The capturing element that defined the [data-action].
   */
  static async #deleteEffect(event, target) {
    const alt = event.shiftKey;
    const effect = await fromUuid(target.closest("[data-effect-uuid]").dataset.effectUuid);
    if (alt && game.user.isGM) effect.delete();
    else effect.deleteDialog();
  }

  /* -------------------------------------------------- */

  /**
   * Toggle an effect.
   * @this {VisualActiveEffects}
   * @param {PointerEvent} event    The initiating double-click event.
   */
  static async #toggleEffect(event) {
    const alt = event.ctrlKey || event.metaKey;
    const effect = await fromUuid(event.currentTarget.closest("[data-effect-uuid]").dataset.effectUuid);
    if (alt) effect.sheet.render({ force: true });
    else effect.update({ disabled: !effect.disabled });
  }
}

// Hooks.on(`${MODULE}.createEffectButtons`, (effect, buttons) => {
//   buttons.push({
//     label: "Click me!",
//     callback: () => ui.notifications.info("CLICKED!"),
//   });
//   buttons.push({
//     label: "Click me!",
//     callback: () => ui.notifications.info("CLICKED!"),
//   });
//   buttons.push({
//     label: "Click me!",
//     callback: () => ui.notifications.info("CLICKED!"),
//   });
// });

/* -------------------------------------------------- */

Hooks.once("ready", () => {
  document.addEventListener("click", event => {
    const btn = event.target.closest("[data-action=customButton].vae-button");
    if (!btn) return;
    const id = btn.dataset.id;
    const button = ui.visualActiveEffects.buttons.find(b => b.id === id);
    if (button) button.callback(event);
  });
});
