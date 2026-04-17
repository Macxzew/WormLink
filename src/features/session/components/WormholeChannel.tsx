import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    ArrowDownIcon,
    ArrowDownTrayIcon,
    ArrowUpTrayIcon,
    ArrowPathIcon,
    CheckCircleIcon,
    ClipboardDocumentIcon,
    ExclamationTriangleIcon,
    PaperAirplaneIcon,
    QrCodeIcon,
    SignalIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { QRCodeSVG } from "qrcode.react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { ChatMessage } from "@/core/types/message";
import type { ConnectionStage, SessionCode, SessionFingerprint, SessionMode } from "@/core/types/session";
import type { TransportStats } from "@/core/types/transport";
import type { FileTransferRecord } from "@/core/types/transfer";
import { buildTimeline, isMedia, transferLabel } from "@/features/session/components/channelTimeline";
import { DEFAULT_SIGNAL_URL, describeSignalEndpointTrust } from "@/infrastructure/signalling/holeAdapter";
import { formatBytes, formatTime } from "@/lib/format";

const BACKEND_PRESETS = [
    {
        label: "hole.0x0.st",
        endpoint: DEFAULT_SIGNAL_URL,
        hint: "Default startup source",
    },
    {
        label: "webwormhole.com",
        endpoint: "https://webwormhole.com/",
        hint: "Official WebWormhole public server",
    },
] as const;

interface WormholeChannelProps {
    stage: ConnectionStage;
    role: SessionMode;
    code?: SessionCode;
    fingerprint?: SessionFingerprint;
    fingerprintVerified: boolean;
    remoteFingerprintVerified: boolean;
    statusLine: string;
    messages: ChatMessage[];
    transfers: FileTransferRecord[];
    backendEndpoint: string;
    backendValidationState: "idle" | "validating" | "valid" | "invalid";
    backendValidationMessage?: string;
    transportStats?: TransportStats;
    strictMode: boolean;
    disabled: boolean;
    isDragActive: boolean;
    onCreateSession: () => Promise<void>;
    onJoinSession: (code: string) => Promise<void>;
    onUpdateBackendEndpoint: (endpoint: string) => Promise<void>;
    onSetStrictMode: (value: boolean) => void;
    onConfirmFingerprint: () => void;
    onSendMessage: (message: string) => Promise<void>;
    onSendFiles: (files: FileList | File[]) => Promise<void>;
    onCloseSession: () => Promise<void>;
}

