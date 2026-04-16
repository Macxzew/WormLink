import { useEffect, useRef } from "react";
import type { RendezvousAdapter, PeerTransport } from "@/core/protocol/contracts";
import type { ChatMessage } from "@/core/types/message";
import type { FileTransferRecord } from "@/core/types/transfer";
import type { AppPayload } from "@/core/types/transport";
import {
    createIncomingBlob,
    createObjectUrl,
    createOutgoingTransfer,
    MAX_FILE_BYTES,
    MAX_FILE_CHUNKS,
    revokePreviewUrl,
} from "@/core/transfer/fileTransfer";
import { buildSessionCode, parseSessionCode } from "@/core/session/sessionCode";
import { deserializePayload, serializePayload } from "@/core/protocol/payloadCodec";
import { useSessionStore } from "@/features/session/state/sessionStore";
import { AesGcmSessionCrypto } from "@/infrastructure/crypto/sessionCrypto";
import { DEFAULT_SIGNAL_URL, HoleSignallingAdapter, validateWormholeEndpoint } from "@/infrastructure/signalling/holeAdapter";
import { WebRtcPeerTransport } from "@/infrastructure/transport/webrtcPeer";
import { bufferToHex, textEncoder } from "@/lib/bytes";
import { createId } from "@/lib/id";

interface IncomingFileAssembly {
    descriptor: FileTransferRecord["descriptor"];
    chunks: ArrayBuffer[];
    totalChunks: number;
}

const cryptoService = new AesGcmSessionCrypto();
// Délai max pour rejoindre une session.
const JOIN_TIMEOUT_MS = 8_000;

