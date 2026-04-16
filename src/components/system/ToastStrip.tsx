import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useSessionStore } from "@/features/session/state/sessionStore";

export const ToastStrip = () => {
    const error = useSessionStore((state) => state.error);
    const notice = useSessionStore((state) => state.notice);
    const setError = useSessionStore((state) => state.setError);
    const setNotice = useSessionStore((state) => state.setNotice);

    useEffect(() => {
        if (!error) {
            return;
        }
        // Les erreurs restent un peu plus longtemps.
        const timeout = window.setTimeout(() => setError(undefined), 4200);
        return () => window.clearTimeout(timeout);
    }, [error, setError]);

    useEffect(() => {
        if (!notice) {
            return;
        }
        const timeout = window.setTimeout(() => setNotice(undefined), 3200);
        return () => window.clearTimeout(timeout);
    }, [notice, setNotice]);

    return (
        <div className="pointer-events-none fixed right-5 top-5 z-50 w-[24rem] max-w-[calc(100vw-2.5rem)]">
            <AnimatePresence>
                {notice ? (
                    <motion.div
                        initial={{ opacity: 0, y: -12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.98 }}
                        className="mb-3 rounded-3xl border border-violet-300/15 bg-violet-950/30 px-4 py-3 text-sm text-slate-100 shadow-2xl backdrop-blur-xl"
                    >
                        {notice}
                    </motion.div>
                ) : null}
                {error ? (
                    <motion.div
                        initial={{ opacity: 0, y: -12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.98 }}
                        className="rounded-3xl border border-rose-300/20 bg-rose-950/50 px-4 py-3 text-sm text-rose-100 shadow-2xl backdrop-blur-xl"
                    >
                        {error}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
};
