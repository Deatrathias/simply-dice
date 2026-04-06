import { getSetting } from "@7h3laughingman/foundry-helpers/utilities";
import { SETTING } from "settings";
import { MainMessage, PhysicsMessage, PhysicsSettings, SimulationStartData } from "worker-types.js";

let physicsWorker: Worker | undefined = undefined;

function startWorker() {
    physicsWorker = new Worker(new URL("./dice-physics.ts", import.meta.url), { type: "module" });

    physicsWorker.onmessage = handleMessage;
}

function send(message: PhysicsMessage) {
    physicsWorker?.postMessage(message);
}

function handleMessage(event: MessageEvent) {
    const message: MainMessage = event.data;

    switch (message.type) {
        case "debugRender":
            game.simplyDice.diceArea?.renderDebugLines(message.data);
            break;
        case "simulationComplete":
            game.simplyDice.diceArea?.receiveSimulationDate(message.data);
            break;
    }
}

function loadObj(denomination: string, url: string) {
    send({
        type: "loadObj",
        data: {
            url,
            denomination
        }});
}

function initPhysicsWorld() {
    send({ type: "init", data: {
        throwImpulse: getSetting(SETTING.THROW_IMPULSE)
    } });
}

function resizeArea(width: number, height: number) {
    send({
        type: "resizeArea",
        data: {
            width,
            height
        }
    });
}

function updateSettings(settings: PhysicsSettings) {
    send({
        type: "updateSettings",
        data: settings
    });
}

function startSimulation(simulationData: SimulationStartData) {
    send({
        type: "startSimulation",
        data: simulationData
    });
}

function removeDice(id: number) {
    send({
        type: "removeDice",
        data: { id: id }
    });
}

export { startWorker, loadObj, initPhysicsWorld, resizeArea, updateSettings, startSimulation, removeDice }