import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { assert } from "chai";
import idl from "../target/idl/merkle_distributor.json";
import { MerkleTree } from './merkle-tree';

// Simple Merkle tree helpers
function hashLeaf(claimant: PublicKey, amountUnlocked: BN, amountLocked: BN): Buffer {
  const leafPrefix = Buffer.from([0]);
  
  const amountUnlockedBytes = Buffer.alloc(8);
  amountUnlockedBytes.writeBigUInt64LE(BigInt(amountUnlocked.toString()));
  
  const amountLockedBytes = Buffer.alloc(8);
  amountLockedBytes.writeBigUInt64LE(BigInt(amountLocked.toString()));
  
  // First hash: claimant + unlocked + locked
  const innerHash = Buffer.from(sha256(Buffer.concat([
    claimant.toBuffer(),
    amountUnlockedBytes,
    amountLockedBytes,
  ])));
  
  // Second hash: leaf_prefix + inner_hash
  const data = Buffer.concat([
    leafPrefix,
    innerHash,
  ]);
  
  return Buffer.from(sha256(data));
}

function hashInternalNode(first: Buffer, second: Buffer | undefined): Buffer {
  if (!second) return first;  // Carry forward unpaired nodes
  // Sort and hash with prefix
  if (first.compare(second) <= 0) {
    return Buffer.from(sha256(Buffer.concat([Buffer.from([1]), first, second])));
  } else {
    return Buffer.from(sha256(Buffer.concat([Buffer.from([1]), second, first])));
  }
}

function getMerkleRoot(leaves: Buffer[]): Buffer {
  let hashes = leaves.slice();
  while (hashes.length > 1) {
    const nextLevel: Buffer[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const next = i + 1 < hashes.length ? hashes[i + 1] : undefined;
      nextLevel.push(hashInternalNode(hashes[i], next));
    }
    hashes = nextLevel;
  }
  return hashes[0];
}

function getMerkleProof(leaves: Buffer[], index: number): Buffer[] {
  // Build all layers first
  const layers: Buffer[][] = [leaves.slice()];
  let hashes = leaves.slice();
  
  while (hashes.length > 1) {
    const nextLevel: Buffer[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const next = i + 1 < hashes.length ? hashes[i + 1] : undefined;
      nextLevel.push(hashInternalNode(hashes[i], next));
    }
    hashes = nextLevel;
    layers.push(hashes.slice());
  }
  
  // Generate proof by collecting siblings
  const proof: Buffer[] = [];
  let idx = index;
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const sibling = idx ^ 1;  // XOR with 1 to get sibling index
    if (sibling < layer.length) {
      proof.push(layer[sibling]);
    }
    idx = Math.floor(idx / 2);
  }
  
  return proof;
}

