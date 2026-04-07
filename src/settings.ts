import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import * as WORKER from "physics-worker-handler";

export const SETTING = { 
    // World
    TIMESCALE: "timescale",
    TIME_UNTIL_DISAPPEARANCE: "timeUntilDisappearance",
    WAIT_FOR_ROLL: "waitForRoll",
    MAX_WAIT_TIME: "maxWaitTime",
    THROW_IMPULSE: "throwImpulse",
    // User
    DISABLE_FOR_USER: "disableForUser",
    // Client
    DICE_SIZE: "diceSize",
    MAX_DICE_ON_SCREEN: "maxDiceOnScreen",
    SHADOWS: "shadows",
    SHADOW_MAP_RESOLUTION: "shadowMapResolution",
    IMMERSIVE_ENVIRONMENT: "immersiveEnvironment",
    ANTIALIASING: "antialiasing",
    DISPLAY_ON_TOP: "displayOnTop",
    SOUNDS: "sounds"
};

export function registerSettings() {
    registerSetting({ id: SETTING.TIMESCALE, type: new foundry.data.fields.NumberField({ nullable: false, min: 1, max: 5, step: 0.1 }), default: 2, scope: "world",
        onChange: value => { 
            if (game.simplyDice.diceArea)
                game.simplyDice.diceArea.timescale = value as number; 
        } 
    });
    registerSetting({ id: SETTING.TIME_UNTIL_DISAPPEARANCE, type: new foundry.data.fields.NumberField({ nullable: false, min: 0.1 }), default: 4, scope: "world" });
    registerSetting({ id: SETTING.WAIT_FOR_ROLL, type: Boolean, default: false, scope: "world" });
    registerSetting({ id: SETTING.MAX_WAIT_TIME, type: new foundry.data.fields.NumberField({ nullable: false, min: 0 }), default: 4, scope: "world" });
    registerSetting({ id: SETTING.THROW_IMPULSE, type: new foundry.data.fields.NumberField({ nullable: false, min: 0, max: 100 }), default: 20, scope: "world", 
        onChange: value => WORKER.updateSettings({ throwImpulse: value as number })});
    registerSetting({ id: SETTING.DISABLE_FOR_USER, type: Boolean, default: false, scope: "user" });
    registerSetting({ id: SETTING.DICE_SIZE, type: new foundry.data.fields.NumberField({ nullable: false, min: 0, max: 100, step: 1 }), default: 75, scope: "client", 
        onChange: value => game.simplyDice.diceArea?.changeSizeSetting(value as number)});
    registerSetting({ id: SETTING.MAX_DICE_ON_SCREEN, type: new foundry.data.fields.NumberField({ nullable: true, min: 1 }), default: 30, scope: "client", 
        onChange: value => game.simplyDice.diceArea?.changeMaxDice(value as number)});
    registerSetting({ id: SETTING.SHADOWS, type: Boolean, default: true, scope: "client",
        onChange: value => game.simplyDice.diceArea?.changeShadows(value as boolean)});
    registerSetting({ id: SETTING.SHADOW_MAP_RESOLUTION, type: String, choices: { 512: "512x512", 1024: "1024x1024", 2048: "2048x2048", 4096: "4096x4096" }, default: 2048, scope: "client",
        onChange: value => game.simplyDice.diceArea?.changeShadowMap(parseInt(value as string)) });
    registerSetting({ id: SETTING.IMMERSIVE_ENVIRONMENT, type: Boolean, default: true, scope: "client",
        onChange: value => game.simplyDice.diceArea?.changeImmersiveEnvironment(value as boolean)});
    registerSetting({ id: SETTING.ANTIALIASING, type: Boolean, default: true, scope: "client", requiresReload: true });
    registerSetting({ id: SETTING.DISPLAY_ON_TOP, type: Boolean, default: false, scope: "client", 
        onChange: value => game.simplyDice.diceArea?.updateContainerStyle() });
    registerSetting({ id: SETTING.SOUNDS, type: Boolean, default: true, scope: "client" });
}

function registerSetting(setting: { id: string, type: any, default: any, choices?: Record<string, unknown>, scope: "world" | "user" | "client", onChange?: (choice: unknown) => void | Promise<void>, requiresReload?: boolean}) {
    const capital = setting.id.capitalize();

    game.settings.register(MODULE.id, setting.id, {
        name: `SIMPLY-DICE.Settings.${capital}`,
        hint: `SIMPLY-DICE.Settings.${capital}Hint`,
        type: setting.type,
        default: setting.default,
        scope: setting.scope,
        config: true,
        choices: setting.choices,
        onChange: setting.onChange,
        requiresReload: setting.requiresReload
    });
}