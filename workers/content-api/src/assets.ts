interface ContentLikeBlock {
  type?: string;
  content?: string;
}

const assetUrlRegex = /\/api\/assets\/((?:images|audio|files)\/[^\s"'<>\\]+)/g;
const bareKeyRegex = /^(images|audio|files)\/[^\s"'<>\\]+$/;

function normalizeAssetKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function addAssetKeysFromText(text: string, keys: Set<string>): void {
  if (bareKeyRegex.test(text)) {
    keys.add(normalizeAssetKey(text));
  }

  assetUrlRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = assetUrlRegex.exec(text)) !== null) {
    keys.add(normalizeAssetKey(match[1]));
  }
}

function addAssetKeysFromJson(value: unknown, keys: Set<string>): void {
  if (typeof value === 'string') {
    addAssetKeysFromText(value, keys);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) addAssetKeysFromJson(item, keys);
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) addAssetKeysFromJson(item, keys);
  }
}

export function extractAssetKeysFromContentBlock(
  block: ContentLikeBlock
): Set<string> {
  const keys = new Set<string>();
  if (typeof block.content !== 'string') return keys;

  addAssetKeysFromText(block.content, keys);

  try {
    addAssetKeysFromJson(JSON.parse(block.content), keys);
  } catch {
    // content 不一定是 JSON；一般 rich_text 會直接存 HTML。
  }

  return keys;
}
