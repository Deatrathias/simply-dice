import * as THREE from "three";
import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { getDiceModel } from "dice-definition.ts";
import { DiceObject } from "dice.ts";
import * as WORKER from "physics-worker-handler.ts";
import { SimulationCompleteData, SimulationRoll, SimulationStartData } from "worker-types.js";
import { HALF_PI } from "utils";
import { DoRollMessage, socketName } from "socket";
import { SortedSet } from "@rimbu/sorted";
import { playDiceSound } from "audio";
import { debugging } from "hooks";

function initDiceArea() {
    game.simplyDice.diceArea = new DiceArea();
}

type RollParameters = {
    seed: number,
    rollId?: number,
    diceTerms: DiceTermParameter[]
}

type DiceTermParameter = {
    number: number | void,
    denomination: string,
    results: {
        result: number;
    }[]
}


class DiceArea {
    private timer: THREE.Timer;

    private renderer: THREE.WebGLRenderer;

    scene: THREE.Scene;

    private camera: THREE.PerspectiveCamera;

    dirLight?: THREE.DirectionalLight;

    floor?: THREE.Mesh;

    private fixedMaterials: THREE.Material[];

    private allDice: DiceObject[];

    private nextRollId: number = 0;

    private nextDiceId: number = 0;

    private rng: foundry.dice.MersenneTwister;

    fovRatio: number;

    rollStack: RollParameters[] = [];

    rollPromiseResolve: Map<number, (value: void) => void>;

    collisionsSet: SortedSet<number>;

    areaSize = new THREE.Vector2();

    debugModel?: THREE.Object3D;

    get timescale(): number { 
        return this.timer.getTimescale();
    }

    set timescale(timescale) {
        this.timer.setTimescale(timescale);
    }

    get shadows(): boolean {
        return this.renderer.shadowMap.enabled;
    }

    set shadows(shadows) {
        this.renderer.shadowMap.enabled = shadows;
        if (this.dirLight)
            this.dirLight.castShadow = shadows;
    }

    constructor() {
        this.timer = new THREE.Timer();
        this.timer.connect(document);
        this.timer.setTimescale(2);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(30, 0.5, 0.1, 1000);
        this.fixedMaterials = [];
        this.rng = new foundry.dice.MersenneTwister();
        this.initScene();
        this.allDice = [];
        this.renderer = new THREE.WebGLRenderer({ alpha: true });
        this.renderer.setClearColor(0, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.VSMShadowMap;
        this.renderer.setAnimationLoop((time) => this.update(time));
        this.resizeArea();
        this.fovRatio = this.camera.position.y * (Math.tan(Math.toRadians(this.camera.fov / 2)));
        this.rollPromiseResolve = new Map();
        this.collisionsSet = SortedSet.empty();
    }

    private initScene() {
        const light = new THREE.HemisphereLight(new THREE.Color("white"), new THREE.Color("black"), 1);
        this.scene.add(light);
        this.dirLight = new THREE.DirectionalLight(new THREE.Color("white"), 1);
        this.dirLight.position.set(15, 30, -10);
        this.dirLight.target.position.set(0, 0, 0);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.scene.add(this.dirLight);
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShadowMaterial({ opacity: 0.5 })).rotateX(-HALF_PI);
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
        this.camera.position.y = 40;
        this.camera.setRotationFromAxisAngle(new THREE.Vector3(1, 0, 0), -HALF_PI);

        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(MODULE.relativePath("textures/d20template.png"), (texture) => { 
            texture.flipY = false;
            this.fixedMaterials = [
                new THREE.MeshStandardMaterial({ color: 0xffffffff, roughness: 0.2, metalness: 0, map: texture }), 
                new THREE.MeshStandardMaterial({ color: 0xffff0000, roughness: 0, metalness: 0 })];

            if (!debugging)
                return;

            const debugDice = getDiceModel("d6");
            if (debugDice) {
                this.debugModel = debugDice.instantiateModel(this.fixedMaterials);
                this.scene.add(this.debugModel);
            }
        });
    }

    generateContainer(): HTMLDivElement {
        const div = document.createElement("div");
        div.id="simply-dice-layer";
        div.style="position: absolute; width: 100%; height: 100%; pointer-events: none; z-index: 1000";
        div.appendChild(this.renderer.domElement);
        return div;
    }

    resizeArea() {
        const size = { width: window.innerWidth, height: window.innerHeight };
        this.renderer.setSize(size.width, size.height);
        this.camera.aspect = size.width / size.height;
        this.camera.updateProjectionMatrix();
        this.camera.getViewSize(this.camera.position.y, this.areaSize);
        WORKER.resizeArea(this.areaSize.x, this.areaSize.y);
        const shadowCam = this.dirLight?.shadow.camera;
        if (shadowCam) {
            const highest = Math.max(this.areaSize.x, this.areaSize.y) / 2;
            shadowCam.right = highest;
            shadowCam.left = -highest;
            shadowCam.top = highest;
            shadowCam.bottom = -highest;
        }
        if (this.floor)
            this.floor.scale.copy({ x: this.areaSize.x, y: this.areaSize.y, z: 1 });
    }

    changeFov(fov: number) {
        this.camera.fov = fov;
        this.camera.position.y = this.fovRatio / (Math.tan(Math.toRadians(fov / 2)));
        this.camera.updateProjectionMatrix();
    }

