import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { EvaluateRollParams, Rolled } from "@7h3laughingman/foundry-types/client/dice/_module.mjs";
import { ChatMessageCreateOperation } from "@7h3laughingman/foundry-types/common/documents/chat-message.mjs";
import { initDiceArea } from "dice-area.ts";
import { loadDefinitions } from "dice-definition.ts";
import * as WORKER from "physics-worker-handler.ts";
import { initSocket } from "socket";

export const debugging = false;

Hooks.on("init", () => {
    initSocket();
    WORKER.startWorker();
    loadDefinitions();

    const libWrapper = (globalThis as any).libWrapper;
    libWrapper.register(MODULE.id, "foundry.dice.Roll.prototype._evaluate", async (wrapped: (args?: EvaluateRollParams) => Promise<Rolled<Roll>>, options?: EvaluateRollParams) => {
        const result = await wrapped(options);
        if (game.simplyDice.diceArea?.can3dRoll(result)) {
            const promise = game.simplyDice.diceArea?.rollAndWait(result.dice);
            await promise;
            result.options["simplyDice-noSound"] = true;
        }
        return result;
    });
});

Hooks.on("ready", async () => {
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
            </div><button type="button" data-action="rotate">Rotate</button><button type="button" data-action="reset">Reset</button><input type="range" name="fov" min="10" max="180" value="40" />`,
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
        await debugWindow.render(true);
        [...debugWindow.element.getElementsByTagName("input")].find(i => i.name === "fov")?.addEventListener("input", (event) => { 
            const slider = event.target as HTMLInputElement;
            game.simplyDice.diceArea?.changeHeight(parseInt(slider.value));
        });
    }
});

Hooks.on("preCreateChatMessage", (message: ChatMessage, data: object, options: Partial<ChatMessageCreateOperation>, userId: string) => {
    if (message.rolls?.length > 0 && message.sound) {
        if (message.rolls.find(r => r.options["simplyDice-noSound"] === true)) {
            message.updateSource({
                "-=sound": null
            });
        }
    }
});