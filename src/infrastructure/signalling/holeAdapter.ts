import type { SignalEnvelope, SignalMessage } from "@/core/types/signalling";
import type { RendezvousAdapter } from "@/core/protocol/contracts";
import { assertInitMessage, assertSignalEnvelope, parseJson } from "@/core/protocol/runtimeGuards";
import type { EncryptedPayload, SessionCrypto } from "@/core/types/crypto";
import { buildSessionCode, parseSessionCode } from "@/core/session/sessionCode";
import { createSessionPassword } from "@/core/session/sessionCode";
import { encodePakePassword, loadPakeRuntime, toFingerprint } from "@/infrastructure/crypto/pakeRuntime";
import { createEmitter } from "@/lib/events";
import { textDecoder, textEncoder, bufferToBase64, base64ToBuffer } from "@/lib/bytes";

const DEFAULT_PROTOCOL = "4";
export const DEFAULT_SIGNAL_URL = "https://hole.0x0.st/";

const LOCAL_SIGNAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

interface ProbeOptions {
    endpoint: string;
    protocol?: string;
    timeoutMs?: number;
}

const normaliseEndpoint = (endpoint: string): string => {
    const base = new URL(endpoint.trim());
    if (!isTrustedSignalOrigin(base)) {
        throw new Error("Only HTTPS backends are allowed, except for localhost development servers.");
    }
    const path = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return `${base.protocol}//${base.host}${path}`;
};

export const isTrustedSignalOrigin = (url: URL): boolean =>
    url.protocol === "https:" || (url.protocol === "http:" && LOCAL_SIGNAL_HOSTS.has(url.hostname));

export const describeSignalEndpointTrust = (endpoint: string): "secure" | "local" => {
    const url = new URL(endpoint);
    return url.protocol === "https:" ? "secure" : "local";
};

const buildWebsocketUrl = (endpoint: string, slot?: string): string => {
    const base = new URL(endpoint);
    const protocol = base.protocol === "http:" ? "ws:" : "wss:";
    const path = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    const suffix = slot ? `${slot}` : "";
    return `${protocol}//${base.host}${path}${suffix}`;
};

export const validateWormholeEndpoint = async ({
    endpoint,
    protocol = DEFAULT_PROTOCOL,
    timeoutMs = 5_500,
}: ProbeOptions): Promise<{ endpoint: string }> => {
    const normalizedEndpoint = normaliseEndpoint(endpoint);
    const url = buildWebsocketUrl(normalizedEndpoint);

    return new Promise<{ endpoint: string }>((resolve, reject) => {
        let settled = false;
        const socket = new WebSocket(url, protocol);

        const finish = (callback: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            callback();
        };

        const timeout = window.setTimeout(() => {
            finish(() => {
                socket.close();
                reject(new Error("Validation timed out before the server initialized."));
            });
        }, timeoutMs);

        socket.onopen = () => undefined;

        socket.onerror = () => {
            finish(() => {
                window.clearTimeout(timeout);
                reject(new Error("The server is unreachable or refused the WebSocket connection."));
            });
        };

        socket.onclose = (event) => {
            if (settled) {
                return;
            }

            finish(() => {
                window.clearTimeout(timeout);
                if (event.code === 4003) {
                    reject(new Error("The server answered, but with an incompatible WebWormhole protocol."));
                    return;
                }
                reject(new Error(`The server closed the connection during initialization (${event.code}).`));
            });
        };

        socket.onmessage = (event) => {
            if (settled) {
                return;
            }

            try {
                const init: unknown = parseJson(String(event.data));
                assertInitMessage(init);
                const parsedInit = init as { slot?: string; iceServers?: RTCIceServer[] };
                finish(() => {
                    window.clearTimeout(timeout);
                    socket.close(1000, "validated");
                    resolve({ endpoint: normalizedEndpoint });
                });
            } catch {
                finish(() => {
                    window.clearTimeout(timeout);
                    socket.close();
                    reject(new Error("The endpoint does not expose a valid WebWormhole initialization payload."));
                });
            }
        };
    });
};

export class HoleSignallingAdapter implements RendezvousAdapter {
    private socket?: WebSocket;
    private readonly envelopeEmitter = createEmitter<SignalEnvelope>();
    private readonly fingerprintEmitter = createEmitter<{ value: string; short: string }>();
    private readonly sharedSecretEmitter = createEmitter<Uint8Array>();
    private readonly debugEmitter = createEmitter<{ message: string; raw?: SignalMessage }>();
    private sharedKey?: CryptoKey;
    private slot?: string;
    private connected = false;
    private password?: string;

