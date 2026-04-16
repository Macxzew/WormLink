<h1 align="center">WormLink <img src="assets/app-icon.png" width="20px"></h1>

> 🌀 WormLink is an encrypted P2P desktop application, compatible with WebWormhole servers, designed to reduce the trust required in remote servers.

<center><img alt="WormLink" src="assets/desktop.png"/></center>

## 🙏 Credits

WormLink is an original project inspired by [Magic Wormhole](https://github.com/magic-wormhole/magic-wormhole).

The current backend used for signalling is [hole.0x0.st](https://hole.0x0.st/), a public WebWormhole instance by [mia / 0x0.st](https://0x0.st/).

By default, WormLink starts on `hole.0x0.st`, but the signalling backend can also be changed at runtime from the interface. Any custom endpoint is validated first to confirm that it behaves like a compatible WebWormhole server before it is applied.

WebWormhole source: [saljam/webwormhole](https://github.com/saljam/webwormhole)

## ✨ Features

- Encrypted peer-to-peer messaging
- Encrypted file transfer up to 512 MB
- Session code sharing
- QR code support
- Drag and drop file sending
- Runtime backend source selector with endpoint validation
- Debug journal
- Reduced motion support

## 🔐 Security Notes

- Messages and file payloads are encrypted locally before transport
- `hole.0x0.st` is the default signalling backend at startup
- Supported signalling sources can be switched from the UI and are validated before use
- Session fingerprints are shown for manual verification
- No security audit has been performed at this time

## 🧩 Environment Variables

You can configure the signalling backend with:

```shell
VITE_WORMLINK_RENDEZVOUS_URL=
VITE_WORMLINK_PROTOCOL=
```

If no environment variable is provided, the application starts with `https://hole.0x0.st/`.

The interface also exposes a backend selector. At the moment, `hole.0x0.st` and `https://webwormhole.com/` are suggested from the UI, and custom endpoints can be entered manually. Runtime changes are temporary for the current launch and reset to the default backend on the next app start.


## 🚀 Usage

To use this project, follow the steps below in your preferred terminal.

### 1️⃣ Installing Dependencies

Before anything else, install the necessary dependencies:

```shell
npm install
```

Note: This step is mandatory before building or running the application.

### 2️⃣ Run in Development

You can start the application in development mode with:

```shell
npm run dev
```

### 3️⃣ Build and Run

#### 🔹 Windows

1. Run the following command to build the Windows version:

```shell
npm run build-win
```

2. You can then launch the application from the generated output folder.

#### 🔹 MAC

1. Run the following command to build the macOS version:

```shell
npm run build-mac
```

2. Copy the application to `/Applications/` so that it appears in the Launchpad:

```shell
sudo cp -R WormLink.app /Applications/
```

3. You can then run `WormLink` directly from the Launchpad.

#### 🔹 Linux

1. Run the following command to build the Linux version:

```shell
npm run build-linux
```

2. You can then launch the generated application from the output folder.


## 👤 Author

Give a ⭐️ if this project helped you!

## 📝 License

Copyright © 2026 [Macxzew](https://github.com/Macxzew).<br />
This project is licensed under the MIT License.
