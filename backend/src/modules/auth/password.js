// Password hashing with Bun's built-in Argon2id (no native add-on to compile).
// OWASP-recommended parameters: 19 MiB memory, 2 iterations. Hashes are standard PHC strings
// ($argon2id$v=19$m=19456,t=2,p=1$…), so hashes made earlier with the argon2 npm package verify too.
const OPTIONS = { algorithm: 'argon2id', memoryCost: 19_456, timeCost: 2 };

export const hashPassword = (plain) => Bun.password.hash(plain, OPTIONS);

export async function verifyPassword(hash, plain) {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

// Used when the phone is unknown, so login takes the same time either way.
let dummyHash;
export async function burnPasswordCheck(plain) {
  dummyHash ??= await hashPassword('lowbid-timing-equalizer-0');
  await verifyPassword(dummyHash, plain);
  return false;
}
