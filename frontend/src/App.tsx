import { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { CONTRACTS, POLKA_STREAM_ABI, STREAM_TOKEN_ABI } from "./config";

type StreamData = {
  id: bigint;
  sender: string;
  recipient: string;
  token: string;
  depositAmount: bigint;
  withdrawnAmount: bigint;
  startTime: number;
  endTime: number;
  cliffTime: number;
  status: number;
  streamType: number;
};

function parseStreamResult(id: bigint, raw: any): StreamData {
  // Handle both named and positional tuple returns
  return {
    id,
    sender: raw.sender ?? raw[0] ?? "",
    recipient: raw.recipient ?? raw[1] ?? "",
    token: raw.token ?? raw[2] ?? "",
    depositAmount: BigInt(raw.depositAmount ?? raw[3] ?? 0),
    withdrawnAmount: BigInt(raw.withdrawnAmount ?? raw[4] ?? 0),
    startTime: Number(raw.startTime ?? raw[5] ?? 0),
    endTime: Number(raw.endTime ?? raw[6] ?? 0),
    cliffTime: Number(raw.cliffTime ?? raw[7] ?? 0),
    status: Number(raw.status ?? raw[9] ?? 0),
    streamType: Number(raw.streamType ?? raw[10] ?? 0),
  };
}

// Animated counter component - ticks every frame
function LiveCounter({ stream, decimals = 6 }: { stream: StreamData; decimals?: number }) {
  const [display, setDisplay] = useState("0.000000");

  useEffect(() => {
    if (stream.status !== 0) {
      setDisplay(Number(formatUnits(stream.depositAmount, decimals)).toFixed(decimals));
      return;
    }

    let raf: number;
    function tick() {
      const now = Date.now() / 1000;
      const start = stream.startTime;
      const end = stream.endTime;
      const deposit = Number(formatUnits(stream.depositAmount, decimals));

      if (stream.streamType === 1 && now < stream.cliffTime) {
        setDisplay("0.000000");
      } else if (now <= start) {
        setDisplay("0.000000");
      } else if (now >= end) {
        setDisplay(deposit.toFixed(decimals));
      } else {
        const elapsed = now - start;
        const duration = end - start;
        const streamed = (deposit * elapsed) / duration;
        setDisplay(streamed.toFixed(decimals));
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, [stream, decimals]);

  return <span className="live-counter">{display}</span>;
}

// Animated progress bar
function StreamProgress({ stream }: { stream: StreamData }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (stream.status !== 0) {
      setPct(stream.status === 3 ? 100 : pct);
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now() / 1000;
      const start = stream.startTime;
      const end = stream.endTime;
      if (now <= start) setPct(0);
      else if (now >= end) setPct(100);
      else setPct(((now - start) / (end - start)) * 100);
    }, 100);
    return () => clearInterval(interval);
  }, [stream]);

  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%` }}>
        {stream.status === 0 && pct > 0 && pct < 100 && <div className="progress-glow" />}
      </div>
    </div>
  );
}

function App() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [tab, setTab] = useState<"send" | "receive">("send");
  const [streams, setStreams] = useState<StreamData[]>([]);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // Form
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("300");
  const [streamTypeForm, setStreamTypeForm] = useState<"linear" | "cliff">("linear");
  const [cliffMinutes, setCliffMinutes] = useState("1");

  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadStreams = useCallback(async () => {
    if (!publicClient || !address) return;
    try {
      const [sentIds, receivedIds] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.polkaStream,
          abi: POLKA_STREAM_ABI,
          functionName: "getSenderStreams",
          args: [address],
        }) as Promise<bigint[]>,
        publicClient.readContract({
          address: CONTRACTS.polkaStream,
          abi: POLKA_STREAM_ABI,
          functionName: "getRecipientStreams",
          args: [address],
        }) as Promise<bigint[]>,
      ]);

      const ids = tab === "send" ? sentIds : receivedIds;
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const raw = await publicClient.readContract({
              address: CONTRACTS.polkaStream,
              abi: POLKA_STREAM_ABI,
              functionName: "getStream",
              args: [id],
            });
            return parseStreamResult(id, raw);
          } catch {
            return null;
          }
        })
      );
      setStreams(results.filter(Boolean).reverse() as StreamData[]);
    } catch (e) {
      console.error("Load streams error:", e);
    }
  }, [publicClient, address, tab]);

  const loadBalance = useCallback(async () => {
    if (!publicClient || !address) return;
    try {
      const bal = (await publicClient.readContract({
        address: CONTRACTS.streamToken,
        abi: STREAM_TOKEN_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      setTokenBalance(bal);
    } catch {}
  }, [publicClient, address]);

  useEffect(() => { loadStreams(); loadBalance(); }, [loadStreams, loadBalance]);
  useEffect(() => {
    const i = setInterval(() => { loadStreams(); loadBalance(); }, 15000);
    return () => clearInterval(i);
  }, [loadStreams, loadBalance]);

  async function handleMint() {
    if (!walletClient || !address || !publicClient) return;
    setLoading(true);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.streamToken,
        abi: STREAM_TOKEN_ABI,
        functionName: "mint",
        args: [address, parseUnits("10000", 6)],
        gas: 500_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Minted 10,000 psUSD!", "success");
      loadBalance();
    } catch (e: any) {
      showToast(e.message?.slice(0, 80) || "Mint failed", "error");
    }
    setLoading(false);
  }

  async function handleCreateStream() {
    if (!walletClient || !address || !publicClient) return;
    if (!recipient || !amount || !duration) return showToast("Fill all fields", "error");
    setLoading(true);
    try {
      const depositAmount = parseUnits(amount, 6);
      const nowTs = Math.floor(Date.now() / 1000);
      const startTime = BigInt(nowTs + 15);
      const endTime = BigInt(nowTs + 15 + parseInt(duration));

      const allowance = (await publicClient.readContract({
        address: CONTRACTS.streamToken,
        abi: STREAM_TOKEN_ABI,
        functionName: "allowance",
        args: [address, CONTRACTS.polkaStream],
      })) as bigint;

      if (allowance < depositAmount) {
        showToast("Approving tokens...", "success");
        const approveTx = await walletClient.writeContract({
          address: CONTRACTS.streamToken,
          abi: STREAM_TOKEN_ABI,
          functionName: "approve",
          args: [CONTRACTS.polkaStream, depositAmount * 10n],
          gas: 500_000n,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 120_000 });
      }

      showToast("Creating stream...", "success");
      let tx: `0x${string}`;

      if (streamTypeForm === "cliff") {
        const cliffTime = BigInt(nowTs + 15 + parseInt(cliffMinutes) * 60);
        tx = await walletClient.writeContract({
          address: CONTRACTS.polkaStream,
          abi: POLKA_STREAM_ABI,
          functionName: "createCliffStream",
          args: [recipient as `0x${string}`, CONTRACTS.streamToken, depositAmount, startTime, endTime, cliffTime],
          gas: 2_000_000n,
        });
      } else {
        tx = await walletClient.writeContract({
          address: CONTRACTS.polkaStream,
          abi: POLKA_STREAM_ABI,
          functionName: "createLinearStream",
          args: [recipient as `0x${string}`, CONTRACTS.streamToken, depositAmount, startTime, endTime],
          gas: 2_000_000n,
        });
      }

      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Stream created!", "success");
      setRecipient("");
      setAmount("");
      loadStreams();
      loadBalance();
    } catch (e: any) {
      showToast(e.message?.slice(0, 100) || "Failed", "error");
    }
    setLoading(false);
  }

  async function handleWithdraw(streamId: bigint) {
    if (!walletClient || !publicClient) return;
    setLoading(true);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.polkaStream,
        abi: POLKA_STREAM_ABI,
        functionName: "withdraw",
        args: [streamId],
        gas: 1_000_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Withdrawn!", "success");
      loadStreams();
      loadBalance();
    } catch (e: any) {
      showToast(e.message?.slice(0, 80) || "Withdraw failed", "error");
    }
    setLoading(false);
  }

  async function handleCancel(streamId: bigint) {
    if (!walletClient || !publicClient) return;
    setLoading(true);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.polkaStream,
        abi: POLKA_STREAM_ABI,
        functionName: "cancel",
        args: [streamId],
        gas: 1_000_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Stream cancelled!", "success");
      loadStreams();
      loadBalance();
    } catch (e: any) {
      showToast(e.message?.slice(0, 80) || "Cancel failed", "error");
    }
    setLoading(false);
  }

  function shortAddr(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }

  function formatDuration(s: number): string {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function timeLeft(s: StreamData): string {
    if (s.status !== 0) return "";
    const remaining = s.endTime - now;
    if (remaining <= 0) return "Ended";
    return formatDuration(remaining) + " left";
  }

  // ========== RENDER ==========

  if (!isConnected) {
    return (
      <div className="hero">
        <div className="hero-bg">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
        </div>
        <div className="hero-content">
          <div className="hero-badge">Built on Polkadot Hub</div>
          <h1 className="hero-title">
            <span className="gradient-text">PolkaStream</span>
          </h1>
          <p className="hero-subtitle">
            Real-time token streaming protocol. Send payments that flow every second. 
            Payroll, vesting, subscriptions — all on-chain on Polkadot.
          </p>
          <div className="hero-features">
            <div className="hero-feat"><span className="feat-icon">⚡</span> Per-second streaming</div>
            <div className="hero-feat"><span className="feat-icon">🔒</span> Non-custodial</div>
            <div className="hero-feat"><span className="feat-icon">🌐</span> Native Polkadot assets</div>
          </div>
          <div className="hero-connect">
            <ConnectButton showBalance={false} />
          </div>
          <div className="hero-powered">
            Deployed on Polkadot Hub Testnet · Chain 420420417
          </div>
        </div>
      </div>
    );
  }

  const activeStreams = streams.filter((s) => s.status === 0);
  const totalStreaming = activeStreams.reduce((acc, s) => acc + Number(formatUnits(s.depositAmount, 6)), 0);

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-dot" />
          <h1>PolkaStream</h1>
          <span className="network-badge">Testnet</span>
        </div>
        <ConnectButton showBalance={false} />
      </header>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <label>psUSD Balance</label>
          <div className="stat-value gradient-text">
            {Number(formatUnits(tokenBalance, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <button className="mint-btn" onClick={handleMint} disabled={loading}>
            + Mint 10k
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔄</div>
          <label>Active Streams</label>
          <div className="stat-value green-text">{activeStreams.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <label>Total Streaming</label>
          <div className="stat-value">{totalStreaming.toLocaleString()} psUSD</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📁</div>
          <label>All Streams</label>
          <div className="stat-value">{streams.length}</div>
        </div>
      </div>

      {/* Create Stream */}
      <div className="section-header">
        <h2><span className="gradient-text">Create Stream</span></h2>
        <p className="section-desc">Send tokens that flow per second to any address</p>
      </div>

      <div className="create-form">
        <div className="form-row">
          <div className="form-group full">
            <label>Recipient Address</label>
            <input placeholder="0x..." value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Amount (psUSD)</label>
            <input type="number" placeholder="1000" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Duration (seconds)</label>
            <input type="number" placeholder="300" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={streamTypeForm} onChange={(e) => setStreamTypeForm(e.target.value as any)}>
              <option value="linear">Linear</option>
              <option value="cliff">Cliff + Linear</option>
            </select>
          </div>
          {streamTypeForm === "cliff" && (
            <div className="form-group">
              <label>Cliff (minutes)</label>
              <input type="number" value={cliffMinutes} onChange={(e) => setCliffMinutes(e.target.value)} />
            </div>
          )}
        </div>

        {amount && duration && (
          <div className="stream-preview">
            <span>Rate: ~{(parseFloat(amount || "0") / parseInt(duration || "1")).toFixed(4)} psUSD/sec</span>
            <span>Duration: {formatDuration(parseInt(duration) || 0)}</span>
          </div>
        )}

        <button className="btn-create" onClick={handleCreateStream} disabled={loading}>
          <span className="btn-pulse" />
          {loading ? "Processing..." : `Stream ${amount || "0"} psUSD`}
        </button>
      </div>

      {/* Streams */}
      <div className="section-header" style={{ marginTop: 40 }}>
        <h2><span className="gradient-text">Your Streams</span></h2>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "send" ? "active" : ""}`} onClick={() => setTab("send")}>
          Sent
        </button>
        <button className={`tab ${tab === "receive" ? "active" : ""}`} onClick={() => setTab("receive")}>
          Received
        </button>
      </div>

      <div className="streams-list">
        {streams.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💸</div>
            <p>No streams yet</p>
            <span>Create your first stream above</span>
          </div>
        ) : (
          streams.map((s) => {
            const total = Number(formatUnits(s.depositAmount, 6));
            const withdrawn = Number(formatUnits(s.withdrawnAmount, 6));
            const isRecipient = address?.toLowerCase() === s.recipient.toLowerCase();
            const isSender = address?.toLowerCase() === s.sender.toLowerCase();
            const statusLabels = ["Active", "Paused", "Cancelled", "Completed"];
            const statusClasses = ["active", "paused", "cancelled", "completed"];

            return (
              <div className={`stream-card ${s.status === 0 ? "stream-active" : ""}`} key={s.id.toString()}>
                <div className="stream-top">
                  <div className="stream-meta">
                    <span className="stream-id">#{s.id.toString()}</span>
                    <span className={`badge badge-${statusClasses[s.status]}`}>
                      {s.status === 0 && <span className="pulse-dot" />}
                      {statusLabels[s.status]}
                    </span>
                    <span className="stream-type-badge">
                      {["Linear", "Cliff", "Milestone"][s.streamType]}
                    </span>
                  </div>
                  <div className="stream-addr">
                    {tab === "send" ? `→ ${shortAddr(s.recipient)}` : `← ${shortAddr(s.sender)}`}
                  </div>
                </div>

                <div className="stream-body">
                  <div className="stream-amount-row">
                    <div className="stream-live">
                      <LiveCounter stream={s} />
                      <span className="stream-unit">psUSD</span>
                    </div>
                    <div className="stream-of">
                      of {total.toLocaleString()} psUSD
                    </div>
                  </div>

                  <StreamProgress stream={s} />

                  <div className="stream-info-row">
                    <span>Withdrawn: {withdrawn.toFixed(2)}</span>
                    <span className="time-left">{timeLeft(s)}</span>
                  </div>
                </div>

                {s.status === 0 && (
                  <div className="stream-actions">
                    {isRecipient && (
                      <button className="btn-action btn-withdraw" onClick={() => handleWithdraw(s.id)} disabled={loading}>
                        Withdraw
                      </button>
                    )}
                    {isSender && (
                      <button className="btn-action btn-cancel" onClick={() => handleCancel(s.id)} disabled={loading}>
                        Cancel Stream
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <footer className="footer">
        <span>PolkaStream Protocol</span>
        <span>·</span>
        <span>Polkadot Hub Testnet</span>
        <span>·</span>
        <a href={`https://blockscout-testnet.polkadot.io/address/${CONTRACTS.polkaStream}`} target="_blank" rel="noreferrer">
          View Contract ↗
        </a>
      </footer>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

export default App;