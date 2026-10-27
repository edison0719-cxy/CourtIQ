// Test harness only. Runs the real Python service locally instead of a Docker VM.
import worker, { pollJob, recover } from './gateway.js';
import { DurableObject } from 'cloudflare:workers';
export class LocalContainer extends DurableObject {
  async fetch(request){
    const url=new URL(request.url),origin=this.env.TEST_RUNNER_ORIGIN;
    return fetch(new Request(origin+url.pathname+url.search,request));
  }
  async stop() { await this.ctx.storage.put('stopped',true); /* The harness owns the native child process. */ }
  async destroy(){return this.stop();}
  async wasStopped(){return !!await this.ctx.storage.get('stopped');}
}
export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(path==='/__test/stopped')return Response.json({stopped:await env.ANALYZER.get(env.ANALYZER.idFromName(new URL(request.url).searchParams.get('name'))).wasStopped()});
    if(path==='/__test/poll'){await pollJob(env,await request.json());return Response.json({ok:true});}
    if(path==='/__test/recover'){await recover(env);return Response.json({ok:true});}
    return worker.fetch(request,env,ctx);
  },
};
