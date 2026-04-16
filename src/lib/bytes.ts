export const CHUNK_SIZE = 64 * 1024;

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export const bufferToBase64 = (buffer: ArrayBuffer): string => {
    // Convertit le binaire en texte transportable.
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
};

export const base64ToBuffer = (value: string): ArrayBuffer => {
    // Refait le binaire depuis le texte.
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
};

export const bufferToHex = (buffer: ArrayBuffer): string =>
    Array.from(new Uint8Array(buffer))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
