import { getSetting, htmlQuery, MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { ApplicationClosingOptions, ApplicationConfiguration, ApplicationFormConfiguration, ApplicationRenderOptions } from "@7h3laughingman/foundry-types/client/applications/_module.mjs";
import { HandlebarsRenderOptions, HandlebarsTemplatePart } from "@7h3laughingman/foundry-types/client/applications/api/_module.mjs";
import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";
import { DiceMaterialConfig, DiceMaterialConfigGroup, UserDiceMaterials } from "dice-materials";
import { denominationList, forEveryModel, getDiceModel } from "dice-definition";
import { SETTING } from "settings";
import * as UTILS from "utils";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { DiceArea, TryRollParameters } from "dice-area";
import { ContextMenuEntry } from "@7h3laughingman/foundry-types/client/applications/ux/context-menu.mjs";

const { SchemaField, BooleanField, ColorField, FilePathField, NumberField, StringField } = foundry.data.fields;
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function toStringNull(s: string): string | null {
    if (!s)
        return null;
    const trimmed = s.trim();
    return trimmed === "" ? null : trimmed;
}

function toColor(s: string | undefined): number {
    if (s === undefined)
        return 0;
    const color = foundry.utils.Color.fromString(s);
    if (!color.valid)
        return 0;
    return color.valueOf();
}

class DiceMaterialsConfigWindow extends HandlebarsApplicationMixin(ApplicationV2) {
    static override DEFAULT_OPTIONS = {
        id: "simply-dice-materials-config",
        tag: "form",
        form: {
            closeOnSubmit: true,
            submitOnChange: false,
            handler: DiceMaterialsConfigWindow.onSubmit
        },
        classes: ["simply-dice-materials-config"],
        window: {
            title: "SIMPLY-DICE.Settings.DiceMaterials",
            contentClasses: ["standard-form"]
        },
        actions: {
            navigate: DiceMaterialsConfigWindow.navigate,
            reset: DiceMaterialsConfigWindow.resetToParent,
            tryRoll: DiceMaterialsConfigWindow.tryRoll
        }
    } satisfies DeepPartial<ApplicationConfiguration>;

    static override PARTS = {
        navigation: {
            template: "modules/simply-dice/templates/dice-config-navigator.hbs",
        },
        body: {
            template: "modules/simply-dice/templates/dice-materials-config-window.hbs"
        },
        footer: {
            template: "templates/generic/form-footer.hbs"
        }
    } satisfies Record<string, HandlebarsTemplatePart>;

    renderer?: THREE.WebGPURenderer;

    renderPipeline?: THREE.RenderPipeline;

    scene?: THREE.Scene;

    camera?: THREE.PerspectiveCamera;

    controls?: RotateControls;

    materials: UserDiceMaterials;

    currentPath!: string;

    configGroup: DiceMaterialConfigGroup;

    currentConfig!: DeepPartial<DiceMaterialConfig>;

    filledConfig!: DiceMaterialConfig;

    parentConfig!: DiceMaterialConfig;

    timer: THREE.Timer;

    previewObjects?: THREE.Object3D[];

    static #schema = new SchemaField({
        usePlayerColor: new BooleanField({ initial: true }),
        color: new ColorField({ initial: "#ffffff", nullable: false, required: true }),
        colorMap: new FilePathField({ nullable: true, categories: ["IMAGE"] }),
        roughness: new NumberField({ min: 0, max: 1, step: 0.01 }),
        roughnessMap: new FilePathField({ nullable: true, categories: ["IMAGE"] }),
        metalness: new NumberField({ min: 0, max: 1, step: 0.01 }),
        metalnessMap: new FilePathField({ nullable: true, categories: ["IMAGE"] }),
        emissiveColor: new ColorField({ nullable: false }),
        emissiveIntensity: new NumberField({ nullable: false, min: 0 }),
        emissiveMap: new FilePathField({ nullable: true, categories: ["IMAGE"] }),
        normalMap: new FilePathField({ nullable: true, categories: ["IMAGE"] }),
        normalScale: new NumberField(),
        text: new SchemaField({
            font: new StringField({ blank: false, required: true, choices: () => foundry.applications.settings.menus.FontConfig.getAvailableFontChoices() }),
            weight: new StringField({ blank: false, required: true, choices: { 
                "normal": "SIMPLY-DICE.DiceMaterialsConfigWindow.FIELDS.text.weight.choices.normal",
                "bold": "SIMPLY-DICE.DiceMaterialsConfigWindow.FIELDS.text.weight.choices.bold"
             }}),
            color: new ColorField({ nullable: false }),
            opacity: new NumberField({ min: 0, max: 255, step: 1}),
            outlineColor: new ColorField({ nullable: false }),
            outlineOpacity: new NumberField({ min: 0, max: 255, step: 1}),
            emissiveColor: new ColorField({ nullable: false }),
            emissiveIntensity: new NumberField({ nullable: false, min: 0 }),
            bump: new NumberField(),
            symbols: new foundry.data.fields.ObjectField()
        })
    });

    static #localized = false;

    static diceToPreview = ["c", "d2", "d4", "d6", "d8", "d10", "d100", "d12", "d20"];

    static iconForPath: Record<string, string> = {
        global: "globe",
        c: "coin",
        d2: "coin-blank",
        d4: "dice-d4",
        d6: "dice-d6",
        d8: "dice-d8",
        d10: "dice-d10",
        d12: "dice-d12",
        d20: "dice-d20",
        d100: "dice-d10",
        f: "plus-minus",
        faces: "square",
        edges: "border-none"
    };

    contextMenu?: foundry.applications.ux.ContextMenu;

    static diceDenomination?: string[];

    constructor(options?: ApplicationConfiguration) {
        super(options);

        this.materials = new UserDiceMaterials(game.userId);

        this.timer = new THREE.Timer();
        this.timer.connect(document);

        const setting = getSetting<DiceMaterialConfigGroup>(SETTING.DICE_MATERIALS);
        if (setting)
            this.configGroup = foundry.utils.deepClone(setting);
        else
            this.configGroup = { global: {} };

        this.materials.settingGroup = this.configGroup;
        this.currentPath = "global";
        this.currentConfig = this.configGroup[this.currentPath];
        this.filledConfig = this.materials.getDiceMaterialConfigFromPath(this.currentPath);
        this.parentConfig = this.materials.getDiceMaterialConfigFromPath(this.parentPath());

        if (!DiceMaterialsConfigWindow.diceDenomination)
            DiceMaterialsConfigWindow.diceDenomination = denominationList();
    }

    /**
     * Get the parent path of the current path
     * @returns string path
     */
    parentPath() {
        const split = this.currentPath.split(".");
        if (split.length === 1) {
            if (split[0] === "global")
                return "";
            else
                return "global";
        }

        split.pop();
        return split.join(".");
    }

    static navigate(event: PointerEvent, target: HTMLElement) {
        if (!(this instanceof DiceMaterialsConfigWindow))
            return;

        if (!target.classList.contains("clickable"))
            return;

        this.navigatePath(target.dataset["path"]);
    }

    navigatePath(path?: string) {
        if (!path)
            return;

        const split = path.split(".");
        if (split[0] === "global" && split.length > 1 && DiceMaterialsConfigWindow.diceDenomination?.includes(split[1]))
            this.currentPath = split.slice(1).join(".");
        else
            this.currentPath = path;
        this.refreshPath();
    }

    refreshPath() {
        this.currentConfig = this.configGroup[this.currentPath];
        this.filledConfig = this.materials.getDiceMaterialConfigFromPath(this.currentPath);
        this.parentConfig = this.materials.getDiceMaterialConfigFromPath(this.parentPath());

        this.createPreviewModel();

        this.render();
    }

    protected override async _prepareContext(options: ApplicationRenderOptions): Promise<Record<string, any>> {
        const context: Record<string, any> = await super._prepareContext(options);
        
        if (!this.currentPath.endsWith("edges"))
            context.showText = true;
        context.fields = DiceMaterialsConfigWindow.#schema.fields;
        context.config = this.configToContext(this.filledConfig);

        return context;
    }

    protected override async _preparePartContext(partId: string, context: Record<string, any>, options: HandlebarsRenderOptions): Promise<Record<string, any>> {
        context = await super._preparePartContext(partId, context, options);
        if (partId === "footer") {
            context.buttons = [{
                    type: "reset",
                    icon: "fa-solid fa-arrow-rotate-left",
                    label: "SIMPLY-DICE.DiceMaterialsConfigWindow.BUTTONS.reset",
                    action: "reset"
                },
                {
                    type: "button",
                    icon: "fa-solid fa-dice",
                    label: "SIMPLY-DICE.DiceMaterialsConfigWindow.BUTTONS.try",
                    action: "tryRoll"
                },
                {
                    type: "submit", 
                    icon: "fa-solid fa-floppy-disk", 
                    label: "SETTINGS.Save"
                }];
        } else if (partId === "navigation") {
            const path = this.currentPath.split(".");
            if (path[0] !== "global")
                path.unshift("global");

            let accumulator = [];

            context.path = path.map((p, i) => {
                accumulator.push(p);
                return {
                    key: p,
                    path: accumulator.join("."),
                    label: `SIMPLY-DICE.DicePaths.${p}`,
                    hasChild: p !== "faces" && p !== "edges",
                    notLast: i !== path.length - 1,
                    icon: DiceMaterialsConfigWindow.iconForPath[p]
                };
            });
        }

        return context;
    }

    protected override async _preFirstRender(context: Record<string, unknown>, options: ApplicationRenderOptions) {
        await super._preFirstRender(context, options);

        if (!DiceMaterialsConfigWindow.#localized) {
            foundry.helpers.Localization.localizeSchema(DiceMaterialsConfigWindow.#schema, ["SIMPLY-DICE.DiceMaterialsConfigWindow"]);
            DiceMaterialsConfigWindow.#localized = true;
        }
    }

    protected override async _onFirstRender(context: object, options: ApplicationRenderOptions) {
        await super._onFirstRender(context, options);

        this.setupRenderer();

        this.setupContextMenu();        
    }

    protected override async _onRender(context: object, options: ApplicationRenderOptions) {
        await super._onRender(context, options);
        if (this.renderer) {
            htmlQuery(this.element, ".preview")?.appendChild(this.renderer.domElement);
        }

        this.adjustInputs();
    }

    setupContextMenu() {
        const menuEntries: ContextMenuEntry[] = [];
        forEveryModel((denomination, model) => {
            menuEntries.push({
                name: `SIMPLY-DICE.DicePaths.${denomination}`,
                group: "dice",
                condition: target => target.dataset["path"] === "global", 
                callback: () => this.navigatePath(denomination),
                icon: foundry.applications.fields.createFontAwesomeIcon(DiceMaterialsConfigWindow.iconForPath[denomination], { style: "solid" }).outerHTML
        })});

        menuEntries.push({
            name: `SIMPLY-DICE.DicePaths.faces`,
            group: "submat",
            callback: (target) => this.navigatePath(`${target.dataset["path"]}.faces`),
            icon: foundry.applications.fields.createFontAwesomeIcon(DiceMaterialsConfigWindow.iconForPath["faces"], { style: "solid" }).outerHTML
        });
        menuEntries.push({
            name: `SIMPLY-DICE.DicePaths.edges`,
            group: "submat",
            callback: (target) => this.navigatePath(`${target.dataset["path"]}.edges`),
            icon: foundry.applications.fields.createFontAwesomeIcon(DiceMaterialsConfigWindow.iconForPath["edges"], { style: "solid" }).outerHTML
        });

        this.contextMenu = new foundry.applications.ux.ContextMenu(this.element, ".arrow", menuEntries, { eventName: "click", jQuery: false });
    }

    setupRenderer() {
        this.renderer = new THREE.WebGPURenderer({ antialias: getSetting<boolean>(SETTING.ANTIALIASING) });
        this.renderer.setSize(500, 500);
        this.renderer.setAnimationLoop((time) => this.updatePreview(time));
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        this.scene = new THREE.Scene();
        this.scene.backgroundNode = TSL.pmremTexture(game.simplyDice.textureManager!.environmentTexture);
        this.scene.backgroundBlurriness = 0.1;
        this.scene.environmentNode = TSL.pmremTexture(game.simplyDice.textureManager!.environmentTexture);
        this.scene.environmentIntensity = 1;

        this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
        this.camera.setRotationFromAxisAngle(new THREE.Vector3(1, 0, 0), -UTILS.HALF_PI);
        this.camera.position.y = 12;

        this.scene.add(this.camera);

        const scenePass = TSL.pass(this.scene, this.camera);
        const bloomProcess = bloom(scenePass, game.simplyDice.diceArea!.bloomStrength.value, 0, game.simplyDice.diceArea!.bloomThreshold.value);
        this.renderPipeline = new THREE.RenderPipeline(this.renderer);
        this.renderPipeline.outputNode = TSL.renderOutput(DiceArea.mergeBloom(scenePass, bloomProcess), THREE.ACESFilmicToneMapping, THREE.LinearSRGBColorSpace);
        this.renderPipeline.outputColorTransform = true;

        this.controls = new RotateControls(this.camera, this.renderer.domElement);

        const hemiLight = new THREE.HemisphereLight(new THREE.Color("white"), new THREE.Color("black"), 1);
        this.scene.add(hemiLight);
        const dirLight = new THREE.DirectionalLight(new THREE.Color(1, 1, 1), 1);
        dirLight.position.set(1, 2.5, -1);
        dirLight.target.position.set(0, 0, 0);
        this.scene.add(dirLight);

        this.materials.initMaterials(this.configGroup);

        if (!this.previewObjects)
            this.createPreviewModel();
    }

    createPreviewModel() {
        if (!this.scene || !this.camera)
            return;

        this.previewObjects?.forEach(o => this.scene!.remove(o));
        if (this.currentPath.startsWith("global")) {
            this.camera.position.y = 12;

            let count = 0;
            this.previewObjects = [];
            for (let y = -1; y <= 1; y++) {
                for (let x = -1; x <= 1; x++) {
                    if (count >= DiceMaterialsConfigWindow.diceToPreview.length)
                        break;

                    const denomination = DiceMaterialsConfigWindow.diceToPreview[count];
                    const model = getDiceModel(denomination);
                    const mesh = model?.instantiateModel(this.materials!.getMaterialSet(denomination)!);
                    if (!mesh) {
                        console.error(`Dice not found: ${denomination}`);
                        return;
                    }
                    mesh.position.set(x * 1.8, 1, y * 1.8);
                    this.scene.add(mesh);
                    this.previewObjects.push(mesh);
                    count++;
                }

                if (count >= DiceMaterialsConfigWindow.diceToPreview.length)
                    break;
            }
        } else {
            this.camera.position.y = 4;

            const denomination = this.currentPath.split(".")[0];
            const model = getDiceModel(denomination);
            const mesh = model?.instantiateModel(this.materials!.getMaterialSet(denomination)!);
            if (!mesh) {
                console.error(`Dice not found: ${denomination}`);
                return;
            }
            mesh.position.set(0, 1, 0);
            this.previewObjects = [mesh];
            this.scene.add(mesh);
        }
        this.controls?.setTargets(this.previewObjects);
    }

    refreshMaterial() {
        this.filledConfig = this.materials.getDiceMaterialConfigFromPath(this.currentPath);
        this.materials.updateMaterials(this.configGroup);
    }

    protected override _onClose(options: ApplicationClosingOptions) {
        super._onClose(options);
        game.simplyDice.diceArea?.clear();
        this.materials.dispose();
        this.renderer?.dispose();
        this.timer.dispose();
    }

    updatePreview(timestamp: DOMHighResTimeStamp) {
        this.timer.update(timestamp);
        this.controls?.update(this.timer.getDelta());
        this.renderPipeline?.render();
    }

    static tryRoll() {
        if (!(this instanceof DiceMaterialsConfigWindow))
            return;

        const root = this.currentPath.split(".")[0];
        let formula;
        if (root === "global") {
            formula = DiceMaterialsConfigWindow.diceToPreview.map(d => {
                if (d.startsWith("d"))
                    return `1${d}`;
                return `1d${d}`;
            }).join("+");
        } else {
            if (root.startsWith("d"))
                formula = `1${root}`;
            else
                formula = `1d${root}`;
        }

        const roll = new foundry.dice.Roll(formula);

        game.simplyDice.diceArea?.enqueueRoll({
            seed: Math.floor(Math.random() * 4294967296),
            userId: game.userId,
            visibility: { blind: false },
            diceTerms: roll.dice,
            materials: this.materials
        } satisfies TryRollParameters);
    }

    protected override _onChangeForm(formConfig: ApplicationFormConfiguration, event: Event) {
        if ((event.target as HTMLInputElement | null)?.disabled)
            return;
        super._onChangeForm(formConfig, event);

        const data = new foundry.applications.ux.FormDataExtended(this.form!, { disabled: true });
        const config = this.contextToConfig(data.object);
        const configDiff = foundry.utils.diffObject(this.parentConfig, config);
        this.configGroup[this.currentPath] = configDiff;

        this.refreshMaterial();
        this.adjustInputs();
    }

    static resetToParent() {
        if (!(this instanceof DiceMaterialsConfigWindow))
            return;

        this.currentConfig = {};
        delete this.configGroup[this.currentPath];

        this.refreshMaterial();

        this.render();
    }

    adjustInputs() {
        if (!this.form)
            return;

        const usePlayerColor = this.form["usePlayerColor"];
        const color = this.form["color"];

        if (usePlayerColor && color) {
            color.disabled = usePlayerColor.checked;
            if (color.disabled)
                color.value = game.user.color.toString();
        }

        if (this.currentPath !== "global") {
            const contextDiff = this.configToContext((this.configGroup[this.currentPath] ?? {}));

            for (const element of this.form.elements)
                element.classList.remove("overridden");

            for (const entry of Object.entries(contextDiff)) {
                if (entry[0] === "text" && entry[1]) {
                    for (const textEntry of Object.entries(entry[1])) {
                        if (textEntry[1] !== undefined)
                            (this.form.elements.namedItem(`text.${textEntry[0]}`) as Element | null)?.classList.add("overridden");
                    }
                } else {
                    if (entry[1] !== undefined)
                        (this.form.elements.namedItem(entry[0]) as Element | null)?.classList.add("overridden");
                }
            }
        }
    }

    configToContext(config: DeepPartial<DiceMaterialConfig>): Record<string, any> {
        const context: Record<string, any> = {
            usePlayerColor: config.color !== undefined ? config.color === "user" : undefined,
            color: config.color === "user" ? game.user.color.toString() : (config.color !== undefined ? foundry.utils.Color.from(config.color & 0xffffff).toString() : undefined),
            colorMap: config.colorMap,
            roughness: config.roughness,
            roughnessMap: config.roughnessMap,
            metalness: config.metalness,
            metalnessMap: config.metalnessMap,
            emissiveColor: config.emissiveColor !== undefined ? foundry.utils.Color.from(config.emissiveColor).toString() : undefined,
            emissiveIntensity: config.emissiveIntensity,
            emissiveMap: config.emissiveMap,
            normalMap: config.normalMap,
            normalScale: config.normalScale,
            text: (config.text ? {
                color: config.text.color !== undefined ? foundry.utils.Color.from(config.text.color & 0xffffff).toString() : undefined,
                opacity: config.text.color !== undefined ?  (config.text.color >>> 24) : undefined,
                outlineColor: config.text.outlineColor !== undefined ? foundry.utils.Color.from(config.text.outlineColor & 0xffffff).toString() : undefined,
                outlineOpacity: config.text.outlineColor !== undefined ? (config.text.outlineColor >>> 24) : undefined,
                font: config.text.font,
                weight: config.text.weight,
                bump: config.text.bump,
                emissiveColor: config.text.emissiveColor !== undefined ? foundry.utils.Color.from(config.text.emissiveColor).toString() : undefined,
                emissiveIntensity: config.text.emissiveIntensity,
                //symbols
            }: undefined)
        };

        return context;
    }

    contextToConfig(context: Record<string, any>): DiceMaterialConfig {
        const config: DiceMaterialConfig = {
            color: context.usePlayerColor ? "user" : toColor(context.color),
            colorMap: toStringNull(context.colorMap),
            roughness: context.roughness as number,
            roughnessMap: toStringNull(context.roughnessMap),
            metalness: context.metalness as number,
            metalnessMap: toStringNull(context.metalnessMap),
            emissiveColor: toColor(context.emissiveColor),
            emissiveIntensity: context.emissiveIntensity as number,
            emissiveMap: toStringNull(context.emissiveMap),
            normalMap: toStringNull(context.normalMap),
            normalScale: context.normalScale as number
        };

        if (context["text.font"]) {
            config.text = {
                font: context["text.font"],
                weight: context["text.weight"],
                color: (toColor(context["text.color"]) + (context["text.opacity"] << 24)) >>> 0,
                outlineColor: (toColor(context["text.outlineColor"]) + (context["text.outlineOpacity"] << 24)) >>> 0,
                emissiveColor: toColor(context["text.emissiveColor"]),
                emissiveIntensity: context["text.emissiveIntensity"],
                bump: context["text.bump"]
            };
        }

        return config;
    }

    purgeEmptyConfig() {
        Object.entries(this.configGroup).forEach((rv => { if (Object.keys(rv[1]).length === 0) delete this.configGroup[rv[0]]; }))
    }

    static async onSubmit(event: Event, form: HTMLFormElement, formData: foundry.applications.ux.FormDataExtended) {
        if (this instanceof DiceMaterialsConfigWindow) {
            console.log(this.configGroup);
            this.purgeEmptyConfig();
            await game.settings.set(MODULE.id, SETTING.DICE_MATERIALS, this.configGroup);
        }
    }
}

