import type { AppPayload } from "@/core/types/transport";
import { base64ToBuffer, bufferToBase64 } from "@/lib/bytes";

type PlainPayload = Exclude<AppPayload, { kind: "encrypted" }>;

type SerializedPayload =
    | Extract<PlainPayload, { kind: "chat" }>
    | Extract<PlainPayload, { kind: "file-meta" }>
    | {
            kind: "file-chunk";
            transferId: string;
            chunkIndex: number;
            totalChunks: number;
            data: string;
        }
  | Extract<PlainPayload, { kind: "file-complete" }>
  | Extract<PlainPayload, { kind: "peer-status" }>;

export const serializePayload = (
  payload: PlainPayload,
): SerializedPayload => {
  if (payload.kind === "file-chunk") {
    // Le transport texte attend du base64.
    return {
      ...payload,
      data: bufferToBase64(payload.data),
        };
    }

    return payload;
};

export const deserializePayload = (
  payload: SerializedPayload,
): PlainPayload => {
  if (payload.kind === "file-chunk" && typeof payload.data === "string") {
    // Recrée le bloc binaire à la réception.
    return {
      ...payload,
      data: base64ToBuffer(payload.data),
        };
    }

    return payload as PlainPayload;
};
