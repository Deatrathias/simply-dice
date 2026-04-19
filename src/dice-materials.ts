import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { DiceModel, DiceTextDefinition, forEveryModel } from "dice-definition";
import { SETTING } from "settings";
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";
import { colorToStyle } from "utils";

type DiceMaterialConfig = {
    color: number | "user",
    colorMap: string | null,
    roughness: number,
    roughnessMap: string | null,
    metalness: number,
    metalnessMap: string | null,
    emissiveColor: number,
    emissiveIntensity: number,
    emissiveMap: string | null,
    normalMap: string | null,
    normalScale: number,
    text?: DiceMaterialTextConfig
}

type DiceMaterialTextConfig = {
    font: string,
    weight: string,
    color: number,
    emissiveColor: number,
    emissiveIntensity: number,
    outlineColor: number,
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
    emissiveColor: 0,
    emissiveIntensity: 1,
    emissiveMap: null,
    normalMap: null,
    normalScale: 1,
    text: {
        font: "Signika",
        weight: "normal",
        color: 0xffffffff,
        emissiveColor: 0,
        emissiveIntensity: 1,
        outlineColor: 0xff000000,
        bump: -1
    }
} satisfies DiceMaterialConfig;

type DiceMaterialConfigGroup = Record<string, DeepPartial<DiceMaterialConfig>>;

type DiceMaterialSubmat = "faces" | "facesSecret" | "edges";

