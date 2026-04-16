export interface SignalEnvelope<T = unknown> {
    type:
        | "hello"
        | "offer"
        | "answer"
        | "ice-candidate"
        | "ready"
        | "close"
        | "error";
    payload: T;
    sentAt: number;
}

export interface SignalMessage {
    phase: string;
    body: string;
    side?: string;
}
