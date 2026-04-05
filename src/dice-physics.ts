import RAPIER from "@dimforge/rapier3d-compat";
import { DebugRenderMessage, DiceSimulation, PhysicsMessage, SimulationCompleteMessage, SimulationStartData } from "worker-types.js";
import { Quaternion } from "quaternion";

const diceObj: Map<string, RAPIER.ColliderDesc> = new Map();

self.onmessage = async (event) => {
    if (!event.data.type)
        return;

    const message: PhysicsMessage = event.data;

    switch (message.type) {
        case "loadObj":
            loadObj(message.data.url, message.data.denomination);
            break;
        case "init":
            physicsArea = await init();
            break;
        case "resizeArea":
            (await getPhysicsArea()).resizeArea(message.data.width, message.data.height);
            break;
        case "startSimulation":
            (await getPhysicsArea()).startSimulation(message.data);
            break;
        case "removeDice":
            (await getPhysicsArea()).removeDice(message.data.id);
            break;
    }
};

const vertexRegex = /^v\s+(-?[\d\.]+)\s+(-?[\d\.]+)\s+(-?[\d\.]+)$/gm;
const indicesRegex = /^f\s+([\d]+)\s+([\d]+)\s+([\d]+)$/gm;

async function loadObj(url: string, denominator: string) {
    const obj = await fetch(url);
    if (!obj.ok) {
        console.error(`Could not find OBJ file ${url}`);
        return;
    }
    const text = await obj.text();
    const vertexArray = new Float32Array([...text.matchAll(vertexRegex)].flat().filter(f => !f.includes("v")).map(f => parseFloat(f)));
    const indexArray = new Uint32Array([...text.matchAll(indicesRegex)].flat().filter(f => !f.includes("f")).map(f => parseInt(f) - 1));
    const colliderDesc = RAPIER.ColliderDesc.convexMesh(vertexArray, indexArray)?.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    if (!colliderDesc) {
        console.error(`Cannot create convex mesh from ${url}`);
        return;
    }

    diceObj.set(denominator, colliderDesc);
}

function addVectors(v1: RAPIER.Vector, v2: RAPIER.Vector): RAPIER.Vector {
    return { x: v1.x + v2.x, y: v1.y + v2.y, z: v1.z + v2.z };
}

