# PolkaStream

**Real-time token streaming protocol on Polkadot Hub**

Stream payments that flow every second. Payroll, vesting, subscriptions — all on-chain, using Polkadot native assets.

[![Live on Testnet](https://img.shields.io/badge/Polkadot_Hub_Testnet-Live-E6007A?style=for-the-badge&logo=polkadot)](https://blockscout-testnet.polkadot.io/address/0xe86ff91613e2997d498daa78974ab2440fb9d048)
[![Tests](https://img.shields.io/badge/Tests-32_passing-22c55e?style=for-the-badge)]()
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?style=for-the-badge&logo=solidity)]()

---

## The Problem

Token payments today are discrete — you send a lump sum and hope for the best. This creates problems:

- **Payroll**: DAOs pay contributors monthly, but trust breaks when someone leaves mid-month
- **Vesting**: Token vesting requires complex multisig setups with manual unlocks
- **Subscriptions**: No on-chain primitive for recurring payments
- **Trust**: Senders can't reclaim unearned funds; recipients can't prove future payment

## The Solution

PolkaStream makes tokens flow continuously, per second, on Polkadot Hub. A sender locks tokens into a stream, and the recipient can withdraw their earned portion at any time. If the relationship ends, the sender cancels and instantly reclaims the unstreamed balance.

**Built natively for Polkadot** — not a fork of Ethereum tooling deployed on Polkadot. PolkaStream uses the ERC-20 precompile to stream Polkadot native assets (USDT, USDC, DOT) without wrapping, and integrates the XCM precompile for cross-chain stream notifications.

---

## Why Polkadot Hub?

This protocol is designed specifically for Polkadot's unique capabilities. Here's what makes it impossible to replicate on Ethereum:

### 1. Native Asset Streaming via ERC-20 Precompile

On Ethereum, streaming USDT requires the token contract to implement ERC-20. On Polkadot Hub, **every asset registered in the Assets pallet is automatically exposed as ERC-20** at a deterministic precompile address. PolkaStream's native asset registry maps these:

| Asset | Pallet ID | ERC-20 Precompile Address |
|-------|-----------|--------------------------|
| USDt  | 1984      | `0x000007c0...01200000`   |
| USDC  | 1337      | `0x00000539...01200000`   |

Any new asset registered on Polkadot Hub is instantly streamable — zero integration work.

### 2. XCM Cross-Chain Notifications

When a stream is created or completed, PolkaStream can send XCM messages to other parachains. Use cases:

- Notify a governance chain that treasury streaming has begun
- Trigger automated actions on a payroll parachain when salary streams activate
- Cross-chain composability that doesn't exist on single-chain protocols

### 3. Unified Gas Model

Polkadot Hub's dual-VM architecture means EVM contracts and PVM contracts share the same address space and gas model. PolkaStream's Solidity contracts interact with native precompiles without bridges or wrapped tokens.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + viem)                    │
│          Live-ticking stream counters + MetaMask             │
└──────────────────────────┬──────────────────────────────────┘
                           │ Eth JSON-RPC
┌──────────────────────────▼──────────────────────────────────┐
│                  Polkadot Hub (Chain 420420417)               │
│                                                              │
│  ┌─────────────────────┐    ┌────────────────────────────┐  │
│  │  PolkaStreamNative   │    │    ERC-20 Precompile       │  │
│  │  (Solidity)          │───▶│    (Native USDT/USDC/DOT)  │  │
│  │                      │    └────────────────────────────┘  │
│  │  • Linear streams    │                                    │
│  │  • Cliff + vesting   │    ┌────────────────────────────┐  │
│  │  • Batch payroll     │───▶│    XCM Precompile          │  │
│  │  • Cancel + refund   │    │    (Cross-chain messaging)  │  │
│  │  • Asset registry    │    └────────────────────────────┘  │
│  └─────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Features

**Core Streaming**
- Linear streams — tokens flow evenly from start to end
- Cliff + linear vesting — nothing until cliff date, then linear flow
- Batch payroll — create up to 50 streams in a single transaction
- Cancel anytime — sender reclaims unstreamed tokens, recipient keeps earned amount
- Withdraw anytime — recipients pull earned tokens whenever they want

**Polkadot Native**
- Native asset registry with ERC-20 precompile integration
- Stream USDT, USDC, or any pallet-assets token without wrapping
- XCM cross-chain notifications for stream lifecycle events
- Designed for Polkadot Hub's unified EVM + PVM execution environment

**Frontend**
- Real-time animated counters that tick every frame (requestAnimationFrame)
- Live progress bars with glow effects on active streams
- Create, withdraw, and cancel streams from the UI
- Mint test tokens for easy demo
- RainbowKit wallet connection

---

## Live Deployment

Deployed on **Polkadot Hub Testnet** (Paseo Asset Hub, Chain ID 420420417):

| Contract | Address | Explorer |
|----------|---------|----------|
| PolkaStreamNative | `0xe86ff91613e2997d498daa78974ab2440fb9d048` | [View ↗](https://blockscout-testnet.polkadot.io/address/0xe86ff91613e2997d498daa78974ab2440fb9d048) |
| StreamToken (psUSD) | `0x651b8475b98fb6b19ed57e34bcb5a63481375741` | [View ↗](https://blockscout-testnet.polkadot.io/address/0x651b8475b98fb6b19ed57e34bcb5a63481375741) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- MetaMask or any EVM wallet

### Install & Run Locally

```bash
# Clone
git clone https://github.com/SohamJuneja/PolkaStream.git
cd PolkaStream

# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests (start a hardhat node in a separate terminal first)
# Terminal 1:
npx hardhat node
# Terminal 2:
npx hardhat test

# Start frontend
cd frontend
npm install
npm run dev
```

### Deploy to Polkadot Hub Testnet

```bash
# 1. Create .env file
cp .env.example .env
# Add your private key and RPC URL

# 2. Get testnet tokens from https://faucet.polkadot.io/
#    Select: Paseo → Asset Hub → paste your EVM address

# 3. Deploy
npx hardhat run scripts/deploy.ts --network polkadotHub
```

### Environment Variables

```
POLKADOT_HUB_RPC_URL=https://eth-rpc-testnet.polkadot.io/
DEPLOYER_PRIVATE_KEY=0x_your_private_key_here
```

---

## Test Suite

32 tests covering all protocol functionality:

```
  PolkaStream Protocol
    Deployment
      ✔ should start with nextStreamId = 1
      ✔ should set deployer as owner
      ✔ should register USDt and USDC native assets
      ✔ should have XCM notifications disabled
      ✔ should mint 1M tokens to deployer
    Linear Streams
      ✔ should create a linear stream
      ✔ should store correct stream data
      ✔ should hold tokens in contract
      ✔ should track sender streams
      ✔ should track recipient streams
      ✔ should return positive stream rate
    Input Validation
      ✔ should reject zero recipient
      ✔ should reject self-streaming
      ✔ should reject zero deposit
      ✔ should reject end before start
    Cliff Streams
      ✔ should create cliff+linear stream
      ✔ should reject cliff after end
    Cancel Stream
      ✔ should cancel an active stream
      ✔ should reject cancel from non-sender
    Batch Streams (Payroll)
      ✔ should create multiple streams at once
      ✔ should reject mismatched arrays
    Native Asset Registry (Polkadot)
      ✔ should map USDt (1984) to correct precompile
      ✔ should map USDC (1337) to correct precompile
      ✔ should identify native asset addresses
      ✔ should not flag non-native tokens
      ✔ should list all registered assets
    Edge Cases
      ✔ should reject withdraw on nonexistent stream
      ✔ should reject cancel on nonexistent stream
      ✔ should return 0 withdrawable for cancelled stream

  32 passing
```

---

## Contract API

### PolkaStream (Base)

| Function | Description |
|----------|-------------|
| `createLinearStream(recipient, token, amount, start, end)` | Create a linear stream |
| `createCliffStream(recipient, token, amount, start, end, cliff)` | Create cliff + linear stream |
| `createBatchStreams(recipients[], amounts[], token, start, end)` | Batch payroll (up to 50) |
| `withdraw(streamId)` | Recipient withdraws earned tokens |
| `cancel(streamId)` | Sender cancels and reclaims unstreamed |
| `getStream(streamId)` | Get full stream details |
| `withdrawable(streamId)` | Check available withdrawal amount |
| `streamRate(streamId)` | Get tokens per second |
| `streamedAmount(streamId)` | Get total streamed so far |

### PolkaStreamNative (Polkadot Extensions)

| Function | Description |
|----------|-------------|
| `streamNativeAsset(assetId, recipient, amount, duration)` | Stream by pallet-assets ID |
| `streamNativeAssetWithCliff(assetId, recipient, amount, duration, cliff)` | Native asset + cliff |
| `batchStreamNativeAsset(assetId, recipients[], amounts[], duration)` | Native asset batch payroll |
| `registerNativeAsset(assetId, precompile, symbol, decimals)` | Register new native asset |
| `getRegisteredAssets()` | List all registered native assets |
| `isNativeAsset(address)` | Check if address is a native asset precompile |
| `setXCMNotifications(enabled)` | Toggle XCM cross-chain notifications |
| `sendStreamNotification(destination, message)` | Send XCM notification |
| `estimateXCMWeight(message)` | Estimate XCM execution cost |

---

## Project Structure

```
PolkaStream/
├── contracts/
│   ├── PolkaStream.sol          # Core streaming protocol
│   ├── PolkaStreamNative.sol    # Polkadot-native extensions (ERC-20 precompile + XCM)
│   ├── IXcm.sol                 # XCM precompile interface
│   └── StreamToken.sol          # Test ERC-20 token
├── frontend/
│   └── src/
│       ├── App.tsx              # Main dashboard with live streaming UI
│       ├── config.ts            # Contract addresses and ABIs
│       ├── main.tsx             # Wagmi + RainbowKit provider setup
│       └── index.css            # Dark theme with animations
├── scripts/
│   ├── deploy.ts                # Deploy to Polkadot Hub testnet
│   └── test-stream.ts           # On-chain integration test
├── test/
│   └── PolkaStream.ts           # 32 comprehensive tests
└── hardhat.config.ts            # Hardhat v3 + Polkadot Hub network
```

---

## Security Considerations

- **ReentrancyGuard** on all state-changing functions (OpenZeppelin)
- **SafeERC20** for all token transfers — handles non-standard return values
- **Integer math** checked by Solidity 0.8.28 default overflow protection
- **Access control** — only stream sender can cancel, only recipient can withdraw
- **No proxy pattern** — immutable deployment, no upgrade risk
- Stream funds are held by the contract, not by any admin

---

## Roadmap

**Phase 1 — Hackathon (Current)**
- Core streaming protocol with linear and cliff streams
- Native asset integration via ERC-20 precompile
- XCM notification infrastructure
- Frontend with live streaming visualization

**Phase 2 — Post-Hackathon**
- Stream NFT receipts (ERC-721 representing stream positions)
- Multi-token streams (stream multiple assets in one stream)
- Scheduled streams via XCM Transact
- Mainnet deployment on Polkadot Hub

**Phase 3 — Protocol Growth**
- SDK for other dApps to integrate streaming payments
- Governance module for protocol parameters
- Cross-chain streams via XCM execute

---

## Tech Stack

- **Smart Contracts**: Solidity 0.8.28, OpenZeppelin 5.x
- **Framework**: Hardhat v3
- **Frontend**: React 18, TypeScript, viem, wagmi, RainbowKit
- **Network**: Polkadot Hub Testnet (Paseo Asset Hub, Chain ID 420420417)
- **Precompiles**: ERC-20 (native assets), XCM (cross-chain messaging)

---

## Hackathon

**Polkadot Solidity Hackathon 2026**
- **Track**: Track 1 — EVM Smart Contract (DeFi & Stablecoin-enabled dApps)
- **Builder**: [SohamJuneja](https://github.com/SohamJuneja)

---

## License

MIT