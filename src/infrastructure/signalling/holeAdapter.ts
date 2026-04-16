import type { SignalEnvelope, SignalMessage } from "@/core/types/signalling";
import type { RendezvousAdapter } from "@/core/protocol/contracts";
import { assertInitMessage, assertSignalEnvelope, parseJson } from "@/core/protocol/runtimeGuards";
import type { SessionCrypto } from "@/core/types/crypto";
import { buildSessionCode, parseSessionCode } from "@/core/session/sessionCode";
import { createSessionPassword } from "@/core/session/sessionCode";
import { createEmitter } from "@/lib/events";
import { textDecoder, textEncoder, bufferToBase64, base64ToBuffer } from "@/lib/bytes";

const DEFAULT_PROTOCOL = "4";
export const DEFAULT_SIGNAL_URL = "https://hole.0x0.st/";

interface ProbeOptions {
    endpoint: string;
    protocol?: string;
    timeoutMs?: number;
}

const normaliseEndpoint = (endpoint: string): string => {
    const base = new URL(endpoint.trim());
    const path = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return `${base.protocol}//${base.host}${path}`;
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
                const init = parseJson(String(event.data));
                assertInitMessage(init);
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
    private readonly debugEmitter = createEmitter<{ message: string; raw?: SignalMessage }>();
    private sharedKey?: CryptoKey;
    private slot?: string;
    private connected = false;

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
        this.sharedKey = await this.cryptoService.deriveSessionKey(password, `rendezvous:${slot}`);
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
        this.sharedKey = await this.cryptoService.deriveSessionKey(code.password, `rendezvous:${code.nameplate}`);

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
                        const init = parseJson(String(event.data));
                        assertInitMessage(init);
                        const assignedSlot = slot ?? init.slot;
                        if (!assignedSlot) {
                            fail(new Error("Rendezvous server did not provide a slot."));
                            return;
                        }

                        settled = true;
                        this.slot = assignedSlot;
                        // Après l'init, on passe en mode enveloppes chiffrées.
                        this.attachEnvelopeListener(socket);
                        resolve({
                            slot: assignedSlot,
                            iceServers: init.iceServers ?? [],
                        });
                    } catch (error) {
                        fail(error instanceof Error ? error : new Error("Invalid rendezvous init payload."));
                    }
                }
            };

            window.setTimeout(() => fail(new Error("Rendezvous initialization timed out.")), 10_000);
        });
    }

    private attachEnvelopeListener(socket: WebSocket): void {
        socket.onmessage = async (event) => {
            try {
                const body = String(event.data);
                this.debugEmitter.emit({
                    message: "WS <- encrypted envelope",
                    raw: { phase: "encrypted", body: `[encrypted:${body.length}]` },
                });

                if (!this.sharedKey) {
                    return;
                }

                // Le srv relaie du base64 texte.
                const serialized = textDecoder.decode(base64ToBuffer(body));
                const encrypted = parseJson(serialized);
                const envelope = await this.cryptoService.decryptPayload<SignalEnvelope>(this.sharedKey, encrypted);
                assertSignalEnvelope(envelope);
                this.envelopeEmitter.emit(envelope);
            } catch (error) {
                this.debugEmitter.emit({
                    message: error instanceof Error ? error.message : "Failed to decode encrypted signalling payload.",
                });
            }
        };
    }

    private websocketUrl(slot?: string): string {
        return buildWebsocketUrl(this.endpoint, slot);
    }
}
