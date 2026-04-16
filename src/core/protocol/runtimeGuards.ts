import type { SignalEnvelope } from "@/core/types/signalling";
import type { EncryptedPayload } from "@/core/types/crypto";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
    typeof value === "object" && value !== null;

const isString = (value: unknown): value is string =>
    typeof value === "string";

const isNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const isEncryptedPayload = (value: unknown): value is EncryptedPayload => {
    if (!isRecord(value)) {
        return false;
    }

    return value.algorithm === "AES-GCM"
        && isString(value.iv)
        && isString(value.ciphertext);
};

export const parseJson = (value: string): unknown => JSON.parse(value);

export const assertSignalEnvelope = (value: unknown): asserts value is SignalEnvelope => {
    if (!isRecord(value) || !isString(value.type) || !isNumber(value.sentAt)) {
        throw new Error("Invalid signalling envelope.");
    }
};

export const assertSerializedTransportPayload = (value: unknown): void => {
    if (!isRecord(value) || !isString(value.kind)) {
        throw new Error("Invalid transport payload.");
    }

    switch (value.kind) {
        case "encrypted":
            if (!isEncryptedPayload(value.envelope)) {
                throw new Error("Invalid encrypted payload.");
            }
            return;

        case "chat":
            if (!isString(value.id) || !isString(value.text) || !isNumber(value.timestamp)) {
                throw new Error("Invalid chat payload.");
            }
            return;

        case "file-meta":
            if (!isString(value.transferId) || !isRecord(value.descriptor)) {
                throw new Error("Invalid file metadata.");
            }
            if (
                !isString(value.descriptor.id)
                || !isString(value.descriptor.name)
                || !isString(value.descriptor.mimeType)
                || !isNumber(value.descriptor.size)
                || !isNumber(value.descriptor.lastModified)
            ) {
                throw new Error("Invalid file descriptor.");
            }
            return;

        case "file-chunk":
            if (
                !isString(value.transferId)
                || !isNumber(value.chunkIndex)
                || !isNumber(value.totalChunks)
                || !isString(value.data)
            ) {
                throw new Error("Invalid file chunk.");
            }
            return;

        case "file-complete":
            if (!isString(value.transferId)) {
                throw new Error("Invalid file completion payload.");
            }
            return;

        case "peer-status":
            if (
                (value.state !== "joined" && value.state !== "closing")
                || !isNumber(value.timestamp)
            ) {
                throw new Error("Invalid peer status payload.");
            }
            return;

        default:
            throw new Error("Unknown transport payload.");
    }
};

export const assertInitMessage = (value: unknown): asserts value is { slot?: string; iceServers?: RTCIceServer[] } => {
    if (!isRecord(value)) {
        throw new Error("Invalid rendezvous init payload.");
    }

    if (value.slot !== undefined && !isString(value.slot)) {
        throw new Error("Invalid rendezvous slot.");
    }

    if (value.iceServers !== undefined && !Array.isArray(value.iceServers)) {
        throw new Error("Invalid ICE server list.");
    }
};
