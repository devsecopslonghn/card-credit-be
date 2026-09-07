type DuplicateCardSource = {
  _id?: unknown;
  workspaceId?: unknown;
  presetId?: unknown;
  owner?: unknown;
  active?: unknown;
};

export type ExactDuplicateCardGroup = { fingerprint: string; cardIds: string[] };

export const normalizeDuplicateOwner = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null;

export const duplicateFingerprint = (card: DuplicateCardSource) => {
  const owner = normalizeDuplicateOwner(card.owner);
  if (typeof card.workspaceId !== "string" || typeof card.presetId !== "string" || !owner) return null;
  return `${card.workspaceId}::${card.presetId}::${owner}`;
};

export const duplicateReason = "Same workspace, catalog preset and normalized owner.";

export const exactDuplicateCardGroups = (cards: DuplicateCardSource[]): ExactDuplicateCardGroup[] => {
  const groups = new Map<string, string[]>();
  for (const card of cards) {
    if (card.active === false) continue;
    const id = typeof card._id === "string" ? card._id : card._id ? String(card._id) : "";
    const fingerprint = duplicateFingerprint(card);
    if (!id || !fingerprint) continue;
    const ids = groups.get(fingerprint) ?? [];
    ids.push(id);
    groups.set(fingerprint, ids);
  }
  return [...groups.entries()]
    .map(([fingerprint, cardIds]) => ({ fingerprint, cardIds: [...new Set(cardIds)].sort() }))
    .filter((group) => group.cardIds.length > 1)
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
};
