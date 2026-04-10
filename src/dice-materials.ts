import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import { DiceModel, forEveryModel } from "dice-definition";
import { SETTING } from "settings";
import * as TSL from "three/tsl";
import * as THREE from "three/webgpu";

type DiceMaterialConfig = {
    color?: number | null,
    colorMap?: string,
    roughness: number,
    roughnessMap?: string,
    metalness: number,
    metalnessMap?: string,
    emissiveColor: number,
    emissiveIntensity: number,
    emissiveMap?: string,
    normalMap?: string,
    normalScale: number,
    text: {
        font: string,
        weight?: string,
        color: number,
        emissiveColor: number,
        emissiveIntensity: number,
        outlineColor: number,
        symbols?: Record<string, { url: string }>
    }
}

const defaultMaterialConfig = {
    roughness: 0.5,
    metalness: 0,
    emissiveColor: 0,
    emissiveIntensity: 1,
    normalScale: 1,
    text: {
        font: "Signika",
        color: 0xffffffff,
        emissiveColor: 0,
        emissiveIntensity: 1,
        outlineColor: 0xff00000000
    }
} satisfies DiceMaterialConfig;

type DiceMaterialConfigGroup = Record<string, DiceMaterialConfig>;

type DiceMaterialSubmat = "faces" | "edges";

type DiceMaterialSet = {
    [K in DiceMaterialSubmat]: DiceMaterial
}

class UserDiceMaterials {
    userId: string;

    materials: Map<string, DiceMaterialSet>;

    settingGroup?: DiceMaterialConfigGroup;

    constructor(userId: string) {
        this.userId = userId;
        this.materials = new Map();
    }

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

    initMaterials() {
        this.settingGroup = (game.settings.storage.get("user").getSetting(`${MODULE.id}.${SETTING.DICE_MATERIALS}`, this.userId).value as DiceMaterialConfigGroup | null) ?? undefined;

        forEveryModel((denomination, model) => {
            let materialSet = this.materials.get(denomination);
            const configFaces = this.getDiceMaterialConfig(denomination, "faces");
            const configEdges = this.getDiceMaterialConfig(denomination, "edges");

            if (!materialSet) {
                materialSet = {
                    faces: new DiceMaterial(configFaces, this.userId, model, "faces"),
                    edges: new DiceMaterial(configEdges, this.userId, model, "edges")
                };
                this.materials.set(denomination, materialSet);
            }
            else {
                materialSet.faces.config = configFaces;
                materialSet.edges.config = configEdges;
            }

            materialSet.faces.buildMaterial(); 
            materialSet.edges.buildMaterial();
        });
    }

    updateMaterials(settings?: DiceMaterialConfigGroup) {
        this.settingGroup = settings;

        for (const material of this.materials) {
            const configFaces = this.getDiceMaterialConfig(material[0], "faces");
            const configEdges = this.getDiceMaterialConfig(material[0], "edges");

            if (!foundry.utils.objectsEqual(material[1].faces.config, configFaces)) {
                material[1].faces.config = configFaces;
                material[1].faces.buildMaterial();
            }

            if (!foundry.utils.objectsEqual(material[1].edges.config, configEdges)) {
                material[1].edges.config = configEdges;
                material[1].edges.buildMaterial();
            }
        }
    }

    getDiceMaterialConfig(denomination: string, submat: DiceMaterialSubmat): DiceMaterialConfig {
        const result: DiceMaterialConfig = foundry.utils.deepClone(defaultMaterialConfig);

        if (!this.settingGroup)
            return result;

        foundry.utils.mergeObject(result, this.settingGroup.global, { recursive: true });
        foundry.utils.mergeObject(result, this.settingGroup[denomination], { recursive: true });
        foundry.utils.mergeObject(result, this.settingGroup[`${denomination}.${submat}`], { recursive: true });

        return result;
    }

    getMaterialSet(denomination: string): DiceMaterialSet | undefined {
        return this.materials.get(denomination);
    }
}

class DiceMaterial {
    config: DiceMaterialConfig;

    userId: string;

    diceModel: DiceModel;

    static texRenderCanvas?: OffscreenCanvas;

    submat: DiceMaterialSubmat;

    material: THREE.MeshStandardNodeMaterial;

    textures: {
        textColor?: THREE.Texture,
        textBump?: THREE.Texture
    };

    constructor(config: DiceMaterialConfig, userId: string, diceModel: DiceModel, submat: DiceMaterialSubmat) {
        this.config = config;
        this.userId = userId;
        this.diceModel = diceModel;
        this.submat = submat;
        
        this.material = new THREE.MeshStandardNodeMaterial();

        this.textures = {};
        if (submat=== "faces") {
            this.textures.textColor = new THREE.Texture();
            this.textures.textBump = new THREE.Texture();
        }
    }

