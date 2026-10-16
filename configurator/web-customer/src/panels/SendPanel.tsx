/**
 * Last step: the customer's name + contact and "Send to my steel building rep".
 * The design (no prices), its plain-text spec and a picture go to the page's
 * own server function, which files it on the lead the rep made the link for.
 * Customer wording only: the page never says where the design is stored.
 */
import { useId, useState } from 'react';
import { useWebStore, currentState } from '../store';
import { buildSpec } from '../model/spec';
import { checkContact, sendErrorText, FIELD_ERRORS, LIMITS, type Contact } from '../model/link';
import { captureDesign, isBlankImage, toJpeg } from '../capture';
import { submitDesign } from '../send';
import { LocationField } from './LocationField';
import { Field, Note } from './ui';

const PHONE = '561-771-5555';
const PHONE_HREF = 'tel:+15617715555';
/** Stored picture: small enough for the lead's card, sharp enough to read. */
const SEND_IMAGE_W = 1200;
const SEND_IMAGE_MAX_CHARS = 850_000; // the database takes up to 900,000 characters

/**
 * The ISO picture as a JPEG data URL the server accepts, or null if none could
 * be made. A blank picture (the 3D did not draw) is tried once more, then left
 * out: the design and its spec still go, without a picture.
 */
export async function sendPicture(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) await new Promise((r) => setTimeout(r, 700));
      const pics = await captureDesign(false);
      if (await isBlankImage(pics.image)) continue;
      let img = await toJpeg(pics.image, SEND_IMAGE_W, 0.82);
      if (img.length > SEND_IMAGE_MAX_CHARS) img = await toJpeg(pics.image, 900, 0.72);
      return img.length <= SEND_IMAGE_MAX_CHARS && img.startsWith('data:image/jpeg;base64,') ? img : null;
    } catch {
      /* try once more, then send without a picture */
    }
  }
  return null;
}

function TextInput({
  label,
  k,
  type = 'text',
  autoComplete,
  inputMode,
  maxLength,
  error,
  required,
}: {
  label: string;
  k: keyof Contact;
  type?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'tel' | 'email' | 'numeric';
  maxLength?: number;
  error?: string;
  required?: boolean;
}) {
  const id = useId();
  const value = useWebStore((s) => s.contact[k]);
  const setContact = useWebStore((s) => s.setContact);
  return (
    <Field label={label} htmlFor={id} hint={error ? <span className="field-error">{error}</span> : undefined}>
      <input
        id={id}
        className={`input ${error ? 'has-error' : ''}`}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        required={required}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(e) => setContact({ [k]: e.target.value })}
      />
    </Field>
  );
}

function CallUs() {
  return (
    <p className="field-hint">
      Questions? Call or text <a href={PHONE_HREF}>{PHONE}</a>.
    </p>
  );
}

export function SendPanel() {
  const link = useWebStore((s) => s.link);
  const token = useWebStore((s) => s.token);
  const sentAt = useWebStore((s) => s.sentAt);
  const setSent = useWebStore((s) => s.setSent);
  const setBusy = useWebStore((s) => s.setBusy);
  const [errors, setErrors] = useState<Partial<Record<keyof Contact, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const notesId = useId();
  const notes = useWebStore((s) => s.contact.notes);
  const setContact = useWebStore((s) => s.setContact);
  const website = useWebStore((s) => s.contact.website);

  if (link === 'none' || !token) {
    return (
      <div className="panel-body">
        <Note>
          To send this design, open the personal link your StormSafe Steel rep texted or emailed you. Or call or text{' '}
          <a href={PHONE_HREF}>{PHONE}</a> and we will design it with you.
        </Note>
      </div>
    );
  }
  if (link === 'expired' || link === 'invalid') {
    return (
      <div className="panel-body">
        <Note tone="warn">{sendErrorText(link === 'expired' ? 'link_expired' : 'link_invalid')}</Note>
      </div>
    );
  }

  if (sentAt) {
    const at = new Date(sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return (
      <div className="panel-body">
        <div className="sent" role="status">
          <span className="sent-check" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>Sent to your steel building rep</strong>
            <p>
              Your rep has your design (sent at {at}) and will reach out soon. Questions before then? Call or text{' '}
              <a href={PHONE_HREF}>{PHONE}</a>.
            </p>
          </div>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setSent(null)}>
          Changed something? Send the updated design
        </button>
      </div>
    );
  }

  async function send() {
    if (sending || !token) return;
    const st = useWebStore.getState();
    const errs = checkContact(st.contact);
    setErrors(errs);
    setFailure(null);
    if (Object.keys(errs).length) return;
    setSending(true);
    setBusy('Sending your design…');
    try {
      const { design, ctx, impact } = useWebStore.getState();
      const state = currentState();
      const spec = buildSpec(design, { zip: ctx.zip, county: ctx.county, impact });
      const image = await sendPicture();
      const contact = useWebStore.getState().contact;
      let res = await submitDesign({ token, contact, state, spec, image });
      // A picture the server will not take must not block the design: send it without one.
      if (!res.ok && res.error === 'bad_image' && image) res = await submitDesign({ token, contact, state, spec, image: null });
      if (res.ok) setSent(Date.now());
      else if (FIELD_ERRORS[res.error]) setErrors({ [FIELD_ERRORS[res.error].field]: FIELD_ERRORS[res.error].text });
      else setFailure(sendErrorText(res.error));
    } finally {
      setBusy(null);
      setSending(false);
    }
  }

  return (
    <form
      className="panel-body send-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <p className="send-lede">
        Happy with your building? Send it to your rep. They will look it over and get back to you with a quote.
      </p>
      <TextInput label="Your name" k="name" autoComplete="name" maxLength={LIMITS.name} error={errors.name} required />
      <TextInput label="Phone" k="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={LIMITS.phone} error={errors.phone} />
      <TextInput label="Email" k="email" type="email" autoComplete="email" inputMode="email" maxLength={LIMITS.email} error={errors.email} />
      <LocationField label="ZIP code where the building will go" />
      {errors.zip ? <p className="field-error">{errors.zip}</p> : null}
      <Field label="Anything else your rep should know? (optional)" htmlFor={notesId} hint={errors.notes ? <span className="field-error">{errors.notes}</span> : undefined}>
        <textarea
          id={notesId}
          className="input textarea"
          rows={3}
          maxLength={LIMITS.notes}
          placeholder="Where it goes on your property, what you will use it for, when you need it…"
          value={notes}
          onChange={(e) => setContact({ notes: e.target.value })}
        />
      </Field>
      {/* Honeypot: hidden from people (and screen readers); bots fill it in. */}
      <div className="hp" aria-hidden="true">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setContact({ website: e.target.value })} />
        </label>
      </div>
      {failure ? (
        <p className="note note-warn" role="alert">
          {failure}
        </p>
      ) : null}
      <button type="submit" className="btn-primary btn-send" disabled={sending}>
        Send to my steel building rep
      </button>
      <p className="field-hint">No prices are shown here. Your rep uses your details only to contact you about this building.</p>
      <CallUs />
    </form>
  );
}
