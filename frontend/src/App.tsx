import { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { CONTRACTS, POLKA_STREAM_ABI, STREAM_TOKEN_ABI } from "./config";

// ===== TYPES =====

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

type NativeAsset = {
  assetId: number;
  precompile: string;
  symbol: string;
  decimals: number;
  active: boolean;
};

type PayrollRow = {
  address: string;
  amount: string;
};

// ===== HELPERS =====

function parseStreamResult(id: bigint, raw: any): StreamData {
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

function shortAddr(a: string) {
  return a.slice(0, 6) + "..." + a.slice(-4);
}

function formatDuration(s: number): string {
  if (s <= 0) return "0s";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatNumber(n: number, decimals = 2): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(decimals);
}

// ===== ANIMATED COMPONENTS =====

function LiveCounter({ stream, decimals = 6 }: { stream: StreamData; decimals?: number }) {
  const [display, setDisplay] = useState("0.000000");

  useEffect(() => {
    if (stream.status !== 0) {
      const val = stream.status === 3
        ? Number(formatUnits(stream.depositAmount, decimals))
        : Number(formatUnits(stream.withdrawnAmount, decimals));
      setDisplay(val.toFixed(decimals));
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
        setDisplay(((deposit * elapsed) / duration).toFixed(decimals));
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, [stream, decimals]);

  return <span className="live-counter">{display}</span>;
}

function StreamProgress({ stream }: { stream: StreamData }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (stream.status === 2) { setPct(0); return; }
    if (stream.status === 3) { setPct(100); return; }

    let raf: number;
    function tick() {
      const now = Date.now() / 1000;
      const start = stream.startTime;
      const end = stream.endTime;
      if (now <= start) setPct(0);
      else if (now >= end) setPct(100);
      else setPct(((now - start) / (end - start)) * 100);
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, [stream]);

  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%` }}>
        {stream.status === 0 && pct > 0 && pct < 100 && <div className="progress-glow" />}
      </div>
    </div>
  );
}

// ===== MAIN APP =====

function App() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  // State
  const [page, setPage] = useState<"dashboard" | "create" | "payroll">("dashboard");
  const [streamTab, setStreamTab] = useState<"send" | "receive">("send");
  const [streams, setStreams] = useState<StreamData[]>([]);
  const [allStreams, setAllStreams] = useState<StreamData[]>([]);
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [nativeAssets, setNativeAssets] = useState<NativeAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // Create stream form
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("600");
  const [streamTypeForm, setStreamTypeForm] = useState<"linear" | "cliff">("linear");
  const [cliffMinutes, setCliffMinutes] = useState("2");
  const [selectedToken, setSelectedToken] = useState<"psUSD" | "native">("psUSD");

  // Batch payroll form
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([
    { address: "", amount: "" },
    { address: "", amount: "" },
    { address: "", amount: "" },
  ]);
  const [payrollDuration, setPayrollDuration] = useState("2592000"); // 30 days

  // Tick
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  const showToast = (msg: string, type: string) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ===== DATA LOADING =====

  const loadStreams = useCallback(async () => {
    if (!publicClient || !address) return;
    try {
      const [sentIds, receivedIds] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
          functionName: "getSenderStreams", args: [address],
        }) as Promise<bigint[]>,
        publicClient.readContract({
          address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
          functionName: "getRecipientStreams", args: [address],
        }) as Promise<bigint[]>,
      ]);

      const allIds = [...new Set([...sentIds, ...receivedIds])];
      const results = await Promise.all(
        allIds.map(async (id) => {
          try {
            const raw = await publicClient.readContract({
              address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
              functionName: "getStream", args: [id],
            });
            return parseStreamResult(id, raw);
          } catch { return null; }
        })
      );
      const all = results.filter(Boolean) as StreamData[];
      setAllStreams(all);

      const filtered = streamTab === "send"
        ? all.filter(s => s.sender.toLowerCase() === address.toLowerCase())
        : all.filter(s => s.recipient.toLowerCase() === address.toLowerCase());
      setStreams(filtered.reverse());
    } catch (e) { console.error("Load streams:", e); }
  }, [publicClient, address, streamTab]);

  const loadBalance = useCallback(async () => {
    if (!publicClient || !address) return;
    try {
      const bal = await publicClient.readContract({
        address: CONTRACTS.streamToken, abi: STREAM_TOKEN_ABI,
        functionName: "balanceOf", args: [address],
      }) as bigint;
      setTokenBalance(bal);
    } catch {}
  }, [publicClient, address]);

  const loadNativeAssets = useCallback(async () => {
    if (!publicClient) return;
    try {
      const assets = await publicClient.readContract({
        address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
        functionName: "getRegisteredAssets",
      }) as any[];
      setNativeAssets(assets.map((a: any) => ({
        assetId: Number(a.assetId),
        precompile: a.precompile,
        symbol: a.symbol,
        decimals: Number(a.decimals),
        active: a.active,
      })));
    } catch {}
  }, [publicClient]);

  useEffect(() => { loadStreams(); loadBalance(); loadNativeAssets(); }, [loadStreams, loadBalance, loadNativeAssets]);
  useEffect(() => {
    const i = setInterval(() => { loadStreams(); loadBalance(); }, 12000);
    return () => clearInterval(i);
  }, [loadStreams, loadBalance]);

  // ===== ACTIONS =====

  async function handleMint() {
    if (!walletClient || !address || !publicClient) return;
    setLoading(true);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.streamToken, abi: STREAM_TOKEN_ABI,
        functionName: "mint", args: [address, parseUnits("10000", 6)], gas: 500_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Minted 10,000 psUSD!", "success");
      loadBalance();
    } catch (e: any) { showToast(e.message?.slice(0, 80) || "Mint failed", "error"); }
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

      // Approve
      const allowance = await publicClient.readContract({
        address: CONTRACTS.streamToken, abi: STREAM_TOKEN_ABI,
        functionName: "allowance", args: [address, CONTRACTS.polkaStream],
      }) as bigint;

      if (allowance < depositAmount) {
        showToast("Approving tokens...", "success");
        const approveTx = await walletClient.writeContract({
          address: CONTRACTS.streamToken, abi: STREAM_TOKEN_ABI,
          functionName: "approve", args: [CONTRACTS.polkaStream, depositAmount * 10n], gas: 500_000n,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 120_000 });
      }

      showToast("Creating stream...", "success");
      let tx: `0x${string}`;

      if (streamTypeForm === "cliff") {
        const cliffTime = BigInt(nowTs + 15 + parseInt(cliffMinutes) * 60);
        tx = await walletClient.writeContract({
          address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
          functionName: "createCliffStream",
          args: [recipient as `0x${string}`, CONTRACTS.streamToken, depositAmount, startTime, endTime, cliffTime],
          gas: 2_000_000n,
        });
      } else {
        tx = await walletClient.writeContract({
          address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
          functionName: "createLinearStream",
          args: [recipient as `0x${string}`, CONTRACTS.streamToken, depositAmount, startTime, endTime],
          gas: 2_000_000n,
        });
      }

      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Stream created!", "success");
      setRecipient(""); setAmount("");
      setPage("dashboard");
      loadStreams(); loadBalance();
    } catch (e: any) { showToast(e.message?.slice(0, 100) || "Failed", "error"); }
    setLoading(false);
  }

  async function handleBatchPayroll() {
    if (!walletClient || !address || !publicClient) return;
    const validRows = payrollRows.filter(r => r.address && r.amount);
    if (validRows.length < 2) return showToast("Add at least 2 recipients", "error");
    if (!payrollDuration) return showToast("Set duration", "error");

    setLoading(true);
    try {
      const recipients = validRows.map(r => r.address as `0x${string}`);
      const amounts = validRows.map(r => parseUnits(r.amount, 6));
      const totalAmount = amounts.reduce((a, b) => a + b, 0n);

      const nowTs = Math.floor(Date.now() / 1000);
      const startTime = BigInt(nowTs + 15);
      const endTime = BigInt(nowTs + 15 + parseInt(payrollDuration));

      // Approve
      const allowance = await publicClient.readContract({
        address: CONTRACTS.streamToken, abi: STREAM_TOKEN_ABI,
        functionName: "allowance", args: [address, CONTRACTS.polkaStream],
      }) as bigint;

      if (allowance < totalAmount) {
        showToast("Approving tokens...", "success");
        const approveTx = await walletClient.writeContract({
          address: CONTRACTS.streamToken, abi: STREAM_TOKEN_ABI,
          functionName: "approve", args: [CONTRACTS.polkaStream, totalAmount * 2n], gas: 500_000n,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 120_000 });
      }

      showToast(`Creating ${validRows.length} streams...`, "success");
      const tx = await walletClient.writeContract({
        address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
        functionName: "createBatchStreams",
        args: [recipients, amounts, CONTRACTS.streamToken, startTime, endTime],
        gas: BigInt(500_000 * validRows.length),
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast(`${validRows.length} payroll streams created!`, "success");
      setPage("dashboard");
      loadStreams(); loadBalance();
    } catch (e: any) { showToast(e.message?.slice(0, 100) || "Batch failed", "error"); }
    setLoading(false);
  }

  async function handleWithdraw(streamId: bigint) {
    if (!walletClient || !publicClient) return;
    setLoading(true);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
        functionName: "withdraw", args: [streamId], gas: 1_000_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Withdrawn!", "success");
      loadStreams(); loadBalance();
    } catch (e: any) { showToast(e.message?.slice(0, 80) || "Failed", "error"); }
    setLoading(false);
  }

  async function handleCancel(streamId: bigint) {
    if (!walletClient || !publicClient) return;
    setLoading(true);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACTS.polkaStream, abi: POLKA_STREAM_ABI,
        functionName: "cancel", args: [streamId], gas: 1_000_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      showToast("Cancelled!", "success");
      loadStreams(); loadBalance();
    } catch (e: any) { showToast(e.message?.slice(0, 80) || "Failed", "error"); }
    setLoading(false);
  }

  // ===== COMPUTED =====

  const activeStreams = allStreams.filter(s => s.status === 0);
  const completedStreams = allStreams.filter(s => s.status === 3);
  const cancelledStreams = allStreams.filter(s => s.status === 2);
  const totalDeposited = allStreams.reduce((a, s) => a + Number(formatUnits(s.depositAmount, 6)), 0);
  const totalWithdrawn = allStreams.reduce((a, s) => a + Number(formatUnits(s.withdrawnAmount, 6)), 0);
  const totalStreaming = activeStreams.reduce((a, s) => a + Number(formatUnits(s.depositAmount, 6)), 0);

  function timeLeft(s: StreamData): string {
    if (s.status !== 0) return "";
    const remaining = s.endTime - now;
    if (remaining <= 0) return "Ended";
    return formatDuration(remaining);
  }

  function addPayrollRow() {
    setPayrollRows([...payrollRows, { address: "", amount: "" }]);
  }

  function removePayrollRow(index: number) {
    if (payrollRows.length <= 2) return;
    setPayrollRows(payrollRows.filter((_, i) => i !== index));
  }

  function updatePayrollRow(index: number, field: "address" | "amount", value: string) {
    const rows = [...payrollRows];
    rows[index][field] = value;
    setPayrollRows(rows);
  }

  const payrollTotal = payrollRows
    .filter(r => r.amount)
    .reduce((a, r) => a + parseFloat(r.amount || "0"), 0);

  // ===== RENDER: HERO =====

  if (!isConnected) {
    return (
      <div className="hero">
        <div className="hero-bg">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
          <div className="grid-bg" />
        </div>
        <div className="hero-content">
          <div className="hero-badge">
            <span className="badge-dot" />
            Polkadot Solidity Hackathon 2026
          </div>
          <h1 className="hero-title">
            <span className="gradient-text">PolkaStream</span>
          </h1>
          <p className="hero-tagline">Money that flows every second</p>
          <p className="hero-subtitle">
            Real-time token streaming protocol on Polkadot Hub.
            Payroll, vesting, subscriptions — all on-chain using native Polkadot assets.
          </p>

          <div className="hero-features">
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h3>Per-Second Streaming</h3>
              <p>Tokens flow continuously. Recipients withdraw earned amount anytime.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🏛️</div>
              <h3>Native Polkadot Assets</h3>
              <p>Stream USDT, USDC, DOT via ERC-20 precompile. No wrapping needed.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🌐</div>
              <h3>XCM Cross-Chain</h3>
              <p>Notify other parachains on stream events via XCM precompile.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">👥</div>
              <h3>Batch Payroll</h3>
              <p>Stream to 50 recipients in one transaction. Built for DAOs.</p>
            </div>
          </div>

          <div className="hero-connect">
            <ConnectButton />
          </div>

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-value">420420417</span>
              <span className="hero-stat-label">Chain ID</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat">
              <span className="hero-stat-value">32</span>
              <span className="hero-stat-label">Tests Passing</span>
            </div>
            <div className="hero-stat-divider" />
            <div className="hero-stat">
              <span className="hero-stat-value">Live</span>
              <span className="hero-stat-label">On Testnet</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== RENDER: DASHBOARD =====

  return (
    <div className="app">
      <header className="header">
        <div className="logo" onClick={() => setPage("dashboard")} style={{ cursor: "pointer" }}>
          <div className="logo-dot" />
          <h1>PolkaStream</h1>
          <span className="network-badge">Testnet</span>
        </div>
        <div className="header-right">
          <nav className="nav">
            <button className={`nav-item ${page === "dashboard" ? "active" : ""}`} onClick={() => setPage("dashboard")}>Dashboard</button>
            <button className={`nav-item ${page === "create" ? "active" : ""}`} onClick={() => setPage("create")}>New Stream</button>
            <button className={`nav-item ${page === "payroll" ? "active" : ""}`} onClick={() => setPage("payroll")}>Batch Payroll</button>
          </nav>
          <ConnectButton showBalance={false} />
        </div>
      </header>

      {/* ===== ANALYTICS ===== */}
      {page === "dashboard" && (
        <>
          <div className="analytics">
            <div className="analytics-header">
              <h2>Protocol Analytics</h2>
              <button className="mint-btn" onClick={handleMint} disabled={loading}>+ Mint 10k psUSD</button>
            </div>

            <div className="stats-grid">
              <div className="stat-card stat-accent">
                <div className="stat-label">Your Balance</div>
                <div className="stat-value gradient-text">
                  {formatNumber(Number(formatUnits(tokenBalance, 6)))}
                </div>
                <div className="stat-sub">psUSD</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Active Streams</div>
                <div className="stat-value green-text">{activeStreams.length}</div>
                <div className="stat-sub">streaming now</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Streaming</div>
                <div className="stat-value">{formatNumber(totalStreaming)}</div>
                <div className="stat-sub">psUSD locked</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Withdrawn</div>
                <div className="stat-value">{formatNumber(totalWithdrawn)}</div>
                <div className="stat-sub">psUSD claimed</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Completed</div>
                <div className="stat-value blue-text">{completedStreams.length}</div>
                <div className="stat-sub">streams finished</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Cancelled</div>
                <div className="stat-value">{cancelledStreams.length}</div>
                <div className="stat-sub">streams refunded</div>
              </div>
            </div>

            {/* Native Asset Registry */}
            <div className="native-assets-section">
              <h3>Polkadot Native Assets <span className="tag">ERC-20 Precompile</span></h3>
              <div className="native-assets-grid">
                {nativeAssets.map(a => (
                  <div className="native-asset-card" key={a.assetId}>
                    <div className="na-symbol">{a.symbol}</div>
                    <div className="na-details">
                      <span>Asset ID: {a.assetId}</span>
                      <span className="na-addr">{shortAddr(a.precompile)}</span>
                    </div>
                    <div className={`na-status ${a.active ? "active" : ""}`}>
                      {a.active ? "Streamable" : "Inactive"}
                    </div>
                  </div>
                ))}
                <div className="native-asset-card na-info">
                  <div className="na-symbol">XCM</div>
                  <div className="na-details">
                    <span>Cross-chain messaging</span>
                    <span className="na-addr">0x...0a0000</span>
                  </div>
                  <div className="na-status">Integrated</div>
                </div>
              </div>
            </div>
          </div>

          {/* ===== STREAM LIST ===== */}
          <div className="streams-section">
            <div className="streams-header">
              <h2>Your Streams</h2>
              <div className="tabs">
                <button className={`tab ${streamTab === "send" ? "active" : ""}`} onClick={() => setStreamTab("send")}>Sent</button>
                <button className={`tab ${streamTab === "receive" ? "active" : ""}`} onClick={() => setStreamTab("receive")}>Received</button>
              </div>
            </div>

            <div className="streams-list">
              {streams.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">💸</div>
                  <p>No streams yet</p>
                  <span>Create your first stream to get started</span>
                  <button className="btn-create-cta" onClick={() => setPage("create")}>Create Stream</button>
                </div>
              ) : (
                streams.map((s) => {
                  const total = Number(formatUnits(s.depositAmount, 6));
                  const withdrawn = Number(formatUnits(s.withdrawnAmount, 6));
                  const isRecipient = address?.toLowerCase() === s.recipient.toLowerCase();
                  const isSender = address?.toLowerCase() === s.sender.toLowerCase();
                  const statusLabels = ["Active", "Paused", "Cancelled", "Completed"];
                  const statusClasses = ["active", "paused", "cancelled", "completed"];
                  const rate = total / (s.endTime - s.startTime);

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
                          {streamTab === "send" ? `→ ${shortAddr(s.recipient)}` : `← ${shortAddr(s.sender)}`}
                        </div>
                      </div>

                      <div className="stream-body">
                        <div className="stream-amount-row">
                          <div className="stream-live">
                            <LiveCounter stream={s} />
                            <span className="stream-unit">psUSD</span>
                          </div>
                          <div className="stream-of">of {formatNumber(total)} psUSD</div>
                        </div>

                        <StreamProgress stream={s} />

                        <div className="stream-info-row">
                          <span>Withdrawn: {formatNumber(withdrawn)}</span>
                          {s.status === 0 && <span>Rate: {rate.toFixed(4)}/s</span>}
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
                              Cancel
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* ===== CREATE STREAM ===== */}
      {page === "create" && (
        <div className="page-content">
          <div className="page-header">
            <h2><span className="gradient-text">Create Stream</span></h2>
            <p>Send tokens that flow per second to any address</p>
          </div>

          <div className="create-form">
            <div className="form-section">
              <label>Recipient Address</label>
              <input placeholder="0x..." value={recipient} onChange={e => setRecipient(e.target.value)} />
            </div>

            <div className="form-row">
              <div className="form-section">
                <label>Token</label>
                <select value={selectedToken} onChange={e => setSelectedToken(e.target.value as any)}>
                  <option value="psUSD">psUSD (Test Stablecoin)</option>
                  {nativeAssets.map(a => (
                    <option key={a.assetId} value="native">
                      {a.symbol} (Native · ID {a.assetId})
                    </option>
                  ))}
                </select>
                {selectedToken === "native" && (
                  <span className="form-hint">Uses ERC-20 precompile — no wrapping needed</span>
                )}
              </div>
              <div className="form-section">
                <label>Amount</label>
                <input type="number" placeholder="1000" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-section">
                <label>Duration (seconds)</label>
                <input type="number" placeholder="600" value={duration} onChange={e => setDuration(e.target.value)} />
                <div className="duration-presets">
                  <button onClick={() => setDuration("300")}>5m</button>
                  <button onClick={() => setDuration("600")}>10m</button>
                  <button onClick={() => setDuration("3600")}>1h</button>
                  <button onClick={() => setDuration("86400")}>1d</button>
                  <button onClick={() => setDuration("2592000")}>30d</button>
                </div>
              </div>
              <div className="form-section">
                <label>Stream Type</label>
                <select value={streamTypeForm} onChange={e => setStreamTypeForm(e.target.value as any)}>
                  <option value="linear">Linear (instant start)</option>
                  <option value="cliff">Cliff + Linear (delayed start)</option>
                </select>
              </div>
            </div>

            {streamTypeForm === "cliff" && (
              <div className="form-section">
                <label>Cliff Duration (minutes)</label>
                <input type="number" value={cliffMinutes} onChange={e => setCliffMinutes(e.target.value)} />
                <span className="form-hint">No tokens flow until cliff ends, then linear streaming begins</span>
              </div>
            )}

            {amount && duration && (
              <div className="stream-preview">
                <div className="preview-item">
                  <span className="preview-label">Rate</span>
                  <span className="preview-value">{(parseFloat(amount) / parseInt(duration)).toFixed(6)} psUSD/sec</span>
                </div>
                <div className="preview-item">
                  <span className="preview-label">Duration</span>
                  <span className="preview-value">{formatDuration(parseInt(duration))}</span>
                </div>
                <div className="preview-item">
                  <span className="preview-label">Total</span>
                  <span className="preview-value">{parseFloat(amount).toLocaleString()} psUSD</span>
                </div>
              </div>
            )}

            <button className="btn-primary" onClick={handleCreateStream} disabled={loading}>
              {loading ? "Processing..." : `Stream ${amount || "0"} psUSD`}
            </button>
          </div>
        </div>
      )}

      {/* ===== BATCH PAYROLL ===== */}
      {page === "payroll" && (
        <div className="page-content">
          <div className="page-header">
            <h2><span className="gradient-text">Batch Payroll</span></h2>
            <p>Stream to multiple recipients in a single transaction. Built for DAOs.</p>
          </div>

          <div className="create-form">
            <div className="form-section">
              <label>Stream Duration</label>
              <input type="number" value={payrollDuration} onChange={e => setPayrollDuration(e.target.value)} />
              <div className="duration-presets">
                <button onClick={() => setPayrollDuration("604800")}>1 week</button>
                <button onClick={() => setPayrollDuration("2592000")}>30 days</button>
                <button onClick={() => setPayrollDuration("7776000")}>90 days</button>
                <button onClick={() => setPayrollDuration("31536000")}>1 year</button>
              </div>
            </div>

            <div className="payroll-table">
              <div className="payroll-header-row">
                <span className="payroll-num">#</span>
                <span className="payroll-addr-col">Recipient Address</span>
                <span className="payroll-amt-col">Amount (psUSD)</span>
                <span className="payroll-rm-col"></span>
              </div>
              {payrollRows.map((row, i) => (
                <div className="payroll-row" key={i}>
                  <span className="payroll-num">{i + 1}</span>
                  <input
                    className="payroll-addr"
                    placeholder="0x..."
                    value={row.address}
                    onChange={e => updatePayrollRow(i, "address", e.target.value)}
                  />
                  <input
                    className="payroll-amt"
                    type="number"
                    placeholder="1000"
                    value={row.amount}
                    onChange={e => updatePayrollRow(i, "amount", e.target.value)}
                  />
                  <button className="payroll-rm" onClick={() => removePayrollRow(i)} disabled={payrollRows.length <= 2}>×</button>
                </div>
              ))}
              <button className="payroll-add" onClick={addPayrollRow}>+ Add Recipient</button>
            </div>

            <div className="stream-preview">
              <div className="preview-item">
                <span className="preview-label">Recipients</span>
                <span className="preview-value">{payrollRows.filter(r => r.address).length}</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Total Amount</span>
                <span className="preview-value">{payrollTotal.toLocaleString()} psUSD</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Duration</span>
                <span className="preview-value">{formatDuration(parseInt(payrollDuration) || 0)}</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Gas Saved</span>
                <span className="preview-value green-text">~{payrollRows.filter(r => r.address).length}x vs individual</span>
              </div>
            </div>

            <button className="btn-primary" onClick={handleBatchPayroll} disabled={loading}>
              {loading ? "Processing..." : `Create ${payrollRows.filter(r => r.address && r.amount).length} Payroll Streams`}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <span>PolkaStream Protocol</span>
        <span className="footer-dot">·</span>
        <span>Polkadot Hub Testnet</span>
        <span className="footer-dot">·</span>
        <a href={`https://blockscout-testnet.polkadot.io/address/${CONTRACTS.polkaStream}`} target="_blank" rel="noreferrer">
          Contract ↗
        </a>
        <span className="footer-dot">·</span>
        <a href="https://github.com/SohamJuneja/PolkaStream" target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </footer>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}

export default App;