import { useEffect, useRef } from "react";
import { MAX_INCOMING_TRANSFERS, MAX_SESSION_TRANSFER_BYTES, MAX_TEXT_LENGTH } from "@/core/security/policy";
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
import { sha256Hex } from "@/lib/bytes";
import { createId } from "@/lib/id";

interface IncomingFileAssembly {
    descriptor: FileTransferRecord["descriptor"];
    chunks: ArrayBuffer[];
    totalChunks: number;
    receivedChunks: Set<number>;
    bytesTransferred: number;
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
    const strictVerifiedNoticeShownRef = useRef(false);

    function clearJoinTimeout(): void {
        if (joinTimeoutRef.current !== null) {
            window.clearTimeout(joinTimeoutRef.current);
            joinTimeoutRef.current = null;
        }
    }

    function getReservedIncomingBytes(): number {
        return Array.from(incomingFilesRef.current.values()).reduce(
            (total, transfer) => total + transfer.descriptor.size,
            0,
        );
    }

    function getTransferProgress(bytesTransferred: number, totalBytes: number): number {
        if (totalBytes <= 0) {
            return 1;
        }
        return Math.min(1, bytesTransferred / totalBytes);
    }

    function isStrictVerificationLocked(): boolean {
        const store = useSessionStore.getState();
        return store.strictMode && (!store.fingerprintVerified || !store.remoteFingerprintVerified);
    }

    function maybeNotifyStrictVerified(): void {
        const store = useSessionStore.getState();
        if (!store.strictMode) {
            strictVerifiedNoticeShownRef.current = false;
            return;
        }

        if (store.fingerprintVerified && store.remoteFingerprintVerified && !strictVerifiedNoticeShownRef.current) {
            strictVerifiedNoticeShownRef.current = true;
            store.setNotice("Session verified on both sides. Secure exchange is unlocked.");
        }
    }

