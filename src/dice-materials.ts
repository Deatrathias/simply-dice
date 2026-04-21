import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { DiceModel, DiceTextDefinition, forEveryModel } from "dice-definition";
import { SETTING } from "settings";
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";
import { cleanup, colorToStyle } from "utils";

const { SchemaField, ColorField, FilePathField, NumberField, StringField, TypedObjectField, BooleanField, AlphaField } = foundry.data.fields;

type DiceMaterialConfig = {
    color: string | Color | "user",
    colorMap: string | null,
    roughness: number,
    roughnessMap: string | null,
    metalness: number,
    metalnessMap: string | null,
    emissiveColor: string | Color,
    emissiveIntensity: number,
    emissiveMap: string | null,
    normalMap: string | null,
    normalScale: number,
    text?: DiceMaterialTextConfig
}

type DiceMaterialTextConfig = {
    show: boolean,
    font: string,
    weight: string,
    color: string | Color,
    opacity: number,
    emissiveColor: string | Color,
    emissiveIntensity: number,
    outlineColor: string | Color,
    outlineOpacity: number,
    bump: number,
    symbols?: Record<string, DiceMaterialSymbolConfig>
}

type DiceMaterialSymbolConfig = {
    url: string,
    scale?: number,
    applyColor?: boolean
}

const defaultMaterialConfig = {
    color: "user",
    colorMap: null,
    roughness: 0.5,
    roughnessMap: null,
    metalness: 0,
    metalnessMap: null,
    emissiveColor: "#000000",
    emissiveIntensity: 1,
    emissiveMap: null,
    normalMap: null,
    normalScale: 1,
    text: {
        show: true,
        font: "Signika",
        weight: "normal",
        color: "#ffffff",
        opacity: 1,
        emissiveColor: "#000000",
        emissiveIntensity: 1,
        outlineColor: "#000000",
        outlineOpacity: 1,
        bump: -1
    }
} satisfies DiceMaterialConfig;

type DiceMaterialConfigGroup = Record<string, DeepPartial<DiceMaterialConfig>>;

type DiceMaterialSubmat = "faces" | "facesSecret" | "edges";

type DiceMaterialSet = {
    [K in DiceMaterialSubmat]: DiceMaterial
}

class ColorOrUserField extends ColorField {
    override initialize(value: unknown, model?: foundry.abstract.DataModel, options?: object): foundry.utils.Color | null {
        if (value === "user")
            return value as any as foundry.utils.Color;

        return super.initialize(value, model, options);
    }

    protected override _cast(value: unknown): unknown {
        if (value === "user")
            return value;

        return super._cast(value);
    }

    protected override _validateType(value: unknown): boolean {
        if (value === "user")
            return true;
        
        return super._validateType(value);
    }
}

const diceMaterialConfigSchema = new SchemaField({
    color: new ColorOrUserField({ required: false, initial: undefined }),
    colorMap: new FilePathField({ nullable: true, categories: ["IMAGE"], required: false, initial: undefined }),
    roughness: new AlphaField({ required: false, initial: undefined }),
    roughnessMap: new FilePathField({ nullable: true, categories: ["IMAGE"], required: false, initial: undefined }),
    metalness: new AlphaField({ required: false, initial: undefined }),
    metalnessMap: new FilePathField({ nullable: true, categories: ["IMAGE"], required: false, initial: undefined }),
    emissiveColor: new ColorField({ required: false, initial: undefined }),
    emissiveIntensity: new NumberField({ min: 0, required: false, initial: undefined }),
    emissiveMap: new FilePathField({ nullable: true, categories: ["IMAGE"], required: false, initial: undefined }),
    normalMap: new FilePathField({ nullable: true, categories: ["IMAGE"], required: false, initial: undefined }),
    normalScale: new NumberField({ required: false, initial: undefined }),
    text: new SchemaField({
        show: new BooleanField({ required: false, initial: undefined }),
        font: new StringField({ required: false, initial: undefined, choices: () => foundry.applications.settings.menus.FontConfig.getAvailableFontChoices() }),
        weight: new StringField({ required: false, initial: undefined, choices: ["normal", "bold"] }),
        color: new ColorField({ required: false, initial: undefined }),
        opacity: new AlphaField({ required: false, initial: undefined }),
        outlineColor: new ColorField({ required: false, initial: undefined }),
        outlineOpacity: new AlphaField({ required: false, initial: undefined }),
        emissiveColor: new ColorField({ required: false, initial: undefined }),
        emissiveIntensity: new NumberField({ min: 0, required: false, initial: undefined }),
        bump: new NumberField({ required: false, initial: undefined }),
        symbols: new TypedObjectField(new SchemaField({
            url: new FilePathField({ nullable: true, categories: ["IMAGE"] }),
            scale: new NumberField({ required: false, initial: undefined }),
            applyColor: new BooleanField({ required: false, initial: undefined })
        }), { initial: {} })
    }, { nullable: true, required: false, initial: undefined })
});