    changeHeight(height: number) {
        this.camera.position.y = height;
        const areaSize = this.camera.getViewSize(height, new THREE.Vector2());
        WORKER.resizeArea(areaSize.x, areaSize.y);
    }

    debugLine?: THREE.LineSegments;

    private update(timestamp: DOMHighResTimeStamp) {
        this.timer.update(timestamp);
        const elapsed = this.timer.getElapsed();
        const uncaledDelta = this.timer.getDelta() / this.timer.getTimescale();
        this.allDice.forEach(d => d.updateSimulationGraphics(elapsed, uncaledDelta));
        this.allDice.filter(d => !d.isAlive).forEach(d => { 
            WORKER.removeDice(d.id);
            this.scene.remove(d.graphics);
            this.allDice.findSplice(ad => ad === d);
        });

        if (this.rollStack.length > 0)
            this.doRoll();
        this.renderer.render(this.scene, this.camera);

        if ((this.collisionsSet.min() ?? Infinity) < elapsed) {
            playDiceSound();
            this.collisionsSet = this.collisionsSet.slice({ start: elapsed });
        }
    }

    renderDebugLines(buffers: { vertices: Float32Array, colors: Float32Array }) {
        if (!this.debugLine) {
            this.debugLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffffff, vertexColors: true }));
            this.scene.add(this.debugLine);
        }
        this.debugLine.geometry.setAttribute("position", new THREE.BufferAttribute(buffers.vertices, 3));
        this.debugLine.geometry.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 4));
    }

    can3dRoll(roll: foundry.dice.Roll): boolean {
        const dice = roll.dice;
        if (!dice)
            return false;

        if (dice.find(d => (d.number ?? 0) > 0 && getDiceModel(d.denomination) !== null))
            return true;
        return false;
    }

    async rollAndWait(diceTerms: DiceTermParameter[]) {
        const rollId = this.nextRollId;
        this.nextRollId++;

        const params = {
            seed: Math.floor(Math.random() * 4294967296),
            rollId,
            diceTerms
        };
        this.rollStack.push(params);

        game.socket.emit(socketName, { type: "doRoll", data: { 
            seed: params.seed,
            diceTerms: params.diceTerms.map(d => { return { denomination: d.denomination, number: d.number, results: d.results.map(r => { return { result: r.result }; }) } })
            }} satisfies DoRollMessage);

        await new Promise<void>((resolve) => { 
            this.rollPromiseResolve.set(rollId, resolve); 
            setTimeout(() => { 
                const resolved = this.rollPromiseResolve.get(rollId);
                if (resolved) {
                    this.rollPromiseResolve.delete(rollId);
                    resolve();
                }
            }, 4000); } );
    }

    enqueueRoll(roll: RollParameters) {
        this.rollStack.push(roll);
    }
    
    async doRoll() {
        if (this.rollStack.length == 0)
            return;

        const rolls = [];
        while (this.rollStack.length > 0) {
            const params = this.rollStack.pop();
            if (!params)
                break;

            this.rng.seed(params.seed);
            
            const simulationData: SimulationRoll = {
                randomNumbers: [],
                diceTerms: []
            };
            const effectiveDiceTerms = [];
            for (const term of params.diceTerms) {
                const diceModel = getDiceModel(term.denomination);
                if (!diceModel)
                    continue;

                effectiveDiceTerms.push(term);
                const diceCount = term.number ?? 0;
                for (let i = 0; i < diceCount; i++) {
                    const result = term.results[i].result;
                    // If there is no rotation for the result, ignore the dice
                    if (!diceModel.rotationMap.has(result)) 
                        continue;
                    const dice = new DiceObject(this.nextDiceId, diceModel, this.fixedMaterials, result, params.rollId);
                    this.nextDiceId++;
                    simulationData.diceTerms.push({
                        id: dice.id,
                        denomination: diceModel.definition.denomination
                    });

                    this.allDice.push(dice);
                }
            }
            if (simulationData.diceTerms.length == 0)
                continue;

            simulationData.randomNumbers = Array.from(Array(1 + 5 * simulationData.diceTerms.length), () => this.rng.random());
            rolls.push(simulationData);
        }
        if (rolls.length == 0)
            return;

        const simulationData = {
            startTime: this.timer.getElapsed(),
            rolls,
        } satisfies SimulationStartData;

        WORKER.startSimulation(simulationData);        
    }

    receiveSimulationDate(data: SimulationCompleteData) {
        for (const simulation of data.simulations)
            this.allDice.find(d => d.id == simulation.id)?.runSimulation(this.scene, this.timer.getElapsed(), data.timestep, simulation.posRot);

        this.collisionsSet = SortedSet.from(this.collisionsSet, [...data.collisions].map(c => this.timer.getElapsed() + c * data.timestep));
    }

    debugWindowRotation(x: number, y: number, z: number) {
        if (!this.debugModel)
            return;

        this.debugModel.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.toRadians(x), Math.toRadians(y), Math.toRadians(z))));

        console.log(Object.fromEntries([["x", this.debugModel.quaternion.x], ["y", this.debugModel.quaternion.y], ["z", this.debugModel.quaternion.z], ["w", this.debugModel.quaternion.w]]));
    }

    debugWindowReset() {
        if (!this.debugModel)
            return;

        this.debugModel.quaternion.identity();
    }
}

export { DiceArea, initDiceArea };
export type { RollParameters };