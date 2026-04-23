import { getSetting } from "@7h3laughingman/foundry-helpers/utilities";
import { DiceModel } from "dice-definition.ts";
import { DiceMaterialSet } from "dice-materials";
import { SETTING } from "settings";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import * as UTILS from "utils.ts";

type SimulationStep = {
    position: THREE.Vector3Like,
    rotation: THREE.QuaternionLike
}

type Simulation = {
    timestep: number,
    steps: SimulationStep[]
}

/**
 * Representation of a 3D dice object
 */
class DiceObject {
    id: number;

    rollId?: number;

    userId: string;

    diceModel: DiceModel;

    graphics: THREE.Object3D;

    simulation?: Simulation;

    secret: boolean;

    started: boolean;

    running: boolean;

    runStartTime?: number;

    replayStep: number = 0;

    lifetime: number;

    maxLifetime: number;

    targetResult?: number;

    rotationOffset: THREE.Quaternion;

    disappearingDuration: number;

    isDisappearing: boolean;

    tempMaterials: THREE.Material[] = [];

    public get isAlive() : boolean {
        return this.lifetime > 0;
    }

    constructor(id: number, userId: string, diceModel: DiceModel, materials: DiceMaterialSet, targetResult?: number, rollId?: number, isSecret?: boolean) {
        this.id = id;
        this.userId = userId;
        this.rollId = rollId;
        this.running = false;
        this.started = false;
        this.targetResult = targetResult;
        this.diceModel = diceModel;
        this.secret = isSecret ?? false;
        this.graphics = diceModel.instantiateModel(materials, isSecret);
        this.graphics.traverse(o => o.castShadow = true);
        this.maxLifetime = getSetting(SETTING.TIME_UNTIL_DISAPPEARANCE);
        this.lifetime = this.maxLifetime;
        this.rotationOffset = new THREE.Quaternion().identity();
        this.disappearingDuration = 1;
        this.isDisappearing = false;
        this.graphics.userData = { disappear: 0 };
    }

    /**
     * Get the value that the dice is facing based on the rotation
     * @param rotation Rotation of the dice
     * @returns Value of the dice, or undefined if no result
     */
    rotationFaceValue(rotation: THREE.QuaternionLike): THREE.Quaternion | undefined {
        let closestValue: THREE.Quaternion | undefined = undefined;
        let closestDot = -Infinity;
        const valueRotation = new THREE.Quaternion();
        const diceUp = new THREE.Vector3();
        for (const rv of this.diceModel.rotationMap) {
            const sub = Array.isArray(rv[1]) ? rv[1] : [rv[1]];
            for (const rot of sub) {
                valueRotation.copy(rot).invert();
                diceUp.set(0, 1, 0).applyQuaternion(valueRotation).applyQuaternion(rotation);

                const dot = diceUp.dot(UTILS.VectorUp);
                if (dot > closestDot) {
                    closestDot = dot;
                    closestValue = rot;
                }
            }
        }

        return valueRotation.copy(closestValue ?? UTILS.QuaternionIdentity);
    }

    /**
     * Prepare the dice to run the calculated simulation
     * @param scene THREE scene
     * @param time The current frame time
     * @param timestep The timestep of the physics simulation
     * @param posRot Array containing positions and rotations
     */
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

        if (!this.secret && this.targetResult !== undefined) {
            const currentFaceValue = this.rotationFaceValue(steps[this.simulation.steps.length - 1].rotation);

            if (currentFaceValue !== undefined)
                this.rotationOffset.copy(currentFaceValue.invert().multiply(this.diceModel.getRotationForValue(this.targetResult)));
        }
        scene.add(this.graphics);
        this.started = true;
        this.running = true;
        this.runStartTime = time;
    }

    /**
     * Advance the simulation
     * @param time The current frame time
     * @param deltaTime The delta time, unscaled
     */
    updateSimulationGraphics(time: number, deltaTime: number) {
        // Cases where the browser is offscreen
        if (deltaTime < 0)
            return;

        if (!this.started)
            return;

        if (!this.running) {
            this.lifetime -= deltaTime;

            if (this.disappearingDuration > 0 && this.maxLifetime > 0) {
                const actualDisappearTime = Math.min(this.disappearingDuration, this.maxLifetime);

                if (this.lifetime < actualDisappearTime) {
                    this.disappear(1 - this.lifetime / actualDisappearTime);
                }
            }
        }

        if (!this.isAlive) {
            this.die();
            return;
        }

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

    /**
     * Remove all simulation data and complete the roll
     */
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

    die() {
        this.tempMaterials.forEach(m => m.dispose());
        this.tempMaterials.length = 0;
    }

    /**
     * Make the dice disappear over time
     * @param progress Value from 1 to 0
     */
    disappear(progress: number) {
        if (!this.isDisappearing) {
            this.isDisappearing = true;
        }

        this.graphics.userData = { disappear: progress };
    }

    /**
     * Make a new transparent material from the source
     * @param source Original material
     * @returns Transparent material, or the same if it's already transparent
     */
    createDisappearMaterial(source: THREE.Material): THREE.Material {
        if (source.transparent)
            return source;
        const mat = source.clone();
        THREE.MeshStandardMaterial.prototype.copy.call(mat, source);
        //mat.transparent = true;
        mat.needsUpdate = true;
        this.tempMaterials.push(mat);
        return mat;
    }
}

export { DiceObject };