const LOCAL_IMAGE_PROTOCOLS = ["file://", "content://", "ph://", "assets-library://", "blob:"];
const REMOTE_IMAGE_PROTOCOLS = ["http://", "https://", "data:image/"];

function hasProtocol(value: string, protocols: string[]) {
  const normalized = value.toLowerCase();
  return protocols.some((protocol) => normalized.startsWith(protocol));
}

export function normalizeProductImage(image?: string | null) {
  if (image === undefined || image === null) {
    return undefined;
  }

  const trimmed = image.trim();

  if (!trimmed) {
    return "";
  }

  if (hasProtocol(trimmed, LOCAL_IMAGE_PROTOCOLS)) {
    return undefined;
  }

  if (hasProtocol(trimmed, REMOTE_IMAGE_PROTOCOLS)) {
    return trimmed;
  }

  return trimmed;
}
