import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversine,
  lineLengthMeters,
  parseDepth,
  depthValue,
  formatDepth,
  depthRange,
  toGeoJSON,
  fromGeoJSON,
} from '../src/geo.js';

test('haversine: one degree of latitude is about 111.2 km', () => {
  const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111195) < 100, String(d));
});

test('line length sums segments', () => {
  const pts = [
    { lat: 40, lng: -100 },
    { lat: 40.001, lng: -100 },
    { lat: 40.002, lng: -100 },
  ];
  assert.ok(Math.abs(lineLengthMeters(pts) - 222.39) < 0.5);
  assert.equal(lineLengthMeters(pts.slice(0, 1)), 0);
});

test('depth parsing and unit conversion', () => {
  assert.equal(parseDepth('4.5', 'ft'), 4.5);
  assert.equal(parseDepth('', 'ft'), null);
  assert.equal(parseDepth('-2', 'ft'), null);
  assert.equal(parseDepth('abc', 'm'), null);
  assert.ok(Math.abs(parseDepth('1', 'm') - 3.28084) < 1e-9);
  assert.equal(depthValue(3.28084, 'm'), '1');
  assert.equal(formatDepth(4, 'ft'), '4 ft');
  assert.equal(formatDepth(null, 'ft'), '—');
});

test('depth range ignores unmeasured points', () => {
  assert.deepEqual(depthRange([{ depth: 3 }, { depth: null }, { depth: 5.5 }]), { min: 3, max: 5.5 });
  assert.equal(depthRange([{ depth: null }]), null);
});

test('GeoJSON round trip keeps geometry, depths and install date', () => {
  const features = [
    {
      id: 'a',
      type: 'water',
      name: '8 in main',
      installDate: '1998-06-15',
      size: '8 in',
      material: 'DI',
      locateMethod: 'Electromagnetic locator',
      notes: 'n',
      points: [
        { lat: 40, lng: -100, depth: 4 },
        { lat: 40.001, lng: -100.001, depth: null },
      ],
    },
    { id: 'b', type: 'sewer', name: 'MH-1', installDate: '', points: [{ lat: 41, lng: -99, depth: 9 }] },
  ];
  const gj = toGeoJSON(features);
  assert.equal(gj.features[0].geometry.type, 'LineString');
  assert.equal(gj.features[1].geometry.type, 'Point');
  assert.deepEqual(gj.features[0].geometry.coordinates[0], [-100, 40]);

  let n = 0;
  const back = fromGeoJSON(JSON.parse(JSON.stringify(gj)), () => `id${n++}`);
  assert.equal(back.length, 2);
  assert.equal(back[0].type, 'water');
  assert.equal(back[0].installDate, '1998-06-15');
  assert.deepEqual(back[0].points, features[0].points);
  assert.deepEqual(back[1].points, features[1].points);
});

test('import rejects bad files and skips unsupported geometry', () => {
  assert.throws(() => fromGeoJSON({ type: 'Feature' }, () => 'x'));
  const out = fromGeoJSON(
    {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [500, 0] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-100, 40] }, properties: { utility: 'bogus' } },
      ],
    },
    () => 'x',
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'proposed');
});
