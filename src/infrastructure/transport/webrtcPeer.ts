import type { PeerTransport } from "@/core/protocol/contracts";
import { MAX_DATA_CHANNEL_MESSAGE_CHARS } from "@/core/security/policy";
import { assertSerializedTransportPayload, parseJson } from "@/core/protocol/runtimeGuards";
import type { AppPayload, TransportStats } from "@/core/types/transport";
import { createEmitter } from "@/lib/events";
import { bufferToBase64, base64ToBuffer, textDecoder } from "@/lib/bytes";

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

export class WebRtcPeerTransport implements PeerTransport {
    readonly isInitiator: boolean;

    private readonly peer: RTCPeerConnection;
    private channel?: RTCDataChannel;
    private statsInterval?: number;
    private readonly openEmitter = createEmitter<void>();
    private readonly closeEmitter = createEmitter<void>();
    private readonly errorEmitter = createEmitter<Error>();
    private readonly payloadEmitter = createEmitter<AppPayload>();
    private readonly descriptionEmitter = createEmitter<RTCSessionDescriptionInit>();
    private readonly candidateEmitter = createEmitter<RTCIceCandidateInit>();
    private readonly statsEmitter = createEmitter<TransportStats>();
    private lastRouteType: TransportStats["routeType"] = "unknown";

    constructor(isInitiator: boolean, iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS) {
        this.isInitiator = isInitiator;
        this.peer = new RTCPeerConnection({ iceServers });
    }

