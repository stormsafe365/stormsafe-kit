import { useResolvedBuilding } from '@/engine/useResolvedBuilding';
import { swatch } from '@/config/colors';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const ft = (n: number) => `${n.toLocaleString('en-US')} ft`;
const sqft = (n: number) => `${n.toLocaleString('en-US')} ft²`;
const lb = (n: number) => `${n.toLocaleString('en-US')} lb`;

/**
 * LAYER 4 entry — live BOM + CPQ. Derived from the same pipeline as the 3D
 * scene, so the quote always matches the model. Flags truss collisions so a
 * quote can't be sent on an un-buildable layout.
 */
export function BomPanel() {
  const { bom, quote, resolved, hasCollision } = useResolvedBuilding();
  const { config, loads } = resolved;

  return (
    <aside className="scroll-thin flex h-full w-full flex-col overflow-y-auto border-l border-border bg-dark-2">
      <header className="border-b border-border px-5 py-5">
        <p className="font-head text-[11px] uppercase tracking-wide2 text-teal-dim">Estimated Build Total</p>
        <p className="mt-1 font-head text-3xl font-800 text-teal">{usd(quote.total)}</p>
        <p className="mt-1 font-body text-[11px] capitalize text-muted">
          {config.buildingType} · {config.width}×{config.length}×{config.legHeight} · est. {lb(bom.weightLb.total)}
        </p>
      </header>

      {hasCollision && (
        <div className="border-b border-danger/40 bg-danger/10 px-5 py-3">
          <p className="text-[12px] font-600 text-danger">⚠ An opening is hitting a truss</p>
          <p className="mt-0.5 text-[11px] text-sub">Resolve the flagged opening in the Wall Editor before quoting.</p>
        </div>
      )}

      {/* Color choices */}
      <Group title="Color Choices">
        <ColorRow label="Roof" code={config.colors.roof} />
        <ColorRow label="Walls" code={config.colors.walls} />
        <ColorRow label="Trim" code={config.colors.trim} />
        {config.wainscot.enabled && <ColorRow label={`Wainscot (${config.wainscot.heightFt}′)`} code={config.colors.wainscot} />}
      </Group>

      {/* Engineering / loads */}
      <Group title="Engineering Loads">
        <Row label="Design wind" value={`${config.windSpeedMph} mph · Exp. ${config.exposureCategory}`} />
        <Row label="Wall pressure" value={`${loads.designWallPressurePsf} psf`} />
        <Row label="Roof uplift" value={`${loads.roofUpliftPsf} psf`} />
        <Row label="Roof snow" value={`${loads.roofSnowPsf} psf`} />
        <Row label="Frame spacing" value={`${resolved.legSpacing} ft · ${resolved.frameCount} bents`} />
      </Group>

      {/* Quote breakdown */}
      <Group title="Quote Breakdown">
        <Row label="Steel framing" value={usd(quote.framePrice)} />
        <Row label="Sheet metal" value={usd(quote.sheetingPrice)} />
        <Row label="Trim" value={usd(quote.trimPrice)} />
        <Row label="Doors & windows" value={usd(quote.openingsPrice)} />
        {quote.wainscotPrice > 0 && <Row label="Wainscot" value={usd(quote.wainscotPrice)} />}
        {quote.windUpcharge > 0 && <Row label="High-wind package" value={usd(quote.windUpcharge)} />}
        {quote.snowUpcharge > 0 && <Row label="Snow-load package" value={usd(quote.snowUpcharge)} />}
        <Row label="Subtotal" value={usd(quote.subtotal)} muted />
      </Group>

      {/* Steel BOM */}
      <Group title={`Steel — ${ft(bom.steel.totalLinearFt)}`}>
        {bom.steel.lines.map((line) => (
          <Row key={line.label} label={line.label} value={ft(line.linearFt)} />
        ))}
      </Group>

      {/* Sheeting */}
      <Group title={`Sheet Metal — ${sqft(bom.sheeting.netSqFt)} net`}>
        <Row label="Roof panels" value={sqft(bom.sheeting.roofSqFt)} />
        <Row label="Wall panels" value={sqft(bom.sheeting.wallSqFt)} />
        <Row label="Opening deductions" value={`− ${sqft(bom.sheeting.openingDeductSqFt)}`} />
      </Group>

      {/* Trim */}
      <Group title={`Trim — ${ft(bom.trim.totalFt)}`}>
        <Row label="Ridge cap" value={ft(bom.trim.ridgeCapFt)} />
        <Row label="Eave trim" value={ft(bom.trim.eaveTrimFt)} />
        <Row label="Gable / rake" value={ft(bom.trim.gableRakeFt)} />
        <Row label="Corner trim" value={ft(bom.trim.cornerTrimFt)} />
        <Row label="Base trim" value={ft(bom.trim.baseTrimFt)} />
        <Row label="Opening J-trim" value={ft(bom.trim.openingJTrimFt)} />
      </Group>

      {/* Weight */}
      <Group title="Approx. Weight">
        <Row label="Structural steel" value={lb(bom.weightLb.steel)} />
        <Row label="Sheet metal" value={lb(bom.weightLb.sheeting)} />
        <Row label="Total" value={lb(bom.weightLb.total)} muted />
      </Group>

      <div className="mt-auto space-y-3 px-5 py-5">
        <button
          type="button"
          disabled={hasCollision}
          className="w-full rounded-lg bg-teal py-3 font-body text-sm font-700 text-dark transition-colors hover:bg-teal-dim disabled:cursor-not-allowed disabled:bg-dark-4 disabled:text-muted"
        >
          {hasCollision ? 'Resolve truss conflict to quote' : 'Request This Quote →'}
        </button>
        <a
          href="tel:561-771-5555"
          className="block w-full rounded-lg border border-teal py-3 text-center font-body text-sm font-600 text-teal transition-colors hover:bg-teal-glow"
        >
          Call 561-771-5555
        </a>
        <p className="text-[10px] leading-relaxed text-muted">{quote.disclaimer}</p>
      </div>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-4">
      <p className="mb-3 font-head text-[11px] uppercase tracking-wide2 text-sub">{title}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ColorRow({ label, code }: { label: string; code: string }) {
  const s = swatch(code);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-sub">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-head text-[11px] tabular-nums text-text">{s.name}</span>
        <span className="h-4 w-4 rounded border border-border-vis" style={{ background: s.hex }} />
      </span>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-[12px] ${muted ? 'font-600 text-text' : 'text-sub'}`}>{label}</span>
      <span className={`font-head text-[12px] tabular-nums ${muted ? 'font-700 text-teal' : 'text-text'}`}>
        {value}
      </span>
    </div>
  );
}