/**
 * Class to store all the materials of one user
 */
class UserDiceMaterials {
    userId: string;

    materials: Map<string, DiceMaterialSet>;

    settingGroup?: DiceMaterialConfigGroup;

    constructor(userId: string) {
        this.userId = userId;
        this.materials = new Map();
    }

    /**
     * Get all the materials ready for every user
     */
    static initMaterialsForAllUsers() {
        if (!DiceMaterial.texRenderCanvas)
            DiceMaterial.texRenderCanvas = new OffscreenCanvas(1024, 1024);

        if (!game.simplyDice.userMaterials)
            game.simplyDice.userMaterials = new Map();

        for (const user of game.users) {
            let diceMaterials = game.simplyDice.userMaterials.get(user.id);
            if (!diceMaterials) {
                diceMaterials = new UserDiceMaterials(user.id);
                game.simplyDice.userMaterials.set(user.id, diceMaterials);
            }

            diceMaterials.initMaterials();
        }
    }

    /**
     * Initialize materials for the user
     */
    initMaterials(existingSetting?: DiceMaterialConfigGroup) {
        let setting = existingSetting;
        if (!setting)
            setting = game.settings.storage.get("user").getSetting(`${MODULE.id}.${SETTING.DICE_MATERIALS}`, this.userId)?.value as DiceMaterialConfigGroup | undefined | null ?? undefined;
        this.settingGroup = setting;
        cleanup(this.settingGroup);

        forEveryModel((denomination, model) => {
            let materialSet = this.materials.get(denomination);
            const configFaces = this.getDiceMaterialConfig(denomination, "faces");
            const configEdges = this.getDiceMaterialConfig(denomination, "edges");

            if (!materialSet) {
                materialSet = {
                    faces: new DiceMaterial(configFaces, model, "faces"),
                    facesSecret: new DiceMaterial(configFaces, model, "facesSecret"),
                    edges: new DiceMaterial(configEdges, model, "edges")
                };
                this.materials.set(denomination, materialSet);
            }
            else {
                materialSet.faces.config = configFaces;
                materialSet.facesSecret.config = configFaces;
                materialSet.edges.config = configEdges;
            }

            materialSet.faces.buildMaterial();
            materialSet.facesSecret.buildMaterial();
            materialSet.edges.buildMaterial();
        });
    }

