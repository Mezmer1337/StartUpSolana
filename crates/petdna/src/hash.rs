use sha2::{Digest, Sha256};

/// sha256 as raw bytes — what Solana uses for PDAs, Anchor discriminators, etc.
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// sha256 as lowercase hex — what Node's `createHash("sha256").digest("hex")` returns.
pub fn sha256_hex(bytes: &[u8]) -> String {
    to_hex(&sha256(bytes))
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
