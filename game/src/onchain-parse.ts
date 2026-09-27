type Attribute = { trait_type?: unknown; value?: unknown };

/** Decode the on-chain data: URI. The embedded SVG image is ignored; the game draws canonical sprite frames. */
export function traitsFromTokenUri(uri: string) {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:application/json") || comma < 0) throw new Error("Unexpected token metadata format.");
  const body = uri.slice(comma + 1);
  const json = JSON.parse(uri.slice(0, comma).endsWith(";base64") ? atob(body) : decodeURIComponent(body)) as { attributes?: Attribute[] };
  const attr = new Map((json.attributes ?? []).map(a => [String(a.trait_type), a.value]));
  return {
    generation: attr.get("Generation"), state: attr.get("State"), character: attr.get("Character"),
    seed: attr.get("Seed"), activationTier: attr.get("Activation tier"), scenery: attr.get("Scenery"), floor: attr.get("Floor"),
  };
}