function scaleVector(v: RAPIER.Vector, s: number): RAPIER.Vector {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function sqrMagnitude(v: RAPIER.Vector): number {
    return v.x * v.x + v.y * v.y + v.z * v.z;
}

const baseDuration = 8;
const maxDuration = 30;

class PhysicsArea {
    world: RAPIER.World;

    currentWidth: number = 0;

    currentHeight: number = 0;

    floor: RAPIER.Collider;

    walls: Record<string, RAPIER.Collider>;

    constructor() {
        this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

        this.floor = this.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 1, 30).setTranslation(0, -1, 0));

        this.walls = {
            right: this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 10, 30)),
            left: this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 10, 30)),
            back: this.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 10, 0.5)),
            front: this.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 10, 0.5))
        };

        // Bouncy walls
        Object.entries(this.walls).forEach(w => w[1].setRestitution(1));
    }

    resizeArea(width: number, height: number) {
        this.currentWidth = width;
        this.currentHeight = height;
        this.walls.right.setTranslation({ x: this.currentWidth / 2 + 0.5, y: 10, z: 0 });
        this.walls.left.setTranslation({ x: -this.currentWidth / 2 - 0.5, y: 10, z: 0 });
        this.walls.back.setTranslation({ x: 0, y: 10, z: this.currentHeight / 2 + 0.5 });
        this.walls.front.setTranslation({ x: 0, y: 10, z: -this.currentHeight / 2 - 0.5 });
        //this.debugRender();
    }

    getAreaIntersection(angle: number): { x: number, y: number } {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const distance = Math.min(cos !== 0 ? this.currentWidth / Math.abs(cos) : Infinity, 
            sin !== 0 ? this.currentHeight / Math.abs(sin) : Infinity) / 2;

        return { x: distance * cos, y: distance * sin };
    }

    debugRender() {
        const buffers = this.world.debugRender();
        self.postMessage({
            type: "debugRender", data: {
                vertices: buffers.vertices,
                colors: buffers.colors
            }
        } satisfies DebugRenderMessage, { transfer: [buffers.vertices.buffer, buffers.colors.buffer] });
    }

    startSimulation(simulationData: SimulationStartData) {
        let baseStepCount = Math.floor(baseDuration / this.world.timestep);
        let maxStepCount = Math.floor(maxDuration / this.world.timestep);

        const simulating = [];
        for (const roll of simulationData.rolls) {

            const rng = roll.randomNumbers;
            const angle = random(rng) * Math.PI * 2;
            const pointOnArea = this.getAreaIntersection(angle);
            const centerStartPoint = { x: pointOnArea.x, y: 5, z: pointOnArea.y };
            const toRotation = Quaternion.fromAxisAngle([0, 1, 0], -angle);

            let count = 0;
            for (const diceTerm of roll.diceTerms) {
                const obj = diceObj.get(diceTerm.denomination);
                if (!obj)
                    continue;

                const impulse = toRotation.rotateVector({ x: -20 - random(rng) * 10, y: -10, z: 0 }) as RAPIER.Vector;

                const offsetRotation = toRotation.mul(Quaternion.fromAxisAngle([0, 1, 0], ((count % 3) -1) * Math.PI / 6));
                const offsetVector = offsetRotation.rotateVector({ x: (-2 - Math.floor((count + 2) / 3)), y: 0, z: 0 }) as RAPIER.Vector;
                
                const startRotation = new Quaternion(random(rng) * 2 - 1, random(rng) * 2 - 1, random(rng) * 2 - 1, random(rng) * 2 - 1).normalize();
                const dice = new SimulatedDice(this, diceTerm.id, simulationData.startTime, baseStepCount, maxStepCount, obj, addVectors(centerStartPoint, offsetVector), startRotation);
                dice.rigidbody.applyImpulse(impulse, true);
                simulating.push(dice);
                count++;
            }
        }

        if (simulating.length == 0) {
            console.log("no dice!");
            return;
        }

        const replayingDices = simulatedDices.filter(d => d.replaySimulation(simulationData.startTime));

        const collisions = new Uint16Array(new ArrayBuffer(30 * Uint16Array.BYTES_PER_ELEMENT, { maxByteLength: 200 * Uint16Array.BYTES_PER_ELEMENT }));
        let collisionCount = 0;
        const eventQueue = new RAPIER.EventQueue(true);
        for (let i = 0; i < maxStepCount; i++) {
            this.world.step(eventQueue);
            eventQueue.drainCollisionEvents((handle1, handle2, started) => {
                if (started) {
                    if (collisionCount > collisions.length) {
                        if (collisions.buffer.byteLength < collisions.buffer.maxByteLength)
                            collisions.buffer.resize(Math.min((collisionCount + 30) * Uint16Array.BYTES_PER_ELEMENT, collisions.buffer.maxByteLength));
                        else
                            return;
                    }
                    collisions[collisionCount] = i;
                    collisionCount++;
                }
            });
            replayingDices.forEach(d => d.replaySimulationStep());
            simulating.forEach(d => d.recordStep());
            
            // If every body is sleeping, end the simulation early
            if (!simulating.find(d => !d.rigidbody.isSleeping() && d.inactiveSteps < 10)) {
                maxStepCount = i + 1;
                break;
            }
        }
        eventQueue.free();
        collisions.buffer.resize(collisionCount * Uint16Array.BYTES_PER_ELEMENT);

        simulating.forEach(d => d.endRecording(maxStepCount));

        const buffersToSend: ArrayBuffer[] = [];
        const simulations = simulating.map(d => {
            const copiedArray = new Float32Array(d.posRot);
            buffersToSend.push(copiedArray.buffer);
            return { id: d.id, posRot: copiedArray } satisfies DiceSimulation
        });
        buffersToSend.push(collisions.buffer);

        self.postMessage({
            type: "simulationComplete", data: {
                timestep: this.world.timestep,
                simulations,
                collisions
            }
        } satisfies SimulationCompleteMessage, { transfer: buffersToSend });

        simulatedDices.push(...simulating);
    }
    
    removeDice(id: number) {
        const diceIndex = simulatedDices.findIndex(d => d.id == id);

        if (diceIndex >= 0) {
            const dice = simulatedDices.splice(diceIndex, 1)[0];
            this.world.removeRigidBody(dice.rigidbody);
        }
    }
}

let physicsArea: PhysicsArea | null = null;

const physicsAreaResolvers: ((resolve: PhysicsArea | PromiseLike<PhysicsArea>) => void)[] = [];

async function init(): Promise<PhysicsArea> {
    await RAPIER.init();
    const result = new PhysicsArea();
    physicsAreaResolvers.forEach(resolve => resolve(result));
    physicsAreaResolvers.length = 0;
    return result;
}

