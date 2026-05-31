import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  Wifi, WifiOff, Zap, Trophy, Radio, Activity,
  Shield, Power, AlertTriangle, CheckCircle, Circle
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────
const REPS   = ["R1", "R2", "R3", "R4"];
const COLORS = ["#00d4ff", "#00ff88", "#ff9f0a", "#ff453a"];
const BG     = ["rgba(0,212,255,0.07)","rgba(0,255,136,0.07)","rgba(255,159,10,0.07)","rgba(255,69,58,0.07)"];
const BORDER = ["rgba(0,212,255,0.28)","rgba(0,255,136,0.28)","rgba(255,159,10,0.28)","rgba(255,69,58,0.28)"];
const LOG_CLR = { info:"#4a6080", success:"#00ff88", error:"#ff453a", warn:"#ff9f0a", vote:"#00d4ff" };

// ── Parse Serial String ───────────────────────────────────────
function parseSerial(raw) {
  const line = raw.trim();
  if (!line.startsWith("DATA|")) return null;
  try {
    const [, votePart, statusPart] = line.split("|");
    if (!votePart || !statusPart) return null;
    const vMap = {};
    votePart.split(",").forEach(s => {
      const [k, v] = s.split(":");
      if (k && v !== undefined) vMap[k.trim()] = parseInt(v) || 0;
    });
    return {
      votes: [vMap.R1 ?? 0, vMap.R2 ?? 0, vMap.R3 ?? 0, vMap.R4 ?? 0],
      status: statusPart.replace("STATUS:", "").trim()
    };
  } catch { return null; }
}

// ── Derive result state from votes ────────────────────────────
// Returns: { type, winners, runnerUps, maxVotes, secondVotes }
// type: "no_votes" | "tie_first" | "winner" 
// runnerUpType: "none" | "tie_runnerup" | "single"
function deriveResult(votes) {
  const total = votes.reduce((a, b) => a + b, 0);
  if (total === 0) return { type: "no_votes" };

  const maxVotes = Math.max(...votes);
  const winners  = votes.map((v, i) => ({ i, v })).filter(x => x.v === maxVotes);

  if (winners.length >= 2) {
    return { type: "tie_first", winners, maxVotes };
  }

  // Single winner — check runner-up
  const winIdx      = winners[0].i;
  const others      = votes.map((v, i) => ({ i, v })).filter(x => x.i !== winIdx);
  const secondVotes = Math.max(...others.map(x => x.v));

  if (secondVotes === 0) {
    return { type: "winner", winners, maxVotes, runnerUpType: "none", runnerUps: [], secondVotes: 0 };
  }

  const runnerUps = others.filter(x => x.v === secondVotes);
  const runnerUpType = runnerUps.length >= 2 ? "tie_runnerup" : "single";

  return { type: "winner", winners, maxVotes, runnerUpType, runnerUps, secondVotes };
}

