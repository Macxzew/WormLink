import type { ErrorInfo, PropsWithChildren } from "react";
import { Component } from "react";

interface ErrorBoundaryState {
    hasError: boolean;
    message?: string;
}

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        hasError: false,
    };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {
            hasError: true,
            message: error.message,
        };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("WormLink renderer crash", error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex min-h-screen items-center justify-center bg-abyss px-6 text-white">
                    <div className="max-w-xl rounded-[28px] border border-rose-300/20 bg-rose-950/20 p-6 shadow-portal">
                        <p className="text-xs uppercase tracking-[0.3em] text-rose-200/80">Renderer error</p>
                        <h1 className="mt-3 font-display text-3xl">WormLink failed to render</h1>
                        <p className="mt-4 text-sm text-slate-200">
                            {this.state.message ?? "Unknown renderer error."}
                        </p>
                        <p className="mt-3 text-sm text-slate-400">
                            Open DevTools and check the console if this persists.
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
