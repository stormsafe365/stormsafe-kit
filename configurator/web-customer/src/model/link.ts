/**
 * The rep's personal design link: https://stormsafe-design.pages.dev/?t=<token>.
 * The token ties a sent design to the lead the rep made the link for. It holds
 * nothing about the lead itself — the page never learns who the lead is.
 */
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

/** The link token from the page address (?t=…), or null. */
export function parseToken(search: string): string | null {
  const t = new URLSearchParams(search).get('t');
  return t && TOKEN_RE.test(t) ? t : null;
}

/** What the server said about the link. 'none' = no token in the address. */
export type LinkStatus = 'checking' | 'ok' | 'expired' | 'invalid' | 'none' | 'offline';

export interface Contact {
  name: string;
  phone: string;
  email: string;
  zip: string;
  notes: string;
  /** Honeypot: a hidden field people never see. Anything typed here = a bot. */
  website: string;
}

export const EMPTY_CONTACT: Contact = { name: '', phone: '', email: '', zip: '', notes: '', website: '' };

export const LIMITS = { name: 120, phone: 40, email: 160, notes: 2000 } as const;

const digits = (s: string) => s.replace(/\D/g, '');
/** The email shape the database accepts (020_design_links.sql checks it lower-cased). */
export const EMAIL_RE = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
/** Characters a name may not hold (it can become a lead's name, printed on other screens and documents). */
export const NAME_BAD_RE = /[<>"`]/;

/** Field problems in the customer's words ({} = ready to send). Same rules as the server (020_design_links.sql). */
export function checkContact(c: Contact): Partial<Record<keyof Contact, string>> {
  const e: Partial<Record<keyof Contact, string>> = {};
  const name = c.name.trim();
  const phone = c.phone.trim();
  const email = c.email.trim();
  const zip = c.zip.trim();
  if (!name) e.name = 'Please enter your name.';
  else if (name.length > LIMITS.name) e.name = 'That name is too long.';
  else if (NAME_BAD_RE.test(name)) e.name = 'Please use letters, numbers and simple punctuation in your name.';
  if (!phone && !email) e.phone = 'Please enter a phone number or an email so your rep can reach you.';
  if (phone && (phone.length > LIMITS.phone || !/^[0-9 ()+.-]+$/.test(phone) || digits(phone).length < 10)) e.phone = 'Please enter a 10-digit phone number.';
  if (email && (email.length > LIMITS.email || !EMAIL_RE.test(email.toLowerCase()))) e.email = 'Please check your email address.';
  if (zip && !/^\d{5}$/.test(zip)) e.zip = 'Please enter a 5-digit ZIP code.';
  if (c.notes.length > LIMITS.notes) e.notes = `Please keep notes under ${LIMITS.notes} characters.`;
  return e;
}

/** Server refusals that belong to one box on the form (that box gets the message). */
export const FIELD_ERRORS: Record<string, { field: keyof Contact; text: string }> = {
  bad_name: { field: 'name', text: 'Please use letters, numbers and simple punctuation in your name.' },
  need_contact: { field: 'phone', text: 'Please enter a phone number or an email so your rep can reach you.' },
  bad_phone: { field: 'phone', text: 'Please enter a 10-digit phone number.' },
  bad_email: { field: 'email', text: 'Please check your email address.' },
};

/** Server error codes (020_design_links.sql) → what the customer reads. */
export function sendErrorText(code: string): string {
  switch (code) {
    case 'link_expired':
      return 'This design link has expired. Call or text 561-771-5555 and your rep will send a new one.';
    case 'link_invalid':
      return 'This design link is not active. Call or text 561-771-5555 and your rep will send a new one.';
    case 'too_many':
      return 'This link has sent a lot of designs today. Please try again tomorrow, or call or text 561-771-5555.';
    case 'link_full':
      return 'This link has sent all the designs it can. Call or text 561-771-5555 and your rep will send a new one.';
    case 'busy':
      return 'We are getting a lot of designs right now. Please try again later today, or call or text 561-771-5555.';
    case 'bad_name':
      return 'Please use letters, numbers and simple punctuation in your name, then try again.';
    case 'need_contact':
    case 'bad_phone':
    case 'bad_email':
    case 'too_long':
      return 'Please check your contact details and try again.';
    default:
      return 'Your design could not be sent right now. Please try again in a minute, or call or text 561-771-5555.';
  }
}
