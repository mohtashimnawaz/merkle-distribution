import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { sha256 } from "@noble/hashes/sha256";

// Test if our hash implementation matches Solana's hashv
function testHash() {
  // Example claimant
  const claimant = new PublicKey("CtY2dt7zbkanksTeo89yTi4Evcc2DN1RgTMoARhqLnEX");
  const amountUnlocked = 10_000_000_000_000; // 10M tokens with 6 decimals
  const amountLocked = 0;
  
  console.log("Testing hash computation:");
  console.log("Claimant:", claimant.toBase58());
  console.log("Claimant bytes:", Buffer.from(claimant.toBytes()).toString("hex"));
  console.log("Amount unlocked:", amountUnlocked);
  console.log("Amount locked:", amountLocked);
  
  const amountUnlockedBytes = Buffer.alloc(8);
  amountUnlockedBytes.writeBigUInt64LE(BigInt(amountUnlocked));
  console.log("Amount unlocked bytes:", amountUnlockedBytes.toString("hex"));
  
  const amountLockedBytes = Buffer.alloc(8);
  amountLockedBytes.writeBigUInt64LE(BigInt(amountLocked));
  console.log("Amount locked bytes:", amountLockedBytes.toString("hex"));
  
  // Inner hash: sha256(claimant || unlocked || locked)
  const innerHash = Buffer.from(sha256(Buffer.concat([
    claimant.toBuffer(),
    amountUnlockedBytes,
    amountLockedBytes,
  ])));
  console.log("\nInner hash:", innerHash.toString("hex"));
  
  // Leaf hash: sha256([0] || inner_hash)
  const leafPrefix = Buffer.from([0]);
  const leafHash = Buffer.from(sha256(Buffer.concat([
    leafPrefix,
    innerHash,
  ])));
  console.log("Leaf hash:", leafHash.toString("hex"));
  
  // Test intermediate hash (with prefix [1])
  const intermediatePrefix = Buffer.from([1]);
  const left = leafHash;
  const right = leafHash;
  const intermediateHash = Buffer.from(sha256(Buffer.concat([
    intermediatePrefix,
    left,
    right,
  ])));
  console.log("\nIntermediate hash (leaf || leaf):", intermediateHash.toString("hex"));
}

testHash();
