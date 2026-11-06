// "Microburbs Agent": a chat agent that answers only from cited Microburbs data
// and can re-run the alternatives search with the user's own criteria.
import { useEffect, useRef, useState } from "react";
import {
  type Alternative,
  askAgent,
  type ChatTurn,
  type Mode,
  type PropertyResponse,
} from "@/lib/api";
import { AltItem } from "./sections";
import { Card, Spinner } from "./ui";

interface Turn extends ChatTurn {
  alternatives?: Alternative[];
}

/** What the agent can do, shown as tappable examples so users discover the tools. */
const CAPABILITIES: Record<Mode, { label: string; ask: string }[]> = {
  sale: [
    { label: "Fair price?", ask: "Is this asking price fair?" },
    {
      label: "Cheaper options",
      ask: "Show cheaper options with the same features",
    },
    {
      label: "Compare",
      ask: "Compare this property with the best-value alternative",
    },
    {
      label: "Monthly cost",
      ask: "What would my monthly repayments be with a 20% deposit?",
    },
    {
      label: "Price trend",
      ask: "How have unit prices in this suburb changed over 10 years?",
    },
    {
      label: "Construction nearby",
      ask: "What development is planned in this suburb?",
    },
    {
      label: "Suburbs",
      ask: "Compare this suburb with Ultimo and Surry Hills for buying",
    },
    { label: "Agency", ask: "How does this agency usually quote?" },
    { label: "Street check", ask: "Is this street cheap or expensive compared with nearby streets?" },
    { label: "Price vs rent", ask: "What yield would this give if I rented it out?" },
    { label: "My block", ask: "Tell me about the block this property is in" },
  ],
  rent: [
    { label: "Fair rent?", ask: "Is this rent fair?" },
    { label: "Cheaper rentals", ask: "Find cheaper rentals like this one" },
    {
      label: "Compare",
      ask: "Compare this rental with the closest alternative",
    },
    {
      label: "Suburbs",
      ask: "Compare this suburb with Ultimo and Glebe for renting",
    },
    {
      label: "Construction nearby",
      ask: "What development is planned in this suburb?",
    },
    { label: "Getting around", ask: "How close is public transport?" },
    { label: "Risks", ask: "What risks or overlays affect this property?" },
    { label: "My block", ask: "Tell me about the block this property is in" },
  ],
};

function Capabilities({
  mode,
  onAsk,
}: {
  mode: Mode;
  onAsk: (q: string) => void;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1.5 text-xs text-slate-600">
        I read Microburbs data for this exact property and cite every number.
        Try one of these, or ask in your own words:
      </p>
      <div className="flex flex-wrap gap-1">
        {CAPABILITIES[mode].map((c) => (
          <button
            key={c.label}
            title={c.ask}
            onClick={() => onAsk(c.ask)}
            className="rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-800 hover:border-brand-500 hover:bg-brand-100"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Renders **bold**, "- " bullets and [citations] without injecting HTML. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|\[[^\]]+\])/g).map((part, j) =>
        part.startsWith("**") ? (
          <strong key={j}>{part.slice(2, -2)}</strong>
        ) : part.startsWith("[") && part.endsWith("]") ? (
          <span
            key={j}
            className="ml-0.5 whitespace-nowrap rounded bg-slate-100 px-1 text-[10px] text-slate-500"
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          <span key={j}>{part}</span>
        ),
      )}
    </>
  );
}

function Text({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]\s/.test(l));
  const prose = lines.filter((l) => !/^[-*•]\s/.test(l));
  return (
    <div className="space-y-1.5 leading-snug">
      {prose.map((l, i) => (
        <p key={i}>
          <Inline text={l} />
        </p>
      ))}
      {bullets.length ? (
        <ul className="list-disc space-y-1 pl-4">
          {bullets.map((l, i) => (
            <li key={i}>
              <Inline text={l.replace(/^[-*•]\s+/, "")} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Chat({ data, mode }: { data: PropertyResponse; mode: Mode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = `${data.match.gnafId}|${mode}`;
  const endRef = useRef<HTMLDivElement>(null);

  // Each property and mode keeps its own conversation for the browser session.
  const [showHelp, setShowHelp] = useState(false);
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    loadedKey.current = null;
    setError(null);
    void browser.storage.session
      .get(`chat:${key}`)
      .then((r) => {
        if (!live) return;
        setTurns((r[`chat:${key}`] as Turn[] | undefined) ?? []);
        loadedKey.current = key;
      })
      .catch(() => {
        setTurns([]);
        loadedKey.current = key;
      });
    return () => {
      live = false;
    };
  }, [key]);
  useEffect(() => {
    if (loadedKey.current === key)
      void browser.storage.session
        .set({ [`chat:${key}`]: turns.slice(-20) })
        .catch(() => {});
  }, [turns, key]);
  // Braces matter: scrollIntoView returns a Promise in recent Chrome, which React would treat as a cleanup.
  useEffect(() => {
    if (turns.length || busy)
      void endRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
  }, [turns, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const history = next
        .slice(-10)
        .map(({ role, content }) => ({ role, content }));
      const r = await askAgent(
        data.match.matchedAddress ?? data.match.input,
        mode,
        history,
        data.match.gnafId ?? undefined,
        data.facts?.listing.userPrice
          ? (data.facts.listing.value?.price ?? undefined)
          : undefined,
      );
      setTurns([
        ...next,
        {
          role: "assistant",
          content: r.answer ?? "No answer.",
          alternatives: r.alternatives?.items,
        },
      ]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The assistant is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    // Highlighted with a soft blue glow: the agent is the centre of the panel.
    <div className="agent-glow rounded-xl">
      <Card
        title="Microburbs Agent"
        right={
          turns.length ? (
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="text-[11px] font-medium text-brand-600 hover:underline"
            >
              {showHelp ? "Hide ideas" : "What can I ask?"}
            </button>
          ) : (
            <span className="text-[10.5px] text-slate-400">
              Ask about this property
            </span>
          )
        }
      >
        {turns.length === 0 || showHelp ? (
          <Capabilities
            mode={mode}
            onAsk={(q) => {
              setShowHelp(false);
              void send(q);
            }}
          />
        ) : null}
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === "user"
                  ? "ml-8 rounded-lg bg-brand-600 px-2 py-1.5 text-sm text-white"
                  : "mr-2 space-y-2 text-sm text-slate-800"
              }
            >
              {t.role === "user" ? t.content : <Text text={t.content} />}
              {t.alternatives?.length ? (
                <ul className="space-y-2">
                  {t.alternatives.map((a) => (
                    <AltItem
                      key={a.gnafId}
                      a={a}
                      mode={mode}
                      onOpen={() =>
                        window.open(a.links.domainProfile, "_blank")
                      }
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          {busy ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Spinner /> Checking the data...
            </div>
          ) : null}
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          <div ref={endRef} />
        </div>
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder={
              mode === "sale"
                ? "e.g. same but with parking under $900k"
                : "e.g. 2 bed under $800/wk near a station"
            }
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
          />
          <button
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Ask
          </button>
        </form>
        <p className="mt-1 text-[10.5px] text-slate-400">
          Answers use only cited Microburbs data. Information, not financial
          advice.
        </p>
      </Card>
    </div>
  );
}
