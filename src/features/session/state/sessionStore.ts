import { create } from "zustand";
import type { ChatMessage, SessionEventLog } from "@/core/types/message";
import type { ConnectionStage, SessionCode, SessionFingerprint, SessionIdentity } from "@/core/types/session";
import type { FileTransferRecord } from "@/core/types/transfer";
import type { TransportStats } from "@/core/types/transport";
import { DEFAULT_SIGNAL_URL } from "@/infrastructure/signalling/holeAdapter";

type BackendValidationState = "idle" | "validating" | "valid" | "invalid";

interface SessionStoreState {
    identity: SessionIdentity;
    stage: ConnectionStage;
    sessionCode?: SessionCode;
    fingerprint?: SessionFingerprint;
    localPassword?: string;
    peerConnected: boolean;
    fingerprintVerified: boolean;
    remoteFingerprintVerified: boolean;
    statusLine: string;
    error?: string;
    notice?: string;
    messages: ChatMessage[];
    transfers: FileTransferRecord[];
    logs: SessionEventLog[];
    transportStats?: TransportStats;
    oneShotMode: boolean;
    strictMode: boolean;
    reducedMotion: boolean;
    debugOpen: boolean;
    isDragActive: boolean;
    backendEndpoint: string;
    backendValidationState: BackendValidationState;
    backendValidationMessage?: string;
    setStage: (stage: ConnectionStage, statusLine: string) => void;
    setIdentity: (identity: Partial<SessionIdentity>) => void;
    setSessionCode: (code?: SessionCode, localPassword?: string) => void;
    setFingerprint: (fingerprint?: SessionFingerprint) => void;
    setFingerprintVerified: (value: boolean) => void;
    setRemoteFingerprintVerified: (value: boolean) => void;
    setPeerConnected: (value: boolean) => void;
    setError: (error?: string) => void;
    setNotice: (notice?: string) => void;
    addMessage: (message: ChatMessage) => void;
    patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
    addTransfer: (transfer: FileTransferRecord) => void;
    patchTransfer: (id: string, patch: Partial<FileTransferRecord>) => void;
    addLog: (entry: SessionEventLog) => void;
    clearLocalSession: () => void;
    setTransportStats: (stats?: TransportStats) => void;
    setOneShotMode: (value: boolean) => void;
    setStrictMode: (value: boolean) => void;
    setReducedMotion: (value: boolean) => void;
    setDebugOpen: (value: boolean) => void;
    setDragActive: (value: boolean) => void;
    setBackendEndpoint: (endpoint: string) => void;
    setBackendValidation: (state: BackendValidationState, message?: string) => void;
}

const initialIdentity: SessionIdentity = {
    peerId: crypto.randomUUID(),
    role: "create",
    createdAt: Date.now(),
};

export const useSessionStore = create<SessionStoreState>((set) => ({
    identity: initialIdentity,
    stage: "idle",
    fingerprintVerified: false,
    remoteFingerprintVerified: false,
    peerConnected: false,
    statusLine: "Encrypted peer-to-peer exchange",
    messages: [],
    transfers: [],
    logs: [],
    oneShotMode: false,
    strictMode: false,
    reducedMotion: false,
    debugOpen: false,
    isDragActive: false,
    backendEndpoint: DEFAULT_SIGNAL_URL,
    backendValidationState: "idle",
    setStage: (stage, statusLine) => set({ stage, statusLine }),
    setIdentity: (identity) =>
        set((state) => ({
            identity: {
                ...state.identity,
                ...identity,
            },
        })),
    setSessionCode: (sessionCode, localPassword) => set({ sessionCode, localPassword }),
    setFingerprint: (fingerprint) => set({ fingerprint }),
    setFingerprintVerified: (fingerprintVerified) => set({ fingerprintVerified }),
    setRemoteFingerprintVerified: (remoteFingerprintVerified) => set({ remoteFingerprintVerified }),
    setPeerConnected: (peerConnected) => set({ peerConnected }),
    setError: (error) => set({ error }),
    setNotice: (notice) => set({ notice }),
    addMessage: (message) =>
        set((state) => ({
            messages: [...state.messages, message],
        })),
    patchMessage: (id, patch) =>
        set((state) => ({
            messages: state.messages.map((message) => (message.id === id ? { ...message, ...patch } : message)),
        })),
    addTransfer: (transfer) =>
        set((state) => ({
            transfers: [...state.transfers.filter((item) => item.id !== transfer.id), transfer],
        })),
    patchTransfer: (id, patch) =>
        set((state) => ({
            transfers: state.transfers.map((transfer) => (transfer.id === id ? { ...transfer, ...patch } : transfer)),
        })),
    addLog: (entry) =>
        set((state) => ({
            logs: [...state.logs, entry].slice(-200),
        })),
    clearLocalSession: () =>
        set({
            stage: "idle",
            sessionCode: undefined,
            fingerprint: undefined,
            fingerprintVerified: false,
            remoteFingerprintVerified: false,
            localPassword: undefined,
            peerConnected: false,
            statusLine: "Encrypted peer-to-peer exchange",
            error: undefined,
            notice: undefined,
            messages: [],
            transfers: [],
            logs: [],
            transportStats: undefined,
            isDragActive: false,
        }),
    setTransportStats: (transportStats) => set({ transportStats }),
    setOneShotMode: (oneShotMode) => set({ oneShotMode }),
    setStrictMode: (strictMode) => set({ strictMode }),
    setReducedMotion: (reducedMotion) => set({ reducedMotion }),
    setDebugOpen: (debugOpen) => set({ debugOpen }),
    setDragActive: (isDragActive) => set({ isDragActive }),
    setBackendEndpoint: (backendEndpoint) => set({ backendEndpoint }),
    setBackendValidation: (backendValidationState, backendValidationMessage) =>
        set({ backendValidationState, backendValidationMessage }),
}));
