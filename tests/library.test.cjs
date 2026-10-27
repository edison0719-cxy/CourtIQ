const test = require('node:test');
const assert = require('node:assert/strict');
const { filterSessions } = require('../static/planning.js');

test('library search finds venue, player and session names without changing records', () => {
  const records = [
    {id:'a',title:'周三训练',venue:'青羽球馆',near_name:'Alice',status:'completed'},
    {id:'b',title:'周六训练',venue:'城南球馆',far_name:'Bob',status:'draft'},
  ];
  assert.deepEqual(filterSessions(records,{query:' 青羽 '}).map(s=>s.id),['a']);
  assert.deepEqual(filterSessions(records,{query:'ALICE'}).map(s=>s.id),['a']);
  assert.deepEqual(filterSessions(records,{query:'周六'}).map(s=>s.id),['b']);
  assert.equal(records.length,2);
});

test('status filters combine with search, including queued and running work', () => {
  const records = [
    {id:'a',title:'训练',status:'completed'}, {id:'b',title:'训练',status:'queued'},
    {id:'c',title:'训练',status:'running'}, {id:'d',title:'其他',status:'failed'},
  ];
  assert.deepEqual(filterSessions(records,{status:'processing'}).map(s=>s.id),['b','c']);
  assert.deepEqual(filterSessions(records,{status:'failed',query:'训练'}),[]);
  assert.equal(filterSessions(records,{status:'all'}).length,4);
});

test('search treats punctuation literally and supports an empty library', () => {
  assert.deepEqual(filterSessions([],{query:'['}),[]);
  assert.deepEqual(filterSessions([{id:'a',title:'Training [1]'}],{query:'[1]'}).map(s=>s.id),['a']);
});
