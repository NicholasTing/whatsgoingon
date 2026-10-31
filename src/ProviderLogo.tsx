import { Icon } from "./Icon.tsx";

const brands = new Set([
  "databricks",
  "claude",
  "openai",
  "github",
  "cloudflare",
  "tailscale",
  "modal",
  "circleci",
  "vercel",
  "supabase",
  "npm",
  "pypi",
  "docker",
  "linear",
  "notion",
  "discord",
]);

export function ProviderLogo({ id }: { id: string }) {
  const brand = id === "codex" ? "openai" : id;
  return (
    <span className="provider-logo" aria-hidden="true">
      {brands.has(brand) ? (
        <img src={`/logos/${brand}.svg`} width="24" height="24" alt="" />
      ) : (
        <Icon name="globe" size={24} />
      )}
    </span>
  );
}
