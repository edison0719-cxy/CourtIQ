import { Container } from '@cloudflare/containers';
export { default } from './gateway.js';

export class AnalysisContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5m';
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {INTERNAL_SECRET:env.INTERNAL_SECRET, PUBLIC_ORIGIN:env.PUBLIC_ORIGIN,MAX_JOB_SECONDS:env.MAX_JOB_SECONDS||'7200',
      PYTHONUNBUFFERED:'1',OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4',MPLBACKEND:'Agg'};
  }
  async onActivityExpired(){
    // CPU inference does not produce incoming HTTP activity. Keep it alive independently of queue latency.
    try{
      const response=await this.containerFetch('http://localhost/activity',{headers:{'X-CourtIQ-Secret':this.env.INTERNAL_SECRET}});
      if(response.ok&&(await response.json()).running){this.renewActivityTimeout();return;}
    }catch{}
    await this.stop();
  }
}
