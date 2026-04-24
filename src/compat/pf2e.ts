import { RollParameters } from "dice-area";

/**
 * PF2e uses a "showBreakdown" option to hide rolls from players
 */
Hooks.on("init", () => {
    if (game.system.id === "pf2e" || game.system.id === "sf2e") {
        Hooks.on("simplyDice.startRoll", (params, initiator, message, roll) => {
            if (initiator && roll instanceof foundry.dice.Roll) {
                if ((roll.options as any).showBreakdown === false)
                (params as RollParameters).visibility = {
                        users: game.users.filter(u => u.isGM).map(u => u.id),
                        blind: !game.user.isGM
                    };
            }
        });
    }
});