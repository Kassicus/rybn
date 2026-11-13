/** True when two lists name the same kinds of group, in any order. */
export function sameKinds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((kind) => right.has(kind));
}

/**
 * Whether the Settings page's Save saves who can see the profile
 * (updatePrivacySettings), which writes the choice onto every profile field:
 * when the person changed the choice, or when some field has another setting
 * (`mixed`), so that saving sets them all. An unchanged choice that every
 * field already has is not saved again.
 */
export function savesPrivacy(chosen: readonly string[], savedChoice: readonly string[], mixed: boolean): boolean {
  return mixed || !sameKinds(chosen, savedChoice);
}