// ── Inject fonts & keyframes once ─────────────────────────────
const _style = document.createElement("style");
_style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Oxanium:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #060a12 !important; }
  .mono   { font-family: 'Share Tech Mono', monospace !important; }
  .oxa    { font-family: 'Oxanium', sans-serif !important; }
  .bar-tx { transition: width 0.9s cubic-bezier(0.4,0,0.2,1); }
  .card-in{ animation: cardIn 0.35s ease both; }
  .row-in { animation: rowIn 0.3s ease both; }
  @keyframes cardIn  { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes rowIn   { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:translateX(0)} }
  @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0.2} }
  @keyframes scanpulse { 0%,100%{opacity:0} 50%{opacity:0.06} }
  @keyframes leadshine { 0%,100%{box-shadow:0 0 0 0 rgba(255,215,0,0)} 50%{box-shadow:0 0 24px 4px rgba(255,215,0,0.25)} }
  @keyframes tiepulse  { 0%,100%{box-shadow:0 0 0 0 rgba(255,159,10,0)} 50%{box-shadow:0 0 24px 4px rgba(255,159,10,0.3)} }
  .blink  { animation: blink 1.4s ease-in-out infinite; }
  .leader { animation: leadshine 2.5s ease-in-out infinite; }
  .tiepulse { animation: tiepulse 2.5s ease-in-out infinite; }
  ::-webkit-scrollbar { width:4px; }
  ::-webkit-scrollbar-thumb { background:#1a2d48; border-radius:2px; }
  ::-webkit-scrollbar-track { background:transparent; }
`;
document.head.appendChild(_style);

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// ═════════════════════════════════════════════════════════════
//  MAIN APP
// ═════════════════════════════════════════════════════════════
export default function App() {
  const [votes,     setVotes]     = useState([0, 0, 0, 0]);
  const [status,    setStatus]    = useState("Ready");
  const [connected, setConnected] = useState(false);
  const [mockMode,  setMockMode]  = useState(false);
  const [log,       setLog]       = useState([
    { time: ts(), msg: "Election Command Center initialized", type: "info" }
  ]);
  const [dot, setDot] = useState(false);

  const portRef   = useRef(null);
  const readerRef = useRef(null);
  const mockRef   = useRef(null);
  const mockVotes = useRef([0, 0, 0, 0]);

  const addLog = useCallback((msg, type = "info") => {
    setLog(p => [{ time: ts(), msg, type }, ...p].slice(0, 18));
    setDot(true);
    setTimeout(() => setDot(false), 600);
  }, []);

  const applyParsed = useCallback(({ votes: v, status: s }) => {
    setVotes(v);
    setStatus(s);
  }, []);

  // ── Mock / Demo Mode ────────────────────────────────────────
  useEffect(() => {
    clearInterval(mockRef.current);
    if (!mockMode) return;
    mockVotes.current = [0, 0, 0, 0];
    setVotes([0, 0, 0, 0]);
    setStatus("Voting");
    addLog("Demo simulation started — vote every 3 s", "success");

    mockRef.current = setInterval(() => {
      const r = Math.floor(Math.random() * 4);
      mockVotes.current = mockVotes.current.map((v, i) => i === r ? v + 1 : v);
      const snap = [...mockVotes.current];
      setVotes(snap);
      const tot = snap.reduce((a, b) => a + b, 0);
      addLog(`Demo vote → ${REPS[r]}   (total: ${tot})`, "vote");
    }, 3000);

    return () => clearInterval(mockRef.current);
  }, [mockMode]);

  // ── Web Serial API ──────────────────────────────────────────
  async function connectSerial() {
    if (!("serial" in navigator)) {
      addLog("Web Serial not supported — use Chrome/Edge", "error");
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      portRef.current = port;
      setConnected(true);
      addLog("Arduino connected @ 9600 baud", "success");

      const dec = new TextDecoderStream();
      port.readable.pipeTo(dec.writable).catch(() => {});
      const reader = dec.readable.getReader();
      readerRef.current = reader;

      let buf = "";
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            const lines = buf.split("\n");
            buf = lines.pop();
            lines.forEach(line => {
              const parsed = parseSerial(line);
              if (parsed) {
                applyParsed(parsed);
                addLog(`← ${line.trim()}`, "vote");
              }
            });
          }
        } catch { /* port closed */ }
        setConnected(false);
        addLog("Arduino disconnected", "warn");
      })();
    } catch (e) {
      addLog(`Connection failed: ${e.message}`, "error");
    }
  }

  async function disconnectSerial() {
    try { await readerRef.current?.cancel(); } catch {}
    try { await portRef.current?.close();    } catch {}
    setConnected(false);
    addLog("Arduino disconnected by user", "warn");
  }

  // ── Derived State ───────────────────────────────────────────
  const total    = votes.reduce((a, b) => a + b, 0);
  const maxV     = Math.max(...votes);
  const isClosed = status === "Closed";
  const result   = isClosed ? deriveResult(votes) : null;

  // For live "leading" display (during voting)
  const leadIdx  = total > 0 ? votes.indexOf(maxV) : -1;

  const chartData = REPS.map((name, i) => ({
    name,
    votes: votes[i],
    pct: total > 0 ? Math.round((votes[i] / total) * 100) : 0
  }));

  // Which indices are currently "top" (for card highlight)
  const topVoteIndices = total > 0
    ? votes.map((v, i) => v === maxV ? i : -1).filter(x => x >= 0)
    : [];

  // ── Custom Tooltip ──────────────────────────────────────────
  function ChartTip({ active, payload }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="mono" style={{ background:"#0b111d", border:"1px solid #1a2d48",
        borderRadius:8, padding:"10px 14px", fontSize:12, color:"#d0e4f0" }}>
        <div style={{ color: COLORS[REPS.indexOf(d.name)], fontWeight:700, marginBottom:4 }}>{d.name}</div>
        <div>{d.votes} votes  ·  {d.pct}%</div>
      </div>
    );
  }

  // ── Result Banner renderer ──────────────────────────────────
  function ResultBanner() {
    if (!isClosed || !result) return null;

    // EDGE: No votes
    if (result.type === "no_votes") {
      return (
        <div className="card-in" style={{ marginTop:18, borderRadius:16,
          background:"rgba(255,69,58,0.08)", border:"1px solid rgba(255,69,58,0.35)",
          padding:"28px 32px", display:"flex", alignItems:"center", gap:20 }}>
          <AlertTriangle size={40} color="#ff453a" style={{ flexShrink:0 }}/>
          <div>
            <div className="mono" style={{ fontSize:11, color:"#ff453a", letterSpacing:4, marginBottom:6 }}>
              ELECTION RESULT — FINAL
            </div>
            <div style={{ fontSize:30, fontWeight:800, color:"#fff" }}>No Votes Were Cast</div>
            <div className="mono" style={{ fontSize:13, color:"#ff453a", marginTop:8 }}>
              Press RESET on the Arduino to start a new session.
            </div>
          </div>
        </div>
      );
    }

    // EDGE: Tie for 1st
    if (result.type === "tie_first") {
      return (
        <div className="card-in tiepulse" style={{ marginTop:18, borderRadius:16, overflow:"hidden",
          background:"linear-gradient(135deg, rgba(255,159,10,0.14), rgba(255,69,58,0.06))",
          border:"1px solid rgba(255,159,10,0.45)", padding:"28px 32px",
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <div style={{ position:"relative" }}>
              <Trophy size={48} color="#ff9f0a" style={{ filter:"drop-shadow(0 0 16px #ff9f0a)" }}/>
              <Trophy size={28} color="#ff453a" style={{ position:"absolute", bottom:-4, right:-12,
                filter:"drop-shadow(0 0 8px #ff453a)" }}/>
            </div>
            <div>
              <div className="mono" style={{ fontSize:11, color:"#ff9f0a", letterSpacing:4, marginBottom:6 }}>
                ELECTION RESULT — TIE
              </div>
              <div style={{ fontSize:34, fontWeight:800, color:"#fff", lineHeight:1 }}>
                {result.winners.map(w => REPS[w.i]).join("  &  ")}
              </div>
              <div style={{ fontSize:16, color:"#ff9f0a", fontWeight:600, marginTop:6 }}>
                Tied with {result.maxVotes} vote{result.maxVotes !== 1 ? "s" : ""} each
              </div>
              <div className="mono" style={{ fontSize:12, color:"#ff453a", marginTop:8 }}>
                ⚠ No clear winner — tiebreaker required
              </div>
            </div>
          </div>
          {/* Full tally */}
          <div style={{ textAlign:"right" }}>
            <div className="mono" style={{ fontSize:11, color:"#2a4a6a", marginBottom:12, letterSpacing:2 }}>FULL TALLY</div>
            {[...REPS.map((r,i) => ({ r, v:votes[i], i }))]
              .sort((a,b) => b.v - a.v)
              .map(({ r, v, i }, rank) => (
                <div key={r} style={{ display:"flex", alignItems:"center", gap:14,
                  justifyContent:"flex-end", marginBottom:6 }}>
                  <span className="mono" style={{ fontSize:11, color:"#1a2d48" }}>#{rank+1}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:COLORS[i],
                    fontFamily:"'Oxanium',sans-serif" }}>{r}</span>
                  <span className="mono" style={{ fontSize:13,
                    color: v === result.maxVotes ? "#ff9f0a" : "#2a4a6a",
                    minWidth:60, textAlign:"right" }}>{v} votes</span>
                </div>
              ))}
          </div>
        </div>
      );
    }

    // Normal winner (with runner-up variants)
    const winIdx   = result.winners[0].i;
    const winVotes = result.maxVotes;

    return (
      <div>
        {/* Winner card */}
        <div className="card-in leader" style={{ marginTop:18, borderRadius:16, overflow:"hidden",
          background:`linear-gradient(135deg, rgba(255,215,0,0.12), ${BG[winIdx]})`,
          border:"1px solid rgba(255,215,0,0.4)", padding:"28px 32px",
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:20 }}>
            <Trophy size={48} color="#ffd700" style={{ filter:"drop-shadow(0 0 16px #ffd700)" }}/>
            <div>
              <div className="mono" style={{ fontSize:11, color:"#ffd700", letterSpacing:4, marginBottom:6 }}>
                ELECTION RESULT — FINAL
              </div>
              <div style={{ fontSize:40, fontWeight:800, color:"#fff", lineHeight:1 }}>
                {REPS[winIdx]}{" "}
                <span style={{ fontSize:18, color:"#ffd700", fontWeight:600 }}>WINS THE ELECTION</span>
              </div>
              <div className="mono" style={{ fontSize:13, color:"#ffd700", marginTop:8 }}>
                {winVotes} votes · {Math.round(winVotes/total*100)}% of total votes cast
              </div>
            </div>
          </div>
          {/* Full tally */}
          <div style={{ textAlign:"right" }}>
            <div className="mono" style={{ fontSize:11, color:"#2a4a6a", marginBottom:12, letterSpacing:2 }}>FULL TALLY</div>
            {[...REPS.map((r,i) => ({ r, v:votes[i], i }))]
              .sort((a,b) => b.v - a.v)
              .map(({ r, v, i }, rank) => (
                <div key={r} style={{ display:"flex", alignItems:"center", gap:14,
                  justifyContent:"flex-end", marginBottom:6 }}>
                  <span className="mono" style={{ fontSize:11, color:"#1a2d48" }}>#{rank+1}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:COLORS[i],
                    fontFamily:"'Oxanium',sans-serif" }}>{r}</span>
                  <span className="mono" style={{ fontSize:13,
                    color: rank===0 ? "#ffd700" : "#2a4a6a",
                    minWidth:60, textAlign:"right" }}>{v} votes</span>
                </div>
              ))}
          </div>
        </div>

        {/* Runner-up strip */}
        {result.runnerUpType === "none" && (
          <div className="card-in" style={{ marginTop:10, borderRadius:12,
            background:"rgba(255,69,58,0.06)", border:"1px solid rgba(255,69,58,0.2)",
            padding:"14px 24px", display:"flex", alignItems:"center", gap:12 }}>
            <AlertTriangle size={16} color="#ff453a"/>
            <span className="mono" style={{ fontSize:12, color:"#ff453a", letterSpacing:1 }}>
              NO RUNNER-UP — All other representatives received 0 votes
            </span>
          </div>
        )}

        {result.runnerUpType === "tie_runnerup" && (
          <div className="card-in" style={{ marginTop:10, borderRadius:12,
            background:"rgba(255,159,10,0.07)", border:"1px solid rgba(255,159,10,0.28)",
            padding:"14px 24px", display:"flex", alignItems:"center", gap:12 }}>
            <Trophy size={16} color="#ff9f0a"/>
            <span className="mono" style={{ fontSize:12, color:"#ff9f0a", letterSpacing:1 }}>
              RUNNER-UP TIE —{" "}
              {result.runnerUps.map(r => REPS[r.i]).join(" & ")}{" "}
              with {result.secondVotes} vote{result.secondVotes !== 1 ? "s" : ""} each
            </span>
          </div>
        )}

        {result.runnerUpType === "single" && (
          <div className="card-in" style={{ marginTop:10, borderRadius:12,
            background:"rgba(255,255,255,0.03)", border:"1px solid #0f1e30",
            padding:"14px 24px", display:"flex", alignItems:"center", gap:12 }}>
            <CheckCircle size={16} color="#2a4a6a"/>
            <span className="mono" style={{ fontSize:12, color:"#2a4a6a", letterSpacing:1 }}>
              RUNNER-UP —{" "}
              <span style={{ color: COLORS[result.runnerUps[0].i] }}>
                {REPS[result.runnerUps[0].i]}
              </span>
              {" "}with {result.secondVotes} vote{result.secondVotes !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <div className="oxa" style={{ background:"#060a12", minHeight:"100vh", color:"#d0e4f0" }}>

      {/* Scanline overlay */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:200,
        background:"repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)" }} />

      {/* ── HEADER ── */}
      <header style={{ background:"rgba(8,12,20,0.95)", borderBottom:"1px solid #0f1e30",
        padding:"0 28px", height:62, display:"flex", alignItems:"center",
        justifyContent:"space-between", position:"sticky", top:0, zIndex:100, backdropFilter:"blur(10px)" }}>

        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ position:"relative", width:10, height:10 }}>
            <div style={{ width:10, height:10, borderRadius:"50%",
              background: isClosed ? "#ff453a" : status==="Voting" ? "#00ff88" : "#4a6080",
              boxShadow: isClosed ? "0 0 10px #ff453a" : status==="Voting" ? "0 0 10px #00ff88" : "none" }}
              className={status==="Voting" ? "blink" : undefined} />
          </div>
          <div>
            <div className="oxa" style={{ fontSize:18, fontWeight:800, color:"#e8f4ff",
              letterSpacing:2, lineHeight:1 }}>ELECTION COMMAND CENTER</div>
            <div className="mono" style={{ fontSize:10, color:"#2a4a6a", letterSpacing:3, marginTop:2 }}>
              IoT DIGITAL VOTING SYSTEM v2.0
            </div>
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {/* Demo Toggle */}
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 16px", borderRadius:10,
            background: mockMode ? "rgba(255,159,10,0.1)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${mockMode ? "rgba(255,159,10,0.35)" : "#0f1e30"}` }}>
            <Zap size={13} color={mockMode ? "#ff9f0a" : "#2a4a6a"} />
            <span className="mono" style={{ fontSize:11, color: mockMode ? "#ff9f0a" : "#2a4a6a", letterSpacing:1 }}>DEMO</span>
            <div onClick={() => setMockMode(p => !p)} style={{
              width:38, height:20, borderRadius:10, cursor:"pointer", position:"relative",
              background: mockMode ? "#ff9f0a" : "#0f1e30",
              transition:"background 0.25s", border:`1px solid ${mockMode?"#ff9f0a":"#1a2d48"}` }}>
              <div style={{ position:"absolute", top:2, left: mockMode ? 19 : 2,
                width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.25s" }} />
            </div>
          </div>

          {/* Serial Connect */}
          <button onClick={connected ? disconnectSerial : connectSerial} style={{
            display:"flex", alignItems:"center", gap:8, padding:"8px 20px", borderRadius:10,
            background: connected ? "rgba(0,255,136,0.09)" : "rgba(0,212,255,0.09)",
            border: `1px solid ${connected ? "rgba(0,255,136,0.35)" : "rgba(0,212,255,0.35)"}`,
            color: connected ? "#00ff88" : "#00d4ff", fontSize:13, fontWeight:700,
            fontFamily:"inherit", cursor:"pointer", letterSpacing:1, transition:"all 0.2s" }}>
            {connected ? <Wifi size={14}/> : <WifiOff size={14}/>}
            {connected ? "CONNECTED" : "CONNECT ARDUINO"}
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{ padding:"24px 28px", maxWidth:1240, margin:"0 auto" }}>

        {/* Status Strip */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:22, flexWrap:"wrap" }}>

          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 18px", borderRadius:20,
            background: isClosed ? "rgba(255,69,58,0.09)" : "rgba(0,255,136,0.07)",
            border: `1px solid ${isClosed ? "rgba(255,69,58,0.3)" : "rgba(0,255,136,0.22)"}` }}>
            <Shield size={13} color={isClosed ? "#ff453a" : "#00ff88"} />
            <span className="mono" style={{ fontSize:12, letterSpacing:2,
              color: isClosed ? "#ff453a" : status==="Voting" ? "#00ff88" : "#4a8080" }}>
              {isClosed ? "VOTING CLOSED" : status==="Voting" ? "● VOTING IN PROGRESS" : "SYSTEM READY"}
            </span>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 18px", borderRadius:20,
            background:"rgba(0,212,255,0.06)", border:"1px solid rgba(0,212,255,0.18)" }}>
            <Activity size={13} color="#00d4ff" />
            <span className="mono" style={{ fontSize:12, color:"#00d4ff", letterSpacing:1 }}>
              TOTAL VOTES: <strong>{total}</strong>
            </span>
          </div>

          {/* Live leading strip — only show during voting, not when closed */}
          {!isClosed && leadIdx >= 0 && total > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 18px", borderRadius:20,
              background:"rgba(255,215,0,0.07)", border:"1px solid rgba(255,215,0,0.28)" }}>
              <Trophy size={13} color="#ffd700" />
              <span className="mono" style={{ fontSize:12, color:"#ffd700", letterSpacing:1 }}>
                LEADING: R{leadIdx+1} &nbsp;·&nbsp; {maxV} votes &nbsp;·&nbsp; {Math.round(maxV/total*100)}%
              </span>
            </div>
          )}

          {!("serial" in navigator) && (
            <div style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 18px", borderRadius:20,
              background:"rgba(255,69,58,0.07)", border:"1px solid rgba(255,69,58,0.25)" }}>
              <AlertTriangle size={13} color="#ff453a" />
              <span className="mono" style={{ fontSize:11, color:"#ff453a" }}>Use Chrome/Edge for Web Serial</span>
            </div>
          )}
        </div>

        {/* ── CANDIDATE CARDS ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:18 }}>
          {REPS.map((rep, i) => {
            const pct   = total > 0 ? Math.round(votes[i] / total * 100) : 0;
            const isTop = topVoteIndices.includes(i) && total > 0;
            const isTied = isTop && topVoteIndices.length >= 2;
            return (
              <div key={rep} className={`card-in ${isTop && !isTied ? "leader" : ""} ${isTied ? "tiepulse" : ""}`}
                style={{ animationDelay: `${i * 60}ms`,
                  background: isTop
                    ? isTied
                      ? `linear-gradient(150deg, rgba(255,159,10,0.13), ${BG[i]})`
                      : `linear-gradient(150deg, rgba(255,215,0,0.11), ${BG[i]})`
                    : BG[i],
                  border: `1px solid ${isTop ? (isTied ? "rgba(255,159,10,0.5)" : "rgba(255,215,0,0.45)") : BORDER[i]}`,
                  borderRadius:16, padding:"22px 20px", position:"relative",
                  overflow:"hidden", transition:"border-color 0.5s, background 0.5s" }}>

                {isTop && (
                  <div style={{ position:"absolute", top:0, left:0, right:0, height:2,
                    background:`linear-gradient(90deg, transparent 0%, ${isTied ? "#ff9f0a" : "#ffd700"} 50%, transparent 100%)` }} />
                )}

                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
                  <div>
                    <div className="mono" style={{ fontSize:10, color:COLORS[i], letterSpacing:3, marginBottom:4 }}>CANDIDATE</div>
                    <div style={{ fontSize:42, fontWeight:800, color:"#e8f4ff", lineHeight:1, letterSpacing:2 }}>{rep}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {isTop ? (
                      <div style={{ display:"flex", alignItems:"center", gap:4, justifyContent:"flex-end",
                        background: isTied ? "rgba(255,159,10,0.14)" : "rgba(255,215,0,0.14)",
                        border: `1px solid ${isTied ? "rgba(255,159,10,0.4)" : "rgba(255,215,0,0.4)"}`,
                        borderRadius:16, padding:"3px 10px", marginBottom:6 }}>
                        <Trophy size={11} color={isTied ? "#ff9f0a" : "#ffd700"}/>
                        <span className="mono" style={{ fontSize:10,
                          color: isTied ? "#ff9f0a" : "#ffd700", letterSpacing:1 }}>
                          {isTied ? "TIE" : "WINNER"}
                        </span>
                      </div>
                    ) : (
                      <div style={{ height:26, marginBottom:6 }} />
                    )}
                    <div style={{ fontSize:44, fontWeight:800, color:COLORS[i], lineHeight:1 }}>{votes[i]}</div>
                    <div className="mono" style={{ fontSize:10, color:"#2a4a6a", letterSpacing:1, marginTop:2 }}>VOTES</div>
                  </div>
                </div>

                <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:6, height:7, overflow:"hidden", marginBottom:10 }}>
                  <div className="bar-tx" style={{
                    height:"100%", width:`${pct}%`, borderRadius:6,
                    background: isTop
                      ? `linear-gradient(90deg, ${COLORS[i]}, ${isTied ? "#ff9f0a" : "#ffd700"})`
                      : COLORS[i],
                    boxShadow: isTop ? `0 0 10px ${COLORS[i]}80` : "none"
                  }} />
                </div>

                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                  <span style={{ fontSize:26, fontWeight:700, color:COLORS[i], fontFamily:"'Oxanium',sans-serif" }}>
                    {pct}<span style={{ fontSize:14 }}>%</span>
                  </span>
                  <span className="mono" style={{ fontSize:10, color:"#2a4a6a" }}>of {total} total</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── CHART + LOG ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 360px", gap:14 }}>

          {/* Bar Chart */}
          <div style={{ background:"#080c14", border:"1px solid #0f1e30", borderRadius:16, padding:"22px 24px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}>
              <Radio size={14} color="#00d4ff"/>
              <span className="mono" style={{ fontSize:11, color:"#00d4ff", letterSpacing:3 }}>VOTE DISTRIBUTION</span>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={chartData} barSize={52} margin={{ top:4, right:8, left:-16, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/>
                <XAxis dataKey="name" tick={{ fill:"#2a4a6a", fontFamily:"Share Tech Mono", fontSize:12 }}
                  axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"#2a4a6a", fontFamily:"Share Tech Mono", fontSize:11 }}
                  axisLine={false} tickLine={false}/>
                <Tooltip content={<ChartTip/>} cursor={{ fill:"rgba(0,212,255,0.04)" }}/>
                <Bar dataKey="votes" radius={[6,6,0,0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={COLORS[i]}
                      opacity={topVoteIndices.includes(i) && total > 0 ? 1 : 0.65}
                      style={{ filter: topVoteIndices.includes(i)&&total>0 ? `drop-shadow(0 0 6px ${COLORS[i]}80)` : "none" }}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display:"flex", justifyContent:"center", gap:20, marginTop:12 }}>
              {REPS.map((r, i) => (
                <div key={r} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:10, height:10, borderRadius:3, background:COLORS[i] }}/>
                  <span className="mono" style={{ fontSize:11, color:"#2a4a6a" }}>{r}  {chartData[i].pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Log */}
          <div style={{ background:"#080c14", border:"1px solid #0f1e30", borderRadius:16,
            padding:"22px 20px", display:"flex", flexDirection:"column", maxHeight:370, overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
              <Activity size={14} color="#00d4ff"/>
              <span className="mono" style={{ fontSize:11, color:"#00d4ff", letterSpacing:3 }}>ACTIVITY LOG</span>
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:5 }}>
                <div style={{ width:7, height:7, borderRadius:"50%",
                  background: dot ? "#00ff88" : "#1a2d48",
                  boxShadow: dot ? "0 0 6px #00ff88" : "none", transition:"all 0.3s" }}/>
                <span className="mono" style={{ fontSize:10, color:"#1a2d48" }}>LIVE</span>
              </div>
            </div>
            <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:5 }}>
              {log.map((e, i) => (
                <div key={i} className={i === 0 ? "row-in" : undefined}
                  style={{ display:"flex", gap:8, padding:"6px 10px", borderRadius:6,
                    background: i === 0 ? "rgba(0,212,255,0.04)" : "transparent",
                    borderLeft:`2px solid ${LOG_CLR[e.type] || "#1a2d48"}40` }}>
                  <span className="mono" style={{ fontSize:10, color:"#1a2d48", flexShrink:0, marginTop:1 }}>{e.time}</span>
                  <span className="mono" style={{ fontSize:11, color: i===0 ? (LOG_CLR[e.type]||"#4a6080") : "#1e3a58",
                    lineHeight:1.5, wordBreak:"break-all" }}>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RESULT BANNER ── */}
        <ResultBanner />

        {/* Footer */}
        <div style={{ marginTop:20, textAlign:"center" }}>
          <span className="mono" style={{ fontSize:10, color:"#0f1e30", letterSpacing:2 }}>
            ELECTION COMMAND CENTER · WEB SERIAL API · RECHARTS · REACT
          </span>
        </div>
      </div>
    </div>
  );
}
