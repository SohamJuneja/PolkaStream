import { defineChain } from "viem";

export const polkadotHubTestnet = defineChain({
  id: 420420417,
  name: "Polkadot Hub Testnet",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://eth-rpc-testnet.polkadot.io/"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://blockscout-testnet.polkadot.io",
    },
  },
  testnet: true,
});

export const CONTRACTS = {
  streamToken: "0xa223258921ea6b0e17f82b57c2bff7b51a33fbdf" as const,
  polkaStream: "0x565dc3183e537b17c1592a7bbcf1de237cf76094" as const,
  streamNFT: "0x09f48b51077bf8aed7649759830bae78acf29cf4" as const,
};

export const STREAM_TOKEN_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const POLKA_STREAM_ABI = [
  {
    inputs: [
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "depositAmount", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
    ],
    name: "createLinearStream",
    outputs: [{ name: "streamId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "depositAmount", type: "uint256" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "cliffTime", type: "uint256" },
    ],
    name: "createCliffStream",
    outputs: [{ name: "streamId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "withdraw",
    outputs: [{ name: "amount", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "cancel",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "getStream",
    outputs: [
      {
        components: [
          { name: "sender", type: "address" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "depositAmount", type: "uint256" },
          { name: "withdrawnAmount", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "cliffTime", type: "uint256" },
          { name: "lastWithdrawTime", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "streamType", type: "uint8" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "withdrawable",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "streamedAmount",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "streamId", type: "uint256" }],
    name: "streamRate",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "sender", type: "address" }],
    name: "getSenderStreams",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "recipient", type: "address" }],
    name: "getRecipientStreams",
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "nextStreamId",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getRegisteredAssets",
    outputs: [
      {
        components: [
          { name: "assetId", type: "uint32" },
          { name: "precompile", type: "address" },
          { name: "symbol", type: "string" },
          { name: "decimals", type: "uint8" },
          { name: "active", type: "bool" },
        ],
        name: "assets",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "token", type: "address" }],
    name: "isNativeAsset",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "xcmNotificationsEnabled",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;