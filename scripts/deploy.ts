import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config();

const polkadotHub = defineChain({
  id: 420420417,
  name: "Polkadot Hub Testnet",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.POLKADOT_HUB_RPC_URL!] },
  },
});

async function main() {
  console.log("🚀 Deploying PolkaStream to Polkadot Hub Testnet...\n");

  const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
  console.log("📋 Deployer:", account.address);

  const publicClient = createPublicClient({
    chain: polkadotHub,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: polkadotHub,
    transport: http(),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("💰 Balance:", Number(balance / 10n**15n) / 1000, "PAS\n");

  // Helper to read compiled artifacts
  function readArtifact(name: string) {
    const artifactPath = join("artifacts", "contracts", `${name}.sol`, `${name}.json`);
    return JSON.parse(readFileSync(artifactPath, "utf-8"));
  }

  // Helper to deploy a contract
  async function deploy(name: string, constructorArgs?: any[]) {
    console.log(`   Deploying ${name}...`);
    const artifact = readArtifact(name);

    let bytecode = artifact.bytecode as `0x${string}`;

    // Encode constructor args if any
    if (constructorArgs && constructorArgs.length > 0) {
      const { ethers } = await import("ethers");
      const iface = new ethers.Interface(artifact.abi);
      const encoded = iface.encodeDeploy(constructorArgs);
      bytecode = (bytecode + encoded.slice(2)) as `0x${string}`;
    }

    const txHash = await walletClient.sendTransaction({
      data: bytecode,
      gas: 10_000_000n,
    });

    console.log(`   Tx hash: ${txHash}`);
    console.log(`   Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 120_000,
    });

    console.log(`   ✅ ${name} deployed at: ${receipt.contractAddress}`);
    return receipt.contractAddress!;
  }

  // 1. Deploy StreamToken
  console.log("1️⃣  Deploying StreamToken (test USDC)...");
  const tokenAddress = await deploy("StreamToken", ["PolkaStream USD", "psUSD", 6]);

  console.log("\n2️⃣  Deploying PolkaStreamNative...");
  const streamAddress = await deploy("PolkaStreamNative", []);

  // 3. Summary
  console.log("\n" + "=".repeat(50));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(50));
  console.log(`StreamToken (psUSD): ${tokenAddress}`);
  console.log(`PolkaStream:         ${streamAddress}`);
  console.log("=".repeat(50));
  console.log("\nSave these addresses! You'll need them for the frontend.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});