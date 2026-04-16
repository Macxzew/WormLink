import type { ChatMessage } from "@/core/types/message";
import type { FileTransferRecord, TransferState } from "@/core/types/transfer";

export interface TimelineMessageEntry {
    id: string;
    kind: "message";
    timestamp: number;
    data: ChatMessage;
}

export interface TimelineTransferEntry {
    id: string;
    kind: "transfer";
    timestamp: number;
    data: FileTransferRecord;
}

export type TimelineEntry = TimelineMessageEntry | TimelineTransferEntry;

export const transferLabel = (state: TransferState): string => {
    switch (state) {
        case "running":
            return "Sending";
        case "completed":
            return "Ready";
        case "failed":
            return "Failed";
        default:
            return "Queued";
    }
};

export const isMedia = (mimeType: string): boolean =>
    mimeType.startsWith("image/") || mimeType.startsWith("video/");

export const buildTimeline = (
    messages: ChatMessage[],
    transfers: FileTransferRecord[],
): TimelineEntry[] => {
    const messageEntries: TimelineMessageEntry[] = messages.map((message) => ({
        id: `msg-${message.id}`,
        kind: "message",
        timestamp: message.timestamp,
        data: message,
    }));

    const transferEntries: TimelineTransferEntry[] = transfers.map((transfer, index) => ({
        id: `tx-${transfer.id}`,
        kind: "transfer",
        timestamp: transfer.createdAt + index,
        data: transfer,
    }));

    return [...messageEntries, ...transferEntries].sort((left, right) => left.timestamp - right.timestamp);
};
