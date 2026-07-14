export function retryDelayMs(attempt:number){
  return Math.min(5*60_000,15_000*Math.pow(2,Math.max(0,attempt-1)));
}

export function canRetryJob(attempt:number,maxAttempts=3){
  return attempt<maxAttempts;
}
