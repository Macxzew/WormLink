import { useEffect } from "react";
import { useSessionStore } from "@/features/session/state/sessionStore";

export const useReducedMotionPreference = (): void => {
    const setReducedMotion = useSessionStore((state) => state.setReducedMotion);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const sync = () => setReducedMotion(media.matches);
        sync();
        media.addEventListener("change", sync);
        return () => media.removeEventListener("change", sync);
    }, [setReducedMotion]);
};
