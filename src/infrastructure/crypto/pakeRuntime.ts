import { bufferToHex } from "@/lib/bytes";

declare global {
    interface Window {
        Go?: new () => {
            importObject: WebAssembly.Imports;
            run(instance: WebAssembly.Instance): void;
        };
        wormlinkPake?: {
            start(pass: Uint8Array): string | null;
            exchange(pass: Uint8Array, msg: string): [Uint8Array | null, string | null];
            finish(msg: string): Uint8Array | null;
        };
    }
}

interface PakeBindings {
    start(pass: Uint8Array): string;
    exchange(pass: Uint8Array, msg: string): [Uint8Array, string];
    finish(msg: string): Uint8Array;
}

let runtimePromise: Promise<PakeBindings> | null = null;

const WASM_EXEC_PATH = `${import.meta.env.BASE_URL}wasm_exec.js`;
const WASM_BINARY_PATH = `${import.meta.env.BASE_URL}wormlink-pake.wasm`;

const loadScript = async (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
            if ((existing as HTMLScriptElement).dataset.loaded === "true") {
                resolve();
            }
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.loaded = "false";
        script.onload = () => {
            script.dataset.loaded = "true";
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });

export const toFingerprint = (value: Uint8Array): { value: string; short: string } => {
    const bytes = new Uint8Array(value);
    const hex = bufferToHex(bytes.buffer);
    return {
        value: hex,
        short: `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`,
    };
};

export const loadPakeRuntime = async (): Promise<PakeBindings> => {
    if (runtimePromise) {
        return runtimePromise;
    }

    runtimePromise = (async () => {
        if (!window.Go) {
            await loadScript(WASM_EXEC_PATH);
        }
        if (!window.Go) {
            throw new Error("Go WebAssembly runtime is unavailable.");
        }

        const go = new window.Go();
        const response = await fetch(WASM_BINARY_PATH);
        if (!response.ok) {
            throw new Error("Failed to load the PAKE WebAssembly binary.");
        }

        const bytes = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
        go.run(instance);

        const pake = window.wormlinkPake;
        if (!pake) {
            throw new Error("PAKE runtime did not expose its bindings.");
        }

        return {
            start(pass) {
                const message = pake.start(pass);
                if (!message) {
                    throw new Error("Could not generate the PAKE initiator message.");
                }
                return message;
            },
            exchange(pass, msg) {
                const [key, responseMessage] = pake.exchange(pass, msg);
                if (!key || !responseMessage) {
                    throw new Error("Could not derive the PAKE responder key.");
                }
                return [key, responseMessage];
            },
            finish(msg) {
                const key = pake.finish(msg);
                if (!key) {
                    throw new Error("Could not derive the PAKE initiator key.");
                }
                return key;
            },
        };
    })();

    return runtimePromise;
};

export const encodePakePassword = (password: string): Uint8Array =>
    new TextEncoder().encode(password);
