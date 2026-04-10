import { MODULE } from "@7h3laughingman/foundry-helpers/utilities";
import * as THREE from "three/webgpu";


class TextureManager {
    imageLoader: THREE.ImageLoader;

    imageCache: Map<string, HTMLImageElement>;

    textureCache: Map<string, THREE.Texture>;

    missingImage: HTMLImageElement;

    constructor() {
        this.imageLoader = new THREE.ImageLoader();
        this.missingImage = this.imageLoader.load(MODULE.relativePath("textures/missing.png"));
        this.imageCache = new Map();
        this.textureCache = new Map();
    }

    loadImage(url: string, callback?: (image: HTMLImageElement) => void, onError?: (err: unknown) => void): HTMLImageElement {
        const existing = this.imageCache.get(url);
        if (existing) {
            if (callback)
                callback(existing);
            return existing;
        }
        
        const result = this.imageLoader.load(url, callback, undefined, (err) => {
            console.error(`Could not load texture ${url}`);
            if (onError)
                onError(err);
        });
        this.imageCache.set(url, result);

        return result;
    }

    async loadImageAsync(url: string): Promise<HTMLImageElement> {
        const result = await new Promise<HTMLImageElement>(resolve => this.loadImage(url, image => resolve(image)));

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
        texture.flipY = false;
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