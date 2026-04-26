import { getSetting, MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { BaseUser } from "@7h3laughingman/foundry-types/client/documents/_module.mjs";
import { ChatMessageCreateOperation } from "@7h3laughingman/foundry-types/client/documents/chat-message.mjs";
import { initDiceArea } from "dice-area.ts";
import { loadPresets } from "dice-config";
import { loadDefinitions } from "dice-definition.ts";
import { DiceMaterialConfigGroup, UserDiceMaterials } from "dice-materials";
import * as WORKER from "physics-worker-handler.ts";
import { registerSettings, SETTING } from "settings";
import { initSocket } from "socket";
import { initTextureManager } from "texture-manager";

declare namespace globalThis {
    class libWrapper {
        static register<TArgs extends unknown[], TResult>(package_id: string, target: string, fn: (wrapped: (...args: TArgs) => TResult, ...args: TArgs) => TResult): void;
    }
}

Hooks.on("init", () => {
    registerSettings();
    initSocket();
    WORKER.startWorker();
    loadDefinitions();
    loadPresets();

    if (globalThis.libWrapper)
        globalThis.libWrapper.register(MODULE.id, "ChatMessage._preCreateOperation", preCreateMessage);
    else
        Hooks.on("preCreateChatMessage", (message) => onPreCreateSynced(message as ChatMessage));
});

async function preCreateMessage(wrapped: (document: ChatMessage[], operation: ChatMessageCreateOperation, user: BaseUser) => Promise<void>, document: ChatMessage[], operation: ChatMessageCreateOperation, user: BaseUser) {
    
    if (getSetting<boolean>(SETTING.WAIT_FOR_ROLL))
        await onPreCreate(...document);
    else
        onPreCreateSynced(...document);
    
    return await wrapped(document, operation, user);
}

async function onPreCreate(...document: ChatMessage[]) {
    if (!game.simplyDice.diceArea) 
        return;

    const rolls: Roll[] = [];
    rolls.push(...document.flatMap(m => m.rolls));

    const promises = [];
    for (const message of document) {
        if (message.rolls) {
            promises.push(...message.rolls.map(r => game.simplyDice.diceArea!.startRoll(r, message)));
        }
    }

    if (promises.length > 0) {
        const rolled = await Promise.all(promises);
        if (rolled.find(b => b)) {
            document.forEach(m => m.updateSource( foundry.utils.isNewerVersion(game.version, "14") ? { sound: new foundry.data.operators.ForcedDeletion() } : {"-=sound": null}));
        }
    }
}

function onPreCreateSynced(...document: ChatMessage[]) {
    if (!game.simplyDice.diceArea)
        return;

    const rolls: Roll[] = [];
    rolls.push(...document.flatMap(m => m.rolls));

    for (const message of document) {
        if (message.rolls) {
            const rolled = message.rolls.reduce((accumulator, roll) => game.simplyDice.diceArea!.startRollSynced(roll, message) || accumulator, false);
            if (rolled)
                document.forEach(m => m.updateSource( foundry.utils.isNewerVersion(game.version, "14") ? { sound: new foundry.data.operators.ForcedDeletion() } : {"-=sound": null}));
        }
    }
}

Hooks.on("setup", () => {
    initTextureManager();
    UserDiceMaterials.initMaterialsForAllUsers();
});

Hooks.on("ready", () => {
    WORKER.initPhysicsWorld();
    initDiceArea();
    if (!game.simplyDice.diceArea)
        return;

    window.addEventListener("resize", () => game.simplyDice.diceArea?.resizeArea());

    document.body.appendChild(game.simplyDice.diceArea.generateContainer());
});

Hooks.on("updateSetting", ((setting: Setting) => {
    if (setting.key !== `${MODULE.id}.${SETTING.DICE_MATERIALS}` || !setting.user)
        return;

    game.simplyDice.userMaterials?.get(setting.user)?.updateMaterials((setting.value ?? undefined) as DiceMaterialConfigGroup | undefined);
}) as ((setting: unknown) => void));

Hooks.on("updateUser", ((user: User, changed: Record<string, any>) => {
    if (changed.color)
        game.simplyDice.userMaterials?.get(user.id)?.updateMaterials();
}) as (...args: unknown[]) => void);

import "compat/index";