/**
 * Which version is currently published for a repo, and — when we can get
 * them — the exact asset URLs attached to it.
 *
 * Two lookups, in order, because the obvious one is not reliable here:
 *
 *  1. api.github.com. Best answer: real asset names, so a renamed installer
 *     becomes a missing link rather than a link that 404s. But unauthenticated
 *     callers get 60 requests/hour *per IP*, and this backend runs on a shared
 *     host whose egress IP is nowhere near that budget on its own — measured
 *     in production, this endpoint answers 403 every time. Relying on it alone
 *     is what left the version resolving to a hardcoded constant.
 *
 *  2. github.com/<repo>/releases/latest. Not the API — a plain web redirect,
 *     not subject to that cap, and its Location header names the tag exactly.
 *     It carries no asset list, so callers rebuild the URLs by convention.
 *
 * If both fail the caller gets no version at all rather than a stale one: a
 * confidently wrong number is the failure this whole module exists to remove.
 */
const FETCH_TIMEOUT_MS = 8000;

export type ReleaseAsset = { name?: string; browser_download_url?: string };

export type ResolvedRelease = {
  /** Version with no leading "v". Empty when nothing could be resolved. */
  tag: string;
  /** Populated only by the API path; empty when resolved via the redirect. */
  assets: ReleaseAsset[];
};

const EMPTY: ResolvedRelease = { tag: "", assets: [] };

const stripV = (value: string) => value.replace(/^v/i, "").trim();

const fromApi = async (repo: string): Promise<ResolvedRelease> => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "hisvex-backend",
          // Lifts the cap to 5000/hour when a token is present. Optional on
          // purpose: the redirect path below already keeps the version correct
          // without one, so a missing token costs asset names, not answers.
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return EMPTY;

    const body = (await res.json()) as {
      tag_name?: string;
      assets?: ReleaseAsset[];
    };
    const tag = stripV(String(body.tag_name ?? ""));
    if (!tag) return EMPTY;
    return { tag, assets: body.assets ?? [] };
  } catch {
    return EMPTY;
  }
};

const fromRedirect = async (repo: string): Promise<ResolvedRelease> => {
  try {
    const res = await fetch(`https://github.com/${repo}/releases/latest`, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "hisvex-backend" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // A repo with no releases at all does not redirect to /tag/... — it either
    // stays on /releases or 404s, and both leave the match below empty.
    const location = res.headers.get("location") ?? "";
    const tag = stripV(location.split("/releases/tag/")[1] ?? "");
    return tag ? { tag, assets: [] } : EMPTY;
  } catch {
    return EMPTY;
  }
};

export const resolveLatestRelease = async (
  repo: string,
): Promise<ResolvedRelease> => {
  const viaApi = await fromApi(repo);
  if (viaApi.tag) return viaApi;
  return fromRedirect(repo);
};

/** First asset whose (lowercased) filename matches, if the API gave us any. */
export const pickAsset = (
  assets: ReleaseAsset[],
  match: (name: string) => boolean,
): string | undefined =>
  assets.find((a) => a.name && match(a.name.toLowerCase()))
    ?.browser_download_url;
