import { getSetting, MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { SETTING } from "settings";

const diceSounds = ["sounds/dice-hit1.ogg", "sounds/dice-hit2.ogg", "sounds/dice-hit3.ogg", "sounds/dice-hit4.ogg"];

let currentSound: foundry.audio.Sound | null = null;

async function playSound(url: string, volume: number) {
    if (currentSound && currentSound.playing) {
        if (currentSound.volume && currentSound.volume > 0)
            return;

        currentSound.stop();
    }
    currentSound = await game.audio.play(MODULE.relativePath(url), { context: game.audio.interface, volume: volume, loop: false });
}

function playDiceSound(volume: number) {
    const configVolume = getSetting<number>(SETTING.SOUND_VOLUME) / 100;
    if (volume === 0)
        return;
    const url = diceSounds[Math.floor(Math.random() * diceSounds.length)];
    playSound(url, volume * configVolume);
}

export { playSound, playDiceSound }