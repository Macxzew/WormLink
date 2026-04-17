export type TransferDirection = "upload" | "download";
export type TransferState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface FileDescriptor {
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
}

export interface FileTransferRecord {
    id: string;
    descriptor: FileDescriptor;
    createdAt: number;
    direction: TransferDirection;
    progress: number;
    bytesTransferred: number;
    state: TransferState;
    previewUrl?: string;
    autoDownloaded?: boolean;
    error?: string;
    integrityState?: "pending" | "verified" | "failed";
}
