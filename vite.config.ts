import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
    root: ".",
    publicDir: path.resolve(__dirname, "static"),
    base: "",
    server: {
        port: 30001,
        proxy: {
            "^(?!/modules/simply-dice)": "http://localhost:30000",
            "/socket.io": { target: "ws://localhost:30000", ws: true }
        }
    },
    resolve: { 
        tsconfigPaths: true
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: false,
        assetsDir: "assets",
        lib: { entry: "src/main.ts", formats: ["es"], fileName: "scripts/main" },
        rolldownOptions: {
        }
    },
    plugins: [ ]
});