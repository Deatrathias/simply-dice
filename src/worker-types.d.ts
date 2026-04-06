export type PhysicsMessage = LoadObjMessage | InitMessage | ResizeAreaMessage | UpdateSettingsMessage | SimulationStartMessage | RemoveDiceMessage;

export type LoadObjMessage = {
    type: "loadObj",
    data: LoadObjMessageDate
}

export type LoadObjMessageDate = {
    url: string,
    denomination: string
}

export type InitMessage = {
    type: "init",
    data: PhysicsSettings
}

export type ResizeAreaMessage = {
    type: "resizeArea";
    data: { 
        width: number,
        height: number
    }
}

export type UpdateSettingsMessage = {
    type: "updateSettings";
    data: PhysicsSettings
}

export type PhysicsSettings = {
    throwImpulse?: number
}

export type SimulationStartMessage = {
    type: "startSimulation",
    data: SimulationStartData
}

export type SimulationStartData = {
    startTime: number,
    rolls: SimulationRoll[]
}

export type SimulationRoll = {
    randomNumbers: number[],
    diceTerms: SimulationDiceTerm[]
}

export type SimulationDiceTerm = {
    id: number,
    denomination: string
}

export type RemoveDiceMessage = {
    type: "removeDice",
    data: { id: number }
}

export type MainMessage = DebugRenderMessage | SimulationCompleteMessage;

export type DebugRenderMessage = {
    type: "debugRender",
    data: { 
        vertices: Float32Array,
        colors: Float32Array
     }
}

export type SimulationCompleteMessage = {
    type: "simulationComplete",
    data: SimulationCompleteData
}

export type DiceSimulation = {
    id: number,
    posRot: Float32Array,
}

type SimulationCompleteData = {
    timestep: number,
    simulations: Array<DiceSimulation>,
    collisions: Uint16Array
}