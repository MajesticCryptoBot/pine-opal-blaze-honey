# Wire for Windows

This repository can be launched as a normal Windows desktop window with Electron. The desktop wrapper packages the existing web app and its local Node server; it does not turn the current simulated trading engine into a live Telegram or exchange integration.

## Requirements

- Windows 10/11, 64-bit for the installed app
- Node.js 22 LTS (only if building from source)
- Git (only if cloning the repository)

## Run the desktop app during development

```powershell
npm install
npm run desktop:dev
```

The Electron window starts the existing Vite development server on `127.0.0.1:8080`. Keep this workflow for development only.

## Build the Windows installer

To build the installer yourself, run these commands in PowerShell from the repository root on a Windows x64 PC:

```powershell
npm install
npm run desktop:build
```

The build script creates a standalone Nitro Node server and packages it with Electron. The expected installer path is:

```text
release/Wire-Setup-1.0.0-x64.exe
```

Run the installer, choose the installation directory, and launch **Wire** from the Start menu or desktop shortcut.

## Important current limitations

- The chat and bot responses currently use the local simulation engine in `src/lib/wire/engine.ts` and `src/lib/wire/store.ts`.
- Real Telegram account/session connectivity has not been implemented or verified by this packaging change.
- Real Binance, Bybit, or Bitget execution has not been implemented or verified by this packaging change. Do not interpret simulated balances, prices, or command replies as live exchange data.
- This initial desktop build uses the existing local browser persistence for chat state. It does not yet provide a dedicated backup/restore workflow.
- Build and test the installer on the target Windows PC before relying on it. This repository change adds the packaging workflow; it is not a claim that a Windows installer has already been built or tested.

## Troubleshooting

- If `npm install` fails, install a current Node.js LTS release and retry in a new PowerShell window.
- If the desktop window reports that the server did not start, close other development instances, run `npm run desktop:build` again, and inspect the terminal output.
- The packaged server uses local port `47831`; if another program occupies that port, close the conflicting program before launching Wire.
