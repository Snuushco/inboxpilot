const signup = require('./api/signup');
const workspace = require('./api/workspace');
const health = require('./api/health');
const status = require('./api/status');
const trial = require('./api/trial-status');

function run(handler, { method='GET', query={}, body=null, headers={} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, query, body, headers };
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k,v){ this.headers[k]=v; },
      status(code){ this.statusCode=code; return this; },
      json(data){ resolve({ statusCode:this.statusCode, data, headers:this.headers }); },
      end(data){ resolve({ statusCode:this.statusCode, data, headers:this.headers }); }
    };
    Promise.resolve(handler(req,res)).catch(reject);
  });
}

(async () => {
  const signupRes = await run(signup, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:{
      firstName:'Guus', lastName:'Test', email:'snuushco@example.com', company:'Snuushco',
      userType:'mkb', mailboxes:'2-3', mailTypes:'support, offertes', actions:'prioriteren', tone:'direct', plan:'Team — €349'
    }
  });
  console.log('signup', signupRes.statusCode, signupRes.data.ok, signupRes.data.leadId ? 'lead-ok' : 'no-lead');
  const leadId = signupRes.data.canonicalLeadId || signupRes.data.leadId;
  const workspaceRes = await run(workspace, { query:{ leadId } });
  console.log('workspace', workspaceRes.statusCode, workspaceRes.data.ok, workspaceRes.data.plan?.key, workspaceRes.data.priorityQueue?.length);
  const healthRes = await run(health);
  console.log('health', healthRes.statusCode, healthRes.data.ok);
  const statusRes = await run(status);
  console.log('status', statusRes.statusCode, statusRes.data.ok);
  const trialRes = await run(trial, { query:{ leadId } });
  console.log('trial', trialRes.statusCode, trialRes.data.ok, trialRes.data.trial?.daysRemaining);
})();
