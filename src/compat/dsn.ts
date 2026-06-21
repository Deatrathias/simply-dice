import { ChatSpeakerData } from "@7h3laughingman/foundry-types/common/documents/chat-message.mjs";

Hooks.on("ready", () => {
    game.dice3d = new Dice3D();
});

class Dice3D {
    async showForRoll(roll: Roll, user: User = game.user, synchronize: boolean, users: Array<User | string> | null = null, blind: boolean, messageID: string | null = null, speaker: ChatSpeakerData | null = null, options: { ghost: boolean, secret: boolean } = { ghost: false, secret:false }): Promise<boolean> {
        if (!game.simplyDice.diceArea?.can3dRoll(roll))
            return false;

        const speakerActor = speaker?.actor ? (await globalThis.fromUuid<Actor>(speaker.actor)) ?? undefined : undefined;
        const whisper = users ? users.map(u => typeof u === "string" ? u : u.id) : undefined;
        await game.simplyDice.diceArea.rollAndWait(roll, synchronize, {
            speakerActor,
            whisper,
            blind
        });
        return true;
    }
}