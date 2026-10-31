/**
 * One option in the Add-ons step (owner 10/31/26: "lean-tos should be add-ons with then the option to add a lean-to or
 * partition wall like on the customize page" - the website's builder, owner 10/29/26: "not everyone knows what a lean-to or
 * partition wall are"): a picture of it from our own 3D model, what it is in one line, and the lime + Add button.
 * Pictures: web-customer/src/assets/addons (the website's, rendered from the builder). The picks under them (which side,
 * room depth, the buttons) take the card's full width: this page's side panel is narrower than the website's.
 */
import type { ReactNode } from 'react';

export const ADDON_PICTURE = (k: 'leanto' | 'partition') => new URL(`../assets/addons/${k}.jpg`, import.meta.url).href;

export function AddonPick({ pic, title, text, added, children }: { pic: 'leanto' | 'partition'; title: string; text: string; added?: ReactNode; children?: ReactNode }) {
  return (
    <section className={`addon-pick${added ? ' is-added' : ''}`} aria-label={title}>
      <img className="addon-pic" src={ADDON_PICTURE(pic)} alt={`A steel building with a ${title.toLowerCase()}`} width={640} height={400} />
      <div className="addon-pick-body">
        <div className="addon-pick-head">
          <h3 className="addon-pick-title">{title}</h3>
          {added}
        </div>
        <p className="addon-pick-text">{text}</p>
      </div>
      {children ? <div className="addon-pick-more">{children}</div> : null}
    </section>
  );
}
