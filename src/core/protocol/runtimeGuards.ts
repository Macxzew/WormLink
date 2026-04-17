import type { SignalEnvelope } from "@/core/types/signalling";
import type { EncryptedPayload } from "@/core/types/crypto";
import { MAX_FILE_NAME_LENGTH, MAX_TEXT_LENGTH } from "@/core/security/policy";

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

export function assertSignalEnvelope(value: unknown): asserts value is SignalEnvelope {
    if (!isRecord(value) || !isString(value.type) || !isNumber(value.sentAt)) {
        throw new Error("Invalid signalling envelope.");
    }
}

export function assertSerializedTransportPayload(value: unknown): void {
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
            if (
                !isString(value.id)
                || !isString(value.text)
                || value.text.length > MAX_TEXT_LENGTH
                || !isNumber(value.timestamp)
            ) {
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
                || value.descriptor.name.length > MAX_FILE_NAME_LENGTH
                || !isString(value.descriptor.mimeType)
                || !isNumber(value.descriptor.size)
                || !isNumber(value.descriptor.lastModified)
                || !isRecord(value.descriptor.integrity)
                || value.descriptor.integrity.algorithm !== "SHA-256"
                || !isNumber(value.descriptor.integrity.chunkSize)
                || !isNumber(value.descriptor.integrity.totalChunks)
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
                || !isString(value.checksum)
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

        case "session-policy":
            if (typeof value.strictMode !== "boolean" || !isNumber(value.timestamp)) {
                throw new Error("Invalid session policy payload.");
            }
            return;

        case "fingerprint-verification":
            if (typeof value.verified !== "boolean" || !isNumber(value.timestamp)) {
                throw new Error("Invalid fingerprint verification payload.");
            }
            return;

        default:
            throw new Error("Unknown transport payload.");
    }
}

export function assertInitMessage(value: unknown): asserts value is { slot?: string; iceServers?: RTCIceServer[] } {
    if (!isRecord(value)) {
        throw new Error("Invalid rendezvous init payload.");
    }

    if (value.slot !== undefined && !isString(value.slot)) {
        throw new Error("Invalid rendezvous slot.");
    }

    if (value.iceServers !== undefined && !Array.isArray(value.iceServers)) {
        throw new Error("Invalid ICE server list.");
    }
}
