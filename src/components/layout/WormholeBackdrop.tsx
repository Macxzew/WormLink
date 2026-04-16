import clsx from "clsx";
import { motion } from "framer-motion";

interface WormholeBackdropProps {
    reducedMotion: boolean;
}

const particles = [
    { top: "8%", left: "16%", size: "h-1 w-1", blur: "blur-[1px]", opacity: "opacity-45" },
    { top: "14%", left: "74%", size: "h-1.5 w-1.5", blur: "blur-[2px]", opacity: "opacity-60" },
    { top: "18%", left: "56%", size: "h-1 w-1", blur: "blur-[1px]", opacity: "opacity-40" },
    { top: "22%", left: "86%", size: "h-1 w-1", blur: "blur-[1px]", opacity: "opacity-35" },
    { top: "28%", left: "10%", size: "h-1 w-1", blur: "blur-[1px]", opacity: "opacity-40" },
    { top: "34%", left: "78%", size: "h-2 w-2", blur: "blur-[3px]", opacity: "opacity-50" },
    { top: "42%", left: "18%", size: "h-1.5 w-1.5", blur: "blur-[2px]", opacity: "opacity-55" },
    { top: "58%", left: "82%", size: "h-1 w-1", blur: "blur-[1px]", opacity: "opacity-45" },
    { top: "64%", left: "12%", size: "h-1 w-1", blur: "blur-[1px]", opacity: "opacity-35" },
    { top: "72%", left: "70%", size: "h-1.5 w-1.5", blur: "blur-[2px]", opacity: "opacity-55" },
    { top: "78%", left: "28%", size: "h-1 w-1", blur: "blur-[1px]", opacity: "opacity-45" },
    { top: "84%", left: "88%", size: "h-1.5 w-1.5", blur: "blur-[2px]", opacity: "opacity-60" },
];

const ringTransition = {
    duration: 18,
    repeat: Number.POSITIVE_INFINITY,
    ease: "linear" as const,
};

