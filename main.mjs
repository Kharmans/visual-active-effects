import { registerAPI } from "./scripts/helpers.mjs";
import { registerSettings } from "./scripts/settings.mjs";
import VisualActiveEffects from "./scripts/visual-active-effects.mjs";
import SettingsMenu from "./scripts/settings-menu.mjs";

foundry.helpers.Hooks.once("init", () => {
  registerSettings();
  CONFIG.ui.visualActiveEffects = VisualActiveEffects;
});

foundry.helpers.Hooks.once("ready", function() {
  registerAPI();
  SettingsMenu.applyDefaults();
  ui.visualActiveEffects.render({ force: true });
});

foundry.helpers.Hooks.on("updateWorldTime", () => ui.visualActiveEffects.render());
foundry.helpers.Hooks.on("controlToken", () => ui.visualActiveEffects.render());

/* -------------------------------------------------- */

for (const prefix of ["create", "update", "delete"]) {
  for (const documentName of ["ActiveEffect", "Item"]) {
    foundry.helpers.Hooks.on(`${prefix}${documentName}`, function(document) {
      let actor;
      switch (document.documentName) {
        case "Item":
          actor = document.parent;
          break;
        case "ActiveEffect":
          actor = document.parent;
          if (actor?.documentName === "Item") actor = actor.parent;
          break;
      }
      if (actor && (actor.uuid === ui.visualActiveEffects.actor?.uuid)) {
        ui.visualActiveEffects.render();
      }
    });
  }
}

/* -------------------------------------------------- */

foundry.helpers.Hooks.on("updateCombat", function(combat, update, context) {
  if (!context.direction) return;
  ui.visualActiveEffects.render();
});
