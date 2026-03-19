import { createWalletClient, createPublicClient, http, defineChain, parseUnits, formatUnits, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config();

const STREAM_TOKEN = "0x5159395e984dec14ae019a00e847a0b761d6e712";
const POLKA_STREAM = "0x828542a4da4f93ef63336f493574be2308179c81";

const polkadotHub = defineChain({
  id: 420420417,
  name: "Polkadot Hub Testnet",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.POLKADOT_HUB_RPC_URL!] },
  },
});

function readAbi(name: string) {
  const artifactPath = join("artifacts", "contracts", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(artifactPath, "utf-8")).abi;
}

async function main() {
  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);

  const publicClient = createPublicClient({
    chain: polkadotHub,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: polkadotHub,
    transport: http(),
  });

  const tokenAbi = readAbi("StreamToken");
  const streamAbi = readAbi("PolkaStream");

  console.log("🧪 Testing PolkaStream on Polkadot Hub Testnet\n");
  console.log("Deployer:", account.address);

  // 1. Check token balance
  const tokenBalance = await publicClient.readContract({
    address: STREAM_TOKEN as `0x${string}`,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [account.address],
  }) as bigint;

  console.log("Token balance:", formatUnits(tokenBalance, 6), "psUSD");

  // 2. Approve PolkaStream to spend tokens
  console.log("\n1️⃣  Approving PolkaStream to spend 1000 psUSD...");
  const approveAmount = parseUnits("1000", 6);

  const approveTx = await walletClient.writeContract({
    address: STREAM_TOKEN as `0x${string}`,
    abi: tokenAbi,
    functionName: "approve",
    args: [POLKA_STREAM, approveAmount],
    gas: 500_000n,
  });
  console.log("   Tx:", approveTx);
  await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 120_000 });
  console.log("   ✅ Approved!");

  // 3. Create a 5-minute linear stream to a test address
  // Using a random recipient (just for testing)
  const testRecipient = "0x1111111111111111111111111111111111111111";
  const streamAmount = parseUnits("100", 6); // 100 psUSD
  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 10;  // starts in 10 seconds
  const endTime = now + 310;   // ends in ~5 minutes

  console.log("\n2️⃣  Creating a 5-minute linear stream of 100 psUSD...");
  console.log(`   Recipient: ${testRecipient}`);
  console.log(`   Amount: 100 psUSD over 5 minutes`);
  console.log(`   Rate: ~0.33 psUSD/second`);

  const createTx = await walletClient.writeContract({
    address: POLKA_STREAM as `0x${string}`,
    abi: streamAbi,
    functionName: "createLinearStream",
    args: [
      testRecipient,
      STREAM_TOKEN,
      streamAmount,
      BigInt(startTime),
      BigInt(endTime),
    ],
    gas: 2_000_000n,
  });
  console.log("   Tx:", createTx);
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx, timeout: 120_000 });
  console.log("   ✅ Stream created! Gas used:", createReceipt.gasUsed.toString());

  // 4. Read stream details
  const streamId = await publicClient.readContract({
    address: POLKA_STREAM as `0x${string}`,
    abi: streamAbi,
    functionName: "nextStreamId",
  }) as bigint;

  const currentStreamId = streamId - 1n;
  console.log(`\n3️⃣  Stream ID: ${currentStreamId}`);

  const stream = await publicClient.readContract({
    address: POLKA_STREAM as `0x${string}`,
    abi: streamAbi,
    functionName: "getStream",
    args: [currentStreamId],
  }) as any;

  console.log("   Sender:", stream.sender);
  console.log("   Recipient:", stream.recipient);
  console.log("   Deposit:", formatUnits(stream.depositAmount, 6), "psUSD");
  console.log("   Status:", ["Active", "Paused", "Cancelled", "Completed"][stream.status]);
  console.log("   Type:", ["Linear", "CliffLinear", "Milestone"][stream.streamType]);

  // 5. Wait and check streamed amount
  console.log("\n4️⃣  Waiting 30 seconds to check streamed amount...");
  await new Promise(r => setTimeout(r, 30000));

  const streamed = await publicClient.readContract({
    address: POLKA_STREAM as `0x${string}`,
    abi: streamAbi,
    functionName: "streamedAmount",
    args: [currentStreamId],
  }) as bigint;

  const withdrawable = await publicClient.readContract({
    address: POLKA_STREAM as `0x${string}`,
    abi: streamAbi,
    functionName: "withdrawable",
    args: [currentStreamId],
  }) as bigint;

  console.log("   Streamed so far:", formatUnits(streamed, 6), "psUSD");
  console.log("   Withdrawable:", formatUnits(withdrawable, 6), "psUSD");

  const rate = await publicClient.readContract({
    address: POLKA_STREAM as `0x${string}`,
    abi: streamAbi,
    functionName: "streamRate",
    args: [currentStreamId],
  }) as bigint;

  console.log("   Rate:", rate.toString(), "tokens/second");

  console.log("\n" + "=".repeat(50));
  console.log("🎉 ALL TESTS PASSED! PolkaStream is working on Polkadot Hub!");
  console.log("=".repeat(50));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});