export const WormholeBackdrop = ({ reducedMotion }: WormholeBackdropProps) => {
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* Base noire */}
            <div className="absolute inset-0 bg-[#010103]" />

            {/* Halo cosmique global */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(245,111,35,0.14),transparent_12%),radial-gradient(circle_at_50%_48%,rgba(108,56,255,0.16),transparent_24%),radial-gradient(circle_at_50%_48%,rgba(70,148,255,0.08),transparent_34%),radial-gradient(circle_at_50%_0%,rgba(52,87,197,0.08),transparent_32%),radial-gradient(circle_at_50%_100%,rgba(0,0,0,0.96),rgba(0,0,0,1)_72%)]" />

            {/* Voile léger */}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_18%,transparent_82%,rgba(0,0,0,0.28))]" />

            {/* Étoiles / particules */}
            {particles.map((particle, index) => (
                <motion.div
                    key={`${particle.top}-${particle.left}-${index}`}
                    className={clsx(
                        "absolute rounded-full bg-white",
                        particle.size,
                        particle.blur,
                        particle.opacity
                    )}
                    style={{ top: particle.top, left: particle.left }}
                    animate={
                        reducedMotion
                            ? undefined
                            : {
                                    opacity: [0.2, 0.85, 0.25],
                                    scale: [1, 1.65, 1],
                                }
                    }
                    transition={{
                        duration: 3.6 + (index % 6),
                        repeat: Number.POSITIVE_INFINITY,
                        ease: "easeInOut",
                        delay: index * 0.25,
                    }}
                />
            ))}

            {/* Halo externe bleu/violet */}
            <motion.div
                className="absolute left-1/2 top-[48%] h-[96rem] w-[96rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(70,120,255,0.12)_0%,rgba(76,34,187,0.10)_18%,rgba(255,106,24,0.05)_30%,rgba(0,0,0,0)_64%)] blur-[220px]"
                animate={
                    reducedMotion
                        ? undefined
                        : {
                                opacity: [0.78, 0.84, 0.8],
                            }
                }
                transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Anneau d’accrétion principal */}
            <motion.div
                className="absolute left-1/2 top-[49%] h-[14rem] w-[50rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[conic-gradient(from_112deg,rgba(255,210,120,0.00)_0deg,rgba(255,190,95,0.10)_20deg,rgba(255,150,70,0.42)_52deg,rgba(255,115,45,0.88)_88deg,rgba(255,95,30,0.98)_118deg,rgba(255,120,48,0.62)_148deg,rgba(140,78,255,0.14)_190deg,rgba(70,140,255,0.04)_238deg,rgba(255,210,120,0.00)_360deg)] blur-[8px] opacity-90"
                animate={
                    reducedMotion
                        ? undefined
                        : {
                                scaleX: [1, 1.018, 1],
                                scaleY: [0.94, 0.91, 0.94],
                                opacity: [0.82, 0.94, 0.85],
                                rotate: [-0.8, 1.2, -0.6],
                            }
                }
                transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Glow chaud autour de l’anneau */}
            <motion.div
                className="absolute left-1/2 top-[49%] h-[20rem] w-[84rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,240,190,0)_0%,rgba(255,210,130,0.08)_18%,rgba(255,150,70,0.20)_38%,rgba(255,105,40,0.28)_54%,rgba(110,52,235,0.06)_72%,transparent_84%)] blur-[52px]"
                animate={
                    reducedMotion
                        ? undefined
                        : {
                                opacity: [0.34, 0.4, 0.36],
                            }
                }
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Lensing / déformation gravitationnelle */}
            <motion.div
                className="absolute left-1/2 top-[48%] h-[28rem] w-[54rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/6 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.02)_34%,transparent_62%)] blur-[6px]"
                animate={
                    reducedMotion
                        ? undefined
                        : {
                                opacity: [0.16, 0.22, 0.18],
                                x: [0, 1, 0],
                            }
                }
                transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Masse principale */}
            <motion.div
                className="absolute left-1/2 top-[48%] h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,0,0,1)_45%,rgba(0,0,0,0.98)_55%,rgba(10,10,20,1)_60%,rgba(40,60,140,0.18)_68%,rgba(255,140,60,0.06)_75%,transparent_85%)] shadow-[0_0_160px_rgba(0,0,0,1)]"
                animate={
                    reducedMotion
                        ? undefined
                        : {
                                scale: [1, 1.015, 0.995],
                                opacity: [0.98, 1, 0.99],
                            }
                }
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Cercle subtil de respiration */}
            <motion.div
                className="absolute left-1/2 top-[48%] h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/10"
                animate={
                    reducedMotion
                        ? undefined
                        : { scale: [0.97, 1.03, 0.985], opacity: [0.25, 0.55, 0.28] }
                }
                transition={{ duration: 6.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />

            {/* Reflet gravitationnel haut */}
            <motion.div
                className="absolute left-1/2 top-[41%] h-[10rem] w-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,transparent,rgba(146,194,255,0.12),rgba(255,255,255,0.2),rgba(146,194,255,0.12),transparent)] blur-[18px]"
                animate={
                    reducedMotion
                        ? undefined
                        : { scaleX: [0.9, 1.08, 0.94], opacity: [0.15, 0.38, 0.18] }
                }
                transition={{ duration: 7.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />

            {/* Reflet gravitationnel bas */}
            <motion.div
                className="absolute left-1/2 top-[55%] h-[8rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,transparent,rgba(81,130,255,0.08),rgba(255,153,94,0.18),rgba(81,130,255,0.08),transparent)] blur-[22px]"
                animate={
                    reducedMotion
                        ? undefined
                        : { scaleX: [1, 1.15, 1.02], opacity: [0.12, 0.3, 0.16] }
                }
                transition={{ duration: 9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />

            {/* Vignette finale */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(0,0,0,0.18)_24%,rgba(0,0,0,0.76)_60%,rgba(0,0,0,0.96)_100%)]" />
        </div>
    );
};