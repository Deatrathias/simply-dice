import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import * as THREE from "three/webgpu";


class TextureManager {
    imageLoader: THREE.ImageBitmapLoader;

    imageCache: Map<string, ImageBitmap>;

    textureCache: Map<string, THREE.Texture>;

    missingImage!: ImageBitmap;

    white: THREE.Texture;

    blue: THREE.Texture;

    constructor() {
        THREE.Cache.enabled = true;
        this.imageLoader = new THREE.ImageBitmapLoader();
        this.imageLoader.load(MODULE.relativePath("textures/missing.png"), img => this.missingImage = img);
        this.imageLoader.setOptions({ imageOrientation: "from-image", colorSpaceConversion: "default" });
        this.imageCache = new Map();
        this.textureCache = new Map();
        this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]));
        this.white.needsUpdate = true;
        this.blue = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]));
        this.blue.needsUpdate = true;
    }

    loadImage(url: string, callback?: (image: ImageBitmap) => void, onError?: (err: unknown) => void) {
        const existing = this.imageCache.get(url);
        if (existing) {
            if (callback)
                callback(existing);
            return;
        }
        
        this.imageLoader.load(url, callback, undefined, (err) => {
            console.error(`Could not load texture ${url}`);
            if (onError)
                onError(err);
        });
    }

    async loadImageAsync(url: string): Promise<ImageBitmap> {
        const result = await new Promise<ImageBitmap>(resolve => this.loadImage(url, image => resolve(image)));

        return result;
    }

    loadTexture(url: string, callback?: (texture: THREE.Texture) => void, nonColor: boolean = false): THREE.Texture {
        const existing = this.textureCache.get(url);
        if (existing) {
            if (callback)
                callback(existing);
            return existing;
        }

        const texture = new THREE.Texture();
        if (nonColor)
            texture.colorSpace = THREE.NoColorSpace;
        else
            texture.colorSpace = THREE.SRGBColorSpace;
        this.textureCache.set(url, texture);

        this.loadImage(url, img => {
            texture.image = img;
            texture.needsUpdate = true;
            if (callback)
                callback(texture);
        }, (err) => {
            texture.image = this.missingImage;
            texture.needsUpdate = true;
        });

        return texture;
    }
}

function initTextureManager() {
    game.simplyDice.textureManager = new TextureManager();
}

export { TextureManager, initTextureManager }