import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBot, seedBots, uid, type Bot, type Exchange, type Message, type Reply } from "@/lib/wire/engine";

type DeskState = {
  bots: Bot[];
  activeId: string;
  sound: boolean;
  infoOpen: boolean;
  query: string;
  setQuery: (q: string) => void;
  setActive: (id: string) => void;
  toggleSound: () => void;
  toggleInfo: () => void;
  send: (text: string) => void;
  toggleOnline: (id: string) => void;
  addBot: (name: string, exchange: Exchange) => void;
  removeBot: (id: string) => void;
  tickAll: () => void;
  drain: (id: string) => Promise<void>;
};

const draining = new Set<string>();

let audioCtx: AudioContext | null = null;

export function playTone(important: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx || new Ctx();
    void audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    const t = audioCtx.currentTime;
    o.frequency.setValueAtTime(important ? 740 : 880, t);
    o.frequency.exponentialRampToValueAtTime(important ? 440 : 620, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + 0.18);
  } catch {
    /* autoplay gate */
  }
}

function soundFor(replies: Reply[], active: boolean, sound: boolean) {
  if (!sound || !replies.length) return;
  const important = replies.some((r) => r.tone === "trade" || r.tone === "alert");
  if (important) playTone(true);
  else if (!active && replies.some((r) => r.tone === "normal")) playTone(false);
}

const seeded = seedBots();

