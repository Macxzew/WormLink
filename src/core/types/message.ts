export type MessageDeliveryState = "pending" | "sent" | "failed" | "received";

export interface ChatMessage {
    id: string;
    author: "local" | "remote" | "system";
    text: string;
    timestamp: number;
    deliveryState: MessageDeliveryState;
}

export interface SessionEventLog {
    id: string;
    level: "debug" | "info" | "warn" | "error";
    message: string;
    timestamp: number;
}
