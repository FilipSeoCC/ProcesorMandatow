import "server-only";
import { createHash } from "node:crypto";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const commonPasswords = new Set([
  "123456789012",
  "password1234",
  "qwerty123456",
  "administrator",
  "admin12345678",
  "flotaflow123",
  "haslo1234567",
]);

export async function validateNewPassword(password: string): Promise<string | null> {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Hasło musi mieć minimum ${PASSWORD_MIN_LENGTH} znaków.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Hasło może mieć maksymalnie ${PASSWORD_MAX_LENGTH} znaków.`;
  if (commonPasswords.has(password.toLocaleLowerCase("pl-PL")))
    return "To hasło jest zbyt łatwe do odgadnięcia. Użyj unikalnej frazy hasłowej.";

  // HIBP Pwned Passwords uses k-anonymity: only the first five characters of
  // the SHA-1 hash leave our server. The password itself is never transmitted.
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "FlotaFlow-password-check",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`HIBP HTTP ${response.status}`);
    const leaked = (await response.text())
      .split(/\r?\n/)
      .some((line) => line.slice(0, 35).toUpperCase() === suffix);
    if (leaked)
      return "To hasło wystąpiło w publicznym wycieku danych. Ustaw inne, unikalne hasło.";
  } catch (reason) {
    // Availability of an external service must not lock every user out. The
    // local length/common-password rules and Supabase policy still apply.
    console.error("Pwned Passwords check unavailable", reason);
  }
  return null;
}
