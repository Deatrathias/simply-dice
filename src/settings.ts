import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { DiceMaterialsConfigWindow } from "dice-config";
import { diceMaterialConfigSchema } from "dice-materials";
import * as WORKER from "physics-worker-handler";

const { NumberField, AlphaField } = foundry.data.fields;

export const SETTING = { 
    // World
    TIMESCALE: "timescale",
    TIME_UNTIL_DISAPPEARANCE: "timeUntilDisappearance",
    WAIT_FOR_ROLL: "waitForRoll",
    MAX_WAIT_TIME: "maxWaitTime",
    THROW_IMPULSE: "throwImpulse",
    // User
    DICE_MATERIALS: "diceMaterials",
    DISABLE_FOR_USER: "disableForUser",
    // Client
    MAX_FRAMERATE: "maxFramerate",
    DICE_SIZE: "diceSize",
    MAX_DICE_ON_SCREEN: "maxDiceOnScreen",
    SHADOWS: "shadows",
    SHADOW_MAP_RESOLUTION: "shadowMapResolution",
    IMMERSIVE_ENVIRONMENT: "immersiveEnvironment",
    ANTIALIASING: "antialiasing",
    DISPLAY_ON_TOP: "displayOnTop",
    SOUND_VOLUME: "soundVolume"
};

export function registerSettings() {
    registerSetting({ id: SETTING.TIMESCALE, type: new NumberField({ nullable: false, min: 1, max: 5, step: 0.1 }), default: 2, scope: "world",
        onChange: value => { 
            if (game.simplyDice.diceArea)
                game.simplyDice.diceArea.timescale = value as number; 
        } 
    });
    registerSetting({ id: SETTING.TIME_UNTIL_DISAPPEARANCE, type: new NumberField({ nullable: false, min: 0.1 }), default: 4, scope: "world" });
    registerSetting({ id: SETTING.WAIT_FOR_ROLL, type: Boolean, default: false, scope: "world" });
    registerSetting({ id: SETTING.MAX_WAIT_TIME, type: new NumberField({ nullable: false, min: 0 }), default: 4, scope: "world" });
    registerSetting({ id: SETTING.THROW_IMPULSE, type: new NumberField({ nullable: false, min: 0, max: 100 }), default: 5, scope: "world", 
        onChange: value => WORKER.updateSettings({ throwImpulse: value as number })});
    registerSetting({ id: SETTING.DISABLE_FOR_USER, type: Boolean, default: false, scope: "user" });
    registerSetting({ id: SETTING.MAX_FRAMERATE, type: new NumberField({ nullable: true, min: 0 }), default: 60, scope: "client",
        onChange: value => game.simplyDice.diceArea?.changeFramerateCap(value as number | null) });
    registerSetting({ id: SETTING.DICE_SIZE, type: new NumberField({ nullable: false, min: 0, max: 100, step: 1 }), default: 50, scope: "client", 
        onChange: value => game.simplyDice.diceArea?.changeSizeSetting(value as number)});
    registerSetting({ id: SETTING.MAX_DICE_ON_SCREEN, type: new NumberField({ nullable: true, min: 1 }), default: 30, scope: "client", 
        onChange: value => game.simplyDice.diceArea?.changeMaxDice(value as number)});
    registerSetting({ id: SETTING.SHADOWS, type: Boolean, default: true, scope: "client",
        onChange: value => game.simplyDice.diceArea?.changeShadows(value as boolean)});
    registerSetting({ id: SETTING.SHADOW_MAP_RESOLUTION, type: String, choices: { 512: "512x512", 1024: "1024x1024", 2048: "2048x2048", 4096: "4096x4096" }, default: 2048, scope: "client",
        onChange: value => game.simplyDice.diceArea?.changeShadowMap(parseInt(value as string)) });
    registerSetting({ id: SETTING.IMMERSIVE_ENVIRONMENT, type: Boolean, default: false, scope: "client",
        onChange: value => game.simplyDice.diceArea?.changeImmersiveEnvironment(value as boolean)});
    registerSetting({ id: SETTING.ANTIALIASING, type: Boolean, default: true, scope: "client", requiresReload: true });
    registerSetting({ id: SETTING.DISPLAY_ON_TOP, type: Boolean, default: false, scope: "client", 
        onChange: value => game.simplyDice.diceArea?.updateContainerStyle() });
    registerSetting({ id: SETTING.SOUND_VOLUME, type: new NumberField({ nullable: false, min: 0, max: 100, step: 1 }), default: 50, scope: "client" });

    game.settings.register(MODULE.id, SETTING.DICE_MATERIALS, { name: "SIMPLY-DICE.Settings.DiceMaterials", type: new foundry.data.fields.TypedObjectField(diceMaterialConfigSchema), default: {}, scope: "user", config: false});

    game.settings.registerMenu(MODULE.id, SETTING.DICE_MATERIALS, { 
        name: "SIMPLY-DICE.Settings.DiceMaterials", 
        hint: "SIMPLY-DICE.Settings.DiceMaterialsHint", 
        label: "SIMPLY-DICE.Settings.DiceMaterialsLabel",
        icon: "fa-solid fa-dice",
        type: DiceMaterialsConfigWindow });
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