describe("merkle-distribution (Jito POC)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey("GCPNXuyuLqQDwpyJeFctdcYpKadWzj9ipxMNbyb7JyA4");
  const program = new anchor.Program(idl as any, programId, provider);
  
  let mint: PublicKey;
  let admin: Keypair;
  let claimants: Keypair[] = [];
  let distributorPda: PublicKey;
  let tokenVault: PublicKey;
  let clawbackReceiver: PublicKey;
  
  // Store merkle tree data for reuse in claim tests
  let merkleLeaves: Buffer[] = [];
  let merkleRoot: Buffer;
  let merkleTree: MerkleTree;
  
  const PERIOD_ALLOCATION = new BN(100_000_000 * 10 ** 6);
  const VERSION = 0;
  
  before(async () => {
    admin = Keypair.generate();
    const adminAirdrop = await provider.connection.requestAirdrop(
      admin.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(adminAirdrop);
    
    for (let i = 0; i < 3; i++) {
      const claimant = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        claimant.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
      claimants.push(claimant);
    }
  });

  it("Creates SKY0 mint", async () => {
    mint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );
    
    console.log("✓ Created mint:", mint.toBase58());
    
    const versionBuffer = Buffer.alloc(8);
    versionBuffer.writeUInt32LE(VERSION, 0);
    
    [distributorPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("MerkleDistributor"),
        mint.toBuffer(),
        versionBuffer,
      ],
      program.programId
    );
    
    tokenVault = await getAssociatedTokenAddress(
      mint,
      distributorPda,
      true
    );
    
    console.log("✓ Distributor PDA:", distributorPda.toBase58());
  });

  it("Creates distributor with Merkle root", async () => {
    const clawbackReceiverAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      admin.publicKey
    );
    clawbackReceiver = clawbackReceiverAccount.address;
    
    const allocations = [
      { index: 0, claimant: claimants[0].publicKey, unlocked: new BN(10_000_000 * 10 ** 6), locked: new BN(0) },
      { index: 1, claimant: claimants[1].publicKey, unlocked: new BN(20_000_000 * 10 ** 6), locked: new BN(0) },
      { index: 2, claimant: claimants[2].publicKey, unlocked: new BN(70_000_000 * 10 ** 6), locked: new BN(0) },
    ];
    
    // Create raw leaf data (not hashed - MerkleTree will handle hashing)
    const leafData = allocations.map(a => {
      const unlockedBytes = Buffer.alloc(8);
      unlockedBytes.writeBigUInt64LE(BigInt(a.unlocked.toString()));
      const lockedBytes = Buffer.alloc(8);
      lockedBytes.writeBigUInt64LE(BigInt(a.locked.toString()));
      
      return Buffer.concat([
        a.claimant.toBuffer(),
        unlockedBytes,
        lockedBytes,
      ]);
    });
    
    // Build Merkle tree using jito's implementation
    merkleTree = new MerkleTree(leafData);
    merkleRoot = merkleTree.getRoot();
    
    // Store the tree for generating proofs later
    merkleLeaves = merkleTree.layers[0];  // First layer has the hashed leaves
    
    console.log("✓ Leaf hashes:");
    merkleLeaves.forEach((leaf, i) => {
      console.log(`  [${i}]: ${leaf.toString("hex")}`);
    });
    
    const rootArray = Array.from(merkleRoot);
    
    console.log("✓ Merkle root:", merkleRoot.toString("hex"));
    
    const now = Math.floor(Date.now() / 1000);
    const startVestingTs = now + 60; // 1 minute in the future
    const endVestingTs = startVestingTs + 365 * 24 * 60 * 60; // 1 year after start
    const clawbackStartTs = endVestingTs + 182 * 24 * 60 * 60; // 6 months after end
    
    const tx = await program.methods
      .newDistributor(
        new BN(VERSION),
        rootArray as any,
        new BN(100_000_000 * 10 ** 6),
        new BN(3),
        new BN(startVestingTs),
        new BN(endVestingTs),
        new BN(clawbackStartTs)
      )
      .accounts({
        distributor: distributorPda,
        clawbackReceiver: clawbackReceiver,
        mint: mint,
        tokenVault: tokenVault,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    
    console.log("✓ Created distributor:", tx.substring(0, 8) + "...");
    
    // Read back the distributor account to verify root was stored correctly
    const distributorAccountInfo = await program.provider.connection.getAccountInfo(distributorPda);
    if (distributorAccountInfo) {
      const data = distributorAccountInfo.data;
      console.log("Account data length:", data.length);
      console.log("Full account data (first 100 bytes):");
      for (let i = 0; i < Math.min(100, data.length); i += 16) {
        const chunk = data.slice(i, Math.min(i + 16, data.length));
        console.log(`  [${i.toString().padStart(3, ' ')}]: ${chunk.toString("hex")}`);
      }
      console.log("Expected root:", merkleRoot.toString("hex"));
    }
  });

  it("Funds the vault", async () => {
    await mintTo(
      provider.connection,
      admin,
      mint,
      tokenVault,
      admin.publicKey,
      PERIOD_ALLOCATION.toNumber()
    );
    
    const vaultInfo = await provider.connection.getTokenAccountBalance(tokenVault);
    console.log("✓ Vault balance:", vaultInfo.value.uiAmountString, "tokens");
    assert.equal(vaultInfo.value.amount, PERIOD_ALLOCATION.toString());
  });

  it("User 0 claims 10M tokens", async () => {
    const claimantIndex = 0;
    const claimant = claimants[claimantIndex];
    const amountUnlocked = new BN(10_000_000 * 10 ** 6);
    
    // Use stored merkle tree to get proof
    const proof = merkleTree.getProof(claimantIndex);
    const proofArray = proof.map(p => Array.from(p));
    
    console.log(`\n=== Claim Test for User ${claimantIndex} ===`);
    console.log(`Claimant: ${claimant.publicKey.toBase58()}`);
    console.log(`Amount unlocked: ${amountUnlocked.toString()}`);
    console.log(`Leaf hash: ${merkleLeaves[claimantIndex].toString("hex")}`);
    console.log(`Proof length: ${proof.length}`);
    proof.forEach((p, i) => console.log(`  Proof[${i}]: ${p.toString("hex")}`));
    console.log(`Stored root: ${merkleRoot.toString("hex")}`);
    
    // Verify locally
    const localVerify = merkleTree.verifyProof(claimantIndex, proof, merkleRoot);
    console.log(`Local verification: ${localVerify}`);
    
    // Compute what the program will compute
    const unlockedBytes = Buffer.alloc(8);
    unlockedBytes.writeBigUInt64LE(BigInt(amountUnlocked.toString()));
    const lockedBytes = Buffer.alloc(8);
    lockedBytes.writeBigUInt64LE(BigInt(0));
    const programInnerHash = Buffer.from(sha256(Buffer.concat([
      claimant.publicKey.toBuffer(),
      unlockedBytes,
      lockedBytes,
    ])));
    const programLeafHash = Buffer.from(sha256(Buffer.concat([Buffer.from([0]), programInnerHash])));
    console.log(`Program will compute leaf: ${programLeafHash.toString("hex")}`);
    console.log(`Match with stored: ${programLeafHash.equals(merkleLeaves[claimantIndex])}`);
    
    // Log proof bytes in detail
    console.log("\nDetailed proof bytes:");
    proofArray.forEach((p, i) => {
      console.log(`  Proof[${i}] array length: ${p.length}, first 4 bytes: [${p.slice(0, 4).join(',')}]`);
    });
    
    const claimantTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      claimant,
      mint,
      claimant.publicKey
    );
    
    const [claimStatusPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("ClaimStatus"),
        claimant.publicKey.toBuffer(),
        distributorPda.toBuffer(),
      ],
      program.programId
    );
    
    try {
      const tx = await program.methods
        .newClaim(amountUnlocked, new BN(0), proofArray as any)
        .accounts({
          distributor: distributorPda,
          claimStatus: claimStatusPda,
          from: tokenVault,
          to: claimantTokenAccount.address,
          claimant: claimant.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimant])
        .rpc();
      
      const balance = await provider.connection.getTokenAccountBalance(claimantTokenAccount.address);
      console.log("✓ User 0 claimed:", balance.value.uiAmountString, "tokens");
      assert.equal(balance.value.amount, amountUnlocked.toString());
    } catch (error) {
      console.error("\n❌ Claim failed with error:", error.message);
      if (error.logs) {
        console.error("Program logs:");
        error.logs.forEach((log: string) => console.error("  ", log));
      }
      throw error;
    }
  });

  it("User 1 claims 20M tokens", async () => {
    const claimantIndex = 1;
    const claimant = claimants[claimantIndex];
    const amountUnlocked = new BN(20_000_000 * 10 ** 6);
    
    // Use stored merkle tree to get proof
    const proof = merkleTree.getProof(claimantIndex);
    const proofArray = proof.map(p => Array.from(p));
    
    const claimantTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      claimant,
      mint,
      claimant.publicKey
    );
    
    const [claimStatusPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("ClaimStatus"),
        claimant.publicKey.toBuffer(),
        distributorPda.toBuffer(),
      ],
      program.programId
    );
    
    const tx = await program.methods
      .newClaim(amountUnlocked, new BN(0), proofArray as any)
      .accounts({
        distributor: distributorPda,
        claimStatus: claimStatusPda,
        from: tokenVault,
        to: claimantTokenAccount.address,
        claimant: claimant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([claimant])
      .rpc();
    
    const balance = await provider.connection.getTokenAccountBalance(claimantTokenAccount.address);
    console.log("✓ User 1 claimed:", balance.value.uiAmountString, "tokens");
    assert.equal(balance.value.amount, amountUnlocked.toString());
  });

  it("Verifies distributor state", async () => {
    const distributorAccount = await program.account.merkleDistributor.fetch(distributorPda);
    console.log("✓ Total claimed:", distributorAccount.totalAmountClaimed.toString(), "lamports");
    console.log("✓ Nodes claimed:", distributorAccount.numNodesClaimed.toString());
    
    const expectedClaimed = new BN(30_000_000 * 10 ** 6);
    assert.equal(distributorAccount.totalAmountClaimed.toString(), expectedClaimed.toString());
    assert.equal(distributorAccount.numNodesClaimed.toNumber(), 2);
  });
});
