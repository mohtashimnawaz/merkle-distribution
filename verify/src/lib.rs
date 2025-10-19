use solana_program::hash::hashv;

/// modified version of https://github.com/saber-hq/merkle-distributor/blob/ac937d1901033ecb7fa3b0db22f7b39569c8e052/programs/merkle-distributor/src/merkle_proof.rs#L8
/// This function deals with verification of Merkle trees (hash trees).
/// Direct port of https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v3.4.0/contracts/cryptography/MerkleProof.sol
/// Returns true if a `leaf` can be proved to be a part of a Merkle tree
/// defined by `root`. For this, a `proof` must be provided, containing
/// sibling hashes on the branch from the leaf to the root of the tree. Each
/// pair of leaves and each pair of pre-images are assumed to be sorted.
pub fn verify(proof: Vec<[u8; 32]>, root: [u8; 32], leaf: [u8; 32]) -> bool {
    use solana_program::msg;
    
    msg!("=== VERIFY START ===");
    msg!("Root: {:?}", root);
    msg!("Leaf: {:?}", leaf);
    msg!("Proof length: {}", proof.len());
    
    let mut computed_hash = leaf;
    for (i, proof_element) in proof.into_iter().enumerate() {
        msg!("Step {}: computed={:?}, proof={:?}", i, computed_hash, proof_element);
        if computed_hash <= proof_element {
            // Hash(current computed hash + current element of the proof)
            computed_hash = hashv(&[&[1u8], &computed_hash, &proof_element]).to_bytes();
            msg!("  Using order: computed, proof");
        } else {
            // Hash(current element of the proof + current computed hash)
            computed_hash = hashv(&[&[1u8], &proof_element, &computed_hash]).to_bytes();
            msg!("  Using order: proof, computed");
        }
        msg!("  Result: {:?}", computed_hash);
    }
    msg!("Final computed: {:?}", computed_hash);
    msg!("Match: {}", computed_hash == root);
    
    // Check if the computed hash (root) is equal to the provided root
    computed_hash == root
}
