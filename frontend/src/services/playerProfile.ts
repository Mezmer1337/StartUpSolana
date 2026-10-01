import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/**
 * Browser client for programs/player_profile (course week 6) — the
 * decentralized profile: read straight from the chain, never through the
 * backend. Instruction and account layouts follow target/idl/player_profile.json
 * (Anchor: 8-byte discriminator, then Borsh fields).
 */

export const PLAYER_PROFILE_PROGRAM_ID = new PublicKey(
  (import.meta.env.VITE_PLAYER_PROFILE_PROGRAM_ID as string) || "CP6Fmq98dsLrpev7EjEVvuGQ1z2aG9H7vAuDiRPDnYkB"
);

// sha256("global:<instruction>")[..8] / sha256("account:<Account>")[..8], copied from the IDL.
const CREATE_PROFILE = [225, 205, 234, 143, 17, 186, 50, 220];
const UPDATE_BIO = [201, 29, 45, 117, 230, 37, 55, 183];
const PLAYER_PROFILE_ACCOUNT = [82, 226, 99, 87, 164, 130, 181, 80];
const USERNAME_RECORD_ACCOUNT = [42, 172, 136, 41, 240, 123, 100, 204];
const PET_RECORD_ACCOUNT_OFFSET_NAME = 8 + 32 + 32; // petnft PetRecord: discriminator, mint, owner, name…

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const MAX_BIO_BYTES = 160;
/** 8 + PlayerProfile::INIT_SPACE and 8 + UsernameRecord::INIT_SPACE. */
export const PROFILE_ACCOUNT_SIZE = 8 + 32 + (4 + 20) + (4 + 160) + (1 + 32) + 8 + 8 + 1;
export const USERNAME_ACCOUNT_SIZE = 8 + 32 + 1;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export const profileAddress = (wallet: PublicKey) =>
  PublicKey.findProgramAddressSync([utf8.encode("profile"), wallet.toBytes()], PLAYER_PROFILE_PROGRAM_ID)[0];

export const usernameAddress = (username: string) =>
  PublicKey.findProgramAddressSync([utf8.encode("username"), utf8.encode(username)], PLAYER_PROFILE_PROGRAM_ID)[0];

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Borsh String: u32 little-endian byte length, then UTF-8 bytes. */
function borshString(value: string): Uint8Array {
  const bytes = utf8.encode(value);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, bytes.length, true);
  return concat(len, bytes);
}

class Reader {
  private offset = 0;
  private data: Uint8Array;
  private view: DataView;
  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  bytes(n: number) {
    const out = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  pubkey() {
    return new PublicKey(this.bytes(32));
  }
  string() {
    const len = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return fromUtf8.decode(this.bytes(len));
  }
  u8() {
    return this.data[this.offset++];
  }
  i64() {
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return Number(value);
  }
}

function hasDiscriminator(data: Uint8Array, discriminator: number[]) {
  return discriminator.every((byte, i) => data[i] === byte);
}

export interface OnchainProfile {
  address: PublicKey;
  authority: PublicKey;
  username: string;
  bio: string;
  featuredPet: PublicKey | null;
  createdAt: Date;
  updatedAt: Date;
}

export function decodeProfile(address: PublicKey, data: Uint8Array): OnchainProfile {
  if (!hasDiscriminator(data, PLAYER_PROFILE_ACCOUNT)) throw new Error("Not a PlayerProfile account");
  const r = new Reader(data);
  r.bytes(8);
  const authority = r.pubkey();
  const username = r.string();
  const bio = r.string();
  const featuredPet = r.u8() === 1 ? r.pubkey() : null;
  const createdAt = new Date(r.i64() * 1000);
  const updatedAt = new Date(r.i64() * 1000);
  return { address, authority, username, bio, featuredPet, createdAt, updatedAt };
}

export async function fetchProfile(connection: Connection, wallet: PublicKey): Promise<OnchainProfile | null> {
  const address = profileAddress(wallet);
  const account = await connection.getAccountInfo(address);
  if (!account) return null;
  if (!account.owner.equals(PLAYER_PROFILE_PROGRAM_ID)) throw new Error("Profile PDA is owned by another program");
  return decodeProfile(address, account.data);
}

/** Who holds `username` (UsernameRecord PDA -> authority), or null if it's free. */
export async function fetchUsernameOwner(connection: Connection, username: string): Promise<PublicKey | null> {
  const account = await connection.getAccountInfo(usernameAddress(username));
  if (!account || !hasDiscriminator(account.data, USERNAME_RECORD_ACCOUNT)) return null;
  return new PublicKey(account.data.subarray(8, 40));
}

/** Name of a petnft PetRecord (the featured pet), read from that program's account. */
export async function fetchPetRecordName(connection: Connection, petRecord: PublicKey): Promise<string | null> {
  const account = await connection.getAccountInfo(petRecord);
  if (!account) return null;
  const r = new Reader(account.data);
  r.bytes(PET_RECORD_ACCOUNT_OFFSET_NAME);
  return r.string();
}

// web3.js types instruction data as Node's Buffer; a Uint8Array works the same
// at runtime and avoids pulling a Buffer polyfill into the browser bundle.
const asData = (bytes: Uint8Array) => bytes as unknown as TransactionInstruction["data"];

export function createProfileInstruction(authority: PublicKey, username: string, bio: string) {
  return new TransactionInstruction({
    programId: PLAYER_PROFILE_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: profileAddress(authority), isSigner: false, isWritable: true },
      { pubkey: usernameAddress(username), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: asData(concat(CREATE_PROFILE, borshString(username), borshString(bio))),
  });
}

export function updateBioInstruction(authority: PublicKey, bio: string) {
  return new TransactionInstruction({
    programId: PLAYER_PROFILE_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: profileAddress(authority), isSigner: false, isWritable: true },
    ],
    data: asData(concat(UPDATE_BIO, borshString(bio))),
  });
}
