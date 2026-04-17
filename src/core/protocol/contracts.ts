import type { SignalEnvelope, SignalMessage } from "@/core/types/signalling";
import type { AppPayload, TransportStats } from "@/core/types/transport";

export interface RendezvousAdapter {
    connect(): Promise<void>;
    createCode(): Promise<{ code: string; password: string; nameplate: string; iceServers: RTCIceServer[] }>;
    joinWithCode(code: string): Promise<{ password: string; nameplate: string; iceServers: RTCIceServer[] }>;
    sendEnvelope(envelope: SignalEnvelope): Promise<void>;
    onEnvelope(listener: (envelope: SignalEnvelope) => void): () => void;
    onFingerprint(listener: (fingerprint: { value: string; short: string }) => void): () => void;
    onSharedSecret(listener: (sharedSecret: Uint8Array) => void): () => void;
    onDebug(listener: (message: string, raw?: SignalMessage) => void): () => void;
    close(): Promise<void>;
}

export interface PeerTransport {
    readonly isInitiator: boolean;
    initialize(): Promise<void>;
    createOffer(): Promise<RTCSessionDescriptionInit>;
    acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>;
    acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void>;
    addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
    send(payload: AppPayload): Promise<void>;
    close(): void;
    onOpen(listener: () => void): () => void;
    onClose(listener: () => void): () => void;
    onError(listener: (error: Error) => void): () => void;
    onPayload(listener: (payload: AppPayload) => void): () => void;
    onLocalDescription(listener: (description: RTCSessionDescriptionInit) => void): () => void;
    onIceCandidate(listener: (candidate: RTCIceCandidateInit) => void): () => void;
    onStats(listener: (stats: TransportStats) => void): () => void;
}