    constructor(
        private readonly cryptoService: SessionCrypto,
        private readonly endpoint = import.meta.env.VITE_WORMLINK_RENDEZVOUS_URL ?? DEFAULT_SIGNAL_URL,
        private readonly protocol = import.meta.env.VITE_WORMLINK_PROTOCOL ?? DEFAULT_PROTOCOL,
    ) {}

    async connect(): Promise<void> {
        this.connected = true;
    }

    async createCode(): Promise<{ code: string; password: string; nameplate: string; iceServers: RTCIceServer[] }> {
        const password = createSessionPassword();
        const { slot, iceServers } = await this.openSocket();
        this.slot = slot;
        this.password = password;
        if (this.socket) {
            this.attachBootstrapListener(this.socket);
        }
        const code = buildSessionCode(slot, password);

        return {
            code: code.value,
            password,
            nameplate: slot,
            iceServers,
        };
    }

    async joinWithCode(codeValue: string): Promise<{ password: string; nameplate: string; iceServers: RTCIceServer[] }> {
        const code = parseSessionCode(codeValue);
        const { iceServers } = await this.openSocket(code.nameplate);
        this.slot = code.nameplate;
        this.password = code.password;
        await this.performJoinPake(code.password);

        return {
            password: code.password,
            nameplate: code.nameplate,
            iceServers,
        };
    }

    async sendEnvelope(envelope: SignalEnvelope): Promise<void> {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sharedKey) {
            throw new Error("Rendezvous session is not ready.");
        }

