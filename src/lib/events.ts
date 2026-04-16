export const createEmitter = <T>() => {
    const listeners = new Set<(value: T) => void>();
    return {
        emit(value: T): void {
            listeners.forEach((listener) => listener(value));
        },
        subscribe(listener: (value: T) => void): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
};