class RotateControls extends THREE.Controls<MouseEvent> {

    _onPointerDown: (event: Event) => void;

    _onPointerMove: (event: Event) => void;

    _onPointerUp: (event: Event) => void;

    _targets: THREE.Object3D[];

    rotationX: THREE.Quaternion;

    rotationY: THREE.Quaternion;

    accumulatorX: number;

    accumulatorY: number;

    rotateStep: number = Math.PI / 128;

    button?: number;

    constructor(camera: THREE.Camera, domElement: HTMLElement | null = null) {
        super(camera, domElement);

        this.enabled = true;

        this._onPointerDown = this.onPointerDown.bind(this);
        this._onPointerMove = this.onPointerMove.bind(this);
        this._onPointerUp = this.onPointerUp.bind(this);

        this._targets = [];

        this.rotationX = new THREE.Quaternion;

        this.rotationY = new THREE.Quaternion;

        this.accumulatorX = 0;
        this.accumulatorY = 0;

        if (domElement !== null)
            this.connect(domElement);
    }

    override connect(element: HTMLElement | SVGElement): void {
        super.connect(element);

        this.domElement?.addEventListener("pointerdown", this._onPointerDown);
        this.domElement?.addEventListener("pointerup", this._onPointerUp);
    }

    override disconnect(): void {
        this.domElement?.removeEventListener("pointerdown", this._onPointerDown);
        this.domElement?.removeEventListener("pointerup", this._onPointerUp);
    }

