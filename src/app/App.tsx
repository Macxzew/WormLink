import { useEffect } from "react";
import { WormholeBackdrop } from "@/components/layout/WormholeBackdrop";
import { DebugDrawer } from "@/components/system/DebugDrawer";
import { ToastStrip } from "@/components/system/ToastStrip";
import { WormholeChannel } from "@/features/session/components/WormholeChannel";
import { useReducedMotionPreference } from "@/features/session/hooks/useReducedMotion";
import { useWormholeController } from "@/features/session/hooks/useWormholeController";
import { useSessionStore } from "@/features/session/state/sessionStore";

export const App = () => {
    useReducedMotionPreference();
    const controller = useWormholeController();
    const {
        stage,
        reducedMotion,
        sessionCode,
        fingerprint,
        statusLine,
        messages,
        transfers,
        isDragActive,
        backendEndpoint,
        backendValidationState,
        backendValidationMessage,
    } = controller.state;
    const setDragActive = useSessionStore((state) => state.setDragActive);

    useEffect(() => {
        // Gère le drop fichier à l'échelle de la fenêtre.
        const handleDragOver = (event: DragEvent) => {
            event.preventDefault();
            setDragActive(true);
        };
        const handleDragLeave = () => setDragActive(false);
        const handleDrop = (event: DragEvent) => {
            event.preventDefault();
            setDragActive(false);
            if (event.dataTransfer?.files?.length) {
                void controller.sendFiles(event.dataTransfer.files);
            }
        };

        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("drop", handleDrop);
        return () => {
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("drop", handleDrop);
        };
    }, [controller.sendFiles, setDragActive]);

    const channelReady = stage === "secure-ready" || stage === "transfer";

    return (
        <div className="relative min-h-screen overflow-hidden bg-abyss text-white">
            <WormholeBackdrop reducedMotion={reducedMotion} />
            <ToastStrip />
            <div className="relative mx-auto flex min-h-screen max-w-[1120px] items-center justify-center px-3 py-3 md:px-5 md:py-5">
                <WormholeChannel
                    stage={stage}
                    code={sessionCode}
                    fingerprint={fingerprint}
                    statusLine={statusLine}
                    messages={messages}
                    transfers={transfers}
                    backendEndpoint={backendEndpoint}
                    backendValidationState={backendValidationState}
                    backendValidationMessage={backendValidationMessage}
                    disabled={!channelReady}
                    isDragActive={isDragActive}
                    onCreateSession={controller.createSession}
                    onJoinSession={controller.joinSession}
                    onUpdateBackendEndpoint={controller.updateBackendEndpoint}
                    onSendMessage={controller.sendText}
                    onSendFiles={controller.sendFiles}
                    onCloseSession={controller.closeSession}
                />
            </div>
            {controller.state.debugOpen ? <DebugDrawer /> : null}
        </div>
    );
};
