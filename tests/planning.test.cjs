const assert = require('node:assert/strict');
const test = require('node:test');

test('public demonstration footage never counts as a venue pilot or training outcome', () => {
  const { summarizeVenues } = require('../static/planning.js');
  const result = summarizeVenues([{id:'demo',is_example:true,venue:'公开样本',status:'completed',notes:'demo'}]);
  assert.equal(result.excludedExamples, 1);
  assert.equal(result.trainingCount, 0);
  assert.equal(result.venueCount, 0);
  assert.equal(result.completedCount, 0);
  assert.equal(result.reviewedCount, 0);
  assert.deepEqual(result.venues, []);
});

test('real training records are grouped by venue and retain their latest session link', () => {
  const { summarizeVenues } = require('../static/planning.js');
  const result = summarizeVenues([
    {id:'old',venue:' 青羽球馆 ',status:'completed',notes:'复盘',created_at:'2026-10-01T00:00:00Z'},
    {id:'new',venue:'青羽球馆',status:'draft',notes:'  ',created_at:'2026-10-26T00:00:00Z'},
    {id:'other',venue:'新城球馆',status:'failed',notes:'未完成',created_at:'2026-10-02T00:00:00Z'},
  ]);
  assert.equal(result.venueCount, 2);
  assert.equal(result.trainingCount, 3);
  assert.equal(result.completedCount, 1);
  assert.equal(result.reviewedCount, 2);
  const venue = result.venues.find(v => v.name === '青羽球馆');
  assert.equal(venue.trainingCount, 2);
  assert.equal(venue.completedCount, 1);
  assert.equal(venue.reviewedCount, 1);
  assert.equal(venue.latestId, 'new');
});

test('unassigned records are visible but do not inflate registered venue count', () => {
  const { summarizeVenues } = require('../static/planning.js');
  const result = summarizeVenues([{id:'a',venue:' ',status:'draft'}]);
  assert.equal(result.venueCount, 0);
  assert.equal(result.unassignedCount, 1);
  assert.equal(result.trainingCount, 1);
  assert.equal(result.venues[0].name, '');
});
