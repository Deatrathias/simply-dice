import { getSetting } from "@7h3laughingman/foundry-helpers/utilities";
import { SETTING } from "settings";
import { MainMessage, PhysicsMessage, PhysicsSettings, SimulationStartData } from "worker-types.js";

let physicsWorker: Worker | undefined = undefined;

/**
 * Start the physics worker
 */
function startWorker() {
    physicsWorker = new Worker(new URL("./dice-physics.ts", import.meta.url), { type: "module" });

    physicsWorker.onmessage = handleMessage;
}

function send(message: PhysicsMessage) {
    physicsWorker?.postMessage(message);
}

/**
 * Handle messages received by the physics worker
 * @param event Message event
 */
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

/**
 * Load an OBJ file to be used as a collider by the physics worker
 * @param denomination Denomination of the dice
 * @param url URL of the OBJ file
 */
function loadObj(denomination: string, url: string) {
    send({
        type: "loadObj",
        data: {
            url,
            denomination
        }});
}

/**
 * Create a collider based on a specific shape
 * @param denomination Dice denomination
 * @param shape Collider shape
 * @param args Arguments to pass to the shape creation
 */
function defineColliderShape(denomination: string, shape: string, ...args: number[]) {
    send({
        type: "defineColliderShape",
        data: {
            denomination,
            shape,
            args
        }
    });
}

/**
 * Initialize physics
 */
function initPhysicsWorld() {
    send({ type: "init", data: {
        throwImpulse: getSetting(SETTING.THROW_IMPULSE)
    } });
}

/**
 * Resize the physics area
 * @param width 
 * @param height 
 */
function resizeArea(width: number, height: number) {
    send({
        type: "resizeArea",
        data: {
            width,
            height
        }
    });
}

/**
 * Update the physics worker when settings are changed
 * @param settings Changed settings
 */
function updateSettings(settings: PhysicsSettings) {
    send({
        type: "updateSettings",
        data: settings
    });
}

/**
 * Run a physics roll simulation
 * @param simulationData Data to send for the simulation
 */
function startSimulation(simulationData: SimulationStartData) {
    send({
        type: "startSimulation",
        data: simulationData
    });
}

/**
 * Remove a dice from the physics area
 * @param id Id of the dice
 */
function removeDice(id: number) {
    send({
        type: "removeDice",
        data: { id: id }
    });
}

export { startWorker, loadObj, defineColliderShape, initPhysicsWorld, resizeArea, updateSettings, startSimulation, removeDice }