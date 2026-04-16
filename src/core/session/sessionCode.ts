import type { SessionCode } from "@/core/types/session";
import { WORDS } from "@/lib/words";

const pickWord = (): string => WORDS[Math.floor(Math.random() * WORDS.length)];

export const createSessionPassword = (): string => [pickWord(), pickWord(), pickWord()].join("-");

export const buildSessionCode = (nameplate: string, password: string): SessionCode => {
    // Format final : slot-mot-mot-mot
    const words = password.split("-");
    return {
        nameplate,
        password,
        words,
        value: [nameplate, ...words].join("-"),
    };
};

export const parseSessionCode = (value: string): SessionCode => {
    // Tolère les espaces et la casse côté saisie.
    const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
    const [nameplate, ...words] = normalized.split("-").filter(Boolean);
    if (!nameplate || words.length < 3) {
        throw new Error("Invalid session code format.");
    }
    const password = words.join("-");
    return {
        nameplate,
        password,
        words,
        value: [nameplate, ...words].join("-"),
    };
};