        // Le backend ne voit que l'enveloppe chiffrée.
        const encrypted = await this.cryptoService.encryptPayload(this.sharedKey, envelope);
        const serialized = JSON.stringify(encrypted);
        this.socket.send(bufferToBase64(textEncoder.encode(serialized).buffer));
        this.debugEmitter.emit({
            message: `WS -> ${envelope.type}`,
            raw: { phase: envelope.type, body: `[encrypted:${serialized.length}]` },
        });
    }

    onEnvelope(listener: (envelope: SignalEnvelope) => void): () => void {
        return this.envelopeEmitter.subscribe(listener);
    }

    onFingerprint(listener: (fingerprint: { value: string; short: string }) => void): () => void {
        return this.fingerprintEmitter.subscribe(listener);
    }

    onSharedSecret(listener: (sharedSecret: Uint8Array) => void): () => void {
        return this.sharedSecretEmitter.subscribe(listener);
    }

    onDebug(listener: (message: string, raw?: SignalMessage) => void): () => void {
        return this.debugEmitter.subscribe(({ message, raw }) => listener(message, raw));
    }

    async close(): Promise<void> {
        if (!this.socket) {
            return;
        }

        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close(1000, "closing");
        }

        this.socket = undefined;
        this.sharedKey = undefined;
        this.slot = undefined;
        this.connected = false;
        this.password = undefined;
    }

    private async openSocket(slot?: string): Promise<{ slot: string; iceServers: RTCIceServer[] }> {
        await this.close();
        // Si slot existe, on rejoint. Sinon le srv en crée un.
        const url = this.websocketUrl(slot);

        this.debugEmitter.emit({
            message: `Opening rendezvous socket ${url}`,
        });

        const socket = new WebSocket(url, this.protocol);
        this.socket = socket;

        return new Promise<{ slot: string; iceServers: RTCIceServer[] }>((resolve, reject) => {
            let settled = false;

            const fail = (error: Error): void => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(error);
            };

            socket.onopen = () => {
                this.debugEmitter.emit({
                    message: "Rendezvous socket established.",
                });
            };

            socket.onerror = () => {
                fail(new Error(`Could not connect to signalling server at ${new URL(this.endpoint).host}.`));
            };

            socket.onclose = (event) => {
                this.debugEmitter.emit({
                    message: `Rendezvous socket closed (${event.code}: ${event.reason || "no reason"})`,
                });

                if (!settled) {
                    if (event.code === 4003) {
                        fail(new Error("Wrong WebWormhole protocol version."));
                        return;
                    }
                    fail(new Error(`Rendezvous socket closed before initialization (${event.code}).`));
                    return;
                }

                if (this.connected) {
                    this.connected = false;
                }
            };

            socket.onmessage = async (event) => {
                if (!settled) {
                    try {
                        const init: unknown = parseJson(String(event.data));
                        assertInitMessage(init);
                        const parsedInit = init as { slot?: string; iceServers?: RTCIceServer[] };
                        const assignedSlot = slot ?? parsedInit.slot;
                        if (!assignedSlot) {
                            fail(new Error("Rendezvous server did not provide a slot."));
                            return;
                        }

                        settled = true;
                        this.slot = assignedSlot;
                        resolve({
                            slot: assignedSlot,
                            iceServers: parsedInit.iceServers ?? [],
                        });
                    } catch (error) {
                        fail(error instanceof Error ? error : new Error("Invalid rendezvous init payload."));
                    }
                }
            };

            window.setTimeout(() => fail(new Error("Rendezvous initialization timed out.")), 10_000);
        });
    }

    private attachBootstrapListener(socket: WebSocket): void {
        socket.onmessage = async (event) => {
            const body = String(event.data);
            if (!this.password || !this.slot) {
                this.debugEmitter.emit({
                    message: "Discarded bootstrap signalling message before password/slot were ready.",
                });
                return;
            }

            if (this.sharedKey) {
                await this.handleEncryptedEnvelope(body);
                return;
            }

            try {
                const runtime = await loadPakeRuntime();
                const pass = encodePakePassword(this.password);
                const [sharedSecret, response] = runtime.exchange(pass, body);
                await this.applyPakeSharedSecret(sharedSecret);
                socket.send(response);
                this.debugEmitter.emit({
                    message: "PAKE responder handshake completed.",
                });
            } catch (error) {
                this.debugEmitter.emit({
                    message: error instanceof Error ? error.message : "PAKE responder handshake failed.",
                });
            }
        };
    }

    private async performJoinPake(password: string): Promise<void> {
        if (!this.socket) {
            throw new Error("Rendezvous socket is not ready.");
        }

        const runtime = await loadPakeRuntime();
        const pass = encodePakePassword(password);
        const msgA = runtime.start(pass);
        this.socket.send(msgA);
        this.debugEmitter.emit({
            message: `WS -> pake-a`,
        });

        const msgB = await new Promise<string>((resolve, reject) => {
            if (!this.socket) {
                reject(new Error("Rendezvous socket disappeared during PAKE."));
                return;
            }

            const socket = this.socket;
            const cleanup = (): void => {
                socket.removeEventListener("message", handleMessage);
                socket.removeEventListener("error", handleError);
                socket.removeEventListener("close", handleClose);
            };
            const handleMessage = (event: MessageEvent): void => {
                cleanup();
                resolve(String(event.data));
            };
            const handleError = (): void => {
                cleanup();
                reject(new Error("Rendezvous socket failed during PAKE."));
            };
            const handleClose = (closeEvent: CloseEvent): void => {
                cleanup();
                reject(new Error(`Rendezvous socket closed during PAKE (${closeEvent.code}).`));
            };

            socket.addEventListener("message", handleMessage);
            socket.addEventListener("error", handleError);
            socket.addEventListener("close", handleClose);
        });

        const sharedSecret = runtime.finish(msgB);
        await this.applyPakeSharedSecret(sharedSecret);
        this.attachEnvelopeListener(this.socket);
        this.debugEmitter.emit({
            message: "PAKE initiator handshake completed.",
        });
    }

    private async applyPakeSharedSecret(sharedSecret: Uint8Array): Promise<void> {
        const rootSecret = new Uint8Array(sharedSecret);
        const signallingKeyMaterial = await this.cryptoService.deriveSubkey(rootSecret.buffer, "signal");
        const fingerprintMaterial = await this.cryptoService.deriveSubkey(rootSecret.buffer, "fingerprint", 8);
        this.sharedKey = await this.cryptoService.importSessionKey(
            new Uint8Array(signallingKeyMaterial).slice().buffer,
        );
        this.sharedSecretEmitter.emit(rootSecret);
        this.fingerprintEmitter.emit(toFingerprint(fingerprintMaterial));
    }

    private attachEnvelopeListener(socket: WebSocket): void {
        socket.onmessage = async (event) => {
            await this.handleEncryptedEnvelope(String(event.data));
        };
    }

    private async handleEncryptedEnvelope(body: string): Promise<void> {
        try {
            this.debugEmitter.emit({
                message: "WS <- encrypted envelope",
                raw: { phase: "encrypted", body: `[encrypted:${body.length}]` },
            });

            if (!this.sharedKey) {
                return;
            }

            // Le srv relaie du base64 texte.
            const serialized = textDecoder.decode(base64ToBuffer(body));
            const encrypted: unknown = parseJson(serialized);
            const envelope = await this.cryptoService.decryptPayload<SignalEnvelope>(
                this.sharedKey,
                encrypted as EncryptedPayload,
            );
            assertSignalEnvelope(envelope);
            this.envelopeEmitter.emit(envelope);
        } catch (error) {
            this.debugEmitter.emit({
                message: error instanceof Error ? error.message : "Failed to decode encrypted signalling payload.",
            });
        }
    }

    private websocketUrl(slot?: string): string {
        return buildWebsocketUrl(this.endpoint, slot);
    }
}
