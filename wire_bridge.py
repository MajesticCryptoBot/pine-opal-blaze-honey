"""Loopback-only bridge for Wire to call the already-running bot process."""
from __future__ import annotations
import contextvars
import logging
from types import SimpleNamespace
from aiohttp import web

HOST, PORT = "127.0.0.1", 47832
WIRE_ORIGIN = "http://127.0.0.1:47831"
_capture = contextvars.ContextVar("wire_reply_capture", default=None)
_ns = None
_app = None
_original_send = None

READ = {
    "/status": "status", "/balance": "balance", "/price": "price",
    "/compound_status": "compound_status", "/isaac_status": "isaac_status",
    "/status2": "status", "/balance2": "balance", "/price2": "price",
    "/compound_status2": "compound_status2",
}
PAIR = {"/pair": "pair_start", "/pair2": "pair_start"}
BLOCKED = {"/mb", "/mb2", "/magic_sell", "/magic_sell2", "/emergency_isaac",
           "/reset_state", "/reset_state2", "/buy_price", "/buy_price2"}

@web.middleware
async def security(request, handler):
    origin = request.headers.get("Origin")
    host = request.host.split(":")[0].strip("[]").lower()
    if host not in {"127.0.0.1", "localhost"} or (origin and origin != WIRE_ORIGIN):
        raise web.HTTPForbidden(text="Wire bridge is local-only.")
    response = web.Response(status=204) if request.method == "OPTIONS" else await handler(request)
    if origin == WIRE_ORIGIN:
        response.headers["Access-Control-Allow-Origin"] = WIRE_ORIGIN
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Vary"] = "Origin"
    response.headers["Cache-Control"] = "no-store"
    return response

async def health(request):
    return web.json_response({"ok": True, "connected": _ns is not None,
        "service": "ABinanceTradingBot", "readOnly": True,
        "commands": sorted(list(READ) + list(PAIR))})

async def snapshot(request):
    try:
        return web.json_response({"ok": True, "connected": _ns is not None,
            "activePair": _ns["active_last_symbol"]() if _ns else None,
            "isaacPair": _ns.get("ISAAC_DCA_SYMBOL") if _ns else None})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)

async def command(request):
    if _ns is None or _app is None:
        raise web.HTTPServiceUnavailable(text="Existing bot process is not connected.")
    try:
        raw = str((await request.json()).get("text", "")).strip()
    except Exception:
        raise web.HTTPBadRequest(text="Expected JSON with a text field.")
    if not raw or len(raw) > 300:
        raise web.HTTPBadRequest(text="Command is empty or too long.")
    parts = raw.split()
    name, args = parts[0].lower().split("@", 1)[0], parts[1:]
    if name in BLOCKED:
        return web.json_response({"ok": False, "blocked": True, "replies": [
            "Not enabled through Wire yet: this command can place orders or change trading state. No action was taken."
        ]}, status=403)
    handler_name = READ.get(name) or PAIR.get(name)
    if not handler_name:
        return web.json_response({"ok": False, "replies": [
            f"{name} is not connected to the real script. No simulated result was generated."
        ]}, status=400)
    if name in PAIR and len(args) != 1:
        quote = "USDC" if name == "/pair2" else "USDT"
        return web.json_response({"ok": False, "replies": [f"Use {name} PAIR/{quote}"]}, status=400)
    fn = _ns.get(handler_name)
    if not callable(fn):
        return web.json_response({"ok": False, "error": f"Handler {handler_name} is missing."}, status=501)

    replies = []
    token = _capture.set(replies)
    slot = _ns.get("ACTIVE_SLOT")
    slot_token = None
    try:
        if name.endswith("2") and slot is not None:
            slot_token = slot.set("USDC")
        fake_bot = SimpleNamespace()
        uid = int(_ns.get("TELEGRAM_USER_ID", 0) or 0)
        message = SimpleNamespace(text=raw, chat=SimpleNamespace(id=uid),
            from_user=SimpleNamespace(id=uid, username="wire-local"))
        update = SimpleNamespace(message=message, effective_message=message,
            effective_chat=message.chat, effective_user=message.from_user,
            get_bot=lambda: fake_bot)
        context = SimpleNamespace(args=args, bot=fake_bot, user_data={}, chat_data={},
            application=_app, error=None, matches=[])
        await fn(update, context)
    except Exception as exc:
        logging.getLogger(__name__).exception("Wire bridge command failed")
        return web.json_response({"ok": False, "error": str(exc), "replies": replies}, status=500)
    finally:
        if slot_token is not None:
            slot.reset(slot_token)
        _capture.reset(token)
    return web.json_response({"ok": True, "replies": replies or [
        "The real handler returned no text response. Check the bot log."
    ]})

async def start(application, namespace):
    global _ns, _app, _original_send
    _ns, _app = namespace, application
    if _original_send is None:
        _original_send = namespace["send_telegram_message"]
        async def send(bot, message):
            active = _capture.get()
            if active is not None:
                active.append(str(message))
                return
            await _original_send(bot, message)
        namespace["send_telegram_message"] = send
    service = web.Application(middlewares=[security])
    async def options(request):
        return web.Response(status=204)
    service.router.add_route("OPTIONS", "/{tail:.*}", options)
    service.router.add_get("/health", health)
    service.router.add_get("/snapshot", snapshot)
    service.router.add_post("/command", command)
    runner = web.AppRunner(service, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, HOST, PORT)
    await site.start()
    logging.getLogger(__name__).info("Wire local bridge listening on http://%s:%s", HOST, PORT)