    /**
     * Refresh the materials based on new settings
     * @param settings Updated settings
     */
    updateMaterials(settings?: DiceMaterialConfigGroup, force?: boolean, doSecret: boolean = true) {
        this.settingGroup = settings;

        cleanup(this.settingGroup);

        for (const material of this.materials) {
            const configFaces = this.getDiceMaterialConfig(material[0], "faces");
            const configEdges = this.getDiceMaterialConfig(material[0], "edges");

            if (force || !foundry.utils.objectsEqual(material[1].faces.config, configFaces)) {
                const skipText = !force && foundry.utils.objectsEqual(material[1].faces.config.text!, configFaces.text!);
                material[1].faces.config = configFaces;
                material[1].faces.buildMaterial(skipText);
                if (doSecret) {
                    material[1].facesSecret.config = configFaces;
                    material[1].facesSecret.buildMaterial(skipText);
                }
            }

            if (force || !foundry.utils.objectsEqual(material[1].edges.config, configEdges)) {
                material[1].edges.config = configEdges;
                material[1].edges.buildMaterial();
            }
        }
    }

    cloneDefault(): DiceMaterialConfig {
        const result: DiceMaterialConfig = foundry.utils.deepClone(defaultMaterialConfig);

        const userColor = game.users.get(this.userId)?.color;
        if (result.text && userColor && userColor.hsl[2] > 0.5) {
            // Make text black for bright color users
            const outline = result.text.outlineColor;
            result.text.outlineColor = result.text.color;
            result.text.color = outline;
        }

        return result;
    }

    /**
     * Generate the material config for a specific die
     * @param denomination Dice denomination
     * @param submat Which submat to get
     * @returns The generated DiceMaterialConfig
     */
    getDiceMaterialConfig(denomination: string, submat: DiceMaterialSubmat): DiceMaterialConfig {
        const result: DiceMaterialConfig = this.cloneDefault();

        if (this.settingGroup) {
            foundry.utils.mergeObject(result, this.settingGroup.global, { recursive: true });
            foundry.utils.mergeObject(result, this.settingGroup[`global.${submat}`], { recursive: true });
            foundry.utils.mergeObject(result, this.settingGroup[denomination], { recursive: true });
            foundry.utils.mergeObject(result, this.settingGroup[`${denomination}.${submat}`], { recursive: true });
        }

        if (result.color === "user") {
            result.color = game.users.get(this.userId)?.color.css ?? "#ffffff";
        }

        return result;
    }

    getDiceMaterialConfigFromPath(path: string) {
        const result: DiceMaterialConfig = this.cloneDefault();

        if (path === "" || !this.settingGroup)
            return result;

        foundry.utils.mergeObject(result, this.settingGroup.global, { recursive: true });
        if (path === "global") {
            return result;
        }

        const subpaths = path.split(".");

        const last = subpaths[subpaths.length - 1];
        if (last === "faces" || last === "edges")
            foundry.utils.mergeObject(result, this.settingGroup[`global.${last}`], { recursive: true });
        let builder = "";

        for (const subpath of subpaths) {
            if (builder === "")
                builder = subpath;
            else
                builder = builder.concat(".", subpath);

            foundry.utils.mergeObject(result, this.settingGroup[builder], { recursive: true });
        }

        return result;
    }

    /**
     * Get material set for a given denomination
     * @param denomination 
     * @returns 
     */
    getMaterialSet(denomination: string): DiceMaterialSet | undefined {
        return this.materials.get(denomination);
    }

    dispose() {
        this.materials.forEach(m => {
            m.faces?.dispose();
            m.facesSecret?.dispose();
            m.edges?.dispose();
        });
        this.materials.clear();
    }
}

class DiceMaterial {
    config: DiceMaterialConfig;

    diceModel: DiceModel;

    static texRenderCanvas?: OffscreenCanvas;

    static intermediateCanvas?: OffscreenCanvas;

    submat: DiceMaterialSubmat;

    material!: THREE.MeshStandardNodeMaterial;

    textures: {
        textColor?: THREE.Texture,
        textMask?: THREE.Texture
    };

    textColorMap?: ImageBitmap;

    textMaskMap?: ImageBitmap;

    showTextNode?: THREE.UniformNode<"bool", boolean>;

    textEmissiveNode?: THREE.UniformNode<"color", THREE.Color>;

    textEmissiveIntensityNode?: THREE.UniformNode<"float", number>;

    textBumpNode?: THREE.UniformNode<"float", number>;

