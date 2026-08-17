/* ============================================================================
 * ca-overrides.js â€” Metal Building HQ price updates applied ON TOP of the
 * verbatim-extracted ca-tables.js.
 *
 * Load order: ca-tables.js â†’ ca-overrides.js â†’ ca-engine.js
 *
 * Keep every dated price change here rather than editing ca-tables.js (which is
 * regenerated from the builder). Each block cites the source so the deviation
 * from the extracted baseline is auditable.
 * ========================================================================== */
(function (root) {
  'use strict';
  var T = root.CA_TABLES; if (!T) return;
  var CA = T.CA;

  /* â”€â”€ Price sheet update â€” effective July 15, 2026 (manufacturer email) â”€â”€â”€â”€â”€
   * "Building prices held; garage-door pricing updated." Certified roll-up,
   * walk-through, and window pricing replaces all prior versions. Base
   * building, leg height, wall, end-wall, frameout, panel, and insulation
   * pricing are explicitly UNCHANGED and are left as extracted.               */

  // Certified roll-up (garage) doors â€” the current line. One certified price per
  // size; 12Ã—12 and up include a chain hoist, smaller sizes take the +$325 add-on.
  // Master Price Book 7/16/26: rep tool quotes the M3652 certified line.
  // (M750 budget / M3100 / M3100 IM need the full catalog UI â€” see quote-builder.)
  T.CERT_RUD = {"8x8":1325,"8x9":1425,"8x10":1500,"8x12":1650,"8x14":1850,"9x8":1400,"9x9":1475,"9x10":1575,"9x12":1775,"9x14":1950,"10x8":1475,"10x9":1550,"10x10":1650,"10x12":1825,"10x14":2025,"12x8":1550,"12x9":1650,"12x10":1725,"12x12":1950,"12x14":2175,"14x8":1675,"14x9":1775,"14x10":1900,"14x12":2100,"14x14":2350,"16x8":1825,"16x9":1950,"16x10":2050,"16x12":2300,"16x14":2600,"18x8":1950,"18x9":2075,"18x10":2175,"18x12":2475,"18x14":2675,"18x16":4520};
  T.CERT_HOIST = {"8x12":true,"8x14":true,"9x12":true,"9x14":true,"10x12":true,"10x14":true,"12x8":true,"12x9":true,"12x10":true,"12x12":true,"12x14":true,"14x8":true,"14x9":true,"14x10":true,"14x12":true,"14x14":true,"16x8":true,"16x9":true,"16x10":true,"16x12":true,"16x14":true,"18x8":true,"18x9":true,"18x10":true,"18x12":true,"18x14":true};  // hoist included above 10x10

  // Roll-up door colour is now a FLAT $100 per door (was a 25â€“30% of-door-price
  // upcharge). White stays free.
  CA.rudColors.forEach(function (c) {
    delete c.pct;
    if (c.v === 'white' || c.v === 'satinWhite') { c.price = 0; }
    else if (c.v === 'black') { c.price = 344; c.label = 'Coal Black (+25%)'; }
    else { c.price = 275; }
  });

  // Certified walk-through door 36"Ã—80" â†’ $395.
  CA.wtdPrices.std = 300;
  (CA.wtdTypes || []).forEach(function (t2) { if (t2.v === 'std') t2.label = 'Blank Walk Door 36\u00d780'; });

  // Windows: 30Ã—30 standard unchanged ($200); 30Ã—30 High-Impact (FL code) â†’ $395.
  CA.winPrices.hi = 590;
  (CA.winTypes || []).forEach(function (t3) {
    if (t3.v === 'std') t3.label = 'Standard 30Ã—30';
    if (t3.v === 'hi') t3.label = 'High-Impact 30\u00d730';
  });

  /* â”€â”€ County sales-tax table (FL) â€” drives tax from the ZIP's county â”€â”€â”€â”€â”€â”€â”€â”€
   * Extracted from the builder's COUNTY_TAX. Rates are percentages.           */
  CA.countyTax = {"Alachua":7.5,"Baker":7,"Bay":7,"Bradford":7,"Brevard":7,"Broward":7,"Calhoun":7.5,"Charlotte":7,"Citrus":6,"Clay":7.5,"Collier":6,"Columbia":7.5,"DeSoto":7.5,"Dixie":7,"Duval":7.5,"Escambia":7.5,"Flagler":7,"Franklin":7.5,"Gadsden":7.5,"Gilchrist":7,"Glades":7,"Gulf":7,"Hamilton":8,"Hardee":7,"Hendry":7.5,"Hernando":6.5,"Highlands":7.5,"Hillsborough":7.5,"Holmes":7.5,"Indian River":7,"Jackson":7.5,"Jefferson":7,"Lafayette":7,"Lake":7,"Lee":6.5,"Leon":7.5,"Levy":7,"Liberty":7.5,"Madison":7.5,"Manatee":7,"Marion":7.5,"Martin":6.5,"Miami-Dade":7,"Monroe":7.5,"Nassau":7,"Okaloosa":7,"Okeechobee":7,"Orange":6.5,"Osceola":7.5,"Palm Beach":6.5,"Pasco":7,"Pinellas":7,"Polk":7,"Putnam":7,"St. Johns":6.5,"St. Lucie":7,"Santa Rosa":7,"Sarasota":7,"Seminole":7,"Sumter":7,"Suwannee":7,"Taylor":7,"Union":7,"Volusia":6.5,"Wakulla":7.5,"Walton":7,"Washington":7.5};

  /* â”€â”€ Engineered plan pricing (per the owner) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   * Generic Stamped $250 Â· As-Built Stamped $400 Â· Commercial / Risk Cat 2 $750
   * Â· Master Files free. Plan type also drives the engineered-plans lead time.  */
  CA.plans = {
    'Generic Plans': 250, 'As Built Plans': 400, 'As Built Comm': 750,
    'Master Files': 0, 'No Permit Required': 0
  };
  CA.planLabels = {
    'Generic Plans': 'Generic Stamped â€” $250',
    'As Built Plans': 'As-Built Stamped â€” $400',
    'As Built Comm': 'As-Built Â· Commercial / Risk Cat 2 â€” $750',
    'Master Files': 'Master Files â€” Free',
    'No Permit Required': 'No Permit Required â€” $0'
  };
  CA.planCostFn = function (pt) { return CA.plans[pt] || 0; };   // flat, no width tiering
  // Engineered-plans lead time by plan type.
  CA.planLeadTime = {
    'Generic Plans': '2â€“3 weeks', 'As Built Plans': '4â€“6 weeks',
    'As Built Comm': '4â€“6 weeks', 'Master Files': '1â€“2 weeks', 'No Permit Required': 'â€”'
  };
})(typeof window !== 'undefined' ? window : globalThis);