export const useWormholeController = () => {
    const adapterRef = useRef<RendezvousAdapter | null>(null);
    const transportRef = useRef<PeerTransport | null>(null);
    const appKeyRef = useRef<CryptoKey | null>(null);
    const incomingFilesRef = useRef<Map<string, IncomingFileAssembly>>(new Map());
    const closingRef = useRef(false);
    const localLeaveRef = useRef(false);
    const joinTimeoutRef = useRef<number | null>(null);

    function clearJoinTimeout(): void {
        if (joinTimeoutRef.current !== null) {
            window.clearTimeout(joinTimeoutRef.current);
            joinTimeoutRef.current = null;
        }
    }

    // Nettoie les aperçus créés côté navigateur.
    function cleanupPreviewUrls(): void {
        useSessionStore.getState().transfers.forEach((transfer) => revokePreviewUrl(transfer.previewUrl));
    }

    // Sert à comparer vite les deux côtés.
    async function deriveFingerprint(value: string): Promise<{ value: string; short: string }> {
        const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(`wormlink:fingerprint:${value}`));
        const hex = bufferToHex(digest);
        return {
            value: hex,
            short: `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`,
        };
    }

    async function cancelPendingJoin(message: string): Promise<void> {
        clearJoinTimeout();
        transportRef.current?.close();
        transportRef.current = null;
        await adapterRef.current?.close().catch(() => undefined);
        adapterRef.current = null;
        appKeyRef.current = null;
        incomingFilesRef.current.clear();
        cleanupPreviewUrls();
        useSessionStore.getState().clearLocalSession();
        useSessionStore.getState().setError(message);
    }

    // Branche les logs bas niveau dans le store.
    function bindDebug(adapter: RendezvousAdapter): void {
        adapter.onDebug((message) => {
            useSessionStore.getState().addLog({
                id: createId(),
                level: "debug",
                message,
                timestamp: Date.now(),
            });
        });
    }

    const updateBackendEndpoint = async (rawEndpoint: string): Promise<void> => {
        const store = useSessionStore.getState();
        const candidate = rawEndpoint.trim() || DEFAULT_SIGNAL_URL;

        store.setBackendValidation("validating", "Checking WebWormhole endpoint…");
        store.setError(undefined);

        try {
            const { endpoint } = await validateWormholeEndpoint({ endpoint: candidate });
            store.setBackendEndpoint(endpoint);
            store.setBackendValidation("valid", "Valid WebWormhole backend");
            store.setNotice(
                endpoint === DEFAULT_SIGNAL_URL
                    ? "Default backend restored: hole.0x0.st"
                    : `Backend validated: ${new URL(endpoint).host}`,
            );
        } catch (error) {
            store.setBackendValidation(
                "invalid",
                error instanceof Error ? error.message : "Invalid WebWormhole backend.",
            );
            store.setError(error instanceof Error ? error.message : "Invalid WebWormhole backend.");
        }
    };

    async function sendEncrypted(payload: Exclude<AppPayload, { kind: "encrypted" }>): Promise<void> {
        const appKey = appKeyRef.current;
        const transport = transportRef.current;
        if (!appKey || !transport) {
            throw new Error("The secure channel is not ready yet.");
        }

        const envelope = await cryptoService.encryptPayload(appKey, serializePayload(payload));
        await transport.send({
            kind: "encrypted",
            envelope,
        });
    }

    async function handleEncryptedPayload(
        payload: Extract<AppPayload, { kind: "encrypted" }>,
        closeSession: (notice?: string, notifyPeer?: boolean) => Promise<void>,
    ): Promise<void> {
        const appKey = appKeyRef.current;
        if (!appKey) {
            throw new Error("Missing application key.");
        }
        const decrypted = await cryptoService.decryptPayload<ReturnType<typeof serializePayload>>(appKey, payload.envelope);
        const appPayload = deserializePayload(decrypted);

        if (appPayload.kind === "chat") {
            useSessionStore.getState().addMessage({
                id: appPayload.id,
                author: "remote",
                text: appPayload.text,
                timestamp: appPayload.timestamp,
                deliveryState: "received",
            });
            return;
        }

        if (appPayload.kind === "file-meta") {
            if (appPayload.descriptor.size > MAX_FILE_BYTES) {
                throw new Error("Incoming file exceeds the accepted transfer limit.");
            }
            incomingFilesRef.current.set(appPayload.transferId, {
                descriptor: appPayload.descriptor,
                chunks: [],
                totalChunks: 0,
            });
            useSessionStore.getState().addTransfer({
                id: appPayload.transferId,
                descriptor: appPayload.descriptor,
                createdAt: Date.now(),
                direction: "download",
                progress: 0,
                bytesTransferred: 0,
                state: "running",
            });
            return;
        }

        if (appPayload.kind === "file-chunk") {
            const target = incomingFilesRef.current.get(appPayload.transferId);
            if (!target) {
                return;
            }
            // Coupe les cas incohérents avant assemblage.
            if (appPayload.totalChunks > MAX_FILE_CHUNKS) {
                throw new Error("Incoming transfer exceeds the accepted chunk limit.");
            }
            if (appPayload.chunkIndex < 0 || appPayload.chunkIndex >= appPayload.totalChunks) {
                throw new Error("Incoming transfer has an invalid chunk index.");
            }
            if (appPayload.data.byteLength > 64 * 1024) {
                throw new Error("Incoming chunk exceeds the accepted size.");
            }
            if (target.totalChunks !== 0 && target.totalChunks !== appPayload.totalChunks) {
                throw new Error("Incoming transfer changed total chunk count unexpectedly.");
            }
            target.chunks[appPayload.chunkIndex] = appPayload.data;
            target.totalChunks = appPayload.totalChunks;
            const bytesTransferred = target.chunks.filter(Boolean).reduce((total, chunk) => total + chunk.byteLength, 0);
            useSessionStore.getState().patchTransfer(appPayload.transferId, {
                progress: bytesTransferred / target.descriptor.size,
                bytesTransferred,
            });
            return;
        }

        if (appPayload.kind === "file-complete") {
            const target = incomingFilesRef.current.get(appPayload.transferId);
            if (!target) {
                return;
            }
            // Recolle tous les blocs reçus.
            const blob = createIncomingBlob(target.chunks, target.descriptor.mimeType);
            const objectUrl = createObjectUrl(blob);

            useSessionStore.getState().patchTransfer(appPayload.transferId, {
                progress: 1,
                bytesTransferred: target.descriptor.size,
                state: "completed",
                previewUrl: objectUrl,
                autoDownloaded: false,
            });
            incomingFilesRef.current.delete(appPayload.transferId);
            if (useSessionStore.getState().oneShotMode) {
                await closeSession();
            }
            return;
        }

        if (appPayload.kind === "peer-status") {
            useSessionStore.getState().setPeerConnected(appPayload.state === "joined");
        }
    }

    function wireSignalling(
        adapter: RendezvousAdapter,
        initiator: boolean,
        nameplate: string,
        iceServers: RTCIceServer[],
        closeSession: (notice?: string, notifyPeer?: boolean) => Promise<void>,
    ): void {
        // Le transport WebRTC reste séparé du backend de signalisation.
        const transport = new WebRtcPeerTransport(initiator, iceServers);
        transportRef.current = transport;

        transport.initialize().catch((error) => {
            useSessionStore.getState().setError(error instanceof Error ? error.message : "Failed to start transport.");
        });

        transport.onIceCandidate((candidate) => {
            adapter
                .sendEnvelope({
                    type: "ice-candidate",
                    payload: candidate,
                    sentAt: Date.now(),
                })
                .catch((error) => useSessionStore.getState().setError(error.message));
        });

        transport.onPayload((payload) => {
            if (payload.kind === "encrypted") {
                handleEncryptedPayload(payload, closeSession).catch((error) => {
                    useSessionStore.getState().setError(error instanceof Error ? error.message : "Failed to decrypt payload.");
                });
            }
        });

        transport.onOpen(() => {
            closingRef.current = false;
            clearJoinTimeout();
            useSessionStore.getState().setPeerConnected(true);
            useSessionStore.getState().setStage("secure-ready", "Encrypted channel ready");
            sendEncrypted({
                kind: "peer-status",
                state: "joined",
                timestamp: Date.now(),
            }).catch(() => undefined);
        });

        transport.onClose(() => {
            if (closingRef.current || localLeaveRef.current) {
                return;
            }
            void closeSession("The other person left the room.", false);
        });

        transport.onError((error) => {
            clearJoinTimeout();
            useSessionStore.getState().setError(error.message);
            useSessionStore.getState().setStage("failed", "Connection failed");
        });

        transport.onStats((stats) => {
            useSessionStore.getState().setTransportStats(stats);
        });

        adapter.onEnvelope(async (envelope) => {
            if (envelope.type === "hello" && initiator) {
                useSessionStore.getState().setStage("deriving-key", "Deriving secure key…");
                const offer = await transport.createOffer();
                await adapter.sendEnvelope({
                    type: "offer",
                    payload: offer,
                    sentAt: Date.now(),
                });
                useSessionStore.getState().setStage("negotiating-peer", "Negotiating direct peer route…");
                return;
            }

            if (envelope.type === "offer" && !initiator) {
                useSessionStore.getState().setStage("deriving-key", "Deriving secure key…");
                const answer = await transport.acceptOffer(envelope.payload as RTCSessionDescriptionInit);
                await adapter.sendEnvelope({
                    type: "answer",
                    payload: answer,
                    sentAt: Date.now(),
                });
                useSessionStore.getState().setStage("negotiating-peer", "Direct peer route established");
                return;
            }

            if (envelope.type === "answer" && initiator) {
                await transport.acceptAnswer(envelope.payload as RTCSessionDescriptionInit);
                useSessionStore.getState().setStage("negotiating-peer", "Direct peer route established");
                return;
            }

            if (envelope.type === "ice-candidate") {
                await transport.addIceCandidate(envelope.payload as RTCIceCandidateInit);
                return;
            }

            if (envelope.type === "close") {
                if (localLeaveRef.current) {
                    return;
                }
                await closeSession("The other person left the room.", false);
            }
        });

        useSessionStore.getState().addLog({
            id: createId(),
            level: "info",
            message: `Session adapter ready for ${nameplate}.`,
            timestamp: Date.now(),
        });
    }

    const createSession = async (): Promise<void> => {
        const store = useSessionStore.getState();
        localLeaveRef.current = false;
        store.clearLocalSession();
        store.setIdentity({ role: "create", peerId: crypto.randomUUID(), createdAt: Date.now() });
        store.setStage("requesting-rendezvous", "Requesting rendezvous...");
        store.setError(undefined);
        store.setBackendValidation("idle");

        // Le backend est interchangeable via l'adapter.
        const adapter = new HoleSignallingAdapter(cryptoService, store.backendEndpoint);
        adapterRef.current = adapter;
        bindDebug(adapter);
        await adapter.connect();

        const created = await adapter.createCode();
        const code = buildSessionCode(created.nameplate, created.password);
        const fingerprint = await deriveFingerprint(code.value);
        appKeyRef.current = await cryptoService.deriveSessionKey(created.password, `app:${created.nameplate}`);
        useSessionStore.getState().setSessionCode(code, created.password);
        useSessionStore.getState().setFingerprint(fingerprint);
        useSessionStore.getState().setStage("sharing-code", "Share this code with the other person");

        wireSignalling(adapter, true, created.nameplate, created.iceServers, closeSession);
    };

    const joinSession = async (rawCode: string): Promise<void> => {
        clearJoinTimeout();
        // Évite de rester bloqué si le salon est mort.
        joinTimeoutRef.current = window.setTimeout(() => {
            void cancelPendingJoin("Join timed out after 8 seconds. The room code may be invalid or the connection may be unstable.");
        }, JOIN_TIMEOUT_MS);

        try {
            const store = useSessionStore.getState();
            localLeaveRef.current = false;
            store.clearLocalSession();
            store.setIdentity({ role: "join", peerId: crypto.randomUUID(), createdAt: Date.now() });
            store.setStage("joining-session", "Requesting rendezvous...");
            store.setError(undefined);
            store.setBackendValidation("idle");

            const adapter = new HoleSignallingAdapter(cryptoService, store.backendEndpoint);
            adapterRef.current = adapter;
            bindDebug(adapter);
            await adapter.connect();

            const parsed = parseSessionCode(rawCode);
            const joined = await adapter.joinWithCode(parsed.value);
            const fingerprint = await deriveFingerprint(parsed.value);
            appKeyRef.current = await cryptoService.deriveSessionKey(joined.password, `app:${joined.nameplate}`);
            useSessionStore.getState().setSessionCode(parsed, joined.password);
            useSessionStore.getState().setFingerprint(fingerprint);
            wireSignalling(adapter, false, joined.nameplate, joined.iceServers, closeSession);
            useSessionStore.getState().setStage("establishing-wormhole", "Establishing secure session...");
            await adapter.sendEnvelope({
                type: "hello",
                payload: {
                    role: "joiner",
                    peerId: useSessionStore.getState().identity.peerId,
                },
                sentAt: Date.now(),
            });
        } catch (error) {
            await cancelPendingJoin(error instanceof Error ? error.message : "Failed to join room.");
        }
    };

    const sendText = async (text: string): Promise<void> => {
        const store = useSessionStore.getState();
        // Ajoute le message avant l'envoi pour garder le fil fluide.
        const message: ChatMessage = {
            id: createId(),
            author: "local",
            text,
            timestamp: Date.now(),
            deliveryState: "pending",
        };
        store.addMessage(message);

        try {
            await sendEncrypted({
                kind: "chat",
                id: message.id,
                text,
                timestamp: message.timestamp,
            });
            useSessionStore.getState().patchMessage(message.id, { deliveryState: "sent" });
        } catch (error) {
            useSessionStore.getState().patchMessage(message.id, { deliveryState: "failed" });
            useSessionStore.getState().setError(error instanceof Error ? error.message : "Failed to send message.");
        }
    };

    const sendFiles = async (files: FileList | File[]): Promise<void> => {
        const list = Array.from(files);
        for (const file of list) {
            const outgoing = createOutgoingTransfer(file);
            const record: FileTransferRecord = {
                id: outgoing.transferId,
                descriptor: outgoing.descriptor,
                createdAt: Date.now(),
                direction: "upload",
                progress: 0,
                bytesTransferred: 0,
                state: "queued",
                previewUrl: outgoing.previewUrl,
            };
            useSessionStore.getState().addTransfer(record);

            try {
                await sendEncrypted({
                    kind: "file-meta",
                    transferId: outgoing.transferId,
                    descriptor: outgoing.descriptor,
                });

                useSessionStore.getState().patchTransfer(outgoing.transferId, { state: "running" });

                let bytesTransferred = 0;
                // Envoie bloc par bloc pour garder la main sur la progression.
                for (let index = 0; index < outgoing.chunks.length; index += 1) {
                    const data = await outgoing.chunks[index].arrayBuffer();
                    await sendEncrypted({
                        kind: "file-chunk",
                        transferId: outgoing.transferId,
                        chunkIndex: index,
                        totalChunks: outgoing.chunks.length,
                        data,
                    });
                    bytesTransferred += data.byteLength;
                    useSessionStore.getState().patchTransfer(outgoing.transferId, {
                        progress: bytesTransferred / outgoing.descriptor.size,
                        bytesTransferred,
                    });
                }

                await sendEncrypted({
                    kind: "file-complete",
                    transferId: outgoing.transferId,
                });

                useSessionStore.getState().patchTransfer(outgoing.transferId, {
                    progress: 1,
                    bytesTransferred: outgoing.descriptor.size,
                    state: "completed",
                });

                if (useSessionStore.getState().oneShotMode) {
                    await closeSession();
                }
            } catch (error) {
                useSessionStore.getState().patchTransfer(outgoing.transferId, {
                    state: "failed",
                    error: error instanceof Error ? error.message : "Transfer failed.",
                });
                useSessionStore.getState().setError(error instanceof Error ? error.message : "Transfer failed.");
            }
        }
    };

    const closeSession = async (
        notice = "You left the room.",
        notifyPeer = true,
    ): Promise<void> => {
        clearJoinTimeout();
        // Bloque les doubles fermetures en cascade.
        closingRef.current = true;
        localLeaveRef.current = notifyPeer;
        transportRef.current?.close();
        transportRef.current = null;
        if (notifyPeer) {
            await adapterRef.current?.sendEnvelope({
                type: "close",
                payload: { peerId: useSessionStore.getState().identity.peerId },
                sentAt: Date.now(),
            }).catch(() => undefined);
        }
        await adapterRef.current?.close();
        adapterRef.current = null;
        appKeyRef.current = null;
        incomingFilesRef.current.clear();
        cleanupPreviewUrls();
        const store = useSessionStore.getState();
        store.clearLocalSession();
        store.setNotice(notice);
        closingRef.current = false;
    };

    const clearLocalSession = (): void => {
        incomingFilesRef.current.clear();
        useSessionStore.getState().clearLocalSession();
    };

    useEffect(
        () => () => {
            clearJoinTimeout();
            transportRef.current?.close();
            adapterRef.current?.close().catch(() => undefined);
        },
        [],
    );

    return {
        createSession,
        joinSession,
        updateBackendEndpoint,
        sendText,
        sendFiles,
        closeSession,
        clearLocalSession,
        state: {
            identity: useSessionStore((state) => state.identity),
            stage: useSessionStore((state) => state.stage),
            sessionCode: useSessionStore((state) => state.sessionCode),
            fingerprint: useSessionStore((state) => state.fingerprint),
            peerConnected: useSessionStore((state) => state.peerConnected),
            statusLine: useSessionStore((state) => state.statusLine),
            error: useSessionStore((state) => state.error),
            notice: useSessionStore((state) => state.notice),
            messages: useSessionStore((state) => state.messages),
            transfers: useSessionStore((state) => state.transfers),
            logs: useSessionStore((state) => state.logs),
            transportStats: useSessionStore((state) => state.transportStats),
            oneShotMode: useSessionStore((state) => state.oneShotMode),
            reducedMotion: useSessionStore((state) => state.reducedMotion),
            debugOpen: useSessionStore((state) => state.debugOpen),
            isDragActive: useSessionStore((state) => state.isDragActive),
            backendEndpoint: useSessionStore((state) => state.backendEndpoint),
            backendValidationState: useSessionStore((state) => state.backendValidationState),
            backendValidationMessage: useSessionStore((state) => state.backendValidationMessage),
        },
    };
};
