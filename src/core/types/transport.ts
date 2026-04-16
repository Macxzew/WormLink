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
            };
        }
    | {
            kind: "file-chunk";
            transferId: string;
            chunkIndex: number;
            totalChunks: number;
            data: ArrayBuffer;
        }
    | {
            kind: "file-complete";
            transferId: string;
        }
    | {
            kind: "peer-status";
            state: "joined" | "closing";
            timestamp: number;
        };

export interface TransportStats {
    bufferedAmount: number;
    connectionState: RTCPeerConnectionState;
    iceState: RTCIceConnectionState;
}