export const useDesk = create<DeskState>()(
  persist(
    (set, get) => ({
      bots: seeded,
      activeId: seeded[0]?.id ?? "",
      sound: true,
      infoOpen: false,
      query: "",
      setQuery: (query) => set({ query }),
      setActive: (id) =>
        set((s) => ({
          activeId: id,
          bots: s.bots.map((b) => (b.id === id ? { ...b, unread: 0 } : b)),
        })),
      toggleSound: () => set((s) => ({ sound: !s.sound })),
      toggleInfo: () => set((s) => ({ infoOpen: !s.infoOpen })),
      toggleOnline: (id) => {
        const bot = get().bots.find((b) => b.id === id);
        if (!bot) return;
        if (bot.name !== "ABinanceTradingBot (local)") {
          set((s) => ({ bots: s.bots.map((b) => b.id === id ? {
            ...b, online: false, lastSeen: Date.now(),
            messages: [...b.messages, { id: uid("m"), from: "service",
              text: "No real script is registered for this profile. Simulation is disabled.",
              ts: Date.now(), tone: "alert" }],
          } : b) }));
          return;
        }
        void fetch("http://127.0.0.1:47832/health", { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error("Bridge unavailable");
            const data = await response.json();
            set((s) => ({ bots: s.bots.map((b) => b.id === id ? {
              ...b, online: Boolean(data.connected), lastSeen: Date.now(),
              messages: [...b.messages, { id: uid("m"), from: "service",
                text: data.connected ? "Connected to the real local Binance script." : "Bridge is running but the script is not connected.",
                ts: Date.now(), tone: "service" }],
            } : b) }));
          })
          .catch(() => set((s) => ({ bots: s.bots.map((b) => b.id === id ? {
            ...b, online: false, lastSeen: Date.now(),
            messages: [...b.messages, { id: uid("m"), from: "service",
              text: "Local script bridge is unavailable. No simulated data is used.",
              ts: Date.now(), tone: "alert" }],
          } : b) })));
      },
      addBot: (name, exchange) => {
        const bot = createBot({ name, exchange, online: false });
        bot.lanes.USDT = { symbol: null, lastSymbol: null, allocated: 0, rescuePool: 0, position: null };
        bot.lanes.USDC = { symbol: null, lastSymbol: null, allocated: 0, rescuePool: 0, position: null };
        bot.isaac.orders = [];
        bot.isaac.virtualUsdt = 0;
        bot.isaac.allocated = 0;
        bot.wallet = {};
        bot.history = [];
        bot.prices = {};
        bot.anchors = {};
        bot.series = {};
        bot.messages = [{ id: uid("m"), from: "service",
          text: "No real local script is registered for this profile yet. Simulation is disabled.",
          ts: Date.now(), tone: "service" }];
        set((s) => ({ bots: [...s.bots, bot], activeId: bot.id }));
      },
      removeBot: (id) =>
        set((s) => {
          const bots = s.bots.filter((b) => b.id !== id);
          const activeId = s.activeId === id ? (bots[0]?.id ?? "") : s.activeId;
          return { bots, activeId };
        }),
      send: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const id = get().activeId;
        const bot = get().bots.find((b) => b.id === id);
        if (!bot) return;
        const jobId = uid("j");
        const mine: Message = {
          id: jobId,
          from: "me",
          text: trimmed,
          ts: Date.now(),
          pending: true,
        };
        set((s) => ({
          bots: s.bots.map((b) =>
            b.id === id
              ? { ...b, messages: [...b.messages, mine], inbox: [...b.inbox, { id: jobId, text: trimmed }], unread: 0 }
              : b,
          ),
        }));
        void get().drain(id);
      },
      tickAll: () => {
        // Live values must come from the real script bridge, never the demo simulator.
      },
      drain: async (id: string) => {
        if (draining.has(id)) return;
        draining.add(id);
        try {
          for (;;) {
            const bot = get().bots.find((b) => b.id === id);
            if (!bot || bot.inbox.length === 0) break;
            if (bot.name !== "ABinanceTradingBot (local)") {
              const job = bot.inbox[0];
              const now = Date.now();
              set((s) => ({ bots: s.bots.map((b) => b.id !== id ? b : {
                ...b,
                messages: [...b.messages.map((m) => m.id === job.id ? { ...m, pending: false } : m),
                  { id: uid("m"), from: "bot", text: "No real script is registered for this profile. No simulated command was executed.", ts: now, tone: "alert" }],
                inbox: b.inbox.filter((j) => j.id !== job.id), typing: false, online: false,
              }) }));
              continue;
            }
            const job = bot.inbox[0];
            set((s) => ({ bots: s.bots.map((b) => b.id === id ? { ...b, typing: true } : b) }));
            let replies: string[] = [];
            let connected = false;
            let blocked = false;
            let snapshotData: any = null;
            try {
              const response = await fetch("http://127.0.0.1:47832/command", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({ text: job.text }),
              });
              const data = await response.json().catch(() => ({}));
              connected = true;
              blocked = Boolean(data.blocked) || !response.ok;
              replies = Array.isArray(data.replies) ? data.replies.map((v: unknown) => String(v)) :
                [String(data.error || (response.ok ? "The real script returned no response." : "The real script rejected the command."))];
              try {
                const snapResponse = await fetch("http://127.0.0.1:47832/snapshot", { cache: "no-store" });
                if (snapResponse.ok) snapshotData = await snapResponse.json();
              } catch { /* command reply remains usable without a snapshot */ }
            } catch {
              replies = ["REAL SCRIPT NOT CONNECTED. Start your existing Binance bot with the Wire bridge installed. No simulated command was executed."];
            }
            const now = Date.now();
            const newMessages: Message[] = replies.map((reply) => ({
              id: uid("m"), from: "bot", text: reply, ts: now,
              tone: (blocked ? "alert" : "normal") as const, mono: reply.startsWith("Spot Wallet:") || reply.includes(" pair added"),
            }));
            const active = get().activeId === id;
            set((s) => ({
              bots: s.bots.map((b) => b.id !== id ? b : {
                ...b,
                online: connected,
                lastSeen: connected ? now : b.lastSeen,
                lanes: snapshotData ? {
                  USDT: { ...b.lanes.USDT, symbol: snapshotData.activePair || null, lastSymbol: snapshotData.activePair || null },
                  USDC: { ...b.lanes.USDC, symbol: snapshotData.activePairUSDC || null, lastSymbol: snapshotData.activePairUSDC || null },
                } : b.lanes,
                isaac: snapshotData?.isaacPair ? { ...b.isaac, symbol: snapshotData.isaacPair } : b.isaac,
                messages: [...b.messages.map((m) => m.id === job.id ? { ...m, pending: false } : m), ...newMessages],
                inbox: b.inbox.filter((j) => j.id !== job.id),
                typing: false,
                unread: active ? 0 : b.unread + newMessages.length,
              }),
            }));
            soundFor(replies.map((text) => ({ text, tone: (blocked ? "alert" : "normal") as const })), active, get().sound);
          }
        } finally {
          draining.delete(id);
          const bot = get().bots.find((b) => b.id === id);
          if (bot && bot.inbox.length) void get().drain(id);
        }
      },
    }),
    {
      name: "wire-desk-v2",
      partialize: (s) => ({
        bots: s.bots.map((b) => ({ ...b, typing: false, inbox: b.online ? [] : b.inbox })),
        activeId: s.activeId,
        sound: s.sound,
        infoOpen: s.infoOpen,
      }),
    },
  ),
);
