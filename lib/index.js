export const name = 'auto-review-router';
export const inject = ['llm'];

const REVIEW_PURPOSE = 'auto-review';
const DEFAULT_ATTEMPTS = 2;

/** Route only auto-review calls; working-model requests remain unchanged. */
export function routeAutoReview(options, reviewer) {
  if (options.purpose !== REVIEW_PURPOSE) return options;
  return { ...options, provider: reviewer.provider, model: reviewer.model };
}

/**
 * Re-enter the public stream for the routed review, retrying a transient
 * transport failure once. The stream is retried only before any chunk is
 * yielded, so an already-started review is never duplicated.
 */
async function* reviewStream(ctx, review, attempts) {
  for (let attempt = 1; ; attempt += 1) {
    const iterator = ctx.llm.stream(review)[Symbol.asyncIterator]();
    let started = false;
    try {
      for (;;) {
        const step = await iterator.next();
        if (step.done) return;
        started = true;
        yield step.value;
      }
    } catch (error) {
      if (started || attempt >= attempts) throw error;
    } finally {
      if (!started) await iterator.return?.();
    }
  }
}

export function apply(ctx, config) {
  const reviewer = { provider: config.provider, model: config.model };
  if (!reviewer.provider || !reviewer.model) return;
  const attempts = Number.isInteger(config.attempts) && config.attempts > 0 ? config.attempts : DEFAULT_ATTEMPTS;

  const routed = new WeakSet();
  ctx.on('llm/stream', (options, next) => {
    if (options.purpose !== REVIEW_PURPOSE || routed.has(options)) return next();
    const review = routeAutoReview(options, reviewer);
    routed.add(review);
    return reviewStream(ctx, review, attempts);
  });
}