    constructor(config: DiceMaterialConfig, diceModel: DiceModel, submat: DiceMaterialSubmat) {
        this.config = config;
        this.diceModel = diceModel;
        this.submat = submat;

        this.textures = {};
        if (submat === "faces" || submat === "facesSecret") {
            this.textures.textColor = new THREE.Texture();
            this.textures.textColor.flipY = false;
            this.textures.textColor.colorSpace = THREE.SRGBColorSpace;
            this.textures.textMask = new THREE.Texture();
            this.textures.textMask.flipY = false;
            this.textures.textMask.colorSpace = THREE.NoColorSpace;
        }
        this.initMaterial();
    }

    initMaterial() {
        this.material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });

        const black = new THREE.Color(0, 0, 0);

        const noise = game.simplyDice.textureManager!.loadTexture(MODULE.relativePath("textures/noise.png"), true)!;
        this.material.opacityNode = TSL.texture(noise).r;
        this.material.alphaTestNode = TSL.userData("disappear", "float").toFloat();

        if (this.submat === "faces" || this.submat === "facesSecret") {
            this.showTextNode = TSL.uniform(true);
            this.material.colorNode = TSL.select(this.showTextNode, TSL.blendColor(TSL.materialColor, TSL.texture(this.textures.textColor)), TSL.materialColor) as THREE.Node<"vec4">;

            // For emissive, we create an emissive node using the material's emissive values and combine with the text's emissive
            this.textEmissiveNode = TSL.uniform(black);
            this.textEmissiveIntensityNode = TSL.uniform(1);

            this.material.emissiveNode = TSL.select(this.showTextNode, 
                TSL.mix(TSL.materialEmissive as unknown as THREE.Node<"vec3">, 
                TSL.mul(this.textEmissiveNode.rgb, this.textEmissiveIntensityNode, 
                TSL.texture(this.textures.textMask).r), TSL.texture(this.textures.textMask).r), 
                TSL.materialEmissive);

            this.textBumpNode = TSL.uniform(-1);
            const bumpNode = TSL.bumpMap(TSL.texture(this.textures.textMask), TSL.vec2(this.textBumpNode, this.textBumpNode));
            const maskAlpha = TSL.texture(this.textures.textMask).a;

            // Combine the existing normal map with the bump
            // We use a cast because Typescript declaration is lacking
            this.material.normalNode = TSL.mix(TSL.materialNormal as THREE.Node<"vec3">, TSL.select(this.showTextNode, bumpNode, TSL.materialNormal) as THREE.Node<"vec3">, maskAlpha);
        }
        this.material.castShadowNode = TSL.vec4(0, 0, 0, TSL.select(TSL.lessThan(this.material.alphaTestNode as THREE.Node<"float">, this.material.opacityNode as THREE.Node<"float">), TSL.float(1), TSL.float(0)));
    }

    buildMaterial(skipText?: boolean) {
        if (!game.simplyDice.textureManager)
            throw new Error("Texture manager not created?");
        const texMan = game.simplyDice.textureManager;

        this.material.setValues({
            color: typeof this.config.color !== "string" ? this.config.color.css : this.config.color,
            map: texMan.loadTexture(this.config.colorMap),
            metalness: this.config.metalness,
            metalnessMap: texMan.loadTexture(this.config.metalnessMap, true),
            roughness: this.config.roughness,
            roughnessMap: texMan.loadTexture(this.config.roughnessMap, true),
            emissive: typeof this.config.emissiveColor !== "string" ? this.config.emissiveColor.css : this.config.emissiveColor,
            emissiveIntensity: this.config.emissiveIntensity,
            emissiveMap: texMan.loadTexture(this.config.emissiveMap),
            normalMap: texMan.loadTexture(this.config.normalMap, true),
            normalScale: new THREE.Vector2(this.config.normalScale, this.config.normalScale)
        });
        // Generating text labels
        if (!skipText && (this.submat === "faces" || this.submat === "facesSecret") && this.config.text) {
            const textConfig = this.config.text;
            this.showTextNode!.value = textConfig.show;

            if (textConfig.show) {
                this.generateTextTexture().then(texs => {
                    if (texs.length == 2)
                        this.updateTextures(texs[0], texs[1]);
                });
            }
            this.textEmissiveNode!.value = new THREE.Color(textConfig.emissiveColor.valueOf());
            this.textEmissiveIntensityNode!.value = textConfig.emissiveIntensity;
            this.textBumpNode!.value = textConfig.bump;
        }

        this.material.needsUpdate = true;
    }

    async generateTextTexture(): Promise<ImageBitmap[]> {
        const textCanvas = DiceMaterial.texRenderCanvas;
        if (!textCanvas)
            return [];

        const definition = this.diceModel.definition.text;
        const config = this.config.text!;

        if (!definition.items || !definition.items.length)
            return [];

        const w = textCanvas.width;
        const h = textCanvas.height;
        const hratio = h / 1024;

        let symbolMap: Map<string, { image: HTMLImageElement, symbol: DiceMaterialSymbolConfig }> | undefined = undefined;
        if (this.submat === "faces" && config.symbols) {
            symbolMap = new Map();
            await Promise.all(Object.entries(config.symbols).filter(entry => entry[1].url && entry[1].url !== "").map(entry => new Promise<void>((resolve) => {
                const image = new Image();
                image.src = entry[1].url;
                image.onload = () => {
                    symbolMap!.set(entry[0], { image, symbol: entry[1] });
                    resolve();
                };
                image.onerror = () => {
                    resolve();
                }
                image.decode();
                globalThis.setTimeout(resolve, 5000);
            })));
        }

        const context = textCanvas.getContext("2d");
        if (!context)
            return [];

        context.clearRect(0, 0, w, h);
        context.reset();

        const textHeight = definition.height * hratio;
        context.font = `${config.weight ?? ""} ${textHeight}px ${config.font}`;
        context.textAlign = "center";
        context.lineCap = "round";
        context.fillStyle = config.color.toString();
        context.strokeStyle = config.outlineColor.toString();
        context.lineWidth = 5;

        this.drawText(context, definition, config, false, symbolMap);

        const textColorMap = textCanvas.transferToImageBitmap();

        // Creation of a mask map
        context.resetTransform();
        context.globalAlpha = 1;
        context.clearRect(0, 0, w, h);
        context.fillStyle = "white";
        context.strokeStyle = "black";

        this.drawText(context, definition, config, true, symbolMap);

        const textMaskMap = textCanvas.transferToImageBitmap();

        return [textColorMap, textMaskMap];
    }

    private drawText(context: OffscreenCanvasRenderingContext2D, definition: DiceTextDefinition, config: DiceMaterialTextConfig, mask: boolean, symbolMap?: Map<string, { image: HTMLImageElement, symbol: DiceMaterialSymbolConfig }>) {
        const textCanvas = DiceMaterial.texRenderCanvas!;
        const wratio = textCanvas.width / 1024;
        const hratio = textCanvas.height / 1024;

        const textMaxWidth = definition.maxWidth * wratio;

        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        if (!mask) {
            context.shadowColor = config.outlineColor.toString();
            context.shadowBlur = 3;
        } else {
            context.shadowColor = "black";
            context.shadowBlur = 2;
        }
        context.globalAlpha = 1;

        for (const textItem of definition.items) {
            context.resetTransform();

            context.translate(textItem.position[0] * wratio, textItem.position[1] * hratio);
            if (textItem.rotation)
                context.rotate(Math.toRadians(textItem.rotation));

            const label = this.submat === "faces" ? textItem.label : "?";
            const symbolElement = symbolMap?.get(label);
            if (symbolElement) {
                const symbol = symbolElement.image;

                const scale = symbolElement.symbol.scale ?? 1;
                let width = scale * symbol.naturalWidth * definition.height / symbol.naturalHeight;
                let height = scale * definition.height;

                if (width > definition.maxWidth) {
                    width = definition.maxWidth;
                    height = definition.maxWidth * symbol.naturalHeight / symbol.naturalWidth;
                }

                width = Math.max(width, 2);
                height = Math.max(height, 2);

                context.drawImage(symbol, 0, 0, symbol.naturalWidth, symbol.naturalHeight, -width / 2, -height / 2, width, height);

                // For applying color on the image
                if (symbolElement.symbol.applyColor) {
                    if (!DiceMaterial.intermediateCanvas)
                        DiceMaterial.intermediateCanvas = new OffscreenCanvas(width, height);
                    DiceMaterial.intermediateCanvas.width = width;
                    DiceMaterial.intermediateCanvas.height = height;
                    const intermediateContext = DiceMaterial.intermediateCanvas.getContext("2d")!;

                    // Paint the image on an intermediate canvas first and cover it with the color
                    intermediateContext.globalCompositeOperation = "source-over";
                    intermediateContext.drawImage(symbol, 0, 0, symbol.naturalWidth, symbol.naturalHeight, 0, 0, width, height);
                    intermediateContext.globalCompositeOperation = "source-atop";
                    intermediateContext.fillStyle = config.color.toString();
                    intermediateContext.fillRect(0, 0, width, height);

                    context.save();

                    // Paint the intermediate canvas on top of the image with multiply
                    context.shadowColor = "rgba(0, 0, 0, 0)";
                    context.globalCompositeOperation = "multiply";
                    context.drawImage(DiceMaterial.intermediateCanvas, 0, 0, width, height, -width / 2, -height / 2, width, height);

                    context.restore();
                }
            }
            else {
                const metrics = context.measureText(label);
                context.translate(0, metrics.actualBoundingBoxAscent / 2 - metrics.actualBoundingBoxDescent / 2);

                this.write(label, context, config.opacity, config.outlineOpacity, textMaxWidth, mask);

                if (this.submat === "faces" && textItem.distinguisher) {
                    this.write("  .", context, config.opacity, config.outlineOpacity, textMaxWidth, mask);
                }
            }
        }
    }

    private write(text: string, context: OffscreenCanvasRenderingContext2D, opacity: number, outlineOpacity: number, maxWidth: number, mask: boolean) {
        if (!mask) {
            // Outline stroke
            context.save();
            context.shadowColor = "rgba(0, 0, 0, 0)";
            context.globalAlpha = outlineOpacity
            context.strokeText(text, 0, 0, maxWidth);
            context.restore();

            context.globalAlpha = opacity;
        }
        else {
            context.strokeText(text, 0, 0, maxWidth);
        }
        context.fillText(text, 0, 0, maxWidth);
    }

    updateTextures(textColorMap: ImageBitmap, textMaskMap: ImageBitmap) {
        // Closing previous image texture
        if (this.textColorMap)
            this.textColorMap.close();
        if (this.textMaskMap)
            this.textMaskMap.close();

        if (this.textures.textColor) {
            this.textures.textColor.image = textColorMap;
            this.textColorMap = textColorMap;
            this.textures.textColor.needsUpdate = true;
        }

        if (this.textures.textMask) {
            this.textures.textMask.image = textMaskMap;
            this.textMaskMap = textMaskMap;
            this.textures.textMask.needsUpdate = true;
        }
    }

    dispose() {
        this.material.dispose();
        Object.values(this.textures).forEach(t => t.dispose());
        this.textColorMap?.close();
        this.textMaskMap?.close();
    }
}

export { DiceMaterial, UserDiceMaterials, defaultMaterialConfig, diceMaterialConfigSchema }
export type { DiceMaterialConfig, DiceMaterialTextConfig, DiceMaterialSymbolConfig, DiceMaterialConfigGroup, DiceMaterialSet }