import * as THREE from "three";
import * as WORKER from "physics-worker-handler.ts";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import definitionsJson from "definitions.json" with { type: "json" };

type DiceDefinition = {
    denomination: string,
    modelUrl: string,
    colliderUrl: string
    rotationForValue: {
        value: number,
        rotation: THREE.QuaternionLike 
    }[]
};

const gltfLoader = new GLTFLoader();

class DiceModel {

    readonly definition: DiceDefinition;

    readonly model: THREE.Group;

    readonly rotationMap: Map<number, THREE.QuaternionLike>;

    get loaded() : boolean {
        return !!this.model;
    }

    private constructor(definition: DiceDefinition, model: THREE.Group) {
        this.definition = definition;
        this.model = model;
        this.rotationMap = new Map();
        definition.rotationForValue.forEach(rv => this.rotationMap.set(rv.value, rv.rotation));
    }

    /**
     * Create a dice model from a definition asynchronously
     * @param definition The Dice Definition
     * @returns a new DiceModel
     */
    static async createModel(definition: DiceDefinition): Promise<DiceModel> {
        // Send message to load collider on the physics worker
        WORKER.loadObj(definition.denomination, definition.colliderUrl);

        // Load model
        const modelPromise = new Promise<THREE.Group>((resolve, reject) =>
         gltfLoader.load(definition.modelUrl, (gltf) => {
            const child = gltf.scene.children[0];
            if (child.type !== "Group") {
                console.error(`Invalid model at ${definition.modelUrl}`);
                reject("Model error");
                return;
            }
            resolve(child as THREE.Group);
        })).then((model) => new DiceModel(definition, model));

        return modelPromise;
    }

    /**
     * Create a new instance of a dice mesh
     * @param materials The materials to apply to this mesh
     * @returns A new Group that copies the model
     */
    instantiateModel(materials: THREE.Material[]): THREE.Group {
        if (!this.model)
            throw new Error("Model is missing");
        const group = new THREE.Group();
        group.copy(this.model, true);
        group.children.forEach((child, index) => (child as THREE.Mesh).material = materials[index]);
        return group;
    }

    getRotationForValue(value: number): THREE.Quaternion {
        const rotation = this.rotationMap.get(value);
        if (!rotation)
            return new THREE.Quaternion().identity();

        return new THREE.Quaternion().copy(rotation);
    }
}

const definitions = new Array<DiceDefinition>();

let diceModels: Record<string, DiceModel> | null = null;

function registerDefinition(diceDefinition: DiceDefinition) {
    definitions.push(diceDefinition);
}

async function loadDefinitions() {
    definitionsJson.forEach(def => definitions.push(def));
    Hooks.callAll("simply-dice.registerDiceDefinitions");

    diceModels = await Promise.all(definitions.map(def => DiceModel.createModel(def)))
        .then((input) => input.reduce((accumulator, current) => {
        accumulator[current.definition.denomination] = current;
        return accumulator;
    }, {} as Record<string, DiceModel>));
}

function getDiceModel(denomination: string): DiceModel | null {
    if (!diceModels)
        return null;

    return diceModels[denomination] ?? null;
}

export { DiceModel, loadDefinitions, registerDefinition, getDiceModel };