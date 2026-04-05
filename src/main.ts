import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import moduleJson from "../static/module.json" with { type: "json" };
import { DiceArea } from "dice-area.ts";
import { registerDefinition } from "dice-definition.ts";
import { collections } from "@7h3laughingman/foundry-types/client/documents/_module.mjs";
import "hooks.ts";

declare module "@7h3laughingman/foundry-types/client/_module.mjs" {
    interface Game<
        TActor extends Actor<null>,
        TActors extends collections.Actors<TActor>,
        TChatMessage extends ChatMessage,
        TCombat extends Combat,
        TItem extends Item<null>,
        TMacro extends Macro,
        TScene extends Scene,
        TUser extends User> {
        simplyDice: {
            diceArea?: DiceArea
        }
    }
}

MODULE.register(moduleJson.id);

export { registerDefinition };