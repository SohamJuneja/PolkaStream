import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  getAddress,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join } from "path";

// Hardhat default test accounts (well-known private keys)
const ACCOUNTS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;

const localChain = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

function readArtifact(name: string) {
  const p = join("artifacts", "contracts", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("PolkaStream Protocol", () => {
  let publicClient: any;
  let senderWallet: any;
  let recipientWallet: any;
  let senderAddress: `0x${string}`;
  let recipientAddress: `0x${string}`;
  let tokenAddress: `0x${string}`;
  let streamAddress: `0x${string}`;
  let tokenAbi: any;
  let streamAbi: any;

  before(async () => {
    const transport = http("http://127.0.0.1:8545");

    const senderAccount = privateKeyToAccount(ACCOUNTS[0]);
    const recipientAccount = privateKeyToAccount(ACCOUNTS[1]);

    senderAddress = senderAccount.address;
    recipientAddress = recipientAccount.address;

    publicClient = createPublicClient({ chain: localChain, transport });

    senderWallet = createWalletClient({
      account: senderAccount,
      chain: localChain,
      transport,
    });

    recipientWallet = createWalletClient({
      account: recipientAccount,
      chain: localChain,
      transport,
    });

    // Deploy StreamToken
    const tokenArtifact = readArtifact("StreamToken");
    tokenAbi = tokenArtifact.abi;
    const { ethers } = await import("ethers");
    const tokenIface = new ethers.Interface(tokenAbi);
    const tokenConstructor = tokenIface.encodeDeploy(["Test USD", "tUSD", 6]);
    const tokenBytecode = (tokenArtifact.bytecode + tokenConstructor.slice(2)) as `0x${string}`;

    const tokenTxHash = await senderWallet.sendTransaction({ data: tokenBytecode });
    const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenTxHash });
    tokenAddress = tokenReceipt.contractAddress!;

    // Deploy PolkaStreamNative
    const streamArtifact = readArtifact("PolkaStreamNative");
    streamAbi = streamArtifact.abi;
    const streamTxHash = await senderWallet.sendTransaction({
      data: streamArtifact.bytecode as `0x${string}`,
    });
    const streamReceipt = await publicClient.waitForTransactionReceipt({ hash: streamTxHash });
    streamAddress = streamReceipt.contractAddress!;

    // Approve tokens
    await senderWallet.writeContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: "approve",
      args: [streamAddress, parseUnits("1000000", 6)],
    });
  });

  // ============ DEPLOYMENT ============

  describe("Deployment", () => {
    it("should start with nextStreamId = 1", async () => {
      const id = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "nextStreamId",
      });
      assert.equal(id, 1n);
    });

    it("should set deployer as owner", async () => {
      const owner = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "owner",
      });
      assert.equal(getAddress(owner as string), getAddress(senderAddress));
    });

    it("should register USDt and USDC native assets", async () => {
      const assets = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getRegisteredAssets",
      }) as any[];
      assert.ok(assets.length >= 2);
      const symbols = assets.map((a: any) => a.symbol);
      assert.ok(symbols.includes("USDt"));
      assert.ok(symbols.includes("USDC"));
    });

    it("should have XCM notifications disabled", async () => {
      const enabled = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "xcmNotificationsEnabled",
      });
      assert.equal(enabled, false);
    });

    it("should mint 1M tokens to deployer", async () => {
      const bal = await publicClient.readContract({
        address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [senderAddress],
      });
      assert.equal(bal, parseUnits("1000000", 6));
    });
  });

  // ============ LINEAR STREAMS ============

  describe("Linear Streams", () => {
    let streamId: bigint;

    it("should create a linear stream", async () => {
      const now = Math.floor(Date.now() / 1000);
      const tx = await senderWallet.writeContract({
        address: streamAddress, abi: streamAbi, functionName: "createLinearStream",
        args: [recipientAddress, tokenAddress, parseUnits("1000", 6), BigInt(now + 5), BigInt(now + 305)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      assert.equal(receipt.status, "success");

      const nextId = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "nextStreamId",
      });
      streamId = (nextId as bigint) - 1n;
      assert.ok(streamId >= 1n);
    });

    it("should store correct stream data", async () => {
      const s = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getStream", args: [streamId],
      }) as any;
      assert.equal(getAddress(s.sender), getAddress(senderAddress));
      assert.equal(getAddress(s.recipient), getAddress(recipientAddress));
      assert.equal(s.depositAmount, parseUnits("1000", 6));
      assert.equal(s.withdrawnAmount, 0n);
      assert.equal(s.status, 0);
      assert.equal(s.streamType, 0);
    });

    it("should hold tokens in contract", async () => {
      const bal = await publicClient.readContract({
        address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [streamAddress],
      });
      assert.ok((bal as bigint) >= parseUnits("1000", 6));
    });

    it("should track sender streams", async () => {
      const ids = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getSenderStreams", args: [senderAddress],
      }) as bigint[];
      assert.ok(ids.includes(streamId));
    });

    it("should track recipient streams", async () => {
      const ids = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getRecipientStreams", args: [recipientAddress],
      }) as bigint[];
      assert.ok(ids.includes(streamId));
    });

    it("should return positive stream rate", async () => {
      const rate = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "streamRate", args: [streamId],
      });
      assert.ok((rate as bigint) > 0n);
    });
  });

  // ============ VALIDATION ============

  describe("Input Validation", () => {
    it("should reject zero recipient", async () => {
      const now = Math.floor(Date.now() / 1000);
      await assert.rejects(async () => {
        await senderWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "createLinearStream",
          args: ["0x0000000000000000000000000000000000000000", tokenAddress, parseUnits("100", 6), BigInt(now + 5), BigInt(now + 105)],
        });
      });
    });

    it("should reject self-streaming", async () => {
      const now = Math.floor(Date.now() / 1000);
      await assert.rejects(async () => {
        await senderWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "createLinearStream",
          args: [senderAddress, tokenAddress, parseUnits("100", 6), BigInt(now + 5), BigInt(now + 105)],
        });
      });
    });

    it("should reject zero deposit", async () => {
      const now = Math.floor(Date.now() / 1000);
      await assert.rejects(async () => {
        await senderWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "createLinearStream",
          args: [recipientAddress, tokenAddress, 0n, BigInt(now + 5), BigInt(now + 105)],
        });
      });
    });

    it("should reject end before start", async () => {
      const now = Math.floor(Date.now() / 1000);
      await assert.rejects(async () => {
        await senderWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "createLinearStream",
          args: [recipientAddress, tokenAddress, parseUnits("100", 6), BigInt(now + 100), BigInt(now + 50)],
        });
      });
    });
  });

  // ============ CLIFF STREAMS ============

  describe("Cliff Streams", () => {
    it("should create cliff+linear stream", async () => {
      const now = Math.floor(Date.now() / 1000);
      const tx = await senderWallet.writeContract({
        address: streamAddress, abi: streamAbi, functionName: "createCliffStream",
        args: [recipientAddress, tokenAddress, parseUnits("500", 6), BigInt(now + 5), BigInt(now + 605), BigInt(now + 65)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      assert.equal(receipt.status, "success");

      const nextId = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "nextStreamId",
      });
      const s = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getStream", args: [(nextId as bigint) - 1n],
      }) as any;
      assert.equal(s.streamType, 1);
      assert.ok(s.cliffTime > 0n);
    });

    it("should reject cliff after end", async () => {
      const now = Math.floor(Date.now() / 1000);
      await assert.rejects(async () => {
        await senderWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "createCliffStream",
          args: [recipientAddress, tokenAddress, parseUnits("100", 6), BigInt(now + 5), BigInt(now + 105), BigInt(now + 200)],
        });
      });
    });
  });

  // ============ CANCEL ============

  describe("Cancel Stream", () => {
    it("should cancel an active stream", async () => {
      const now = Math.floor(Date.now() / 1000);
      await senderWallet.writeContract({
        address: streamAddress, abi: streamAbi, functionName: "createLinearStream",
        args: [recipientAddress, tokenAddress, parseUnits("200", 6), BigInt(now + 5), BigInt(now + 3605)],
      });
      const nextId = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "nextStreamId",
      });
      const sid = (nextId as bigint) - 1n;

      const tx = await senderWallet.writeContract({
        address: streamAddress, abi: streamAbi, functionName: "cancel", args: [sid],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      assert.equal(receipt.status, "success");

      const s = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getStream", args: [sid],
      }) as any;
      assert.equal(s.status, 2);
    });

    it("should reject cancel from non-sender", async () => {
      const now = Math.floor(Date.now() / 1000);
      await senderWallet.writeContract({
        address: streamAddress, abi: streamAbi, functionName: "createLinearStream",
        args: [recipientAddress, tokenAddress, parseUnits("100", 6), BigInt(now + 5), BigInt(now + 3605)],
      });
      const nextId = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "nextStreamId",
      });
      const sid = (nextId as bigint) - 1n;

      await assert.rejects(async () => {
        await recipientWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "cancel", args: [sid],
        });
      });
    });
  });

  // ============ BATCH ============

  describe("Batch Streams (Payroll)", () => {
    it("should create multiple streams at once", async () => {
      const thirdAccount = privateKeyToAccount(ACCOUNTS[2]);
      const now = Math.floor(Date.now() / 1000);

      const beforeId = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "nextStreamId",
      }) as bigint;

      const tx = await senderWallet.writeContract({
        address: streamAddress, abi: streamAbi, functionName: "createBatchStreams",
        args: [
          [recipientAddress, thirdAccount.address],
          [parseUnits("100", 6), parseUnits("200", 6)],
          tokenAddress,
          BigInt(now + 5),
          BigInt(now + 605),
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      assert.equal(receipt.status, "success");

      const afterId = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "nextStreamId",
      }) as bigint;
      assert.equal(afterId - beforeId, 2n, "Should create exactly 2 streams");
    });

    it("should reject mismatched arrays", async () => {
      const now = Math.floor(Date.now() / 1000);
      await assert.rejects(async () => {
        await senderWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "createBatchStreams",
          args: [
            [recipientAddress],
            [parseUnits("100", 6), parseUnits("200", 6)],
            tokenAddress,
            BigInt(now + 5),
            BigInt(now + 605),
          ],
        });
      });
    });
  });

  // ============ NATIVE ASSET REGISTRY ============

  describe("Native Asset Registry (Polkadot)", () => {
    it("should map USDt (1984) to correct precompile", async () => {
      const addr = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getNativeAssetAddress", args: [1984],
      });
      assert.equal(getAddress(addr as string), getAddress("0x000007c000000000000000000000000001200000"));
    });

    it("should map USDC (1337) to correct precompile", async () => {
      const addr = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getNativeAssetAddress", args: [1337],
      });
      assert.equal(getAddress(addr as string), getAddress("0x0000053900000000000000000000000001200000"));
    });

    it("should identify native asset addresses", async () => {
      const yes = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "isNativeAsset",
        args: ["0x000007c000000000000000000000000001200000"],
      });
      assert.equal(yes, true);
    });

    it("should not flag non-native tokens", async () => {
      const no = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "isNativeAsset", args: [tokenAddress],
      });
      assert.equal(no, false);
    });

    it("should list all registered assets", async () => {
      const assets = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getRegisteredAssets",
      }) as any[];
      assert.ok(assets.length >= 2);
    });
  });

  // ============ EDGE CASES ============

  describe("Edge Cases", () => {
    it("should reject withdraw on nonexistent stream", async () => {
      await assert.rejects(async () => {
        await recipientWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "withdraw", args: [999n],
        });
      });
    });

    it("should reject cancel on nonexistent stream", async () => {
      await assert.rejects(async () => {
        await senderWallet.writeContract({
          address: streamAddress, abi: streamAbi, functionName: "cancel", args: [999n],
        });
      });
    });

    it("should return 0 withdrawable for cancelled stream", async () => {
      const ids = await publicClient.readContract({
        address: streamAddress, abi: streamAbi, functionName: "getSenderStreams", args: [senderAddress],
      }) as bigint[];

      for (const id of ids) {
        const s = await publicClient.readContract({
          address: streamAddress, abi: streamAbi, functionName: "getStream", args: [id],
        }) as any;
        if (s.status === 2) {
          const w = await publicClient.readContract({
            address: streamAddress, abi: streamAbi, functionName: "withdrawable", args: [id],
          });
          assert.equal(w, 0n);
          return;
        }
      }
      assert.ok(true);
    });
  });
});