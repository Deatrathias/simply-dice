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
import * as TSL from "three/tsl";
import BloomNode, { bloom } from "three/addons/tsl/display/BloomNode.js";
import { debugging } from "hooks";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";

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
    visibility: { blind?: boolean, users?: string[] },
    blind?: boolean,
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

    renderer: THREE.WebGPURenderer;

    private renderPipeline: THREE.RenderPipeline;

    bloomProcess: BloomNode;

    toneMappingIntensity: THREE.UniformNode<"float", number>;

    bloomStrength: THREE.UniformNode<"float", number>;

    bloomThreshold: THREE.UniformNode<"float", number>;

    divContainer?: HTMLDivElement;

    scene: THREE.Scene;

    camera!: THREE.PerspectiveCamera;

    hemiLight!: THREE.HemisphereLight;

    dirLight!: THREE.DirectionalLight;

    floor!: THREE.Mesh;

    framerateCap: number | null;

    timeUntilFrame: number;

    lastUpdateTime: number;

    deltaTimeAccumulator: number;

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
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        THREE.ColorManagement.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.shadowMap.transmitted = true;
        this.renderer.setAnimationLoop((time) => this.update(time));
        this.framerateCap = getSetting(SETTING.MAX_FRAMERATE);
        this.timeUntilFrame = 0;
        this.lastUpdateTime = 0;
        this.deltaTimeAccumulator = 0;
        const scenePass = TSL.pass(this.scene, this.camera);
        this.bloomStrength = TSL.uniform(1);
        this.bloomThreshold = TSL.uniform(5);
        this.bloomProcess = bloom(scenePass, 0, 0, 1);
        this.bloomProcess.strength = this.bloomStrength;
        this.bloomProcess.threshold = this.bloomThreshold;
        this.toneMappingIntensity = TSL.uniform(1);
        this.renderPipeline = new THREE.RenderPipeline(this.renderer);
        this.renderPipeline.outputNode = TSL.renderOutput(this.mergeBloom(scenePass, this.bloomProcess), THREE.ACESFilmicToneMapping, THREE.LinearSRGBColorSpace);
        this.renderPipeline.outputColorTransform = true;
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
        this.hemiLight = new THREE.HemisphereLight(new THREE.Color("white"), new THREE.Color("black"), 1);
        this.scene.add(this.hemiLight);
        this.dirLight = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 1);
        this.dirLight.position.set(20, 50, -20);
        this.dirLight.target.position.set(0, 0, 0);
        this.changeShadowMap(parseInt(getSetting<string>(SETTING.SHADOW_MAP_RESOLUTION)));
        this.scene.add(this.dirLight);
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShadowMaterial({ opacity: 0.5 })).rotateX(-HALF_PI);
        this.scene.add(this.floor);
        this.camera.position.y = 40;
        this.camera.setRotationFromAxisAngle(new THREE.Vector3(1, 0, 0), -HALF_PI);

        if (!debugging)
            return;
        this.debugModel = getDiceModel("d10")?.instantiateModel(game.simplyDice.userMaterials!.get(game.userId)!.getMaterialSet("d10")!);
        this.debugModel?.quaternion.set(-0.0499904803327302, -0.07139380484326963, -0.0868240888334651, 0.9924038765061041);

        if (this.debugModel)
            this.scene.add(this.debugModel);
    }

    /**
     * Set up for the immersive environment feature
     */
    setupImmersiveEnvironment() {
        this.scene.environmentIntensity = 1;
        if (!game.simplyDice.textureManager)
            return;

        const loader = new EXRLoader();
        this.defaultEnvironment = TSL.pmremTexture(loader.load(MODULE.relativePath("textures/clarens_midday_1k.exr"), texture => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = false;
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
        this.changeHeight(50 - size * 0.4, noResize);
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

    changeFramerateCap(cap: number | null) {
        this.framerateCap = cap;
        this.timeUntilFrame = 0;

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

    updateImmersiveEnvironment() {
        if (!this.immersiveCanvasContext)
            return;

        const w = this.immersiveCanvasContext.canvas.width;
        const h = this.immersiveCanvasContext.canvas.height;
        this.immersiveCanvasContext.fillStyle = canvas.colors.sceneBackground.multiply(canvas.colors.background).toHTML();
        this.immersiveCanvasContext.fillRect(0, 0, w, h/2)
        this.immersiveCanvasContext.drawImage(canvas.app.view as HTMLCanvasElement, 0, 0, window.innerWidth, window.innerHeight, 0, h/2, w, h);
        this.immersiveCanvasTexture!.needsPMREMUpdate = true;
        this.immersiveUpdateTexture = false;
    }

    debugLine?: THREE.LineSegments;

    /**
     * Main renderer update function
     * @param timestamp 
     */
    private update(timestamp: DOMHighResTimeStamp) {
        this.timer.update(timestamp);

        this.deltaTimeAccumulator += this.timer.getDelta();

        if (this.framerateCap != null) {
            this.timeUntilFrame -= timestamp - this.lastUpdateTime;
            this.lastUpdateTime = timestamp;

            if (this.timeUntilFrame > 0)
                return;

            this.timeUntilFrame += 1000 / this.framerateCap;
        }

        if (this.rollStack.length > 0)
            this.doRoll();

        if (this.allDice.length == 0 && !this.debugModel) {
            this.changeCanvasVisibility(false);
            return;
        }
        else {
            this.changeCanvasVisibility(true);
        }

        const elapsed = this.timer.getElapsed();
        const uncaledDelta = this.deltaTimeAccumulator / this.timer.getTimescale();
        this.allDice.forEach(d => d.updateSimulationGraphics(elapsed, uncaledDelta));
        this.allDice.filter(d => !d.isAlive).forEach(d => { 
            WORKER.removeDice(d.id);
            this.scene.remove(d.graphics);
            this.allDice.findSplice(ad => ad === d);
        });
        //this.dirLight.intensity = canvas.colors.background.hsv[2];

        if (this.immersiveUpdateTexture)
            this.updateImmersiveEnvironment();

        this.renderPipeline.render();

        if ((this.collisionsSet.min() ?? Infinity) < elapsed) {
            playDiceSound();
            this.collisionsSet = this.collisionsSet.slice({ start: elapsed });
        }

        this.deltaTimeAccumulator = 0;
    }

    renderDebugLines(buffers: { vertices: Float32Array, colors: Float32Array }) {
        if (!this.debugLine) {
            this.debugLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffffff, vertexColors: true }));
            this.scene.add(this.debugLine);
        }
        this.debugLine.geometry.setAttribute("position", new THREE.BufferAttribute(buffers.vertices, 3));
        this.debugLine.geometry.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 4));
    }

    /**
     * On roll evaluate wrapper
     * @param wrapped original function
     * @param roll Evaluated roll
     * @param options Evaluated roll options
     * @returns Rolled
     */
    /*async onEvaluate(wrapped: (args?: EvaluateRollParams) => Promise<Rolled<Roll>>, roll: Roll, options?: EvaluateRollParams): Promise<Rolled<Roll>> {
        const diceToRoll = [];
        if (this.can3dRoll(roll)) {
            diceToRoll.push(...roll.dice.filter(d => !(d as any)._simplyDiceRolled));
            diceToRoll.forEach(d => (d as any)._simplyDiceRolled = true);
        }
        console.log(roll);

        const result = await wrapped(options);

        if (diceToRoll.length > 0) {
            const promise = this.rollAndWait(diceToRoll);
            if (getSetting<boolean>(SETTING.WAIT_FOR_ROLL))
                await promise;
            result.options["simplyDice-noSound"] = true;
        }
        return result;
    }*/

    async triggerRoll(roll: Roll, message?: ChatMessage): Promise<boolean> {
        let played = false;
        if (this.can3dRoll(roll)) {
            played = true;
            const promise = this.rollAndWait(roll.dice, message);
            if (getSetting<boolean>(SETTING.WAIT_FOR_ROLL))
                await promise;
        }

        return played;
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

        if (dice.find(d => (d.number ?? 0) > 0 && getDiceModel(d.denomination) !== null && !(d as any)._simplyDiceRolled))
            return true;
        return false;
    }

    /**
     * Start a 3D roll to perform and wait until it is done
     * @param diceTerms terms of the roll
     */
    async rollAndWait(diceTerms: DiceTermParameter[], message?: ChatMessage) {
        const rollId = this.nextRollId;
        this.nextRollId++;

        const adjustedDiceTerms = diceTerms.map(d => { 
            return { 
                denomination: d.denomination, 
                number: d.number, 
                results: d.results.map(r => { return { result: r.result }; }) } satisfies DiceTermParameter });

        // Case for the d100
        adjustedDiceTerms.filter(d => d.denomination === "d100").forEach(d => {
            const newDice = { 
                denomination: "d10", 
                number: d.number,
                results: [...d.results.map(r => {
                    let result = { result: r.result % 10 };
                    if (result.result == 0)
                        result.result = 10;
                    return result;
                })]
            } satisfies DiceTermParameter;
            d.results.forEach(r =>  r.result = Math.floor((r.result % 100) / 10) * 10);

            adjustedDiceTerms.push(newDice);
        });

        const params = {
            seed: Math.floor(Math.random() * 4294967296),
            userId: game.userId,
            rollId,
            visibility: {
                users: message?.whisper as string[],
                blind: message?.blind
            },
            diceTerms: adjustedDiceTerms
        } satisfies RollParameters;
        this.rollStack.push(params);

        game.socket.emit(socketName, { type: "doRoll", data: { 
            seed: params.seed,
            userId: game.userId,
            visibility: { users: message?.whisper as string[] },
            diceTerms: adjustedDiceTerms
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
     * Add a roll from another player to be displayed
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

            const secret = params.visibility.users && params.visibility.users.length > 0 && !params.visibility.users.includes(game.userId) && (params.visibility.blind === undefined || params.visibility.blind);

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
                    const dice = new DiceObject(this.nextDiceId, diceModel, materialSet, result, params.rollId, secret);
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

        console.log(this.debugModel.quaternion.toArray());
    }

    debugWindowReset() {
        if (!this.debugModel)
            return;

        this.debugModel.quaternion.identity();
    }
}

export { DiceArea, initDiceArea };
export type { RollParameters };