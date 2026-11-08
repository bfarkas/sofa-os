import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFocus } from './focus.ts';

function setup(rows: string[][], o = {}) {
  const seen: (string | null)[] = [];
  const f = createFocus((id) => seen.push(id));
  f.setBase(rows, o);
  seen.length = 0;
  return { f, seen };
}

test('the first tile is focused when a grid is set', () => {
  const seen: (string | null)[] = [];
  const f = createFocus((id) => seen.push(id));
  f.setBase([['a', 'b'], ['c']]);
  assert.equal(f.current(), 'a');
  assert.deepEqual(seen, ['a']);
});

test('arrows move along the rows and stop at the edges', () => {
  const { f, seen } = setup([['a', 'b', 'c'], ['d', 'e']]);
  assert.equal(f.move('left'), false);
  assert.equal(f.move('up'), false);
  assert.equal(f.move('right'), true);
  assert.equal(f.move('right'), true);
  assert.equal(f.move('right'), false);
  assert.equal(f.current(), 'c');
  assert.equal(f.move('down'), true);
  assert.equal(f.current(), 'e'); // the second row is shorter: the last tile
  assert.equal(f.move('down'), false);
  assert.deepEqual(seen, ['b', 'c', 'e']);
});

test('vertical moves remember the column across a short row', () => {
  const { f } = setup([['a', 'b', 'c', 'd'], ['e'], ['f', 'g', 'h', 'i']]);
  f.move('right');
  f.move('right');
  f.move('right'); // d, column 3
  f.move('down');
  assert.equal(f.current(), 'e');
  f.move('down');
  assert.equal(f.current(), 'i'); // back to column 3, not column 0
  f.move('left'); // a sideways move resets the column to aim for
  f.move('up');
  assert.equal(f.current(), 'e');
});

test('wrap makes arrows go around the edges', () => {
  const { f } = setup([['a'], ['b'], ['c']], { wrap: true });
  f.move('up');
  assert.equal(f.current(), 'c');
  f.move('down');
  assert.equal(f.current(), 'a');
  const row = setup([['x', 'y']], { wrap: true });
  row.f.move('left');
  assert.equal(row.f.current(), 'y');
  row.f.move('right');
  assert.equal(row.f.current(), 'x');
});

test('a bar: Down enters the first tile, Up returns to the bar item last focused', () => {
  const { f } = setup([['t1', 't2', 'settings'], ['a', 'b', 'c'], ['d', 'e', 'f']], { bar: true });
  f.move('right');
  f.move('right'); // settings
  f.move('down');
  assert.equal(f.current(), 'a');
  f.move('right');
  f.move('right');
  f.move('down'); // column 2 of the next row: leaving the bar started the aim at column 0
  assert.equal(f.current(), 'f');
  f.move('up');
  f.move('up'); // into the bar
  assert.equal(f.current(), 'settings');
  f.move('left');
  f.move('down');
  assert.equal(f.current(), 'a'); // always the first tile, whichever bar item
  f.move('up');
  assert.equal(f.current(), 't2');
});

test('overlays: Back closes the top one and lands on the tile that opened it', () => {
  const { f, seen } = setup([['a', 'b'], ['c', 'd']]);
  f.move('right');
  f.move('down'); // d
  f.push([['x'], ['y'], ['z']], { wrap: true });
  assert.equal(f.depth(), 2);
  assert.equal(f.current(), 'x');
  f.move('up'); // wraps inside the overlay only
  assert.equal(f.current(), 'z');
  f.push([['m']]);
  assert.equal(f.current(), 'm');
  assert.equal(f.pop(), true);
  assert.equal(f.current(), 'z'); // the overlay under keeps its own focus
  assert.equal(f.pop(), true);
  assert.equal(f.current(), 'd');
  assert.equal(f.pop(), false); // nothing left to close
  assert.equal(f.depth(), 1);
  assert.deepEqual(seen.slice(-3), ['m', 'z', 'd']);
});

test('a pushed overlay can start on a given tile; arrows never reach the layer below', () => {
  const { f } = setup([['a', 'b']]);
  f.push([['x'], ['y']], { start: 'y' });
  assert.equal(f.current(), 'y');
  assert.equal(f.move('right'), false);
  assert.equal(f.focus('a'), false); // not part of the visible layer
});

test('setBase keeps focus on the same id, or the nearest position when it is gone', () => {
  const { f, seen } = setup([['a', 'b', 'c'], ['d', 'e', 'f']]);
  f.focus('f');
  seen.length = 0;
  f.setBase([['a', 'b', 'c'], ['d', 'e', 'f', 'g']]);
  assert.equal(f.current(), 'f');
  assert.deepEqual(seen, []); // unchanged: no needless highlight work
  f.setBase([['a', 'b'], ['d', 'e']]);
  assert.equal(f.current(), 'e'); // row 1, column clamped
  f.setBase([['z']]);
  assert.equal(f.current(), 'z');
  f.setBase([]);
  assert.equal(f.current(), null);
  assert.equal(f.move('down'), false);
});

test('a base change under an overlay does not steal focus, and applies after Back', () => {
  const { f, seen } = setup([['a', 'b']]);
  f.focus('b');
  f.push([['x']]);
  seen.length = 0;
  f.setBase([['b', 'c']]);
  assert.deepEqual(seen, []);
  f.pop();
  assert.equal(f.current(), 'b');
});

test('refresh says the current focus again, for resume', () => {
  const { f, seen } = setup([['a', 'b']]);
  f.move('right');
  seen.length = 0;
  f.refresh();
  assert.deepEqual(seen, ['b']);
});

test('empty rows are ignored', () => {
  const { f } = setup([[], ['a'], []]);
  assert.equal(f.current(), 'a');
});