    buildMaterial(): THREE.Material {
        if (!game.simplyDice.textureManager)
            throw new Error("Texture manager not created?");

        const baseColor = this.config.color ?? ((game.users.get(this.userId)?.color.valueOf() ?? 0xffffffff) | 0xff000000);

        this.material.setValues({ 
            metalness: this.config.metalness, 
            roughness: this.config.roughness,
            emissive: this.config.emissiveColor,
            emissiveIntensity: this.config.emissiveIntensity,
            normalScale: new THREE.Vector2(this.config.normalScale, this.config.normalScale) });
        let colorNode = TSL.color(baseColor);
        this.material.colorNode = colorNode;
        if (this.config.colorMap) {
            const tex = game.simplyDice.textureManager.loadTexture(this.config.colorMap);
            this.material.colorNode = TSL.texture(tex).mul(colorNode);
        }
        //this.material.opacity = ((baseColor >>> 24) & 0xff) / 255;

        if (this.config.metalnessMap)
            this.material.metalnessMap = game.simplyDice.textureManager.loadTexture(this.config.metalnessMap, undefined, true);
        else
            this.material.metalnessMap = null;
        
        if (this.config.roughnessMap)
            this.material.roughnessMap = game.simplyDice.textureManager.loadTexture(this.config.roughnessMap, undefined, true);
        else
            this.material.roughnessMap = null;

        if (this.config.emissiveMap)
            this.material.emissiveMap = game.simplyDice.textureManager.loadTexture(this.config.emissiveMap);
        else
            this.material.emissiveMap = null;

        if (this.config.normalMap)
            this.material.normalMap = game.simplyDice.textureManager.loadTexture(this.config.normalMap, undefined, true);
        else
            this.material.normalMap = null;

        if (this.submat === "faces")
            this.generateTextTexture();

        this.material.needsUpdate = true;
        return this.material;
    }

    generateTextTexture() {
        if (!DiceMaterial.texRenderCanvas)
            return;

        const text = this.diceModel.definition.text;
        if (!text || !text.items || !text.items.length)
            return;

        const w = DiceMaterial.texRenderCanvas.width;
        const h = DiceMaterial.texRenderCanvas.height;

        const textConfig = this.config.text;

        const context = DiceMaterial.texRenderCanvas.getContext("2d");
        if (!context)
            return;

        context.clearRect(0, 0, w, h);
        context.reset();
        
        context.font = `${textConfig.weight ?? ""} ${this.diceModel.definition.text.height * h}px ${textConfig.font}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineCap = "round";
        context.fillStyle = new THREE.Color(textConfig.color).getStyle();
        context.strokeStyle = new THREE.Color(textConfig.outlineColor).getStyle();
        context.lineWidth = 5;

        for (const textItem of this.diceModel.definition.text.items) {
            context.resetTransform();
            context.translate(textItem.position[0] * w, (textItem.position[1]) * h);
            if (textItem.rotation)
                context.rotate(Math.toRadians(textItem.rotation));

            context.globalAlpha = ((textConfig.outlineColor >>> 24) & 255) / 255;
            context.strokeText(textItem.label, 0, 0);
            context.globalAlpha = ((textConfig.color >>> 24) & 255) / 255;
            context.fillText(textItem.label, 0, 0);
        }

        const textMap = this.textures.textColor!;
        textMap.image = context.canvas.transferToImageBitmap();
        textMap.flipY = false;
        textMap.needsUpdate = true,
        textMap.colorSpace = THREE.SRGBColorSpace;
        const texNode = TSL.texture(textMap);
        
        this.material.colorNode = TSL.blendColor(this.material.colorNode!, texNode);
        
        // For emissive, we create an emissive node using the material's emissive values and combine with the text's emissive
        if (textConfig.emissiveColor !== 0 && textConfig.emissiveIntensity !== 0) {
            let emissiveNode: THREE.Node<"vec3"> = TSL.color(this.material.emissive).rgb;
            if (this.material.emissiveMap)
                emissiveNode = TSL.texture(this.material.emissiveMap).rgb.mul(emissiveNode);
            emissiveNode = emissiveNode.mul(this.material.emissiveIntensity);
            this.material.emissiveNode = TSL.color(textConfig.emissiveColor).mul(textConfig.emissiveIntensity).mul(TSL.texture(textMap).a).add(emissiveNode);
        }
        else
            this.material.emissiveNode = null;

        // Creation of a bump map
        context.resetTransform();
        context.globalAlpha = 1;
        context.clearRect(0, 0, w, h);
        context.fillStyle = "white";

        for (const textItem of this.diceModel.definition.text.items) {
            context.resetTransform();
            context.translate(textItem.position[0] * w, (textItem.position[1]) * h);
            if (textItem.rotation)
                context.rotate(Math.toRadians(textItem.rotation));

            context.fillText(textItem.label, 0, 0);
        }

        const bumpMap = this.textures.textBump!;
        bumpMap.image = context.canvas.transferToImageBitmap();
        bumpMap.flipY = false;
        bumpMap.needsUpdate = true,
        bumpMap.colorSpace = THREE.NoColorSpace;
        const bumpNode = TSL.bumpMap(TSL.oneMinus(TSL.texture(bumpMap)), TSL.vec2(10, 10));

        // Combining normal with bump
        const normalNode = TSL.normalMap((this.material.normalMap ? TSL.texture(this.material.normalMap).rgb : TSL.color(0.5, 0.5, 1)), TSL.vec2(this.material.normalScale));
        // We use a cast because Typescript declaration is lacking
        this.material.normalNode = TSL.normalize(TSL.mix(normalNode as unknown as THREE.Node<"vec3">, bumpNode as unknown as THREE.Node<"vec3">, TSL.texture(bumpMap).a));
    }
}


export { DiceMaterial, UserDiceMaterials }
export type { DiceMaterialConfig, DiceMaterialConfigGroup, DiceMaterialSet }