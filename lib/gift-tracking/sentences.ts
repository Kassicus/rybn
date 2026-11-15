/**
 * The fixed sentences the gift tracker's recipient actions answer (lib/actions/gift-tracking.ts), in one module that is
 * not "use server", so the actions and the app's routes (lib/mobile) read the same words.
 */
export const RECIPIENT_SENTENCES = { nameTaken: "You already have a recipient with this name" } as const;
