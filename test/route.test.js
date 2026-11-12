import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, inject, routeAutoReview } from '../lib/index.js';

const reviewer = {
  provider: 'review-provider',
  model: 'reviewer-model',
};

const review = {
  provider: 'work-provider',
  model: 'work-model',
  temperature: 0,
  purpose: 'auto-review',
  messages: [{ role: 'user', content: [] }],
};

test('every working model uses the configured reviewer', () => {
  for (const model of ['work-model', 'another-model', 'third-model']) {
    const routed = routeAutoReview({ ...review, model }, reviewer);
    assert.equal(routed.provider, 'review-provider');
    assert.equal(routed.model, 'reviewer-model');
    assert.equal(routed.temperature, 0);
    assert.equal(routed.purpose, 'auto-review');
    assert.deepEqual(routed.messages, review.messages);
  }
});

test('non-review requests keep their object identity', () => {
  for (const purpose of [undefined, 'agent-loop', 'session-title']) {
    const request = { provider: 'work-provider', model: 'work-model', purpose };
    assert.equal(routeAutoReview(request, reviewer), request);
  }
});

test('routing never mutates the frozen review request', () => {
  const request = Object.freeze(review);
  routeAutoReview(request, reviewer);
  assert.equal(request.model, 'work-model');
});

function createContext(streams) {
  const dispatched = [];
  const ctx = {
    on(event, listener) {
      assert.equal(event, 'llm/stream');
      ctx.listener = listener;
    },
    llm: {
      stream(options) {
        dispatched.push(options);
        return streams[dispatched.length - 1](options);
      },
    },
  };
  return { ctx, dispatched };
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

test('the listener redispatches reviews on the reviewer route once', async () => {
  assert.deepEqual(inject, ['llm']);
  const { ctx, dispatched } = createContext([
    async function* () {
      yield { type: 'text', text: 'allow' };
    },
  ]);
  apply(ctx, reviewer);

  assert.deepEqual(await collect(ctx.listener(review, () => [])), [{ type: 'text', text: 'allow' }]);
  assert.deepEqual(dispatched[0], routeAutoReview(review, reviewer));

  const working = { provider: 'work-provider', model: 'work-model' };
  assert.deepEqual(await collect(ctx.listener(working, () => [{ type: 'working' }])), [{ type: 'working' }]);
  assert.equal(dispatched.length, 1);
});

test('a pre-first-chunk failure is retried once', async () => {
  let calls = 0;
  const { ctx } = createContext([
    async function* () {
      calls += 1;
      throw new Error('network dropped');
    },
    async function* () {
      calls += 1;
      yield { type: 'text', text: 'allowed' };
    },
  ]);
  apply(ctx, reviewer);

  assert.deepEqual(await collect(ctx.listener(review, () => [])), [{ type: 'text', text: 'allowed' }]);
  assert.equal(calls, 2);
});

test('a mid-stream failure is not retried', async () => {
  let calls = 0;
  const { ctx } = createContext([
    async function* () {
      calls += 1;
      yield { type: 'text', text: 'partial' };
      throw new Error('stream broke');
    },
  ]);
  apply(ctx, reviewer);

  await assert.rejects(collect(ctx.listener(review, () => [])), /stream broke/);
  assert.equal(calls, 1);
});

test('repeated failures still surface', async () => {
  let calls = 0;
  const failing = async function* () {
    calls += 1;
    throw new Error('network dropped');
  };
  const { ctx } = createContext([failing, failing]);
  apply(ctx, reviewer);

  await assert.rejects(collect(ctx.listener(review, () => [])), /network dropped/);
  assert.equal(calls, 2);
});

test('an unconfigured reviewer leaves every request untouched', () => {
  const ctx = {
    on() {
      throw new Error('the listener must not be registered without a reviewer');
    },
  };
  apply(ctx, {});
  apply(ctx, { provider: 'review-provider' });
});
