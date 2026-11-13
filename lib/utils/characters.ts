/**
 * The characters Rybn does not save in text, and the one sentence that says so. The website's form schemas
 * (lib/schemas) and the app's rules at the door (lib/mobile) both read them from here, so they refuse the same
 * characters with the same words.
 *
 * Imports nothing: the browser's forms load it.
 */

/** Said when text holds a character it may not. */
export const CHARACTERS_REFUSED = "That has characters Rybn can't save. Try typing it again.";

/** Control characters: U+0000 to U+001F and U+007F. One-line text may hold none of them. */
export const CONTROL = /[\u0000-\u001F\u007F]/;

/**
 * Control characters other than tab, line feed and carriage return, which notes and other free text written over
 * several lines may hold.
 */
export const CONTROL_EXCEPT_NOTES_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
