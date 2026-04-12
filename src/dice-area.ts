import * as THREE from "three/webgpu";
import { getSetting, MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { getDiceModel } from "dice-definition.ts";
import { DiceObject } from "dice.ts";
import * as WORKER from "physics-worker-handler.ts";
import { SimulationCompleteData, SimulationRoll, SimulationStartData } from "worker-types.js";
import { HALF_PI } from "utils";
import { DoRollMessage, socketName } from "socket";
import { SortedSet } from "@rimbu/sorted";
import { playDiceSound } from "audio";
import { SETTING } from "settings";
import { EvaluateRollParams, Rolled } from "@7h3laughingman/foundry-types/client/dice/_module.mjs";
import * as TSL from "three/tsl";
import BloomNode, { bloom } from "three/addons/tsl/display/BloomNode.js"

// That function is missing for some reason
declare module "three/webgpu" {
    interface PMREMNode {
        updateFromTexture(texture: THREE.Texture): void;
    }
}

function initDiceArea() {
    game.simplyDice.diceArea = new DiceArea();
}

type RollParameters = {
    seed: number,
    userId: string,
    rollId?: number,
    createdAt?: number,
    diceTerms: DiceTermParameter[]
}

type DiceTermParameter = {
    number: number | void,
    denomination: string,
    results: {
        result: number;
    }[]
}

/**
 * Main dice area for rendering and starting rolls
 */
class DiceArea {
    private timer: THREE.Timer;

    private renderer: THREE.WebGPURenderer;

    private renderPipeline: THREE.RenderPipeline;

    bloomProcess: BloomNode;

    divContainer?: HTMLDivElement;

    scene: THREE.Scene;

    private camera!: THREE.PerspectiveCamera;

    hemiLight!: THREE.HemisphereLight;

    dirLight!: THREE.DirectionalLight;

    floor!: THREE.Mesh;

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

    maxDice: number | null;

    defaultEnvironment: THREE.Node<"vec3"> | null = null;

    immersiveCanvasContext: OffscreenCanvasRenderingContext2D | null = null;

    immersiveCanvasTexture: THREE.CanvasTexture<PIXI.ICanvas | null> | null = null;

    immersiveEnvironmentNode: THREE.PMREMNode | null = null;

    immersiveUpdateTexture: boolean = false;

    immersiveEnvironmentUpdateDelay: number = 0;

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
        this.timer.setTimescale(getSetting(SETTING.TIMESCALE));
        this.scene = new THREE.Scene();
        
        this.rng = new foundry.dice.MersenneTwister();
        this.initScene();
        this.allDice = [];
        this.renderer = new THREE.WebGPURenderer({ alpha: true, antialias: getSetting(SETTING.ANTIALIASING) });
        this.renderer.setClearColor(0, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.setAnimationLoop((time) => this.update(time));
        const scenePass = TSL.pass(this.scene, this.camera);
        this.bloomProcess = bloom(scenePass, 1, 0, 3);
        this.renderPipeline = new THREE.RenderPipeline(this.renderer, TSL.vec4(TSL.acesFilmicToneMapping(this.mergeBloom(scenePass, this.bloomProcess), TSL.uniform(0.7)), scenePass.a));
        this.changeSizeSetting(getSetting(SETTING.DICE_SIZE), true);
        this.resizeArea();

        this.setupImmersiveEnvironment();
        
        this.fovRatio = this.camera.position.y * (Math.tan(Math.toRadians(this.camera.fov / 2)));
        this.rollPromiseResolve = new Map();
        this.collisionsSet = SortedSet.empty();
        this.maxDice = getSetting(SETTING.MAX_DICE_ON_SCREEN);
        this.changeShadows(getSetting(SETTING.SHADOWS));
    }

    mergeBloom(source: THREE.Node<"vec4">, bloom: THREE.Node<"vec4">): THREE.Node<"vec4"> {
        return TSL.vec4(source.add(bloom).rgb, source.a);
    }

    private initScene() {
        this.camera = new THREE.PerspectiveCamera(30, 0.5, 0.1, 1000);
        this.hemiLight = new THREE.HemisphereLight(new THREE.Color("white"), new THREE.Color("black"), 0.5);
        this.scene.add(this.hemiLight);
        this.dirLight = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 0.5);
        this.dirLight.position.set(30, 30, -20);
        this.dirLight.target.position.set(0, 0, 0);
        this.changeShadowMap(parseInt(getSetting<string>(SETTING.SHADOW_MAP_RESOLUTION)));
        this.scene.add(this.dirLight);
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShadowMaterial({ opacity: 0.5 })).rotateX(-HALF_PI);
        this.scene.add(this.floor);
        this.camera.position.y = 40;
        this.camera.setRotationFromAxisAngle(new THREE.Vector3(1, 0, 0), -HALF_PI);
    }

    /**
     * Set up for the immersive environment feature
     */
    setupImmersiveEnvironment() {
        this.scene.environmentIntensity = 1;
        if (!game.simplyDice.textureManager)
            return;

        this.defaultEnvironment = TSL.pmremTexture(game.simplyDice.textureManager.loadTexture(MODULE.relativePath("textures/DayEnvironmentHDRI043_4K_TONEMAPPED.jpg"), texture => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = true;
            if (!getSetting<boolean>(SETTING.IMMERSIVE_ENVIRONMENT))
                this.scene.environmentNode = this.defaultEnvironment;
        }));
        
        // Only refresh the canvas texture when the canvas is updated
        canvas.app?.ticker.add((t) => {
            if (this.allDice.length > 0 && getSetting<boolean>(SETTING.IMMERSIVE_ENVIRONMENT)) {
                this.immersiveEnvironmentUpdateDelay -= t;
                if (this.immersiveEnvironmentUpdateDelay <= 0) {
                    if (!this.immersiveCanvasContext || !this.immersiveCanvasTexture)
                        this.setupImmersiveCanvas();
                    
                    if (this.immersiveCanvasTexture)
                        this.immersiveCanvasTexture.needsUpdate = true;

                    this.immersiveUpdateTexture = true;
                    // Delay to avoid updating on every frame
                    this.immersiveEnvironmentUpdateDelay += 5;
                }
            }
        });
    }

    /**
     * Create the immersive canvas
     */
    private setupImmersiveCanvas() {
        if (this.immersiveCanvasContext)
            return;

        const immersiveCanvas = new OffscreenCanvas(1024, 512);
        this.immersiveCanvasContext = immersiveCanvas.getContext("2d");
        this.immersiveCanvasTexture = new THREE.CanvasTexture(immersiveCanvas);
        this.immersiveCanvasTexture.mapping = THREE.EquirectangularRefractionMapping;
        this.immersiveCanvasTexture.flipY = true;
        this.immersiveCanvasTexture.colorSpace = THREE.SRGBColorSpace;
        this.immersiveEnvironmentNode = TSL.pmremTexture(this.immersiveCanvasTexture);
        if (getSetting<boolean>(SETTING.IMMERSIVE_ENVIRONMENT)) {
            this.scene.environmentNode = this.immersiveEnvironmentNode;
        }
    }

    /**
     * Create the div container for the canvas
     * @returns div
     */
    generateContainer(): HTMLDivElement {
        this.divContainer = document.createElement("div");
        this.divContainer.id="simply-dice-layer";
        this.updateContainerStyle();
        this.divContainer.appendChild(this.renderer.domElement);
        return this.divContainer;
    }

    updateContainerStyle() {
        if (this.divContainer)
            this.divContainer.style = "position: absolute; width: 100%; height: 100%; pointer-events: none;" + (getSetting<boolean>(SETTING.DISPLAY_ON_TOP) ? "z-index: 1000" : "");
    }

    resizeArea() {
        const size = { width: window.innerWidth, height: window.innerHeight };
        this.renderer.setSize(size.width, size.height);
        this.camera.aspect = size.width / size.height;
        this.camera.updateProjectionMatrix();
        this.camera.getViewSize(this.camera.position.y, this.areaSize);
        WORKER.resizeArea(this.areaSize.x, this.areaSize.y);
        const shadowCam = this.dirLight.shadow.camera;
        const highest = Math.max(this.areaSize.x, this.areaSize.y) / 2;
        shadowCam.right = highest;
        shadowCam.left = -highest;
        shadowCam.top = highest;
        shadowCam.bottom = -highest;
        this.floor.scale.copy({ x: this.areaSize.x, y: this.areaSize.y, z: 1 });
    }

    changeFov(fov: number) {
        this.camera.fov = fov;
        this.camera.position.y = this.fovRatio / (Math.tan(Math.toRadians(fov / 2)));
        this.camera.updateProjectionMatrix();
    }

    changeHeight(height: number, noResize: boolean = false) {
        this.camera.position.y = height;
        if (!noResize) {
            this.resizeArea();
        }
    }

    changeSizeSetting(size: number, noResize: boolean = false) {
        this.changeHeight(60 - size * 0.4, noResize);
    }

    changeMaxDice(maxDice: number | null) {
        this.maxDice = maxDice;
        this.cullExtraDice();
    }

    /**
     * Cull dices above maximum
     */
    cullExtraDice() {
        if (this.maxDice && this.allDice.length > this.maxDice) {
            console.log(this.allDice.length - this.maxDice);
            const toRemove = this.allDice.length - this.maxDice;
            for (let i = 0; i < toRemove; i++) {
                const dice = this.allDice[i];
                dice.clearSimulation();
                dice.lifetime = 0;
            }
        }
    }

    changeImmersiveEnvironment(enabled: boolean) {
        if (enabled) {
            this.immersiveEnvironmentUpdateDelay = 0;
            this.scene.environmentNode = this.immersiveEnvironmentNode;
        }
        else {
            this.scene.environmentNode = this.defaultEnvironment;
        }
    }

    changeShadows(enabled: boolean) {
        this.renderer.shadowMap.enabled = enabled;
        this.floor.receiveShadow = enabled;
        this.dirLight.castShadow = enabled;
    }

    changeShadowMap(resolution: number) {
        if (this.dirLight.shadow.mapSize.x != resolution) {
            this.dirLight.shadow.mapSize.copy({ x: resolution, y: resolution });
            // If shadow map resolution changed, delete shadow map to rebuild it
            this.dirLight.shadow.map?.dispose();
            this.dirLight.shadow.map = null;
            this.dirLight.shadow.camera.updateMatrix();
        }
        
    }

    changeCanvasVisibility(visible: boolean) {
        const canvas = this.renderer.domElement;
        const style = this.renderer.domElement.style;

        const goal = visible ? "block" : "none";

        if (style.display !== goal) {
            style.display = goal;
            canvas.style = style.cssText;
        }
    }

    debugLine?: THREE.LineSegments;

    /**
     * Main renderer update function
     * @param timestamp 
     */
    private update(timestamp: DOMHighResTimeStamp) {
        this.timer.update(timestamp);

        if (this.rollStack.length > 0)
            this.doRoll();

        if (this.allDice.length == 0) {
            this.changeCanvasVisibility(false);
            return;
        }
        else {
            this.changeCanvasVisibility(true);
        }

        const elapsed = this.timer.getElapsed();
        const uncaledDelta = this.timer.getDelta() / this.timer.getTimescale();
        this.allDice.forEach(d => d.updateSimulationGraphics(elapsed, uncaledDelta));
        this.allDice.filter(d => !d.isAlive).forEach(d => { 
            WORKER.removeDice(d.id);
            this.scene.remove(d.graphics);
            this.allDice.findSplice(ad => ad === d);
        });

        

        //this.dirLight.intensity = canvas.colors.background.hsv[2];

        if (this.immersiveUpdateTexture && this.immersiveCanvasContext) {
            const w = this.immersiveCanvasContext.canvas.width;
            const h = this.immersiveCanvasContext.canvas.height;
            this.immersiveCanvasContext.fillStyle = canvas.colors.sceneBackground.multiply(canvas.colors.background).toHTML();
            this.immersiveCanvasContext.fillRect(0, 0, w, h/2)
            this.immersiveCanvasContext.drawImage(canvas.app.view as HTMLCanvasElement, 0, 0, window.innerWidth, window.innerHeight, 0, h/2, w, h);
            this.immersiveCanvasTexture!.needsPMREMUpdate = true;
            this.immersiveUpdateTexture = false;
        }

        this.renderPipeline.render();

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

    async onEvaluate(wrapped: (args?: EvaluateRollParams) => Promise<Rolled<Roll>>, options?: EvaluateRollParams) {
        const result = await wrapped(options);
        if (game.simplyDice.diceArea?.can3dRoll(result)) {
            const promise = game.simplyDice.diceArea.rollAndWait(result.dice);
            if (getSetting<boolean>(SETTING.WAIT_FOR_ROLL))
                await promise;
            result.options["simplyDice-noSound"] = true;
        }
        return result;
    }

    

    /**
     * Check if the roll can be displayed with 3D dice
     * @param roll The roll
     * @returns true if 3D dice can be used
     */
    can3dRoll(roll: foundry.dice.Roll): boolean {
        if (getSetting<boolean>(SETTING.DISABLE_FOR_USER))
            return false;

        const dice = roll.dice;
        if (!dice)
            return false;

        if (dice.find(d => (d.number ?? 0) > 0 && getDiceModel(d.denomination) !== null))
            return true;
        return false;
    }

    /**
     * Start a 3D roll to perform and wait until it is done
     * @param diceTerms terms of the roll
     */
    async rollAndWait(diceTerms: DiceTermParameter[]) {
        const rollId = this.nextRollId;
        this.nextRollId++;

        const params = {
            seed: Math.floor(Math.random() * 4294967296),
            userId: game.userId,
            rollId,
            diceTerms
        } satisfies RollParameters;
        this.rollStack.push(params);

        game.socket.emit(socketName, { type: "doRoll", data: { 
            seed: params.seed,
            userId: game.userId,
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
            }, getSetting<number>(SETTING.MAX_WAIT_TIME) * 1000); } );
    }

    /**
     * Add a roll to be displayed
     * @param roll 
     */
    enqueueRoll(roll: RollParameters) {
        roll.createdAt = Date.now();
        this.rollStack.push(roll);
    }
    
    /**
     * Check all the rolls in the stack, create the 3D dice and call the physics worker
     */
    doRoll() {
        if (this.rollStack.length == 0)
            return;

        let count = 0;
        const rolls = [];
        while (this.rollStack.length > 0) {
            const params = this.rollStack.pop();
            // Don't show rolls too old
            if (!params || (params.createdAt && Date.now() - params.createdAt > 10000))
                break;

            if (this.maxDice && count >= this.maxDice)
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

                    const materialSet = game.simplyDice.userMaterials?.get(params.userId)?.getMaterialSet(term.denomination);
                    if (!materialSet)
                        continue;

                    count++;
                    const dice = new DiceObject(this.nextDiceId, diceModel, materialSet, result, params.rollId);
                    this.nextDiceId++;
                    simulationData.diceTerms.push({
                        id: dice.id,
                        denomination: diceModel.definition.denomination
                    });

                    this.allDice.push(dice);
                    if (this.maxDice && count >= this.maxDice)
                        break;
                }
            }
            if (simulationData.diceTerms.length == 0)
                continue;

            simulationData.randomNumbers = Array.from(Array(1 + 5 * simulationData.diceTerms.length), () => this.rng.random());
            rolls.push(simulationData);
        }
        if (rolls.length == 0)
            return;

        if (this.rollStack.length > 0) {
            // Clear rolls if they are above the dice cap
            this.rollStack.forEach(r => {
                if (r.rollId) {
                    const resolve = this.rollPromiseResolve.get(r.rollId);
                    if (resolve)
                        resolve();
                }
            });
            this.rollStack.length = 0;   
        }

        this.cullExtraDice();

        const simulationData = {
            startTime: this.timer.getElapsed(),
            rolls,
        } satisfies SimulationStartData;

        WORKER.startSimulation(simulationData);      
    }

    /**
     * Called when simulation data is received from the physics worker
     * @param data Simulation data
     */
    receiveSimulationDate(data: SimulationCompleteData) {
        for (const simulation of data.simulations)
            this.allDice.find(d => d.id == simulation.id)?.runSimulation(this.scene, this.timer.getElapsed(), data.timestep, simulation.posRot);

        if (data.collisions)
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