type DiceMaterialSet = {
    [K in DiceMaterialSubmat]: DiceMaterial
}

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
    updateMaterials(settings?: DiceMaterialConfigGroup, force?: boolean) {
        this.settingGroup = settings;

        for (const material of this.materials) {
            const configFaces = this.getDiceMaterialConfig(material[0], "faces");
            const configEdges = this.getDiceMaterialConfig(material[0], "edges");

            if (force || !foundry.utils.objectsEqual(material[1].faces.config, configFaces)) {
                material[1].faces.config = configFaces;
                material[1].faces.buildMaterial();
                material[1].facesSecret.config = configFaces;
                material[1].facesSecret.buildMaterial();
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
            const userColor = game.users.get(this.userId)?.color;
            result.color = userColor?.valueOf() ?? 0xffffffff;
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

    colorNode!: THREE.UniformNode<"color", THREE.Color>;

    colorMapNode!: THREE.TextureNode;

    metalnessNode!: THREE.UniformNode<"float", number>;

    metalnessMapNode!: THREE.TextureNode;

    roughnessNode!: THREE.UniformNode<"float", number>;

    roughnessMapNode!: THREE.TextureNode;

    emissiveColorNode!: THREE.UniformNode<"color", THREE.Color>;

    emissiveIntensityNode!: THREE.UniformNode<"float", number>

    emissiveMapNode!: THREE.TextureNode;

    normalMapNode!: THREE.TextureNode;

    normalScaleNode!: THREE.UniformNode<"float", number>;

    textEmissiveNode!: THREE.UniformNode<"color", THREE.Color>;

    textEmissiveIntensityNode!: THREE.UniformNode<"float", number>;

    textBumpNode!: THREE.UniformNode<"float", number>;

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
        this.colorNode = TSL.uniform(black);
        this.colorMapNode = TSL.texture().setName("colorMap");

        this.material.colorNode = TSL.mul(this.colorNode.rgb, this.colorMapNode);

        this.metalnessNode = TSL.uniform(0);
        this.metalnessMapNode = TSL.texture().setName("metalnessMap");
        this.material.metalnessNode = TSL.mul(this.metalnessNode, this.metalnessMapNode);

        this.roughnessNode = TSL.uniform(1);
        this.roughnessMapNode = TSL.texture().setName("roughnessMap");
        this.material.roughnessNode = TSL.mul(this.roughnessNode, this.roughnessMapNode);

        this.emissiveColorNode = TSL.uniform(black);
        this.emissiveIntensityNode = TSL.uniform(1);
        this.emissiveMapNode = TSL.texture().setName("emissiveMap");
        this.material.emissiveNode = TSL.mul(this.emissiveColorNode.rgb, this.emissiveIntensityNode, this.emissiveMapNode);

        this.normalMapNode = TSL.texture(game.simplyDice.textureManager?.blue.clone());
        this.normalScaleNode = TSL.uniform(1);
        this.material.normalNode = TSL.normalMap(this.normalMapNode.rgb, TSL.vec2(this.normalScaleNode, this.normalScaleNode));

        this.material.opacityNode = TSL.userData("disappear", "float");

        if (this.submat === "faces" || this.submat === "facesSecret") {
            this.material.colorNode = TSL.blendColor(this.material.colorNode, TSL.texture(this.textures.textColor));

            // For emissive, we create an emissive node using the material's emissive values and combine with the text's emissive
            this.textEmissiveNode = TSL.uniform(black);
            this.textEmissiveIntensityNode = TSL.uniform(1);

            this.material.emissiveNode = TSL.mul(this.textEmissiveNode.rgb, this.textEmissiveIntensityNode, TSL.texture(this.textures.textMask).a).add(this.material.emissiveNode as THREE.Node<"vec3">);

            this.textBumpNode = TSL.uniform(-10);
            const bumpNode = TSL.bumpMap(TSL.texture(this.textures.textMask), TSL.vec2(this.textBumpNode, this.textBumpNode));

            // Combine the existing normal map with the bump
            // We use a cast because Typescript declaration is lacking
            this.material.normalNode = TSL.mix(this.material.normalNode as THREE.Node<"vec3">, bumpNode as unknown as THREE.Node<"vec3">, TSL.texture(this.textures.textMask).a);

            /*this.material.colorNode = TSL.texture(this.textures.textMask);
            this.material.opacityNode = TSL.texture(this.textures.textMask).a;
            this.material.transparent = true;*/
        }
        this.material.castShadowNode = TSL.vec4(0, 0, 0, this.material.opacityNode);
    }

    buildMaterial() {
        if (!game.simplyDice.textureManager)
            throw new Error("Texture manager not created?");

        this.colorNode.value = new THREE.Color(this.config.color ?? 0xff000000);
        if (this.config.colorMap)
            this.colorMapNode.value = game.simplyDice.textureManager.loadTexture(this.config.colorMap);
        else
            this.colorMapNode.value = game.simplyDice.textureManager.white;

        this.metalnessNode.value = this.config.metalness;
        if (this.config.metalnessMap)
            this.metalnessMapNode.value = game.simplyDice.textureManager.loadTexture(this.config.metalnessMap);
        else
            this.metalnessMapNode.value = game.simplyDice.textureManager.white;

        this.roughnessNode.value = this.config.roughness;
        if (this.config.roughnessMap)
            this.roughnessMapNode.value = game.simplyDice.textureManager.loadTexture(this.config.roughnessMap);
        else
            this.roughnessMapNode.value = game.simplyDice.textureManager.white;

        this.emissiveColorNode.value = new THREE.Color(this.config.emissiveColor);
        this.emissiveIntensityNode.value = this.config.emissiveIntensity;
        if (this.config.emissiveMap)
            this.emissiveMapNode.value = game.simplyDice.textureManager.loadTexture(this.config.emissiveMap);
        else
            this.emissiveMapNode.value = game.simplyDice.textureManager.white;

        this.normalScaleNode.value = this.config.normalScale;
        if (this.config.normalMap)
            this.normalMapNode.value = game.simplyDice.textureManager.loadTexture(this.config.normalMap, undefined, true);
        else
            this.normalMapNode.value = game.simplyDice.textureManager.blue;

        // Doing this to refresh the material that isn't normally refreshed by changing texture nodes
        this.material.setValues({
            color: this.colorNode.value,
            map: this.colorMapNode.value,
            metalness: this.metalnessNode.value,
            metalnessMap: this.metalnessMapNode.value,
            roughness: this.roughnessNode.value,
            roughnessMap: this.roughnessMapNode.value,
            emissive: this.emissiveColorNode.value,
            emissiveIntensity: this.emissiveIntensityNode.value,
            emissiveMap: this.emissiveMapNode.value,
            normalMap: this.normalMapNode.value,
            normalScale: new THREE.Vector2(this.normalScaleNode.value, this.normalScaleNode.value)
        });
        // Generating text labels
        if (this.submat === "faces" || this.submat === "facesSecret") {
            const textConfig = this.config.text!;
            this.generateTextTexture().then(texs => {
                if (texs.length == 2)
                    this.updateTextures(texs[0], texs[1]);
            });

            this.textEmissiveNode.value = new THREE.Color(textConfig.emissiveColor);
            this.textEmissiveIntensityNode.value = textConfig.emissiveIntensity;
            this.textBumpNode.value = textConfig.bump;
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
            await Promise.all(Object.entries(config.symbols).map(entry => new Promise<void>((resolve) => {
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
        context.fillStyle = colorToStyle(config.color);
        context.strokeStyle = colorToStyle(config.outlineColor);
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
            context.shadowColor = colorToStyle(config.outlineColor);
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
                    intermediateContext.fillStyle = colorToStyle(config.color)
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

                this.write(label, context, config.color, config.outlineColor, textMaxWidth, mask);

                if (this.submat === "faces" && textItem.distinguisher) {
                    this.write("  .", context, config.color, config.outlineColor, textMaxWidth, mask);
                }
            }
        }
    }

    private write(text: string, context: OffscreenCanvasRenderingContext2D, color: number, outlineColor: number, maxWidth: number, mask: boolean) {
        if (!mask) {
            // Outline stroke
            context.save();
            context.shadowColor = "rgba(0, 0, 0, 0)";
            context.globalAlpha = ((outlineColor >>> 24) & 255) / 255
            context.strokeText(text, 0, 0, maxWidth);
            context.restore();

            context.globalAlpha = ((color >>> 24) & 255) / 255;
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

export { DiceMaterial, UserDiceMaterials, defaultMaterialConfig }
export type { DiceMaterialConfig, DiceMaterialTextConfig, DiceMaterialConfigGroup, DiceMaterialSet }