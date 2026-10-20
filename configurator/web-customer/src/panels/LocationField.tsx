/**
 * "Where will your building go?" — a 5-digit ZIP picks the county from the quote
 * program's own ZIP table, so the page offers the doors and windows that county
 * requires (impact-rated in the Hi-Impact counties), the same rule as the quote.
 */
import { useId } from 'react';
import { useWebStore } from '../store';
import { Field } from './ui';

export function LocationField({ label = 'Where will your building go? (ZIP code)', required, error }: { label?: string; required?: boolean; error?: string }) {
  const zip = useWebStore((s) => s.contact.zip);
  const county = useWebStore((s) => s.ctx.county);
  const setZip = useWebStore((s) => s.setZip);
  const id = useId();
  const full = /^\d{5}$/.test(zip);
  // the Send step's "please enter your ZIP" sits in the box's own hint spot, like the other boxes
  const hint = error
    ? <span className="field-error">{error}</span>
    : full
      ? county
        ? `${county} County, FL`
        : 'We could not find that ZIP code in Florida. Your rep will check your area.'
      : 'Your ZIP code shows the doors and windows used in your county.';
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        className={`input input-zip ${error ? 'has-error' : ''}`}
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={10}
        required={required}
        aria-invalid={error ? true : undefined}
        placeholder="e.g. 33401"
        value={zip}
        onChange={(e) => setZip(e.target.value)}
      />
    </Field>
  );
}
