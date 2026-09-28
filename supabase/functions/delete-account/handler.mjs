// Authentication is verified remotely. Never accept a user ID from the request.
const origins = new Set(['http://localhost:5500','http://127.0.0.1:5500','http://localhost:4173','http://127.0.0.1:4173','http://localhost:4174','http://127.0.0.1:4174','https://nectarspend.com','https://www.nectarspend.com','https://nectarspend.vercel.app']);
export function deletionHandler({verifyUser, deleteUser}) {
  return async (request) => {
    const origin = request.headers.get('origin');
    const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
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
    if (!/^Bearer \S+$/i.test(auth)) return reply(401,{error:'Sign in again.'});
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415,{error:'Use JSON.'});
    try {
      const body = await request.json();
      if (!body || body.confirmation !== 'DELETE' || Object.keys(body).some(k=>k!=='confirmation'))
        return reply(400,{error:'Confirm deletion of your own account.'});
    } catch { return reply(400,{error:'Invalid request.'}); }
    try {
      const {data, error} = await verifyUser(auth.slice(7));
      if (error || !data?.user?.id) return reply(401,{error:'Sign in again.'});
      const result = await deleteUser(data.user.id);
      if (result.error) return reply(503,{error:'Deletion could not be confirmed. Try again or contact support.'});
      return reply(200,{deleted:true});
    } catch { return reply(503,{error:'Deletion could not be confirmed. Try again or contact support.'}); }
  };
}
