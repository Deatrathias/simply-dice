import * as THREE from "three/webgpu";

export const TAU = Math.PI * 2;

export const HALF_PI = Math.PI / 2;

export const QuaternionIdentity = new THREE.Quaternion(0, 0, 0, 1);

export const VectorZero = new THREE.Vector3(0, 0, 0);

export const VectorOne = new THREE.Vector3(1, 1, 1);

export const VectorRight = new THREE.Vector3(1, 0, 0);

export const VectorUp = new THREE.Vector3(0, 1, 0);

export const VectorForward = new THREE.Vector3(0, 0, 1);

export function randomQuaternion(): THREE.Quaternion {
    return new THREE.Quaternion(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
}

export function colorToStyle(color: number): string {
    return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${(color >> 24) & 255})`;
}