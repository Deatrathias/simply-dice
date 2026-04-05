import { defineConfig } from "vite";
import moduleJson from "./static/module.json" with { type: "json" };
import wasm from "vite-plugin-wasm";

export default defineConfig({
    root: ".",
    base: `/modules/${moduleJson.id}`,
    publicDir: "static",
    server: {
        open: "/",
        port: 30001,
        proxy: {
            [`^(?!/modules/${moduleJson.id}/scripts)`]: "http://localhost:30000",
            "/socket.io": { target: "ws://localhost:30000", ws: true }
        }
    },
    resolve: { 
        tsconfigPaths: true
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: true,
        assetsDir: "assets",
        lib: { entry: "src/main.ts", formats: ["es"], fileName: "scripts/main" },
        rolldownOptions: {
        }
    },
    plugins: [ 
        (wasm as unknown as () => any)()
     ]
});