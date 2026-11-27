const key = Symbol.for("slm.heavyJobs.v1");

export class HeavyJobError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createHeavyQueue(maxQueued = 3) {
  let busy = false;
  const waiting = [];
  function next() {
    const entry = waiting.shift();
    if (entry) entry.start();
    else busy = false;
  }
  return function run(job, signal) {
    if (signal?.aborted) return Promise.reject(new HeavyJobError("The job was cancelled.", 408));
    if (busy && waiting.length >= maxQueued) return Promise.reject(new HeavyJobError("The heavy-job queue is full. Try again shortly.", 429));
    return new Promise((resolve, reject) => {
      const entry = {
        start() {
          signal?.removeEventListener("abort", cancel);
          busy = true;
          Promise.resolve().then(() => {
            if (signal?.aborted) throw new HeavyJobError("The job was cancelled.", 408);
            return job();
          }).then(resolve, reject).finally(next);
        },
      };
      function cancel() {
        const index = waiting.indexOf(entry);
        if (index !== -1) {
          waiting.splice(index, 1);
          reject(new HeavyJobError("The job was cancelled.", 408));
        }
      }
      if (!busy) entry.start();
      else {
        waiting.push(entry);
        signal?.addEventListener("abort", cancel, { once: true });
      }
    });
  };
}

export const heavyJob = globalThis[key] ??= createHeavyQueue();
