export interface EncryptedPayload {
    algorithm: "AES-GCM";
    iv: string;
    ciphertext: string;
}

export interface SessionCrypto {
    deriveSessionKey(secret: string, context: string): Promise<CryptoKey>;
    encryptPayload(key: CryptoKey, payload: unknown): Promise<EncryptedPayload>;
    decryptPayload<T>(key: CryptoKey, payload: EncryptedPayload): Promise<T>;
    importSessionKey(raw: BufferSource): Promise<CryptoKey>;
    deriveSubkey(secret: BufferSource, context: string, length?: number): Promise<Uint8Array>;
}
