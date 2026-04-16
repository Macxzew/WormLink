import type { Config } from "tailwindcss";

export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                abyss: "#020611",
                "void-1": "#07101f",
                "void-2": "#0e1a33",
                "portal-cyan": "#4de6ff",
                "portal-blue": "#5991ff",
                "portal-violet": "#8e6fff",
                "portal-frost": "#d8e7ff",
            },
            boxShadow: {
                portal: "0 0 0 1px rgba(124, 164, 255, 0.12), 0 20px 50px rgba(3, 8, 24, 0.55), 0 0 40px rgba(77, 230, 255, 0.15)",
            },
            backgroundImage: {
                "portal-grid":
                    "radial-gradient(circle at center, rgba(94,130,255,0.12), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0))",
            },
            animation: {
                "drift-slow": "driftSlow 14s ease-in-out infinite",
                "pulse-ring": "pulseRing 6s ease-in-out infinite",
                "shimmer-line": "shimmerLine 2.6s linear infinite",
            },
            keyframes: {
                driftSlow: {
                    "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
                    "50%": { transform: "translate3d(0, -12px, 0) scale(1.03)" },
                },
                pulseRing: {
                    "0%, 100%": { transform: "scale(0.94)", opacity: "0.45" },
                    "50%": { transform: "scale(1.06)", opacity: "0.95" },
                },
                shimmerLine: {
                    "0%": { backgroundPosition: "200% 0" },
                    "100%": { backgroundPosition: "-200% 0" },
                },
            },
            fontFamily: {
                sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
                display: ["Space Grotesk", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
            },
        },
    },
    plugins: [],
} satisfies Config;