    setTargets(targets: THREE.Object3D[]) {
        this._targets = targets;
    }

    onPointerDown(event: Event) {
        if (!this.enabled)
            return;

        if (!document.pointerLockElement) {
            this.domElement?.setPointerCapture((event as PointerEvent).pointerId);
        }

        this.domElement?.addEventListener("pointermove", this._onPointerMove);

        this.accumulatorX = 0;
        this.accumulatorY = 0;

        this.button = (event as PointerEvent).button;
    }

    onPointerMove(event: Event) {
        if (!this.enabled)
            return;

        const pointer = event as PointerEvent;

        this.accumulatorX += pointer.movementX;
        this.accumulatorY += pointer.movementY;
    }

    onPointerUp(event: Event) {
        if (!this.enabled)
            return;

        this.domElement?.releasePointerCapture((event as PointerEvent).pointerId);

        this.domElement?.removeEventListener("pointermove", this._onPointerMove);
        
        this.button = undefined;
    }

    override update(delta: number): void {
        if (this.accumulatorX == 0 && this.accumulatorY == 0)
            return;

        if (this.button === 0) {
            this.rotationX.setFromAxisAngle(UTILS.VectorUp.clone().applyQuaternion(this.object.quaternion), this.accumulatorX * this.rotateStep);
            this.rotationY.setFromAxisAngle(UTILS.VectorRight.clone().applyQuaternion(this.object.quaternion), this.accumulatorY * this.rotateStep);

            this._targets.forEach(o => {
                o.applyQuaternion(this.rotationX);
                o.applyQuaternion(this.rotationY);
            });
        } else if (this.button === 2) {
            this.rotationY.setFromAxisAngle(UTILS.VectorForward.clone().applyQuaternion(this.object.quaternion), this.accumulatorY * this.rotateStep);
            this._targets.forEach(o => o.applyQuaternion(this.rotationY));
        }

        this.accumulatorX = 0;
        this.accumulatorY = 0;
    }
}

export { DiceMaterialsConfigWindow }