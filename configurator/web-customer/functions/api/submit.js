// POST /api/submit: the customer's "Send to my steel building rep" (server/core.js).
import { handleSubmit } from '../../server/core.js';
import { CONFIG } from '../../server/config.js'; // written by tools/stage-design-site.mjs, never committed

export const onRequest = (ctx) => handleSubmit(ctx.request, CONFIG);
