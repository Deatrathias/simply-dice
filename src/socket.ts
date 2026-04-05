import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { RollParameters } from "dice-area"

export let socketName: string;

type SocketMessage = DoRollMessage;

type DoRollMessage = {
    type: "doRoll",
    data: RollParameters
}

export function initSocket() {
    socketName = `module.${MODULE.id}`;
    game.socket.on(socketName, onSocketMessage);
}

export function onSocketMessage(message: SocketMessage) {
    switch (message.type) {
        case "doRoll":
            game.simplyDice.diceArea?.enqueueRoll(message.data);
            break;
    }
}

export type { DoRollMessage }