import type { EncryptedPayload, SessionCrypto } from "@/core/types/crypto";
import { base64ToBuffer, bufferToBase64, textDecoder, textEncoder } from "@/lib/bytes";

const KEY_LENGTH = 256;
const IV_BYTES = 12;

const importPassphrase = async (secret: string): Promise<CryptoKey> =>
    crypto.subtle.importKey("raw", textEncoder.encode(secret), "PBKDF2", false, ["deriveKey"]);

const createIv = (): Uint8Array => {
    const iv = new Uint8Array(IV_BYTES);
    crypto.getRandomValues(iv);
    return iv;
};

const readDerivedBits = async (secret: BufferSource, context: string, length: number): Promise<Uint8Array> => {
    const imported = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: textEncoder.encode("wormlink:pake-root"),
            info: textEncoder.encode(`wormlink:${context}`),
        },
        imported,
        length * 8,
    );
    return new Uint8Array(bits);
};

export class AesGcmSessionCrypto implements SessionCrypto {
  async deriveSessionKey(secret: string, context: string): Promise<CryptoKey> {
    // Le contexte sépare les clés rendezvous et app.
    const material = await importPassphrase(`${secret}:${context}`);
        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                hash: "SHA-256",
                salt: textEncoder.encode(`wormlink:${context}`),
                iterations: 180_000,
            },
            material,
            {
                name: "AES-GCM",
                length: KEY_LENGTH,
            },
            false,
            ["encrypt", "decrypt"],
        );
    }

  async encryptPayload(key: CryptoKey, payload: unknown): Promise<EncryptedPayload> {
    // L'IV change à chaque chiffrement.
    const iv = createIv();
        const encoded = textEncoder.encode(JSON.stringify(payload));
        const ciphertext = await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: new Uint8Array(iv),
            },
            key,
            encoded,
        );

        return {
            algorithm: "AES-GCM",
            iv: bufferToBase64(iv.buffer as ArrayBuffer),
            ciphertext: bufferToBase64(ciphertext),
        };
    }

  async decryptPayload<T>(key: CryptoKey, payload: EncryptedPayload): Promise<T> {
        const plaintext = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: new Uint8Array(base64ToBuffer(payload.iv)),
            },
            key,
            base64ToBuffer(payload.ciphertext),
        );

        return JSON.parse(textDecoder.decode(plaintext)) as T;
    }

  async importSessionKey(raw: BufferSource): Promise<CryptoKey> {
        return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    }

  async deriveSubkey(secret: BufferSource, context: string, length = 32): Promise<Uint8Array> {
        return readDerivedBits(secret, context, length);
    }
}
