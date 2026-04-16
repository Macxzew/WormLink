import type { PropsWithChildren } from "react";
import clsx from "clsx";

interface GlassPanelProps extends PropsWithChildren {
    className?: string;
}

export const GlassPanel = ({ className, children }: GlassPanelProps) => (
    <div
        className={clsx(
            "rounded-[28px] border border-white/10 bg-white/[0.06] shadow-portal backdrop-blur-2xl",
            className,
        )}
    >
        {children}
    </div>
);
