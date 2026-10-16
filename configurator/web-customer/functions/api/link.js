// GET /api/link?t=<token>: is this design link still good? (server/core.js)
import { handleLink } from '../../server/core.js';
import { CONFIG } from '../../server/config.js'; // written by tools/stage-design-site.mjs, never committed

export const onRequest = (ctx) => handleLink(ctx.request, CONFIG);
