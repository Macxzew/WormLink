export type SessionMode = "create" | "join";

export type ConnectionStage =
    | "idle"
    | "requesting-rendezvous"
    | "sharing-code"
    | "joining-session"
    | "establishing-wormhole"
    | "deriving-key"
    | "negotiating-peer"
    | "secure-ready"
    | "transfer"
    | "lost"
    | "closed"
    | "failed";

export interface SessionCode {
    nameplate: string;
    password: string;
    words: string[];
    value: string;
}

export interface SessionIdentity {
    peerId: string;
    role: SessionMode;
    createdAt: number;
    code?: SessionCode;
}

export interface SessionFingerprint {
    value: string;
    short: string;
}

export interface SecurityNote {
    title: string;
    description: string;
}
