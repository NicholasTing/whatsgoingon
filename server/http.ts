import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";
import ipaddr from "ipaddr.js";

export function publicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (
      parsed.kind() === "ipv6" &&
      (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    )
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export function publicUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Use a public HTTPS URL without credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) && !publicAddress(host))
  )
    throw new Error("Private network addresses are not supported.");
  return url;
}
export type HttpResult = {
  status: number;
  body: string;
  latencyMs: number;
  certificateExpiresAt?: string;
};
export async function fetchPublic(
  value: string,
  options: {
    method?: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResult> {
  const url = publicUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new Error("The hostname must resolve only to public addresses.");
  const address = addresses[0];
  const start = performance.now();
  return new Promise((resolve, reject) => {
    // Pin the validated address so DNS rebinding cannot change the request destination.
    const req = request(
      url,
      {
        method: options.method ?? "GET",
        lookup: (_hostname, settings, callback) => {
          if (settings.all)
            (
              callback as unknown as (
                err: null,
                addresses: { address: string; family: number }[],
              ) => void
            )(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: {
          "User-Agent": "whatsgoingon/0.1",
          Accept: "application/json,text/html;q=0.8",
          "Accept-Encoding": "identity",
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const certificate = (response.socket as TLSSocket).getPeerCertificate();
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 4_000_000) {
            req.destroy(
              new Error("Provider response exceeded the size limit."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const bytes = Buffer.concat(chunks);
          const encoding =
            bytes[0] === 255 && bytes[1] === 254
              ? "utf-16le"
              : bytes[0] === 254 && bytes[1] === 255
                ? "utf-16be"
                : "utf-8";
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: new TextDecoder(encoding, { fatal: true }).decode(bytes),
              latencyMs: Math.round(performance.now() - start),
              ...(certificate.valid_to
                ? {
                    certificateExpiresAt: new Date(
                      certificate.valid_to,
                    ).toISOString(),
                  }
                : {}),
            });
          } catch {
            reject(new Error("Provider response has invalid text encoding."));
          }
        });
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error("Provider request timed out.")),
      12_000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
export async function getJson(url: string): Promise<unknown> {
  const response = await fetchPublic(url);
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `Provider returned HTTP ${response.status}. Redirects are not followed.`,
    );
  return JSON.parse(response.body);
}
