import { app, BrowserWindow, Menu, nativeTheme, shell } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { fileURLToPath } from "node:url";

const createWindow = async (): Promise<void> => {
    const window = new BrowserWindow({
        width: 1420,
        height: 930,
        minWidth: 1120,
        minHeight: 760,
        backgroundColor: "#020611",
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 18, y: 18 },
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        const indexPath = fileURLToPath(
            new URL("../out/renderer/index.html", import.meta.url)
        );
        await window.loadFile(indexPath);
    }

    window.show();
};

app.whenReady().then(() => {
    electronApp.setAppUserModelId("io.wormlink.app");
    nativeTheme.themeSource = "dark";
    Menu.setApplicationMenu(null);

    app.on("browser-window-created", (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});