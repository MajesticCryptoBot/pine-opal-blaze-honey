from __future__ import annotations
import argparse
import shutil
from pathlib import Path

IMPORT_MARKER = "import wire_bridge  # WIRE_LOCAL_BRIDGE"
START_MARKER = "await wire_bridge.start(application, globals())"
START_NEEDLE = "        await application.start()"

def main():
    parser = argparse.ArgumentParser(description="Safely patch the existing Binance bot for Wire.")
    parser.add_argument("script", nargs="?", help="Path to ABinanceTradingBot.py")
    args = parser.parse_args()
    raw = args.script or input("Full path to your existing ABinanceTradingBot.py: ").strip().strip('"')
    source = Path(raw).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"Script not found: {source}")
    text = source.read_text(encoding="utf-8-sig")
    if IMPORT_MARKER in text and START_MARKER in text:
        print("Wire bridge is already installed.")
        return
    if text.count(START_NEEDLE) != 1:
        raise SystemExit("Safe patch stopped: expected exactly one application.start() marker; no changes made.")
    main_marker = "\nasync def main():"
    if text.count(main_marker) != 1:
        raise SystemExit("Safe patch stopped: could not uniquely locate main(); no changes made.")
    bridge_source = Path(__file__).resolve().parents[1] / "wire_bridge.py"
    if not bridge_source.is_file():
        raise SystemExit(f"wire_bridge.py not found: {bridge_source}")
    bridge_target = source.parent / "wire_bridge.py"
    if bridge_target.exists() and "Loopback-only bridge for Wire" not in bridge_target.read_text(encoding="utf-8"):
        raise SystemExit(f"Refusing to overwrite existing file: {bridge_target}")
    backup = source.with_suffix(source.suffix + ".pre-wire-bridge.bak")
    if backup.exists():
        raise SystemExit(f"Backup already exists; refusing to overwrite it: {backup}")
    if not bridge_target.exists():
        shutil.copy2(bridge_source, bridge_target)
    shutil.copy2(source, backup)
    text = text.replace(main_marker, f"\n{IMPORT_MARKER}\n\nasync def main():", 1)
    text = text.replace(START_NEEDLE, START_NEEDLE + "\n        " + START_MARKER, 1)
    source.write_text(text, encoding="utf-8")
    print("Wire bridge installed; original script backup saved to:")
    print(backup)
    print("Restart the existing bot process. Do not start a second bot instance.")

if __name__ == "__main__":
    main()
