// POST /api/lead?k=<key>&kind=chat|form: a website lead from Wix Automations (server/lead.js).
import { handleLead } from '../../server/lead.js';
import { CONFIG } from '../../server/config.js'; // written by tools/stage-design-site.mjs, never committed

export const onRequest = (ctx) => handleLead(ctx.request, CONFIG);