    // Nettoie les aperçus créés côté navigateur.
    function cleanupPreviewUrls(): void {
        useSessionStore.getState().transfers.forEach((transfer) => revokePreviewUrl(transfer.previewUrl));
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
        adapter.onFingerprint((fingerprint) => {
            useSessionStore.getState().setFingerprint(fingerprint);
            useSessionStore.getState().setFingerprintVerified(false);
            useSessionStore.getState().setRemoteFingerprintVerified(false);
            strictVerifiedNoticeShownRef.current = false;
        });
        adapter.onSharedSecret((sharedSecret) => {
            const rootSecret = new Uint8Array(sharedSecret);
            cryptoService
                .deriveSubkey(rootSecret.buffer, "app")
                .then((appKeyMaterial) =>
                    cryptoService.importSessionKey(new Uint8Array(appKeyMaterial).slice().buffer),
                )
                .then((key) => {
                    appKeyRef.current = key;
                })
                .catch((error) => {
                    useSessionStore.getState().setError(
                        error instanceof Error ? error.message : "Failed to derive the application session key.",
                    );
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
            if (isStrictVerificationLocked()) {
                throw new Error("Strict mode blocks messages until both fingerprints are verified.");
            }
            if (appPayload.text.length > MAX_TEXT_LENGTH) {
                throw new Error("Incoming message exceeds the accepted size.");
            }
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
            if (isStrictVerificationLocked()) {
                throw new Error("Strict mode blocks file transfers until both fingerprints are verified.");
            }
            if (appPayload.descriptor.size > MAX_FILE_BYTES) {
                throw new Error("Incoming file exceeds the accepted transfer limit.");
            }
            if (incomingFilesRef.current.size >= MAX_INCOMING_TRANSFERS) {
                throw new Error("Too many incoming transfers are already pending.");
            }
            if (appPayload.descriptor.integrity.totalChunks > MAX_FILE_CHUNKS) {
                throw new Error("Incoming transfer exceeds the accepted chunk limit.");
            }
            if (getReservedIncomingBytes() + appPayload.descriptor.size > MAX_SESSION_TRANSFER_BYTES) {
                throw new Error("Incoming transfers exceed the accepted session quota.");
            }
            if (incomingFilesRef.current.has(appPayload.transferId)) {
                throw new Error("Incoming transfer reused an existing identifier.");
            }
            incomingFilesRef.current.set(appPayload.transferId, {
                descriptor: appPayload.descriptor,
                chunks: [],
                totalChunks: appPayload.descriptor.integrity.totalChunks,
                receivedChunks: new Set(),
                bytesTransferred: 0,
            });
            useSessionStore.getState().addTransfer({
                id: appPayload.transferId,
                descriptor: appPayload.descriptor,
                createdAt: Date.now(),
                direction: "download",
                progress: 0,
                bytesTransferred: 0,
                state: "running",
                integrityState: "pending",
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
            if (target.totalChunks !== appPayload.totalChunks) {
                throw new Error("Incoming transfer changed total chunk count unexpectedly.");
            }
            const checksum = await sha256Hex(appPayload.data);
            if (checksum !== appPayload.checksum) {
                throw new Error("Incoming chunk failed integrity verification.");
            }
            if (target.receivedChunks.has(appPayload.chunkIndex)) {
                return;
            }
            target.chunks[appPayload.chunkIndex] = appPayload.data;
            target.receivedChunks.add(appPayload.chunkIndex);
            target.bytesTransferred += appPayload.data.byteLength;
            useSessionStore.getState().patchTransfer(appPayload.transferId, {
                progress: getTransferProgress(target.bytesTransferred, target.descriptor.size),
                bytesTransferred: target.bytesTransferred,
            });
            return;
        }

        if (appPayload.kind === "file-complete") {
            const target = incomingFilesRef.current.get(appPayload.transferId);
            if (!target) {
                return;
            }
            if (target.receivedChunks.size !== target.totalChunks) {
                throw new Error("Incoming transfer completed before every chunk was received.");
            }
            if (target.bytesTransferred !== target.descriptor.size) {
                throw new Error("Incoming transfer size did not match the advertised file size.");
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
                integrityState: "verified",
            });
            incomingFilesRef.current.delete(appPayload.transferId);
            if (useSessionStore.getState().oneShotMode) {
                await closeSession();
            }
            return;
        }

        if (appPayload.kind === "peer-status") {
            useSessionStore.getState().setPeerConnected(appPayload.state === "joined");
            return;
        }

        if (appPayload.kind === "session-policy") {
            if (useSessionStore.getState().identity.role === "join") {
                useSessionStore.getState().setStrictMode(appPayload.strictMode);
                if (!appPayload.strictMode) {
                    strictVerifiedNoticeShownRef.current = false;
                }
            }
            return;
        }

        if (appPayload.kind === "fingerprint-verification") {
            useSessionStore.getState().setRemoteFingerprintVerified(appPayload.verified);
            maybeNotifyStrictVerified();
        }
    }

    async function syncSessionPolicy(): Promise<void> {
        const store = useSessionStore.getState();
        if (store.identity.role !== "create" || !transportRef.current || !appKeyRef.current) {
            return;
        }

        await sendEncrypted({
            kind: "session-policy",
            strictMode: store.strictMode,
            timestamp: Date.now(),
        });
    }

    async function syncFingerprintVerification(verified: boolean): Promise<void> {
        if (!transportRef.current || !appKeyRef.current) {
            return;
        }

        await sendEncrypted({
            kind: "fingerprint-verification",
            verified,
            timestamp: Date.now(),
        });
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
            syncSessionPolicy().catch(() => undefined);
            syncFingerprintVerification(useSessionStore.getState().fingerprintVerified).catch(() => undefined);
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
        useSessionStore.getState().setSessionCode(code, created.password);
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
            useSessionStore.getState().setSessionCode(parsed, joined.password);
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
        if (store.strictMode && !store.fingerprintVerified) {
            store.setError("Strict mode is enabled. Verify the session fingerprint before sending data.");
            return;
        }
        if (store.strictMode && !store.remoteFingerprintVerified) {
            store.setError("Strict mode is enabled. Wait for the other person to verify the session fingerprint.");
            return;
        }
        if (store.strictMode && store.transportStats?.routeType === "relay") {
            store.setError("Strict mode blocks relay-routed sessions. Wait for a direct route or disable strict mode.");
            return;
        }
        if (text.length > MAX_TEXT_LENGTH) {
            store.setError(`Message exceeds the ${MAX_TEXT_LENGTH}-character limit.`);
            return;
        }
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
        const store = useSessionStore.getState();
        if (store.strictMode && !store.fingerprintVerified) {
            store.setError("Strict mode is enabled. Verify the session fingerprint before sending data.");
            return;
        }
        if (store.strictMode && !store.remoteFingerprintVerified) {
            store.setError("Strict mode is enabled. Wait for the other person to verify the session fingerprint.");
            return;
        }
        if (store.strictMode && store.transportStats?.routeType === "relay") {
            store.setError("Strict mode blocks relay-routed sessions. Wait for a direct route or disable strict mode.");
            return;
        }
        const list = Array.from(files);
        for (const file of list) {
            let outgoing;
            try {
                outgoing = createOutgoingTransfer(file);
            } catch (error) {
                useSessionStore.getState().setError(
                    error instanceof Error ? error.message : "Transfer preparation failed.",
                );
                continue;
            }
            const record: FileTransferRecord = {
                id: outgoing.transferId,
                descriptor: outgoing.descriptor,
                createdAt: Date.now(),
                direction: "upload",
                progress: 0,
                bytesTransferred: 0,
                state: "queued",
                previewUrl: outgoing.previewUrl,
                integrityState: "pending",
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
                    const checksum = await sha256Hex(data);
                    await sendEncrypted({
                        kind: "file-chunk",
                        transferId: outgoing.transferId,
                        chunkIndex: index,
                        totalChunks: outgoing.chunks.length,
                        data,
                        checksum,
                    });
                    bytesTransferred += data.byteLength;
                    useSessionStore.getState().patchTransfer(outgoing.transferId, {
                        progress: getTransferProgress(bytesTransferred, outgoing.descriptor.size),
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
                    integrityState: "verified",
                });

                if (useSessionStore.getState().oneShotMode) {
                    await closeSession();
                }
            } catch (error) {
                useSessionStore.getState().patchTransfer(outgoing.transferId, {
                    state: "failed",
                    error: error instanceof Error ? error.message : "Transfer failed.",
                    integrityState: "failed",
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

    const setStrictMode = (value: boolean): void => {
        useSessionStore.getState().setStrictMode(value);
        strictVerifiedNoticeShownRef.current = false;
        syncSessionPolicy().catch(() => undefined);
    };

    const confirmFingerprint = (): void => {
        useSessionStore.getState().setFingerprintVerified(true);
        maybeNotifyStrictVerified();
        syncFingerprintVerification(true).catch(() => undefined);
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
        setStrictMode,
        confirmFingerprint,
        state: {
            identity: useSessionStore((state) => state.identity),
            stage: useSessionStore((state) => state.stage),
            sessionCode: useSessionStore((state) => state.sessionCode),
            fingerprint: useSessionStore((state) => state.fingerprint),
            fingerprintVerified: useSessionStore((state) => state.fingerprintVerified),
            remoteFingerprintVerified: useSessionStore((state) => state.remoteFingerprintVerified),
            peerConnected: useSessionStore((state) => state.peerConnected),
            statusLine: useSessionStore((state) => state.statusLine),
            error: useSessionStore((state) => state.error),
            notice: useSessionStore((state) => state.notice),
            messages: useSessionStore((state) => state.messages),
            transfers: useSessionStore((state) => state.transfers),
            logs: useSessionStore((state) => state.logs),
            transportStats: useSessionStore((state) => state.transportStats),
            oneShotMode: useSessionStore((state) => state.oneShotMode),
            strictMode: useSessionStore((state) => state.strictMode),
            reducedMotion: useSessionStore((state) => state.reducedMotion),
            debugOpen: useSessionStore((state) => state.debugOpen),
            isDragActive: useSessionStore((state) => state.isDragActive),
            backendEndpoint: useSessionStore((state) => state.backendEndpoint),
            backendValidationState: useSessionStore((state) => state.backendValidationState),
            backendValidationMessage: useSessionStore((state) => state.backendValidationMessage),
        },
    };
};
