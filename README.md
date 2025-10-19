# SKY0 Token Distribution via Merkle Tree

A production-ready Proof of Concept for distributing SKY0 tokens to users based on earned points using Merkle tree claims, powered by the battle-tested [jito-foundation/distributor](https://github.com/jito-foundation/distributor).

## 📋 Overview

This POC demonstrates an end-to-end token distribution system where:
- **1 billion SKY0 tokens** are minted with frozen mint authority
- **~100 million tokens per period** are distributed monthly
- **Users claim proportional to points** earned via Merkle proofs
- **Trustless and scalable** - no centralized distribution, supports 10k+ users

## 🏗️ Architecture

```
┌─────────────────────┐
│   Leaderboard Data  │ (Off-chain)
│  User | Points      │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────┐
│  Merkle Tree Builder │ (Off-chain script)
│  - Compute amounts   │
│  - Build tree        │
│  - Generate proofs   │
└──────────┬───────────┘
           │
           ▼ (Submit root)
┌──────────────────────────┐
│ Merkle Distributor (BPF) │ (On-chain Solana program)
│  - Verify proofs         │
│  - Track claims          │
│  - Transfer tokens       │
└──────────────────────────┘
           │
           ▼ (User claims with proof)
┌─────────────────────┐
│   User Wallets      │
│  (Token accounts)   │
└─────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
```bash
# Rust & Solana
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor (for Solana program development)
cargo install --git https://github.com/coral-xyz/anchor --tag v0.28.0 anchor-cli

# Node.js dependencies
yarn install
```

### Build
```bash
# Build the Solana program
anchor build --no-idl

# The compiled program: target/deploy/merkle_distributor.so
```

### Test
```bash
# Run end-to-end tests on local validator
anchor test

# Tests demonstrate:
# 1. Create SKY0 mint
# 2. Initialize distributor with Merkle root
# 3. Fund vault with 100M tokens
# 4. Multiple users claim with proofs
# 5. Verify balances and state
```

## 📁 Repository Structure

```
merkle-distribution/
├── programs/
│   └── merkle-distributor/    # Jito's Anchor program (vendored)
│       ├── src/
│       │   ├── lib.rs          # Program entry point
│       │   ├── instructions/   # new_distributor, new_claim, etc.
│       │   ├── state/          # MerkleDistributor, ClaimStatus
│       │   └── error.rs
│       └── Cargo.toml
├── merkle-tree/                # Utilities for tree generation
│   └── src/
│       ├── airdrop_merkle_tree.rs
│       ├── tree_node.rs
│       └── utils.rs
├── verify/                     # Merkle proof verification
├── tests/
│   └── merkle-distribution.ts  # End-to-end integration test
├── POC_SUMMARY.md             # Detailed POC documentation
└── README.md                   # This file
```

## 🔑 Key Features

### 1. Merkle Distribution
- **Scalability**: Store only 32-byte root on-chain for unlimited users
- **Gas efficiency**: Users pay claim cost (~0.000005 SOL)
- **Trustless**: Cryptographic proof verification

### 2. Multi-Period Support
- Create new distributor per period (monthly)
- Independent Merkle trees per distribution
- Prevents double-claims via claim status PDAs

### 3. Vesting & Clawback
- Support for locked/vesting token schedules
- Admin can reclaim unclaimed tokens after deadline
- Configurable vesting periods

### 4. Production-Grade
- Battle-tested code (used for JTO airdrop)
- Comprehensive error handling
- Admin controls with multisig support

## 💡 How It Works

### For Admins (Distribution Setup)

1. **Export Leaderboard**
   ```csv
   pubkey,points
   7xKX...abc,1000
   9zYP...def,2000
   ```

2. **Generate Merkle Tree**
   ```typescript
   import { AirdropMerkleTree } from './merkle-tree';
   
   const allocations = computeAllocations(leaderboard, 100_000_000);
   const tree = new AirdropMerkleTree(allocations);
   tree.writeToFile('merkle_tree.json');
   ```

3. **Create Distributor On-Chain**
   ```bash
   # Call new_distributor instruction
   anchor run new-distributor --args \
     --root $(cat merkle_tree.json | jq -r .root) \
     --max-claim 100000000000000 \
     --max-nodes 10000
   ```

4. **Fund Vault**
   ```bash
   spl-token transfer <MINT> 100000000 <VAULT> --fund-recipient
   ```

5. **Publish Proofs**
   - Host `merkle_tree.json` on API or IPFS
   - Users fetch their proof and submit claim

### For Users (Claiming Tokens)

1. **Connect Wallet** (via your frontend)

2. **Fetch Proof** from your API:
   ```json
   {
     "index": 42,
     "amount": "10000000",
     "proof": ["0x1a2b...", "0x3c4d..."]
   }
   ```

3. **Submit Claim** transaction:
   ```typescript
   await program.methods
     .newClaim(amountUnlocked, amountLocked, proof)
     .accounts({
       distributor,
       claimStatus,
       from: vault,
       to: userTokenAccount,
       claimant: userWallet,
     })
     .rpc();
   ```

4. **Receive Tokens** in wallet

## 📊 Test Results

The POC includes comprehensive tests demonstrating:

✅ **Mint Creation**: SKY0 token with 6 decimals  
✅ **Distributor Setup**: Initialize with Merkle root for 3 users  
✅ **Vault Funding**: Mint 100M tokens to distributor vault  
✅ **Proportional Claims**:
   - User 0: 10M tokens (1000 points / 10000 total = 10%)
   - User 1: 20M tokens (2000 points / 10000 total = 20%)
   - User 2: 70M tokens (7000 points / 10000 total = 70%)  
✅ **State Verification**: Total claimed, nodes claimed tracked correctly  
✅ **Double-Claim Prevention**: Claim status PDA prevents re-claiming

### Build Status
- **Program Compilation**: ✅ Success (with non-fatal stack warnings)
- **Test Execution**: ✅ Success (all assertions passed)
- **Deployment**: ✅ Ready for devnet/mainnet

### Known Warnings
- Stack frame size warnings are non-fatal (jito program uses Anchor 0.28)
- IDL generation skipped (use `--no-idl` flag)
- Anchor version mismatch CLI vs program deps (intentional for compat)

## 🔐 Security Considerations

### Implemented
- ✅ Merkle proof verification prevents unauthorized claims
- ✅ Claim status PDA prevents double-claims
- ✅ Front-running protection in `new_distributor`
- ✅ Admin authority checks on sensitive operations

### Recommendations for Production
1. **Use multisig for admin** (Squads Protocol or similar)
2. **Verify distributor state** after creation (check root, amounts)
3. **Set reasonable clawback periods** (30-90 days)
4. **Monitor claim rate** and vault balance
5. **Audit Merkle tree generation** script carefully
6. **Test on devnet** before mainnet deployment

## 📚 Documentation

- **[POC_SUMMARY.md](./POC_SUMMARY.md)** - Detailed implementation notes
- **[Jito Distributor](https://github.com/jito-foundation/distributor)** - Upstream repository
- **[Anchor Docs](https://www.anchor-lang.com/)** - Solana program framework
- **[SPL Token](https://spl.solana.com/token)** - Token program documentation

## 🛠️ Production Deployment

### 1. Deploy Program
```bash
# Build and deploy to mainnet
anchor build
solana program deploy target/deploy/merkle_distributor.so \
  --program-id <KEYPAIR> \
  --url mainnet-beta
```

### 2. Create & Freeze Mint
```bash
# Create SKY0 mint
spl-token create-token --decimals 6

# Mint total supply to admin
spl-token mint <MINT> 1000000000 <ADMIN_TOKEN_ACCOUNT>

# Freeze mint authority
spl-token authorize <MINT> mint --disable
```

### 3. For Each Period
```bash
# 1. Export leaderboard
# 2. Generate Merkle tree
# 3. Create distributor
# 4. Fund vault
# 5. Publish proofs
# 6. Announce to users
```

## 🤝 Contributing

This POC is based on the jito-foundation/distributor (GPL-3.0). Contributions should:
- Follow the upstream license
- Include tests for new features
- Update documentation

## 📄 License

GPL-3.0 (following jito-foundation/distributor)

## 🆘 Support

- Open an issue for bugs or questions
- Check POC_SUMMARY.md for detailed architecture
- Review jito-foundation/distributor docs for program details

---

**Built with ❤️ using Anchor, Solana, and Jito Foundation's battle-tested Merkle distributor**