    async initialize(): Promise<void> {
        if (this.isInitiator) {
            // L'initiateur crée le canal de données.
            this.attachChannel(this.peer.createDataChannel("wormlink", { ordered: true }));
        } else {
            this.peer.ondatachannel = (event) => this.attachChannel(event.channel);
        }

        this.peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.candidateEmitter.emit(event.candidate.toJSON());
            }
        };

        this.peer.onconnectionstatechange = () => {
            void this.emitStats();
            if (this.peer.connectionState === "failed") {
                this.errorEmitter.emit(new Error("Peer connection failed."));
            }
            if (this.peer.connectionState === "closed" || this.peer.connectionState === "disconnected") {
                this.closeEmitter.emit(undefined);
            }
        };

        this.peer.oniceconnectionstatechange = () => void this.emitStats();
        this.statsInterval = window.setInterval(() => {
            void this.emitStats();
        }, 400);
    }

    async createOffer(): Promise<RTCSessionDescriptionInit> {
        const offer = await this.peer.createOffer();
        await this.peer.setLocalDescription(offer);
        this.descriptionEmitter.emit(offer);
        return offer;
    }

    async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        await this.peer.setRemoteDescription(offer);
        const answer = await this.peer.createAnswer();
        await this.peer.setLocalDescription(answer);
        this.descriptionEmitter.emit(answer);
        return answer;
    }

    async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        await this.peer.setRemoteDescription(answer);
    }

    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        await this.peer.addIceCandidate(candidate);
    }

    async send(payload: AppPayload): Promise<void> {
        if (!this.channel || this.channel.readyState !== "open") {
            throw new Error("The encrypted data channel is not open.");
        }

        // Attend que le buffer redescende avant d'envoyer plus.
        while (this.channel.bufferedAmount > 512 * 1024) {
            await new Promise((resolve) => window.setTimeout(resolve, 16));
        }

        if (payload.kind === "file-chunk") {
            const binaryPayload = {
                ...payload,
                data: bufferToBase64(payload.data),
            };
            this.channel.send(JSON.stringify(binaryPayload));
            return;
        }

        this.channel.send(JSON.stringify(payload));
    }

    close(): void {
        this.channel?.close();
        this.peer.close();
        if (this.statsInterval) {
            window.clearInterval(this.statsInterval);
        }
    }

    onOpen(listener: () => void): () => void {
        return this.openEmitter.subscribe(listener);
    }

    onClose(listener: () => void): () => void {
        return this.closeEmitter.subscribe(listener);
    }

    onError(listener: (error: Error) => void): () => void {
        return this.errorEmitter.subscribe(listener);
    }

    onPayload(listener: (payload: AppPayload) => void): () => void {
        return this.payloadEmitter.subscribe(listener);
    }

    onLocalDescription(listener: (description: RTCSessionDescriptionInit) => void): () => void {
        return this.descriptionEmitter.subscribe(listener);
    }

    onIceCandidate(listener: (candidate: RTCIceCandidateInit) => void): () => void {
        return this.candidateEmitter.subscribe(listener);
    }

    onStats(listener: (stats: TransportStats) => void): () => void {
        return this.statsEmitter.subscribe(listener);
    }

    private attachChannel(channel: RTCDataChannel): void {
        this.channel = channel;
        channel.binaryType = "arraybuffer";
        channel.bufferedAmountLowThreshold = 256 * 1024;

        channel.onopen = () => this.openEmitter.emit(undefined);
        channel.onclose = () => this.closeEmitter.emit(undefined);
        channel.onerror = () => this.errorEmitter.emit(new Error("Data channel error."));
        channel.onmessage = (event) => {
            try {
                const raw = typeof event.data === "string" ? event.data : textDecoder.decode(event.data);
                if (raw.length > MAX_DATA_CHANNEL_MESSAGE_CHARS) {
                    throw new Error("Incoming transport payload exceeded the accepted size.");
                }

                const payload: unknown = parseJson(raw);
                assertSerializedTransportPayload(payload);
                const parsedPayload = payload as AppPayload | {
                    kind: "file-chunk";
                    transferId: string;
                    chunkIndex: number;
                    totalChunks: number;
                    data: string;
                    checksum: string;
                };
                if (parsedPayload.kind === "file-chunk" && typeof parsedPayload.data === "string") {
                    // Reconvertit le bloc en binaire.
                    this.payloadEmitter.emit({
                        ...parsedPayload,
                        data: base64ToBuffer(parsedPayload.data),
                    } satisfies AppPayload);
                    return;
                }
                this.payloadEmitter.emit(parsedPayload as AppPayload);
            } catch (error) {
                this.errorEmitter.emit(
                    error instanceof Error ? error : new Error("Failed to decode incoming transport payload."),
                );
            }
        };
    }

    private async detectRouteType(): Promise<TransportStats["routeType"]> {
        try {
            const stats = await this.peer.getStats();
            let selectedPair: RTCStats | undefined;
            let localCandidate: RTCStats | undefined;
            let remoteCandidate: RTCStats | undefined;

            stats.forEach((report) => {
                if (
                    report.type === "transport"
                    && "selectedCandidatePairId" in report
                    && report.selectedCandidatePairId
                ) {
                    selectedPair = stats.get(report.selectedCandidatePairId);
                }
            });

            if (!selectedPair) {
                stats.forEach((report) => {
                    if (
                        report.type === "candidate-pair"
                        && "state" in report
                        && report.state === "succeeded"
                        && "nominated" in report
                        && report.nominated
                    ) {
                        selectedPair = report;
                    }
                });
            }

            if (
                selectedPair
                && "localCandidateId" in selectedPair
                && "remoteCandidateId" in selectedPair
            ) {
                localCandidate = stats.get(selectedPair.localCandidateId as string);
                remoteCandidate = stats.get(selectedPair.remoteCandidateId as string);
            }

            const localType =
                localCandidate && "candidateType" in localCandidate
                    ? (localCandidate.candidateType as string | undefined)
                    : undefined;
            const remoteType =
                remoteCandidate && "candidateType" in remoteCandidate
                    ? (remoteCandidate.candidateType as string | undefined)
                    : undefined;

            if (localType === "relay" || remoteType === "relay") {
                return "relay";
            }

            if (localType || remoteType) {
                return "direct";
            }
        } catch {
            return this.lastRouteType;
        }

        return "unknown";
    }

    private async emitStats(): Promise<void> {
        // Sert au debug et à l'état réseau.
        this.lastRouteType = await this.detectRouteType();
        this.statsEmitter.emit({
            bufferedAmount: this.channel?.bufferedAmount ?? 0,
            connectionState: this.peer.connectionState,
            iceState: this.peer.iceConnectionState,
            routeType: this.lastRouteType,
        });
    }
}
