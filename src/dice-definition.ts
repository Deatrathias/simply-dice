import * as THREE from "three/webgpu";
import * as WORKER from "physics-worker-handler.ts";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DiceMaterialSet } from "dice-materials";
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";

type DiceDefinition = {
    denomination: string,
    modelUrl: string,
    colliderUrl: string
    rotationForValue: Record<string, THREE.QuaternionTuple>,
    text: DiceTextDefinition
};

type DiceTextDefinition = {
    height: number,
    maxWidth: number,
    items: {
        label: string,
        position: THREE.Vector2Tuple,
        rotation?: number
    }[]
};

const gltfLoader = new GLTFLoader();

/**
 * Represent the model of a 3D dice to be duplicated for instanciation
 */
class DiceModel {

    readonly definition: DiceDefinition;

    readonly model: THREE.Mesh;

    readonly rotationMap: Map<number, THREE.QuaternionLike>;

    get loaded() : boolean {
        return !!this.model;
    }

    private constructor(definition: DiceDefinition, model: THREE.Mesh) {
        this.definition = definition;
        this.model = model;
        this.rotationMap = new Map();
        Object.entries(definition.rotationForValue).forEach(rv => this.rotationMap.set(parseInt(rv[0]), new THREE.Quaternion(rv[1][0], rv[1][1], rv[1][2], rv[1][3])));
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
        const modelPromise = new Promise<THREE.Mesh>((resolve, reject) =>
         gltfLoader.load(definition.modelUrl, (gltf) => {
            const meshes: THREE.Mesh[] = [];
            gltf.scene.traverse(o => { 
                if ((o as THREE.Mesh).isMesh)
                    meshes.push((o as THREE.Mesh));
            });
            if (meshes.length == 0) {
                console.error(`Invalid model at ${definition.modelUrl}`);
                reject("Model error");
                return;
            }
            const materials = meshes.flatMap(m => m.material);
            // Combines meshes into one geometry
            const combinedGeometry = BufferGeometryUtils.mergeGeometries(meshes.map(m => m.geometry), true);
            const mesh = new THREE.Mesh(combinedGeometry, materials);
            resolve(mesh);
        })).then((model) => new DiceModel(definition, model), (reason) => { throw new Error(reason); });

        return modelPromise;
    }

    /**
     * Create a new instance of a dice mesh
     * @param materials The materials to apply to this mesh
     * @returns A new Mesh that copies the model
     */
    instantiateModel(materialSet: DiceMaterialSet): THREE.Mesh {
        if (!this.model)
            throw new Error("Model is missing");
        if (!materialSet.faces.material || !materialSet.edges.material)
            throw new Error("Materials not generated");
        const mesh = new THREE.Mesh();
        mesh.copy(this.model);
        mesh.material = (mesh.material as THREE.Material[]).map(m => {
            if (m.name === "Faces")
                return materialSet.faces.material!;
            else if (m.name === "Edges")
                return materialSet.edges.material!;
            return m;
        });

        return mesh;
    }

    /**
     * Get a rotation quaternion for a given value
     * @param value Dice value
     * @returns The given rotation, or identity if not found
     */
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
    const definitions = await (await fetch(MODULE.relativePath("definitions.json"))).json() as DiceDefinition[];
    
    Hooks.callAll("simply-dice.registerDiceDefinitions");

    diceModels = await Promise.all(definitions.map(def => DiceModel.createModel(def)))
        .then((input) => input.reduce((accumulator, current) => {
        accumulator[current.definition.denomination] = current;
        return accumulator;
    }, {} as Record<string, DiceModel>));
}

/**
 * Get a dice model for a specific denomination
 * @param denomination Dice denomination
 * @returns DiceModel, or null if not found
 */
function getDiceModel(denomination: string): DiceModel | null {
    if (!diceModels)
        return null;

    return diceModels[denomination] ?? null;
}

function forEveryModel<Result>(fn: (denomination: string, model: DiceModel) => Result): Result[] {
    if (!diceModels)
        return [];

    return Object.entries(diceModels).map(entry => fn(entry[0], entry[1]));
}

export { DiceModel, loadDefinitions, registerDefinition, getDiceModel, forEveryModel };
export type { DiceTextDefinition };