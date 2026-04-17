import type { PropsWithChildren } from "react";
import clsx from "clsx";

interface GlassPanelProps extends PropsWithChildren {
    className?: string;
}

export const GlassPanel = ({ className, children }: GlassPanelProps) => (
    <div
        className={clsx(
            "rounded-[28px] bg-white/[0.04] shadow-portal backdrop-blur-2xl",
            className,
        )}
    >
        {children}
    </div>
);
