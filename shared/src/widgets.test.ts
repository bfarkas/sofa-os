import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTITY_DOMAINS, readConfig, validateDisplay, validateWidgetData, type ConfigField } from './widgets.ts';

test('readConfig checks each field kind, fills defaults and drops undeclared keys', () => {
  const fields: ConfigField[] = [
    { key: 'title', label: 'Title', kind: 'text', maxLength: 5, default: 'Home' },
    { key: 'days', label: 'Days', kind: 'number', min: 1, max: 7, integer: true, default: 3 },
    { key: 'unit', label: 'Unit', kind: 'choice', options: [{ value: 'c', label: '°C' }], default: 'c' },
    { key: 'bars', label: 'Bars', kind: 'boolean', default: false },
    { key: 'entity', label: 'Entity', kind: 'entity', domains: ['sensor'], required: true },
    { key: 'more', label: 'More', kind: 'entities', domains: ['sensor', 'lock'], max: 2 },
  ];
  assert.deepEqual(readConfig(fields, { entity: 'sensor.temp', extra: 1 }), { config: { title: 'Home', days: 3, unit: 'c', bars: false, entity: 'sensor.temp' }, errors: [] });
  assert.deepEqual(readConfig(fields, { entity: 'sensor.a', more: ['lock.door', 'sensor.b'], days: 7 }).errors, []);
  assert.deepEqual(readConfig(fields, { title: 'Too long', days: 2.5, unit: 'f', bars: 'yes', entity: 'camera.door', more: ['sensor.a', 'sensor.a'] }).errors, [
    'title: must be text of at most 5 characters',
    'days: must be a whole number from 1 to 7',
    'unit: must be one of c',
    'bars: must be true or false',
    'entity: must be an entity of sensor',
    'more: must be at most 2 different entities of sensor, lock',
  ]);
  assert.deepEqual(readConfig(fields, null).errors, ['config: must be an object', 'entity: is required']);
  assert.deepEqual(readConfig(fields, { entity: 'sensor.Bad-Id' }).errors, ['entity: must be an entity of sensor']);
});

test('the generic card offers readings only', () => {
  for (const d of ['camera', 'media_player', 'person', 'device_tracker', 'alarm_control_panel', 'script', 'automation']) assert.equal((ENTITY_DOMAINS as readonly string[]).indexOf(d), -1, d);
});

test('validateDisplay accepts every template and refuses malformed ones', () => {
  const good = [
    { template: 'value', value: null, unit: 'kWh', note: 'Today' },
    { template: 'list', rows: [{ label: 'Door', value: 'Closed' }, { label: 'Temp', value: null, unit: '°C' }] },
    { template: 'columns', note: 'Last 3 hours', columns: [{ label: '14:00', value: '0.4', unit: 'kWh', level: 0.5 }, { label: '15:00', value: null }] },
    { template: 'agenda', days: [{ title: 'Today', events: [{ time: 'All day', title: 'Holiday' }, { time: '18:00', title: 'Swim', detail: 'Pool' }] }] },
    { template: 'photo', image: '/api/media/abc.jpg', caption: 'Summer' },
  ];
  for (const d of good) assert.deepEqual(validateDisplay(d), [], d.template);
  assert.deepEqual(validateDisplay({ template: 'value', value: 0 }), ['display.value: must be a string of at most 40 characters']);
  assert.deepEqual(validateDisplay({ template: 'columns', columns: [{ label: 'a', value: '1', level: 2 }] }), ['display.columns[0].level: must be a number from 0 to 1']);
  assert.deepEqual(validateDisplay({ template: 'chart' }), ['display.template: must be one of value, list, columns, agenda, photo']);
  for (const image of ['https://evil.example/x.jpg', '//evil.example/x.jpg', 'x.jpg', '/a b.jpg']) assert.equal(validateDisplay({ template: 'photo', image }).length, 1, image);
});

test('validateWidgetData checks what Sofa Home receives', () => {
  const ok = { id: 'w', title: 'Weather', status: 'ok', card: { template: 'value', value: '12', unit: '°C' }, updatedAt: '2026-11-09T10:00:00.000Z', failing: false, staleAfterSeconds: 180 };
  assert.deepEqual(validateWidgetData(ok), []);
  assert.deepEqual(validateWidgetData({ ...ok, status: 'unavailable', card: undefined, updatedAt: null, message: 'Not available right now' }), []);
  assert.deepEqual(validateWidgetData({ ...ok, card: undefined }), ['card: must be an object']);
  assert.deepEqual(validateWidgetData({ ...ok, updatedAt: 'soon', staleAfterSeconds: 0 }), ['updatedAt: must be an ISO time or null', 'staleAfterSeconds: must be a positive number']);
});
