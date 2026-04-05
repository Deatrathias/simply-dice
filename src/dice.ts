import { DiceModel } from "dice-definition.ts";
import * as THREE from "three";
import * as UTILS from "utils.ts";

type SimulationStep = {
    position: THREE.Vector3Like,
    rotation: THREE.QuaternionLike
}

type Simulation = {
    timestep: number,
    steps: SimulationStep[]
}

class DiceObject {
    id: number;

    rollId?: number;

    diceModel: DiceModel;

    graphics: THREE.Object3D;

    simulation?: Simulation;

    started: boolean;

    running: boolean;

    runStartTime?: number;

    replayStep: number = 0;

    lifetime: number;

    targetResult: number;

    rotationOffset: THREE.Quaternion;

    public get isAlive() : boolean {
        return this.lifetime > 0;
    }

    constructor(id: number, diceModel: DiceModel, materials: THREE.Material[], targetResult: number, rollId?: number) {
        this.id = id;
        this.rollId = rollId;
        this.running = false;
        this.started = false;
        this.targetResult = targetResult;
        this.diceModel = diceModel;
        this.graphics = diceModel.instantiateModel(materials);
        this.graphics.traverse(o => o.castShadow = true);
        this.lifetime = 4;
        this.rotationOffset = new THREE.Quaternion().identity();
    }

    rotationFaceValue(rotation: THREE.QuaternionLike): number | undefined {
        let closestValue: number | undefined = undefined;
        let closestDot = -Infinity;
        const valueRotation = new THREE.Quaternion();
        const diceUp = new THREE.Vector3();
        for (const rv of this.diceModel.rotationMap) {
            valueRotation.copy(rv[1]).invert();
            diceUp.set(0, 1, 0).applyQuaternion(valueRotation).applyQuaternion(rotation);

            const dot = diceUp.dot(UTILS.VectorUp);
            if (dot > closestDot) {
                closestDot = dot;
                closestValue = rv[0];
            }
        }

        return closestValue;
    }

    runSimulation(scene: THREE.Scene, time: number, timestep: number, posRot: Float32Array) {
        const steps: SimulationStep[] = [];

        const stepCount = Math.floor(posRot.length / 7);
        for (let i = 0; i < stepCount; i++) {
            const index = i * 7;
            steps.push({
                position: { x: posRot[index], y: posRot[index+1], z: posRot[index+2] },
                rotation: { x: posRot[index+3], y: posRot[index+4], z: posRot[index+5], w: posRot[index+6]}
            });
        }

        this.simulation = {
            timestep,
            steps
        };

        const currentFaceValue = this.rotationFaceValue(steps[this.simulation.steps.length - 1].rotation);

        if (currentFaceValue) {
            this.rotationOffset.copy(this.diceModel.getRotationForValue(currentFaceValue).invert().multiply(this.diceModel.getRotationForValue(this.targetResult)));
        }

        scene.add(this.graphics);
        this.started = true;
        this.running = true;
        this.runStartTime = time;
    }

    updateSimulationGraphics(time: number, deltaTime: number) {
        // Cases where the browser is offscreen
        if (deltaTime < 0)
            return;

        if (!this.started)
            return;

        if (!this.running)
            this.lifetime -= deltaTime;

        if (!this.isAlive)
            return;

        if (!this.simulation || !this.running || !this.runStartTime)
            return;

        const stepTime = (time - this.runStartTime) / this.simulation.timestep;
        const stepCount = Math.floor(stepTime);

        if (stepCount >= this.simulation.steps.length - 1) {
            const simStep = this.simulation.steps[this.simulation.steps.length - 1];
            this.graphics.position.copy(simStep.position);
            this.graphics.quaternion.copy(simStep.rotation).multiply(this.rotationOffset);
            this.clearSimulation();
        }
        else {
            const currentStep = this.simulation.steps[stepCount];
            const nextStep = this.simulation.steps[stepCount + 1];

            const ratio = stepTime - stepCount;
            this.graphics.position.copy(currentStep.position).lerp(nextStep.position, ratio);
            this.graphics.quaternion.copy(currentStep.rotation).slerp(new THREE.Quaternion().copy(nextStep.rotation), ratio).multiply(this.rotationOffset);
        }
    }

    clearSimulation() {
        this.simulation = undefined;
        this.running = false;
        this.runStartTime = undefined;
        if (this.rollId) {
            const promises = game.simplyDice.diceArea?.rollPromiseResolve;
            const resolve = promises?.get(this.rollId);

            if (resolve) {
                promises?.delete(this.rollId);
                resolve();
            }
        }
    }
}

export { DiceObject };