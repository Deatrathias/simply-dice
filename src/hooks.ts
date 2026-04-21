import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { DatabaseUpdateOperation } from "@7h3laughingman/foundry-types/common/abstract/_module.mjs";
import { ChatMessageCreateOperation } from "@7h3laughingman/foundry-types/common/documents/chat-message.mjs";
import BaseUser from "@7h3laughingman/foundry-types/common/documents/user.mjs";
import { initDiceArea } from "dice-area.ts";
import { loadPresets } from "dice-config";
import { loadDefinitions } from "dice-definition.ts";
import { DiceMaterialConfigGroup, UserDiceMaterials } from "dice-materials";
import * as WORKER from "physics-worker-handler.ts";
import { registerSettings, SETTING } from "settings";
import { initSocket } from "socket";
import { initTextureManager } from "texture-manager";

export const debugging = false;
const libWrapper = (globalThis as any).libWrapper;

Hooks.on("init", () => {
    registerSettings();
    initSocket();
    WORKER.startWorker();
    loadDefinitions();
    loadPresets();

    libWrapper.register(MODULE.id, "ChatMessage._preCreateOperation", preCreateMessage);
});

async function preCreateMessage(wrapped: (document: ChatMessage[], operation: ChatMessageCreateOperation, user: BaseUser) => Promise<void>, document: ChatMessage[], operation: ChatMessageCreateOperation, user: BaseUser) {
    
    if (game.simplyDice.diceArea) {
        const rolls: Roll[] = [];
        rolls.push(...document.flatMap(m => m.rolls));

        const promises = [];
        for (const message of document) {
            if (message.rolls) {
                promises.push(...message.rolls.map(r => game.simplyDice.diceArea!.triggerRoll(r, message)));
            }
        }

        if (promises.length > 0) {
            const rolled = await Promise.all(promises);
            if (rolled.find(b => b)) {
                document.forEach(m => m.updateSource({"-=sound": null}));
            }
        }
    }
    
    return await wrapped(document, operation, user);
}

Hooks.on("setup", () => {
    initTextureManager();
});

Hooks.on("ready", () => {
    UserDiceMaterials.initMaterialsForAllUsers();
    WORKER.initPhysicsWorld();
    initDiceArea();
    if (!game.simplyDice.diceArea)
        return;

    window.addEventListener("resize", () => game.simplyDice.diceArea?.resizeArea());

    document.body.appendChild(game.simplyDice.diceArea.generateContainer());

    if (debugging) {
        const debugWindow = new foundry.applications.api.DialogV2({
            buttons: [{ action: "close", label: "Close" }],
            content: `<div class="form-group"><input type="number" name="x" value="0" /><input type="number" name="y" value="0" /><input type="number" name="z" value="0" />
            </div><button type="button" data-action="rotate">Rotate</button><button type="button" data-action="reset">Reset</button><input type="range" name="fov" min="10" max="180" value="40" />
            <label>Dir light</label><input type="range" name="dirLight" min="0" max="10" value="1" step="0.1" /><label>Hemi light</label><input type="range" name="hemiLight" min="0" max="18" value="1" step="0.1" />`,
            actions: {
                "rotate": (event, target) => {
                    const form = (target as HTMLButtonElement).form;
                    if (!form)
                        return;
                    game.simplyDice.diceArea?.debugWindowRotation(form["x"].value, form["y"].value, form["z"].value);
                    },
                "reset": () => game.simplyDice.diceArea?.debugWindowReset()
            }
        });
        debugWindow.render(true).then(() => {
            const inputs = [...debugWindow.element.getElementsByTagName("input")];
            inputs.find(i => i.name === "fov")?.addEventListener("input", (event) => { 
                const slider = event.target as HTMLInputElement;
                game.simplyDice.diceArea?.changeHeight(parseInt(slider.value));
            });
            inputs.find(i => i.name === "dirLight")?.addEventListener("input", (event) => {
                game.simplyDice.diceArea!.dirLight.intensity = parseFloat((event.target as HTMLInputElement).value);
            });
            inputs.find(i => i.name === "hemiLight")?.addEventListener("input", (event) => {
                game.simplyDice.diceArea!.hemiLight.intensity = parseFloat((event.target as HTMLInputElement).value);
            });
        });
    }
});

Hooks.on("updateSetting", (setting: Setting, changed: object, options: Partial<DatabaseUpdateOperation<Setting>>, userId: string) => {
    if (setting.key !== `${MODULE.id}.${SETTING.DICE_MATERIALS}` || !setting.user)
        return;

    game.simplyDice.userMaterials?.get(setting.user)?.updateMaterials((setting.value ?? undefined) as DiceMaterialConfigGroup | undefined);
});

Hooks.on("updateUser", (user: User, changed) => {
    if (changed.color)
        game.simplyDice.userMaterials?.get(user.id)?.updateMaterials();
});