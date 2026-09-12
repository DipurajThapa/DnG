import type { ProviderQueueWorker } from '../runtime/provider-runtime.js';

export interface WorkerCycleResult { processed:number;retried:number;deadLettered:number;recovered:number; }
export interface WorkerLoopOptions { pollIntervalMs?:number; batchSize?:number; onCycle?:(result:WorkerCycleResult)=>void; onError?:(error:unknown)=>void; }

/** Small durable-worker runner. Hosting/scheduling belongs to the production platform; business retry/dead-letter state stays in integration_inbox_v2. */
export class DurableProviderWorkerLoop {
  private stopped=true;
  constructor(private readonly worker:Pick<ProviderQueueWorker,'drain'>,private readonly options:WorkerLoopOptions={}){}
  async run(signal?:{aborted:boolean}):Promise<void>{
    const poll=Math.max(100,this.options.pollIntervalMs??1000),batch=Math.max(1,this.options.batchSize??25); this.stopped=false;
    while(!this.stopped&&!signal?.aborted){
      try{const result=await this.worker.drain(batch);this.options.onCycle?.(result);}catch(error){this.options.onError?.(error);}
      if(this.stopped||signal?.aborted)break;
      await new Promise<void>(resolve=>setTimeout(resolve,poll));
    }
  }
  stop():void{this.stopped=true;}
  async runOnce():Promise<WorkerCycleResult>{const result=await this.worker.drain(Math.max(1,this.options.batchSize??25));this.options.onCycle?.(result);return result;}
}