async function getPhysicsArea(): Promise<PhysicsArea> {
    if (physicsArea)
        return physicsArea;
    return new Promise<PhysicsArea>((resolve) => physicsAreaResolvers.push(resolve));
}

class SimulatedDice {
    area: PhysicsArea;

    id: number;

    rigidbody: RAPIER.RigidBody;

    posRot: Float32Array;

    startTime: number;

    maxByteSize: number;

    currentStep: number;

    maxStep: number;

    inactiveSteps: number;

    static toByteSize(step: number): number { return step * 7 * Float32Array.BYTES_PER_ELEMENT; };

    constructor(area: PhysicsArea, id: number, startTime: number, baseStepCount: number, maxStepCount: number, collider: RAPIER.ColliderDesc, position: RAPIER.Vector3, rotation: RAPIER.Quaternion) {
        this.area = area;
        this.id = id;
        this.rigidbody = area.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z).setRotation(rotation));
        area.world.createCollider(collider, this.rigidbody);
        this.maxByteSize = SimulatedDice.toByteSize(maxStepCount);
        this.posRot = new Float32Array(new ArrayBuffer(SimulatedDice.toByteSize(baseStepCount), { maxByteLength: this.maxByteSize }));
        this.startTime = startTime;
        this.currentStep = 0;
        this.maxStep = 0;
        this.inactiveSteps = 0;
    }

    /**
     * Record one step of the simulation
     */
    recordStep() {
        const position = this.rigidbody.translation();
        const rotation = this.rigidbody.rotation();
        const stepIndex = this.currentStep * 7;

        if (stepIndex >= this.posRot.length) {
            // If buffer is full, expand it by another 60 step
            (this.posRot.buffer as ArrayBuffer).resize(Math.min(this.maxByteSize, SimulatedDice.toByteSize(this.currentStep + 60)));

            if (this.posRot.buffer.byteLength == this.posRot.buffer.maxByteLength) {
                console.log("max reached");
            }
        }

        if (sqrMagnitude(this.rigidbody.linvel()) < 0.0001 && sqrMagnitude(this.rigidbody.angvel()) < 0.0001)
            this.inactiveSteps++;
        else
            this.inactiveSteps = 0;

        this.posRot[stepIndex] = position.x;
        this.posRot[stepIndex + 1] = position.y;
        this.posRot[stepIndex + 2] = position.z;

        this.posRot[stepIndex + 3] = rotation.x;
        this.posRot[stepIndex + 4] = rotation.y;
        this.posRot[stepIndex + 5] = rotation.z;
        this.posRot[stepIndex + 6] = rotation.w;

        this.currentStep++;
    }

    /**
     * Specific that the simulation recording has ended and the dice can now be kinematic
     * @param maxStep The number of total steps in this simulation
     */
    endRecording(maxStep: number) {
        this.maxStep = maxStep;
        (this.posRot.buffer as ArrayBuffer).resize(SimulatedDice.toByteSize(maxStep));
        this.rigidbody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
    }

    /**
     * Replay a simulation as a kinematic body
     * @param time The current time
     * @returns Whether or not the simulation should be replayed
     */
    replaySimulation(time: number): boolean {
        this.currentStep = Math.floor((time - this.startTime) / this.area.world.timestep)

        if (this.currentStep >= this.maxStep) 
            return false;

        const stepIndex = this.currentStep * 7;
        this.rigidbody.setTranslation({
            x: this.posRot[stepIndex],
            y: this.posRot[stepIndex + 1],
            z: this.posRot[stepIndex + 2]
        }, true);

        this.rigidbody.setRotation({
            x: this.posRot[stepIndex + 3],
            y: this.posRot[stepIndex + 4],
            z: this.posRot[stepIndex + 5],
            w: this.posRot[stepIndex + 6]
        }, true);

        return true;
    }

    /**
     * Advance a step of the replay
     */
    replaySimulationStep() {
        if (this.currentStep >= this.maxStep)
            return;

        const stepIndex = this.currentStep * 7;

        this.rigidbody.setNextKinematicTranslation({
            x: this.posRot[stepIndex],
            y: this.posRot[stepIndex + 1],
            z: this.posRot[stepIndex + 2]
        });

        this.rigidbody.setNextKinematicRotation({
            x: this.posRot[stepIndex + 3],
            y: this.posRot[stepIndex + 4],
            z: this.posRot[stepIndex + 5],
            w: this.posRot[stepIndex + 6]
        });

        this.currentStep++;
    }
}

const simulatedDices: SimulatedDice[] = [];

function random(rng: number[]): number {
    const result = rng.pop();
    if (!result)
        throw new Error("ran out of rng");
    return result;
}