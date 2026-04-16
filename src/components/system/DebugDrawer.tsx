import clsx from "clsx";
import { ChevronUpIcon } from "@heroicons/react/24/outline";
import { useSessionStore } from "@/features/session/state/sessionStore";
import { formatTime } from "@/lib/format";

export const DebugDrawer = () => {
    const debugOpen = useSessionStore((state) => state.debugOpen);
    const logs = useSessionStore((state) => state.logs);
    const setDebugOpen = useSessionStore((state) => state.setDebugOpen);

    return (
        <div className="fixed bottom-4 left-4 right-4 z-40 md:left-auto md:w-[28rem]">
            <button
                type="button"
                onClick={() => setDebugOpen(!debugOpen)}
                className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-xs text-slate-300 backdrop-blur"
            >
                Debug journal
                <ChevronUpIcon className={clsx("h-4 w-4 transition", debugOpen && "rotate-180")} />
            </button>
            <div
                className={clsx(
                    "overflow-hidden rounded-3xl border border-white/10 bg-black/55 backdrop-blur-xl transition-all duration-300",
                    debugOpen ? "max-h-80 opacity-100" : "max-h-0 opacity-0",
                )}
            >
                <div className="max-h-80 space-y-2 overflow-y-auto p-4 text-xs">
                    {logs.length === 0 ? <p className="text-slate-400">No protocol events yet.</p> : null}
                    {logs.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-2">
                            <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-slate-500">
                                <span>{entry.level}</span>
                                <span>{formatTime(entry.timestamp)}</span>
                            </div>
                            <p className="text-slate-200">{entry.message}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
