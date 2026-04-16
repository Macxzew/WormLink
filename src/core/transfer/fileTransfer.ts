import type { FileDescriptor } from "@/core/types/transfer";
import { CHUNK_SIZE } from "@/lib/bytes";
import { createId } from "@/lib/id";

// Garde une taille compatible avec le transport.
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_FILE_CHUNKS = 16_384;

export interface OutgoingTransfer {
    transferId: string;
    descriptor: FileDescriptor;
    chunks: Blob[];
    previewUrl?: string;
}

export const isPreviewableMime = (mimeType: string): boolean =>
    mimeType.startsWith("image/") || mimeType.startsWith("video/");

export const createOutgoingTransfer = (file: File): OutgoingTransfer => {
    if (file.size > MAX_FILE_BYTES) {
        throw new Error("File exceeds the 512 MB transfer limit.");
    }

    // Coupe le fichier en blocs fixes.
    const chunks: Blob[] = [];
    let offset = 0;
    while (offset < file.size) {
        chunks.push(file.slice(offset, offset + CHUNK_SIZE));
        offset += CHUNK_SIZE;
    }

    if (chunks.length > MAX_FILE_CHUNKS) {
        throw new Error("File requires too many chunks to transfer safely.");
    }

    return {
        transferId: createId(),
        descriptor: {
            id: createId(),
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            lastModified: file.lastModified,
        },
        chunks,
        previewUrl: isPreviewableMime(file.type) ? URL.createObjectURL(file) : undefined,
    };
};

export const createIncomingBlob = (chunks: ArrayBuffer[], mimeType: string): Blob =>
    new Blob(chunks, { type: mimeType });

export const createObjectUrl = (blob: Blob): string => URL.createObjectURL(blob);

export const revokePreviewUrl = (previewUrl?: string): void => {
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
    }
};
