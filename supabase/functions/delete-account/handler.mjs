// Bearer identity is verified with Auth, never taken from a request body or CORS.
const productionOrigins = ['https://nectarspend.com', 'https://www.nectarspend.com', 'https://nectarspend.vercel.app'];
const developmentOrigins = ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost:4174', 'http://127.0.0.1:4174'];
const MAX_BODY = 1024;
async function boundedBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks = [];
  let size = 0;
  const timeout = setTimeout(() => reader.cancel().catch(() => {}), 5000);
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}
export function deletionHandler({verifyUser, deleteUser, consumeAttempt, allowDevelopment = false}) {
  const origins = new Set([...productionOrigins, ...(allowDevelopment ? developmentOrigins : [])]);
  return async (request) => {
    const origin = request.headers.get('origin');
    const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if (origin && origins.has(origin)) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods':'POST, OPTIONS'
    });
    const reply = (status, message) => new Response(JSON.stringify(message), {status,headers});
    if (origin && !origins.has(origin)) return reply(403,{error:'Origin not allowed.'});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return reply(405,{error:'Use POST.'});
    const auth = request.headers.get('authorization') || '';
    if (auth.length > 16384 || !/^Bearer \S+$/i.test(auth)) return reply(401,{error:'Sign in again.'});
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return reply(415,{error:'Use JSON.'});
    try {
      const body = await boundedBody(request);
      if (!body || body.confirmation !== 'DELETE' || Object.keys(body).some(k=>k!=='confirmation'))
        return reply(400,{error:'Confirm deletion of your own account.'});
    } catch (error) { return reply(error instanceof RangeError ? 413 : 400,{error:'Invalid request.'}); }
    try {
      const {data, error} = await verifyUser(auth.slice(7));
      if (error || !data?.user?.id || data.user.is_anonymous) return reply(401,{error:'Sign in again.'});
      // A missing migration or limiter failure must never bypass the limit.
      if (typeof consumeAttempt !== 'function') throw new Error('Limiter unavailable');
      if (!(await consumeAttempt(data.user.id))) {
        headers['Retry-After'] = '900';
        return reply(429,{error:'Too many deletion attempts. Try again in 15 minutes.'});
      }
      const result = await deleteUser(data.user.id);
      if (result.error) return reply(503,{error:'Deletion could not be confirmed. Try again or contact support.'});
      return reply(200,{deleted:true});
    } catch { return reply(503,{error:'Deletion could not be confirmed. Try again or contact support.'}); }
  };
}
