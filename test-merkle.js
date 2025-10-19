const { sha256 } = require('@noble/hashes/sha256');
const { PublicKey } = require('@solana/web3.js');

// Test claimants from the test
const claimants = [
  "Div36pdRGJ6E7L1k962ZoaCYmZRRyq2oNmWa1JKAzNKU",
  "7VFjhA3H2gzN3z8fYx9D2mCGJq8XhVvK3pZLnRbCzEy5",  // Need actual values from test
  "8WjhB4C3gzP4A9fZy0E3nDHKr9YiWwL4qApMoScDzFz6"   // Need actual values from test
];

function hashLeaf(claimant, unlocked, locked) {
  const claimantBytes = new PublicKey(claimant).toBytes();
  const unlockedBytes = Buffer.alloc(8);
  unlockedBytes.writeBigUInt64LE(BigInt(unlocked));
  const lockedBytes = Buffer.alloc(8);
  lockedBytes.writeBigUInt64LE(BigInt(locked));
  
  const innerHash = sha256(Buffer.concat([claimantBytes, unlockedBytes, lockedBytes]));
  const leafHash = sha256(Buffer.concat([Buffer.from([0]), innerHash]));
  
  return Buffer.from(leafHash);
}

function hashInternal(first, second) {
  if (!second) return first;
  
  const sorted = first.compare(second) <= 0 ? [first, second] : [second, first];
  return Buffer.from(sha256(Buffer.concat([Buffer.from([1]), sorted[0], sorted[1]])));
}

function verify(proof, root, leaf) {
  let node = leaf;
  console.log(`Starting with leaf: ${node.toString('hex')}`);
  
  for (let i = 0; i < proof.length; i++) {
    const proofElement = proof[i];
    console.log(`\nStep ${i + 1}:`);
    console.log(`  Current: ${node.toString('hex')}`);
    console.log(`  Proof[${i}]: ${proofElement.toString('hex')}`);
    
    if (node.compare(proofElement) <= 0) {
      node = Buffer.from(sha256(Buffer.concat([Buffer.from([1]), node, proofElement])));
      console.log(`  Hashing: hash([1], current, proof[${i}])`);
    } else {
      node = Buffer.from(sha256(Buffer.concat([Buffer.from([1]), proofElement, node])));
      console.log(`  Hashing: hash([1], proof[${i}], current)`);
    }
    console.log(`  Result: ${node.toString('hex')}`);
  }
  
  console.log(`\nFinal hash: ${node.toString('hex')}`);
  console.log(`Expected root: ${root.toString('hex')}`);
  console.log(`Match: ${node.equals(root)}`);
  
  return node.equals(root);
}

// Test with 3 claimants
const leaf0 = hashLeaf(claimants[0], 10_000_000 * 1e6, 0);
console.log(`Leaf 0: ${leaf0.toString('hex')}`);

// Generate fake leaves for now
const leaf1 = Buffer.from('6d277658c5d890646babda3946a350d10dd832d56aa3c504899a0528de355e1f', 'hex');
const leaf2 = Buffer.from('ac79e71bd7e783d719da214cca55d26dcf82ad869a9912104f25ce4c6eff759c', 'hex');

console.log(`Leaf 1: ${leaf1.toString('hex')}`);
console.log(`Leaf 2: ${leaf2.toString('hex')}`);

// Build tree
const h01 = hashInternal(leaf0, leaf1);
console.log(`\nHash(leaf0, leaf1): ${h01.toString('hex')}`);

const level1 = [h01, leaf2];  // leaf2 carried forward
console.log(`Level 1: [${h01.toString('hex')}, ${leaf2.toString('hex')}]`);

const root = hashInternal(h01, leaf2);
console.log(`\nRoot: ${root.toString('hex')}`);

// Test proof for leaf0
const proof = [leaf1, leaf2];
console.log(`\nProof for leaf0: [${leaf1.toString('hex')}, ${leaf2.toString('hex')}]`);

console.log('\n=== Verification ===');
verify(proof, root, leaf0);
