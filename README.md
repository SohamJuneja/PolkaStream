# PolkaStream

**Real-time token streaming protocol on Polkadot Hub**

Stream payments that flow every second. Payroll, vesting, subscriptions — all on-chain, using Polkadot native assets. Stream positions are transferable NFTs.

[![Live Demo](https://img.shields.io/badge/Live_Demo-polka--stream.vercel.app-E6007A?style=for-the-badge&logo=vercel)](https://polka-stream.vercel.app)
[![Live on Testnet](https://img.shields.io/badge/Polkadot_Hub_Testnet-Live-E6007A?style=for-the-badge&logo=polkadot)](https://blockscout-testnet.polkadot.io/address/0x565dc3183e537b17c1592a7bbcf1de237cf76094)
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

**Built natively for Polkadot** — not a fork of Ethereum tooling deployed on Polkadot. PolkaStream uses the ERC-20 precompile to stream Polkadot native assets (USDT, USDC, DOT) without wrapping, integrates the XCM precompile for cross-chain stream notifications, and mints transferable ERC-721 NFTs representing stream positions.

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
│     Live-ticking counters · Batch Payroll · Analytics        │
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
│                                                              │
│  ┌─────────────────────┐                                    │
│  │  StreamNFT (ERC-721) │    Transferable stream positions  │
│  │  • On-chain SVG      │    Transfer NFT = transfer income │
│  │  • Batch mint        │    Composable DeFi primitive       │
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

**Stream NFT Receipts (ERC-721)**
- Every stream mints a transferable NFT to the recipient
- Transfer the NFT = transfer the right to withdraw from the stream
- Fully on-chain SVG metadata — no IPFS dependency
- Dynamic rendering of stream amount, progress, status, and label
- Enables secondary markets for income streams, DeFi collateral, and gifting

**Polkadot Native**
- Native asset registry with ERC-20 precompile integration
- Stream USDT, USDC, or any pallet-assets token without wrapping
- XCM cross-chain notifications for stream lifecycle events
- Designed for Polkadot Hub's unified EVM + PVM execution environment

**Frontend**
- Real-time animated counters that tick every frame (requestAnimationFrame)
- Live progress bars with glow effects on active streams
- Batch payroll interface with add/remove recipients
- Native asset selector showing Polkadot precompile addresses
- Protocol analytics dashboard
- RainbowKit wallet connection

---

## Stream NFT Receipts

PolkaStream's unique innovation: every stream position is a transferable NFT.

When a stream is created via `StreamNFT.sol`, an ERC-721 token is minted to the recipient. This NFT **is** the stream — whoever holds the NFT has the right to withdraw earned tokens.

**Transfer the NFT → Transfer the income stream.**

| Use Case | How It Works |
|----------|-------------|
| Sell future salary | List your salary stream NFT on any marketplace |
| DeFi collateral | Use vesting NFT as collateral in lending protocols |
| Gift payments | Transfer the NFT to gift someone a payment stream |
| Derivatives | Build options/futures on stream positions |

Each NFT has **fully on-chain SVG metadata** — no IPFS dependency. The SVG dynamically renders stream amount, progress, status, and label from contract state.

```solidity
// Only the NFT holder can withdraw
function withdraw(uint256 streamId) external {
    require(ownerOf(streamId) == msg.sender, "Not NFT owner");
    // ... earned tokens transfer to NFT holder
}
```

---

## Live Deployment

All contracts deployed on **Polkadot Hub Testnet** (Paseo Asset Hub, Chain ID 420420417):

| Contract | Address | Explorer |
|----------|---------|----------|
| PolkaStreamNative | `0x565dc3183e537b17c1592a7bbcf1de237cf76094` | [View ↗](https://blockscout-testnet.polkadot.io/address/0x565dc3183e537b17c1592a7bbcf1de237cf76094) |
| StreamNFT | `0x09f48b51077bf8aed7649759830bae78acf29cf4` | [View ↗](https://blockscout-testnet.polkadot.io/address/0x09f48b51077bf8aed7649759830bae78acf29cf4) |
| StreamToken (psUSD) | `0xa223258921ea6b0e17f82b57c2bff7b51a33fbdf` | [View ↗](https://blockscout-testnet.polkadot.io/address/0xa223258921ea6b0e17f82b57c2bff7b51a33fbdf) |

**Network:** Polkadot Hub Testnet · Chain ID: 420420417 · RPC: `https://eth-rpc-testnet.polkadot.io/`

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

### StreamNFT (Transferable Positions)

| Function | Description |
|----------|-------------|
| `createStream(recipient, token, amount, duration, label)` | Create stream + mint NFT |
| `createCliffStream(recipient, token, amount, duration, cliff, label)` | Cliff stream + NFT |
| `createBatchStreams(recipients[], amounts[], token, duration, label)` | Batch + NFTs |
| `withdraw(streamId)` | NFT holder withdraws earned tokens |
| `cancel(streamId)` | Original sender cancels stream |
| `tokenURI(streamId)` | On-chain SVG metadata |
| `transferFrom(from, to, streamId)` | Transfer stream position (ERC-721) |

---

## Project Structure

```
PolkaStream/
├── contracts/
│   ├── PolkaStream.sol          # Core streaming protocol
│   ├── PolkaStreamNative.sol    # Polkadot-native extensions (ERC-20 + XCM precompiles)
│   ├── StreamNFT.sol            # Transferable stream positions as ERC-721
│   ├── IXcm.sol                 # XCM precompile interface
│   └── StreamToken.sol          # Test ERC-20 token
├── frontend/
│   └── src/
│       ├── App.tsx              # Dashboard with live streaming, batch payroll, analytics
│       ├── config.ts            # Contract addresses and ABIs
│       ├── main.tsx             # Wagmi + RainbowKit provider
│       └── index.css            # Dark theme with Space Grotesk + JetBrains Mono
├── scripts/
│   ├── deploy.ts                # Deploy all contracts to Polkadot Hub
│   └── test-stream.ts           # On-chain integration test
├── test/
│   └── PolkaStream.ts           # 32 comprehensive tests
└── hardhat.config.ts            # Hardhat v3 + viaIR + Polkadot Hub network
```

---

## Security Considerations

- **ReentrancyGuard** on all state-changing functions (OpenZeppelin)
- **SafeERC20** for all token transfers — handles non-standard return values
- **ERC721Enumerable** for NFT position tracking (OpenZeppelin)
- **Integer math** checked by Solidity 0.8.28 default overflow protection
- **Access control** — only stream sender can cancel, only NFT holder can withdraw
- **No proxy pattern** — immutable deployment, no upgrade risk
- Stream funds are held by the contract, not by any admin

---

## Roadmap

**Phase 1 — Hackathon (Current)**
- Core streaming protocol with linear and cliff streams
- Native asset integration via ERC-20 precompile
- XCM notification infrastructure
- Stream NFT receipts with on-chain SVG
- Batch payroll for DAOs
- Frontend with live streaming visualization and analytics

**Phase 2 — Post-Hackathon**
- NFT marketplace integration for trading stream positions
- Multi-token streams (stream multiple assets in one stream)
- Scheduled streams via XCM Transact
- Mainnet deployment on Polkadot Hub

**Phase 3 — Protocol Growth**
- SDK for other dApps to integrate streaming payments
- Governance module for protocol parameters
- Cross-chain streams via XCM execute
- Stream position derivatives and lending integration

---

## Tech Stack

- **Smart Contracts**: Solidity 0.8.28, OpenZeppelin 5.x (ERC721, ReentrancyGuard, SafeERC20)
- **NFT Metadata**: Fully on-chain SVG generation (Base64 encoded, no IPFS)
- **Framework**: Hardhat v3 with viaIR compilation
- **Frontend**: React 18, TypeScript, viem, wagmi, RainbowKit
- **Styling**: Custom CSS with Space Grotesk + JetBrains Mono
- **Network**: Polkadot Hub Testnet (Paseo Asset Hub, Chain ID 420420417)
- **Precompiles**: ERC-20 (native assets), XCM (cross-chain messaging)
- **Hosting**: Vercel

---

## Hackathon

**Polkadot Solidity Hackathon 2026**
- **Tracks**: Track 1 (EVM Smart Contract) · Track 2 (PVM — Native Assets + Precompiles) · OpenZeppelin Sponsor Track
- **Builder**: [SohamJuneja](https://github.com/SohamJuneja)

---

## License

MIT