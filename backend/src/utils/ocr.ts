import { createWorker, type Worker } from "tesseract.js";

// A worker holds a loaded Tesseract engine + language model in memory
// (tens of MB) and takes real time to spin up — creating one per request
// would make every receipt upload pay that cost twice over (multer already
// buffers the file in memory). Created lazily on first use and reused for
// the lifetime of the process; `workerPromise` (not the resolved worker)
// is cached so concurrent first-callers await the same in-flight creation
// instead of racing to create two.
let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // "eng" only — receipts only need digits, and Tesseract's digit
      // recognition doesn't depend on the receipt's actual language (Uzbek/
      // Russian text around the amount is noise we filter out below, not
      // something we need to read). This keeps the traineddata download
      // small; see the NOTE at the bottom of this file about what that
      // download means for a Render free-tier deploy.
      const worker = await createWorker("eng");
      // Deliberately NOT restricted to a digit-only tessedit_char_whitelist.
      // Measured against a real "150 000 so'm" / "ID: 998877665544" sample:
      // a digits-only whitelist forces Tesseract to map every character —
      // including the letters in "so'm"/"ID" — onto the nearest allowed
      // digit glyph, which corrupted "150 000 so'm" into "150 000 0" (an
      // extra, wrong "0" from the misread "s"). Recognizing the full
      // character set instead read it back exactly right ("150 000 so'm"),
      // and was faster besides (no measurable slowdown from the wider
      // search space in practice). The digit-groups we actually want are
      // pulled out of the correctly-recognized text afterward — see
      // parseReceiptAmount/extractTransactionRef below.
      return worker;
    })();
  }
  return workerPromise;
}

// Triggers worker creation (and therefore the traineddata fetch described in
// the NOTE below) at boot instead of on whichever user's receipt upload
// happens to be first. Fire-and-forget from server.ts — a receipt uploaded
// before this resolves just pays the cost inline via the same getWorker()
// cache, it doesn't fail or double-fetch.
export async function warmUpOcr(): Promise<void> {
  await getWorker();
}

export async function runOcr(buffer: Buffer): Promise<string> {
  const worker = await getWorker();
  // tesseract.js's TS type for `recognize` only lists browser image types
  // (HTMLImageElement etc.) plus `string`, but its Node implementation
  // accepts a raw Buffer directly (documented usage) — the type
  // declaration just hasn't caught up. Buffer really is a supported input.
  const { data } = await worker.recognize(buffer as unknown as string);
  return data.text ?? "";
}

// Matches a run of digits optionally grouped with spaces/commas/periods
// (thousand separators), e.g. "150 000", "150,000", "150.000", "150000".
// Deliberately does not require a currency suffix ("so'm"/"UZS") — OCR text
// is noisy enough that requiring one would drop otherwise-good matches.
//
// Uses a literal space (\x20), not \s: \s also matches newlines, and an
// earlier version of this regex used \s here, which let a match span two
// unrelated lines (e.g. an amount on one line and an ID on the next) and
// silently concatenate them into one wrong number. A receipt's amount and
// its transaction ref are never meant to be read as a single value.
const AMOUNT_GROUP_REGEX = /\d[\d.,\x20]*\d|\d/g;

function normalizeAmountCandidate(raw: string): number | null {
  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (!digitsOnly) return null;
  const value = Number(digitsOnly);
  return Number.isFinite(value) ? value : null;
}

/**
 * Pulls every digit-group out of the OCR'd text and checks whether any of
 * them equals expectedAmount exactly. Amounts here are always whole so'm —
 * no fuzzy/percentage tolerance, just exact match against one of the
 * candidates (a receipt legitimately contains other numbers: dates, card
 * tails, balances, so scanning for *any* exact match is the right shape,
 * not assuming the amount is the only number present).
 */
export function parseReceiptAmount(
  text: string,
  expectedAmount: number,
): { extractedAmount: number | null; matched: boolean } {
  const candidates = Array.from(text.matchAll(AMOUNT_GROUP_REGEX))
    .map((m) => normalizeAmountCandidate(m[0]))
    .filter((value): value is number => value !== null && value > 0);

  if (candidates.length === 0) {
    return { extractedAmount: null, matched: false };
  }

  const exact = candidates.find((value) => value === expectedAmount);
  if (exact !== undefined) {
    return { extractedAmount: exact, matched: true };
  }

  // No exact match — still report the largest candidate (most likely to be
  // the transfer amount rather than a date/card fragment) so an admin
  // reviewing a "not auto-provisioned" payment has a starting point,
  // without ever claiming a match that didn't happen.
  return { extractedAmount: Math.max(...candidates), matched: false };
}

// Longest run of 6+ consecutive digits in the text — receipts print a
// transaction/reference number this shape, distinct from the (usually
// shorter, or separator-broken) amount. Ties broken by first occurrence.
const DIGIT_RUN_REGEX = /\d{6,}/g;

export function extractTransactionRef(text: string): string | null {
  const runs = text.match(DIGIT_RUN_REGEX);
  if (!runs || runs.length === 0) return null;

  return runs.reduce((longest, current) => (current.length > longest.length ? current : longest));
}

// NOTE on Render free tier — CONFIRMED locally, not speculation:
// createWorker("eng") downloads eng.traineddata (~5MB uncompressed) from
// Tesseract's CDN on first use and writes it to the process's current
// working directory (a plain `createWorker("eng")` run from this repo's
// root during development wrote eng.traineddata straight into the repo —
// now gitignored, see .gitignore). There is no bundled copy in this
// package. On Render's free plan that means: (1) the instance's first OCR
// request after a cold start (free tier spins down on idle, and every
// deploy is a fresh instance/fresh disk) pays a one-off ~200ms-to-several-
// second network fetch + disk write, adding real latency to whichever
// user's request happens to trigger it, and (2) if Render's egress or the
// CDN is unreachable at that moment, that request fails outright with no
// retry. Subsequent requests on the same running instance are fast (~100-
// 200ms recognize time, measured locally) since the module-level worker
// singleton and the on-disk file both persist for the instance's uptime.
// Mitigations if this proves disruptive in practice: vendor eng.traineddata
// into the repo/image and pass `langPath` (a local path) to createWorker to
// skip the network fetch entirely, or warm the worker once in server.ts's
// bootstrap() so the cost is paid at boot instead of on a user's request.
// Neither is done here since Render's actual cwd/disk-writability and cold
// start frequency need a real deploy to observe, not local assumptions.
