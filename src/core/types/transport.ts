import type { EncryptedPayload } from "@/core/types/crypto";

export type AppPayload =
    | {
            kind: "encrypted";
            envelope: EncryptedPayload;
        }
    | {
            kind: "chat";
            id: string;
            timestamp: number;
            text: string;
        }
    | {
            kind: "file-meta";
            transferId: string;
            descriptor: {
                id: string;
                name: string;
                mimeType: string;
                size: number;
                lastModified: number;
                integrity: {
                    algorithm: "SHA-256";
                    chunkSize: number;
                    totalChunks: number;
                };
            };
        }
    | {
            kind: "file-chunk";
            transferId: string;
            chunkIndex: number;
            totalChunks: number;
            data: ArrayBuffer;
            checksum: string;
        }
    | {
            kind: "file-complete";
            transferId: string;
        }
    | {
            kind: "peer-status";
            state: "joined" | "closing";
            timestamp: number;
        }
    | {
            kind: "session-policy";
            strictMode: boolean;
            timestamp: number;
        }
    | {
            kind: "fingerprint-verification";
            verified: boolean;
            timestamp: number;
        };

export interface TransportStats {
    bufferedAmount: number;
    connectionState: RTCPeerConnectionState;
    iceState: RTCIceConnectionState;
    routeType: "direct" | "relay" | "unknown";
}
