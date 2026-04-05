import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";

const diceSounds = ["sounds/dice-hit1.ogg", "sounds/dice-hit2.ogg", "sounds/dice-hit3.ogg", "sounds/dice-hit4.ogg"];

async function playSound(url: string) {
    game.audio.play(MODULE.relativePath(url), { context: game.audio.interface });
}

function playDiceSound() {
    const url = diceSounds[Math.floor(Math.random() * diceSounds.length)];
    playSound(url);
}

export { playSound, playDiceSound }