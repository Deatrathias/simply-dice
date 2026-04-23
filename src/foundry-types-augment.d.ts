/********
 * Fixing the declarations for foundry-types
 ********/

import "@7h3laughingman/foundry-types";
import { SoundPlaybackOptions } from "@7h3laughingman/foundry-types/client/audio/_types.mjs";
import { DataFieldOptions } from "@7h3laughingman/foundry-types/common/data/_module.mjs";
import { DiceArea } from "dice-area";
import { TextureManager } from "texture-manager";
import { UserDiceMaterials } from "dice-materials";
import { HookParameters } from "@7h3laughingman/foundry-types/client/helpers/hooks.mjs"

declare module "@7h3laughingman/foundry-types/client/_module.mjs" {
    interface Game {
        simplyDice: {
            diceArea?: DiceArea,
            textureManager?: TextureManager,
            userMaterials?: Map<string, UserDiceMaterials>
        }
    }
}

declare module "@7h3laughingman/foundry-types/client/dice/terms/_module.mjs" {
    interface DiceTerm {
        get denomination(): string;
    }
}

declare module "@7h3laughingman/foundry-types/client/audio/_module.mjs" {
    interface AudioHelper {
        play(src: string, options?: { context?: AudioContext } & SoundPlaybackOptions): Promise<Sound>;
    }
}

declare module "@7h3laughingman/foundry-types/client/documents/_module.mjs" {
    interface Setting {
        user: string;
    }
}

declare module "@7h3laughingman/foundry-types/common/utils/helpers.mjs" {
    /**
     * Deprecated in v14
     */
    function objectsEqual(a: unknown, b: unknown): boolean;
}