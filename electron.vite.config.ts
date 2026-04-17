import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            lib: {
                entry: path.resolve(__dirname, "electron/main.ts"),
            },
            outDir: "dist-electron",
            emptyOutDir: false,
            rollupOptions: {
                output: {
                    entryFileNames: "main.js",
                },
            },
        },
    },
    renderer: {
        root: ".",
        base: "./", // <- important
        plugins: [react()],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "src"),
            },
        },
        build: {
            rollupOptions: {
                input: path.resolve(__dirname, "index.html"),
            },
        },
    },
});