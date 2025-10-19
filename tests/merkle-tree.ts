import { sha256 } from '@noble/hashes/sha256';

export class MerkleTree {
  leafs: Buffer[];
  layers: Buffer[][];

  constructor(leafs: Buffer[]) {
    this.leafs = leafs.slice();
    this.layers = [];

    let hashes = this.leafs.map(MerkleTree.nodeHash);
    while (hashes.length > 0) {
      this.layers.push(hashes.slice());
      if (hashes.length === 1) break;
      hashes = hashes.reduce((acc, cur, idx, arr) => {
        if (idx % 2 === 0) {
          const nxt = arr[idx + 1];
          acc.push(MerkleTree.internalHash(cur, nxt));
        }
        return acc;
      }, [] as Buffer[]);
    }
  }

  static sha256(...args: Buffer[]): Buffer {
    const data = Buffer.concat(args);
    return Buffer.from(sha256(data));
  }

  static nodeHash(data: Buffer): Buffer {
    // jito method: hash([0], hash(data))
    return MerkleTree.sha256(Buffer.from([0x00]), MerkleTree.sha256(data));
  }

  static internalHash(first: Buffer, second: Buffer | undefined): Buffer {
    if (!second) return first;
    const [fst, snd] = [first, second].sort(Buffer.compare);
    return MerkleTree.sha256(Buffer.from([0x01]), fst, snd);
  }

  getRoot(): Buffer {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(idx: number): Buffer[] {
    return this.layers.reduce((proof, layer) => {
      const sibling = idx ^ 1;
      if (sibling < layer.length) {
        proof.push(layer[sibling]);
      }
      idx = Math.floor(idx / 2);
      return proof;
    }, [] as Buffer[]);
  }

  verifyProof(idx: number, proof: Buffer[], root: Buffer): boolean {
    let pair = MerkleTree.nodeHash(this.leafs[idx]);
    for (const item of proof) {
      pair = MerkleTree.internalHash(pair, item);
    }
    return pair.equals(root);
  }
}
