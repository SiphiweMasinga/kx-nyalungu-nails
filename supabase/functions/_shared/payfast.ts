// PayFast helpers shared by kx-api (starting a payment) and payfast-itn (confirming it).
// Docs: https://developers.payfast.co.za/docs#step_2_signature
import { crypto as stdCrypto } from "jsr:@std/crypto@1.0.3";
import { encodeHex } from "jsr:@std/encoding@1.0.5/hex";

export function payfastHost(): string {
  return Deno.env.get("PAYFAST_MODE") === "live" ? "www.payfast.co.za" : "sandbox.payfast.co.za";
}

export function payfastConfigured(): boolean {
  return Boolean(Deno.env.get("PAYFAST_MERCHANT_ID") && Deno.env.get("PAYFAST_MERCHANT_KEY"));
}

// PayFast's URL encoding: like PHP urlencode — spaces become "+".
function pfEncode(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

export function paramString(pairs: [string, string][]): string {
  return pairs
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${pfEncode(value)}`)
    .join("&");
}

export async function md5Hex(text: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest("MD5", new TextEncoder().encode(text));
  return encodeHex(new Uint8Array(digest));
}

// Signs fields in the order given (PayFast requires its documented field order).
export async function signature(pairs: [string, string][]): Promise<string> {
  let base = paramString(pairs);
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE");
  if (passphrase) base += `&passphrase=${pfEncode(passphrase)}`;
  return await md5Hex(base);
}

export function centsToRand(cents: number): string {
  return (cents / 100).toFixed(2);
}