export const WormholeChannel = ({
    stage,
    role,
    code,
    fingerprint,
    fingerprintVerified,
    remoteFingerprintVerified,
    statusLine,
    messages,
    transfers,
    backendEndpoint,
    backendValidationState,
    backendValidationMessage,
    transportStats,
    strictMode,
    disabled,
    isDragActive,
    onCreateSession,
    onJoinSession,
    onUpdateBackendEndpoint,
    onSetStrictMode,
    onConfirmFingerprint,
    onSendMessage,
    onSendFiles,
    onCloseSession,
}: WormholeChannelProps) => {
    const [joinCode, setJoinCode] = useState("");
    const [draft, setDraft] = useState("");
    const [showQr, setShowQr] = useState(false);
    const [backendDraft, setBackendDraft] = useState(backendEndpoint);
    const [showBackendEditor, setShowBackendEditor] = useState(false);

    const [showJumpToBottom, setShowJumpToBottom] = useState(false);
    const [pendingItemsCount, setPendingItemsCount] = useState(0);

    const inputRef = useRef<HTMLInputElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
    const wasNearBottomRef = useRef(true);
    const previousTimelineLengthRef = useRef(0);

    const isActiveRoom = stage === "secure-ready" || stage === "transfer";
    const createSelected = Boolean(code) && !isActiveRoom;
    const joinDisabled = createSelected || !["idle", "closed", "failed"].includes(stage);
    const createDisabled = !["idle", "closed", "failed"].includes(stage);
    const backendLocked = !["idle", "closed", "failed"].includes(stage);
    const currentBackend = new URL(backendEndpoint).host;
    const isDefaultBackend = backendEndpoint === DEFAULT_SIGNAL_URL;
    const backendTrust = describeSignalEndpointTrust(backendEndpoint);
    const linkHealth =
        transportStats?.connectionState === "connected"
            ? transportStats.bufferedAmount > 512 * 1024
                ? "Buffered"
                : "Direct"
            : transportStats?.connectionState === "connecting"
              ? "Connecting"
              : transportStats?.connectionState === "disconnected" || transportStats?.connectionState === "failed"
                ? "Unstable"
                : "Idle";
    const routeLabel =
        transportStats?.routeType === "relay"
            ? "Relay"
            : transportStats?.routeType === "direct"
              ? "Direct"
              : "Unknown";
    const strictBlocked = strictMode && isActiveRoom && (!fingerprintVerified || !remoteFingerprintVerified);
    const strictRelayBlocked = strictMode && isActiveRoom && transportStats?.routeType === "relay";
    const strictWaitingOnLocal = strictMode && isActiveRoom && !fingerprintVerified;
    const strictWaitingOnPeer = strictMode && isActiveRoom && fingerprintVerified && !remoteFingerprintVerified;
    const strictRoomLocked = strictBlocked || strictRelayBlocked;
    const canEditStrictMode = !isActiveRoom && !createSelected;

    useEffect(() => {
        setBackendDraft(backendEndpoint);
    }, [backendEndpoint]);

    useEffect(() => {
        if (backendValidationState === "valid") {
            setShowBackendEditor(false);
        }
    }, [backendValidationState]);

    const timeline = useMemo(() => {
        // Fusionne messages et fichiers dans un seul fil.
        return buildTimeline(messages, transfers);
    }, [messages, transfers]);

    const scrollToBottom = (behavior: ScrollBehavior = "smooth"): void => {
        bottomAnchorRef.current?.scrollIntoView({ behavior, block: "end" });
    };

    const isNearBottom = (): boolean => {
        const container = scrollContainerRef.current;
        if (!container) {
            return true;
        }

        // Petite marge pour éviter les faux positifs.
        const threshold = 72;
        const distanceFromBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight;

        return distanceFromBottom <= threshold;
    };

    useEffect(() => {
        if (!isActiveRoom) {
            setShowJumpToBottom(false);
            setPendingItemsCount(0);
            previousTimelineLengthRef.current = 0;
            wasNearBottomRef.current = true;
            return;
        }

        const container = scrollContainerRef.current;
        if (!container) {
            return;
        }

        const handleScroll = (): void => {
            const nearBottom = isNearBottom();
            wasNearBottomRef.current = nearBottom;

            if (nearBottom) {
                setShowJumpToBottom(false);
                setPendingItemsCount(0);
            }
        };

        handleScroll();
        container.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            container.removeEventListener("scroll", handleScroll);
        };
    }, [isActiveRoom]);

    useEffect(() => {
        if (!isActiveRoom) {
            return;
        }

        const nextLength = timeline.length;
        const previousLength = previousTimelineLengthRef.current;

        if (nextLength === 0) {
            previousTimelineLengthRef.current = 0;
            setShowJumpToBottom(false);
            setPendingItemsCount(0);
            return;
        }

        if (previousLength === 0) {
            previousTimelineLengthRef.current = nextLength;
            requestAnimationFrame(() => {
                scrollToBottom("auto");
            });
            return;
        }

        if (nextLength <= previousLength) {
            previousTimelineLengthRef.current = nextLength;
            return;
        }

        const addedCount = nextLength - previousLength;
        const shouldStickToBottom = wasNearBottomRef.current || isNearBottom();

        previousTimelineLengthRef.current = nextLength;

        requestAnimationFrame(() => {
            if (shouldStickToBottom) {
                scrollToBottom("smooth");
                setShowJumpToBottom(false);
                setPendingItemsCount(0);
            } else {
                // Signale les nouveaux éléments sans casser la lecture.
                setShowJumpToBottom(true);
                setPendingItemsCount((current) => current + addedCount);
            }
        });
    }, [timeline, isActiveRoom]);

    const submit = async (): Promise<void> => {
        const next = draft.trim();
        if (!next) {
            return;
        }

        setDraft("");
        await onSendMessage(next);
    };

    return (
        <div className="w-full">
            <AnimatePresence mode="wait">
                {!isActiveRoom ? (
                    <motion.div
                        key="setup"
                        initial={{ opacity: 0, y: 28, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -24, scale: 0.98 }}
                        className="relative"
                    >
                        <GlassPanel className="mx-auto w-full max-w-[820px] overflow-hidden p-0">
                            <div className="bg-black/18 px-6 py-6">
                                <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                                    <div className="min-w-0">
                                        <h1 className="font-display text-3xl text-white md:text-4xl">WormLink</h1>
                                        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">{statusLine}</p>
                                    </div>

                                    <div className="md:w-[180px]">
                                        <button
                                            type="button"
                                            onClick={() => setShowBackendEditor(true)}
                                            disabled={backendLocked}
                                            className="rounded-[18px] bg-white/[0.03] px-4 py-3 text-left shadow-md transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-70"
                                        >
                                            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                                Backend
                                            </p>
                                            <p className="mt-2 truncate text-sm font-medium text-white">
                                                {currentBackend}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {isDefaultBackend ? "Default" : "Custom"}
                                            </p>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-0 md:grid-cols-2">
                                <div className="p-6">
                                    <div className="flex items-start justify-between gap-4">
                                        <p className="text-sm font-medium text-white">Create room</p>

                                        <div className="group relative">
                                            <label
                                                className={`inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 shadow-sm transition ${
                                                    canEditStrictMode ? "hover:bg-white/[0.06]" : "opacity-70"
                                                }`}
                                            >
                                                <span className="uppercase tracking-[0.18em] text-slate-500">
                                                    Strict
                                                </span>
                                                <input
                                                    type="checkbox"
                                                    checked={strictMode}
                                                    onChange={(event) => onSetStrictMode(event.target.checked)}
                                                    disabled={!canEditStrictMode}
                                                    className="h-3.5 w-3.5 rounded border-sky-300/20 bg-black/30"
                                                />
                                            </label>

                                            <motion.div
                                                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                                whileHover={{ opacity: 1, y: 0, scale: 1 }}
                                                className="pointer-events-none absolute right-0 top-[calc(100%+10px)] z-20 w-64 rounded-[16px] border border-sky-300/15 bg-slate-950/92 p-3 text-left opacity-0 shadow-[0_18px_50px_rgba(0,0,0,0.4)] backdrop-blur-xl group-hover:opacity-100"
                                            >
                                                <p className="text-[10px] uppercase tracking-[0.2em] text-violet-300/75">
                                                    Strict Mode
                                                </p>
                                                <p className="mt-2 text-xs leading-5 text-slate-300">
                                                    The room creator decides this. Nothing can be sent until both people verify the fingerprint through an external trusted channel.
                                                </p>
                                                <p className="mt-2 text-[11px] text-slate-500">
                                                    {canEditStrictMode
                                                        ? "Applies to this room before connection."
                                                        : role === "join"
                                                          ? "Controlled by the room creator."
                                                          : "Locked while the session is active."}
                                                </p>
                                            </motion.div>
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => void onCreateSession()}
                                        disabled={createDisabled}
                                        className="mt-4 w-full rounded-2xl bg-gradient-to-r from-violet-400 via-portal-violet to-fuchsia-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Create room
                                    </button>

                                    <div className="mt-4 rounded-[20px] bg-white/[0.03] p-4 shadow-lg">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                                                    Code
                                                </p>
                                                <div className="mt-3 break-words font-display text-xl tracking-[0.08em] text-white">
                                                    {code ? code.value : "Waiting for code"}
                                                </div>
                                            </div>

                                            {code ? (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => navigator.clipboard.writeText(code.value)}
                                                        className="rounded-full bg-white/[0.06] p-2 text-slate-300 shadow-sm transition hover:bg-white/[0.1]"
                                                    >
                                                        <ClipboardDocumentIcon className="h-5 w-5" />
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => setShowQr((value) => !value)}
                                                        className="rounded-full bg-white/[0.06] p-2 text-slate-300 shadow-sm transition hover:bg-white/[0.1]"
                                                    >
                                                        <QrCodeIcon className="h-5 w-5" />
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>

                                        {showQr && code ? (
                                            <div className="mt-4 flex justify-center rounded-[16px] bg-white p-3 shadow-md">
                                                <QRCodeSVG value={code.value} size={132} />
                                            </div>
                                        ) : null}

                                        {fingerprint ? (
                                            <div className="mt-4 pt-3 text-xs text-slate-400">
                                                <span className="text-slate-500">Fingerprint</span>{" "}
                                                <span className="font-medium text-slate-200">{fingerprint.short}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>

                                <div className={`p-6 transition ${joinDisabled ? "opacity-45" : "opacity-100"}`}>
                                    <p className="text-sm font-medium text-white">Join room</p>

                                    <div className="mt-4 space-y-3">
                                        <input
                                            value={joinCode}
                                            onChange={(event) => setJoinCode(event.target.value)}
                                            placeholder="Enter code"
                                            disabled={joinDisabled}
                                            className="w-full rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-violet-400/15 disabled:cursor-not-allowed"
                                        />

                                        <button
                                            type="button"
                                            onClick={() => void onJoinSession(joinCode)}
                                            disabled={joinDisabled || !joinCode.trim()}
                                            className="w-full rounded-[18px] bg-white/[0.07] px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Join room
                                        </button>
                                    </div>

                                    <p className="mt-4 text-xs text-slate-500">Join with the shared code.</p>
                                </div>
                            </div>
                        </GlassPanel>

                        <AnimatePresence>
                            {showBackendEditor ? (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 z-20 flex items-center justify-center bg-black/72 px-4 backdrop-blur-md"
                                >
                                    <motion.div
                                        initial={{ opacity: 0, y: 24, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 12, scale: 0.98 }}
                                        className="w-full max-w-xl rounded-[28px] bg-[#05070c]/95 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.55)]"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[11px] uppercase tracking-[0.3em] text-violet-300/70">
                                                    Backend Source
                                                </p>
                                                <h3 className="mt-2 text-xl font-medium text-white">
                                                    Change backend
                                                </h3>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setShowBackendEditor(false)}
                                                className="rounded-full bg-white/[0.06] p-2 text-slate-300 shadow-sm transition hover:bg-white/[0.1]"
                                            >
                                                <XMarkIcon className="h-5 w-5" />
                                            </button>
                                        </div>

                                        <div className="mt-5">
                                            <p className="text-[11px] uppercase tracking-[0.28em] text-violet-300/70">
                                                Quick Select
                                            </p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {BACKEND_PRESETS.map((preset) => {
                                                    const active = backendDraft.trim() === preset.endpoint;
                                                    const current = backendEndpoint === preset.endpoint;

                                                    return (
                                                        <button
                                                            key={preset.endpoint}
                                                            type="button"
                                                            onClick={() => setBackendDraft(preset.endpoint)}
                                                            className={`rounded-full px-3 py-2 text-left text-xs transition ${
                                                            active
                                                                ? "bg-violet-400/14 text-violet-100 shadow-sm"
                                                                : "bg-white/[0.05] text-slate-300 shadow-sm hover:bg-white/[0.08]"
                                                            }`}
                                                        >
                                                            <span className="flex items-center gap-2 font-medium">
                                                                <span>{preset.label}</span>
                                                                {current ? (
                                                                    <span className="rounded-full bg-violet-400/14 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-violet-100">
                                                                        Current
                                                                    </span>
                                                                ) : null}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="mt-4 flex gap-3">
                                            <input
                                                value={backendDraft}
                                                onChange={(event) => setBackendDraft(event.target.value)}
                                                placeholder={DEFAULT_SIGNAL_URL}
                                                disabled={backendLocked || backendValidationState === "validating"}
                                                className="flex-1 rounded-2xl bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-violet-400/15 disabled:cursor-not-allowed"
                                            />

                                            <button
                                                type="button"
                                                onClick={() => void onUpdateBackendEndpoint(backendDraft)}
                                                disabled={backendLocked || backendValidationState === "validating"}
                                                className="inline-flex items-center gap-2 rounded-2xl bg-white/[0.08] px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {backendValidationState === "validating" ? (
                                                    <ArrowPathIcon className="h-5 w-5 animate-spin" />
                                                ) : (
                                                    <SignalIcon className="h-5 w-5" />
                                                )}
                                                Validate
                                            </button>
                                        </div>

                                        <p className="mt-2 text-xs text-slate-500">
                                            The source changes only after a valid handshake. Remote non-TLS backends are rejected.
                                        </p>

                                        <AnimatePresence mode="wait" initial={false}>
                                            {backendValidationState !== "idle" && backendValidationMessage ? (
                                                <motion.div
                                                    key={`${backendValidationState}:${backendValidationMessage}`}
                                                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                                    className={`mt-4 flex items-center gap-2 rounded-2xl px-3 py-3 text-sm ${
                                                        backendValidationState === "valid"
                                                        ? "bg-violet-400/10 text-violet-100"
                                                        : backendValidationState === "invalid"
                                                        ? "bg-rose-500/10 text-rose-100"
                                                        : "bg-fuchsia-400/10 text-fuchsia-100"
                                                    }`}
                                                >
                                                    {backendValidationState === "valid" ? (
                                                        <CheckCircleIcon className="h-5 w-5 shrink-0" />
                                                    ) : backendValidationState === "invalid" ? (
                                                        <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
                                                    ) : (
                                                        <ArrowPathIcon className="h-5 w-5 shrink-0 animate-spin" />
                                                    )}
                                                    <span>{backendValidationMessage}</span>
                                                </motion.div>
                                            ) : null}
                                        </AnimatePresence>
                                    </motion.div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </motion.div>
                ) : (
                    <motion.div
                        key="channel"
                        initial={{ opacity: 0, y: 28, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -24, scale: 0.98 }}
                    >
                        <GlassPanel className="relative mx-auto flex h-[calc(100vh-2rem)] w-full max-w-[980px] flex-col overflow-hidden p-0 md:h-[calc(100vh-3rem)]">
                            <div className="bg-black/18 px-5 py-4">
                                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                    <div className="min-w-0">
                                        <p className="text-[11px] uppercase tracking-[0.32em] text-violet-300/70">
                                            WormLink
                                        </p>
                                        <div className="mt-2 flex flex-wrap items-center gap-3">
                                            <h2 className="font-display text-xl text-white">Secure session</h2>
                                            <div className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-slate-300">
                                                {strictMode ? "Strict mode" : "Open mode"}
                                            </div>
                                            <div className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                                                Backend {currentBackend}
                                            </div>
                                            {fingerprint ? (
                                                <div className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                                                    Fingerprint {fingerprint.short}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => void onCloseSession()}
                                        className="inline-flex items-center gap-2 self-start rounded-full bg-white/[0.06] px-4 py-2 text-sm text-white shadow-sm transition hover:bg-white/[0.1]"
                                    >
                                        <XMarkIcon className="h-4 w-4" />
                                        Leave room
                                    </button>
                                </div>

                                <p className="mt-3 text-xs text-slate-500">
                                    {statusLine} · Link {linkHealth} · Route {routeLabel}
                                </p>
                            </div>

                            <div
                                className={`relative flex-1 overflow-hidden ${
                                    isDragActive ? "bg-violet-500/5" : "bg-transparent"
                                }`}
                            >
                                <div
                                    ref={scrollContainerRef}
                                    className={`absolute inset-0 overflow-y-auto px-4 py-4 md:px-5 ${
                                        strictRoomLocked ? "blur-[2px]" : ""
                                    }`}
                                >
                                    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
                                        {timeline.length === 0 ? (
                                            <div className="rounded-[20px] border border-dashed border-white/10 bg-black/16 px-5 py-10 text-center text-sm text-slate-400">
                                                The room is open. Sent files appear in the thread. Nothing is downloaded
                                                automatically for the other person.
                                            </div>
                                        ) : null}

                                        {timeline.map((entry) => {
                                            if (entry.kind === "message") {
                                                const message = entry.data;
                                                const local = message.author === "local";

                                                return (
                                                    <motion.div
                                                        key={entry.id}
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        className={`max-w-[82%] min-w-0 rounded-[20px] px-4 py-3 ${
                                                            local
                                                                ? "ml-auto bg-[linear-gradient(135deg,rgba(77,230,255,0.18),rgba(89,145,255,0.22))] text-white"
                                                                : "bg-white/[0.05] text-slate-100 shadow-sm"
                                                        }`}
                                                    >
                                                        <p className="break-words [overflow-wrap:anywhere] text-sm leading-6">{message.text}</p>

                                                        <div className="mt-2 flex items-center justify-between gap-4 text-[11px] uppercase tracking-[0.2em] text-slate-300/80">
                                                            <span>{formatTime(message.timestamp)}</span>
                                                            <span>{message.deliveryState}</span>
                                                        </div>
                                                    </motion.div>
                                                );
                                            }

                                            const transfer = entry.data;
                                            const local = transfer.direction === "upload";

                                            return (
                                                <motion.div
                                                    key={entry.id}
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className={`max-w-[82%] rounded-[20px] px-4 py-4 shadow-sm ${
                                                        local ? "ml-auto bg-black/24" : "bg-white/[0.05]"
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-medium text-white">
                                                                {transfer.descriptor.name}
                                                            </p>
                                                            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                                                                {transfer.direction === "upload" ? "You sent" : "Received"} •{" "}
                                                                {formatBytes(transfer.descriptor.size)}
                                                            </p>
                                                        </div>

                                                        <div className="text-xs text-slate-400">
                                                            {transferLabel(transfer.state)}
                                                        </div>
                                                    </div>

                                                    <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                                                        {transfer.integrityState === "verified"
                                                            ? "Integrity verified"
                                                            : transfer.integrityState === "failed"
                                                              ? "Integrity failed"
                                                              : "Integrity pending"}
                                                    </div>

                                                    {transfer.previewUrl && isMedia(transfer.descriptor.mimeType) ? (
                                                        <div className="mt-4 overflow-hidden rounded-[18px] bg-black/30 shadow-md">
                                                            {transfer.descriptor.mimeType.startsWith("image/") ? (
                                                                <img
                                                                    src={transfer.previewUrl}
                                                                    alt={transfer.descriptor.name}
                                                                    className="max-h-80 w-full object-cover"
                                                                />
                                                            ) : (
                                                                <video
                                                                    src={transfer.previewUrl}
                                                                    controls
                                                                    className="max-h-80 w-full bg-black"
                                                                />
                                                            )}
                                                        </div>
                                                    ) : null}

                                                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
                                                        <div
                                                            className="h-full rounded-full bg-[linear-gradient(90deg,#4de6ff,#5991ff,#8e6fff)] transition-[width] duration-200"
                                                            style={{ width: `${Math.max(4, transfer.progress * 100)}%` }}
                                                        />
                                                    </div>

                                                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                                                        <span>
                                                            {isMedia(transfer.descriptor.mimeType)
                                                                ? "Preview available locally"
                                                                : "Stored locally until you save it"}
                                                        </span>

                                                        {!local && transfer.previewUrl ? (
                                                            <a
                                                                href={transfer.previewUrl}
                                                                download={transfer.descriptor.name}
                                                                className="pointer-events-auto inline-flex items-center gap-1 text-slate-200 hover:text-white"
                                                            >
                                                                <ArrowDownTrayIcon className="h-4 w-4" />
                                                                Save
                                                            </a>
                                                        ) : null}
                                                    </div>
                                                </motion.div>
                                            );
                                        })}

                                        <div ref={bottomAnchorRef} className="h-px w-full" />
                                    </div>
                                </div>

                                {strictRoomLocked ? (
                                    <div className="absolute inset-0 z-10 flex items-center justify-center px-6">
                                        <div className="w-full max-w-md rounded-[22px] bg-slate-950/82 p-5 text-center shadow-[0_22px_70px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                                            <p className="text-[11px] uppercase tracking-[0.24em] text-amber-300/80">
                                                Strict Mode
                                            </p>
                                            <h3 className="mt-2 text-lg font-medium text-white">
                                                Room locked until both fingerprints are verified
                                            </h3>
                                            <p className="mt-3 text-sm leading-6 text-slate-300">
                                                Confirm the fingerprint through an external trusted channel. Messages and files stay locked on both sides until both people verify.
                                            </p>
                                        </div>
                                    </div>
                                ) : null}

                                <AnimatePresence>
                                    {showJumpToBottom ? (
                                        <motion.button
                                            type="button"
                                            initial={{ opacity: 0, y: 16, scale: 0.96 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: 16, scale: 0.96 }}
                                            onClick={() => {
                                                scrollToBottom("smooth");
                                                setShowJumpToBottom(false);
                                                setPendingItemsCount(0);
                                            }}
                                            className="absolute bottom-5 right-5 z-20 inline-flex items-center gap-2 rounded-full bg-slate-950/82 px-4 py-3 text-sm text-white shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-xl transition hover:bg-slate-900/90"
                                        >
                                            <ArrowDownIcon className="h-4 w-4" />
                                            <span>
                                                {pendingItemsCount > 1
                                                    ? `${pendingItemsCount} new items`
                                                    : "1 new item"}
                                            </span>
                                        </motion.button>
                                    ) : null}
                                </AnimatePresence>
                            </div>

                            <div className="bg-black/24 px-4 py-4 md:px-5">
                                <div className="mx-auto max-w-[720px]">
                                    <AnimatePresence mode="wait" initial={false}>
                                        {strictMode && fingerprint && (!fingerprintVerified || !remoteFingerprintVerified) ? (
                                            <motion.div
                                                key="fingerprint-gate"
                                                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: -14, scale: 0.97 }}
                                                transition={{ duration: 0.28, ease: "easeOut" }}
                                                className={`mb-3 rounded-[18px] px-4 py-3 text-sm shadow-sm ${
                                                    strictMode && strictBlocked
                                                        ? "bg-amber-500/8 text-amber-100"
                                                        : fingerprintVerified
                                                          ? "bg-emerald-500/8 text-emerald-100"
                                                          : "bg-amber-500/8 text-amber-100"
                                                }`}
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-3">
                                                    <div>
                                                        <p className="font-medium">
                                                            Fingerprint {fingerprint.short}
                                                        </p>
                                                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-current/80">
                                                            <p>You: {fingerprintVerified ? "verified" : "pending"}</p>
                                                            <p>Peer: {remoteFingerprintVerified ? "verified" : "pending"}</p>
                                                        </div>
                                                    </div>
                                                    {!fingerprintVerified ? (
                                                        <button
                                                            type="button"
                                                            onClick={onConfirmFingerprint}
                                                            className="rounded-full bg-black/20 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white shadow-sm transition hover:bg-black/30"
                                                        >
                                                            Mark verified
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </motion.div>
                                        ) : null}
                                    </AnimatePresence>

                                    {strictBlocked ? (
                                        <p className="mb-3 text-xs text-amber-300/90">
                                            {strictWaitingOnLocal
                                                ? "Verify the fingerprint on your side to unlock the room."
                                                : "Waiting for the other person to verify the fingerprint."}
                                        </p>
                                    ) : null}
                                    {strictRelayBlocked ? (
                                        <p className="mb-3 text-xs text-amber-300/90">
                                            Strict mode blocks relay routes until direct connection.
                                        </p>
                                    ) : null}

                                    <div className="flex gap-3">
                                        <button
                                            type="button"
                                            onClick={() => inputRef.current?.click()}
                                            disabled={disabled || strictBlocked || strictRelayBlocked}
                                            className="rounded-2xl bg-white/[0.06] px-4 py-3 text-white shadow-sm transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <ArrowUpTrayIcon className="h-5 w-5" />
                                        </button>

                                        <input
                                            ref={inputRef}
                                            type="file"
                                            multiple
                                            className="hidden"
                                            onChange={(event) => {
                                                if (event.target.files) {
                                                    void onSendFiles(event.target.files);
                                                    event.target.value = "";
                                                }
                                            }}
                                        />

                                        <textarea
                                            value={draft}
                                            onChange={(event) => setDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" && !event.shiftKey) {
                                                    event.preventDefault();
                                                    void submit();
                                                }
                                            }}
                                            rows={2}
                                            placeholder="Write a message"
                                            disabled={disabled || strictBlocked || strictRelayBlocked}
                                            className="min-h-14 flex-1 resize-none rounded-[22px] bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-violet-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                                        />

                                        <button
                                            type="button"
                                            onClick={() => void submit()}
                                            disabled={disabled || strictBlocked || strictRelayBlocked || !draft.trim()}
                                            className="rounded-[22px] bg-gradient-to-br from-violet-400 to-fuchsia-500 p-4 text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <PaperAirplaneIcon className="h-5 w-5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </GlassPanel>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
