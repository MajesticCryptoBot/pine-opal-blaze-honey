# Connect Wire to the existing Binance bot

Wire does not start another copy of the trading bot. The bridge is loaded into the existing Python process and binds only to `127.0.0.1:47832`.

## Install the bridge into the existing script

1. Stop the existing bot cleanly first.
2. Download and extract the repository ZIP for branch `desktop-windows-app`.
3. Open PowerShell in the extracted repository folder.
4. Run the patcher against the one script you actually run (adjust the path if yours differs):

   ```powershell
   py scripts\install_wire_bridge.py "C:\Users\pauld\Desktop\IG\ABinanceTradingBot.py"
   ```

5. The patcher creates a `.pre-wire-bridge.bak` backup and copies `wire_bridge.py` next to the script. It stops rather than overwriting an unexpected backup or source layout.
6. Start the same script again using its normal Python environment. Confirm its log says: `Wire local bridge listening on http://127.0.0.1:47832`.
7. Open Wire and send `/status` or `/balance`. If Wire was already open, send the command again; it will test the bridge.

## Commands enabled in this first connection

Read-only: `/status`, `/balance`, `/price`, `/compound_status`, `/isaac_status`, and the corresponding USDC-lane status commands. Pair selection is also supported with `/pair XRP/USDT` or `/pair2 XRP/USDC`.

Order placement, emergency sells, state resets, and buy-price changes are blocked in Wire for now. Use the existing Telegram command channel for those until the app has a deliberate confirmation workflow. Unsupported commands return an explicit message; they do not fall back to simulated responses.

## Security

- Rotate any API keys or Telegram bot tokens that have been exposed in source files.
- Never commit secrets to GitHub.
- The bridge is loopback-only and is not available from a phone or another PC.
- Do not expose port 47832 to your LAN or internet.
