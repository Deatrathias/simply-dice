import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { DiceArea } from "dice-area.ts";
import { registerDefinition } from "dice-definition.ts";
import { TextureManager } from "texture-manager";
import { UserDiceMaterials } from "dice-materials";
import "hooks.ts";

declare module "@7h3laughingman/foundry-types/client/_module.mjs" {
    interface Game<
        TActor extends Actor<null>,
        TActors extends foundry.documents.collections.Actors<TActor>,
        TChatMessage extends ChatMessage,
        TCombat extends Combat,
        TItem extends Item<null>,
        TMacro extends Macro,
        TScene extends Scene,
        TUser extends User> {
        simplyDice: {
            diceArea?: DiceArea,
            textureManager?: TextureManager,
            userMaterials?: Map<string, UserDiceMaterials>
        }
    }
}

MODULE.register("simply-dice");

export { registerDefinition };