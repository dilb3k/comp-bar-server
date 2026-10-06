const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadSource } = require('./helpers/load-source.cjs');
const backend = fs.existsSync('backend/src/utils/quantities.ts');
const web = fs.existsSync('src/lib/quantities.ts');
const native = fs.existsSync('app/(tabs)/inventory.tsx');
const base = backend ? 'backend/src/utils' : web ? 'src/lib' : 'src/utils';
const quantities = loadSource(`${base}/quantities.ts`);
const plain = value => JSON.parse(JSON.stringify(value));

test('fractional quantity displays trim float tails but retain grams, zero and large numbers', () => {
  const { formatDecimal } = quantities;
  assert.equal(formatDecimal(254.29999999999998), '254.3');
  assert.equal(formatDecimal(0.1 + 0.2), '0.3');
  assert.equal(formatDecimal(0.001), '0.001');
  assert.equal(formatDecimal(2.500000000000004), '2.5');
  assert.equal(formatDecimal(-0.00000000001), '0');
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(formatDecimal(value), '0');
  assert.equal(formatDecimal(1e21), '1000000000000000000000');
  assert.equal(formatDecimal(Number.MAX_VALUE).includes('∞'), false);
});

test('cart totals keep dona and kg separate after many decimal additions', () => {
  const items = [{ unit: 'dona', quantity: 68 }, ...Array.from({ length: 2543 }, () => ({ unit: 'kg', quantity: 0.1 }))];
  assert.deepEqual(plain(quantities.sumQuantities(items)), { dona: 68, kg: 254.3 });
  assert.deepEqual(plain(quantities.addQuantities({ dona: 1, kg: 0.1 }, { dona: 2, kg: 0.2 })), { dona: 3, kg: 0.3 });
});

test('range units sum daily sales once and take latest stock once, including locked sales and duplicates', () => {
  const rows = [
    { productId: 'piece', unit: 'dona', date: '2026-10-01', startQuantity: 10, currentQuantity: 8 },
    { productId: 'piece', unit: 'dona', date: '2026-10-02', startQuantity: 8, currentQuantity: 5 },
    { productId: 'weight', product: null, unit: 'kg', date: '2026-10-01', startQuantity: 1, currentQuantity: 0.7 },
    { productId: 'weight', unit: 'kg', date: '2026-10-02', updatedAt: '2026-10-02T08:00:00Z', startQuantity: 0.6, currentQuantity: 0.4, lockedSold: 0.1 },
    { productId: 'weight', unit: 'kg', date: '2026-10-02', updatedAt: '2026-10-02T09:00:00Z', startQuantity: 0.6, currentQuantity: 0.4, lockedSold: 0.1 },
  ];
  assert.deepEqual(plain(quantities.getInventoryQuantities(rows)), {
    start: { dona: 10, kg: 1 }, current: { dona: 5, kg: 0.4 },
    sold: { dona: 5, kg: 0.6 }, sellable: { dona: 10, kg: 1 },
  });
  const supplied = quantities.getInventoryQuantities(rows);
  assert.deepEqual(plain(quantities.getInventoryQuantities([], { quantities: supplied })), plain(supplied));
});

test('money display and editing preserve a weighed amount instead of stripping its decimal separator', () => {
  const { formatDecimal, formatInputMoney, parseInputMoney } = quantities;
  assert.equal(formatDecimal(254.29999999999998, 2), '254.3');
  assert.equal(parseInputMoney(formatInputMoney('254.3')), 254.3);
  assert.equal(parseInputMoney(formatInputMoney('1254,30')), 1254.3);
  assert.equal(parseInputMoney(formatInputMoney('0.01')), 0.01);
  assert.equal(parseInputMoney(''), 0);
  assert.equal(formatInputMoney('1.'), '1.');
});

if (!backend) {
  test('quantity stack stays in one compact column with dona above kg', () => {
    const mocks = native ? { 'react-native': { Text: 'Text', View: 'View' }, '../store/themeStore': { useTheme: () => ({ colors: { text: '#111' } }) } } : {};
    const { QuantityStack } = loadSource('src/components/QuantityStack.tsx', mocks);
    const tree = QuantityStack({ quantities: { dona: 68, kg: 254.29999999999998 } });
    assert.equal(tree.props.style.flexDirection, 'column');
    const rows = tree.props.children;
    assert.equal(rows.length, 2);
    const text = node => Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children;
    assert.equal(text(rows[0]), '68 dona');
    assert.equal(text(rows[1]), '254.3 kg');
    assert.equal(native ? rows[0].props.style.fontSize : tree.props.style.fontSize, 14);
  });

  test('inventory metrics format and total fractional API and offline rows without leaking tails', () => {
    const inventory = loadSource(`${base}/inventory.ts`);
    assert.equal(inventory.formatQuantity(254.29999999999998, 'kg'), '254.3 kg');
    const p = { id: 'p', _id: 'p', localId: 'p', unit: 'kg', sellPrice: 100, buyPrice: 40 };
    const row = { productId: 'p', product: p, unit: 'kg', date: '2026-10-04', startQuantity: 254.6, currentQuantity: 254.29999999999998, sold: 0.30000000000001, remaining: 254.29999999999998, revenue: 30.000000000001, realizedProfit: 18.000000000001 };
    const metrics = inventory.getInventoryMetrics(row);
    assert.equal(metrics.remaining, 254.3);
    assert.equal(metrics.sold, 0.3);
    assert.equal(metrics.revenue, 30);
    assert.equal(metrics.realizedProfit, 18);
    const total = inventory.getInventoryTotals([row], null);
    assert.equal(total.current, 254.3);
    assert.equal(total.sold, 0.3);
    assert.equal(total.revenue, 30);
  });
} else {
  test('server day and range summaries return quantities and money at their stored precision', () => {
    const { aggregateInventory, aggregateInventoryForRange } = loadSource('backend/src/modules/inventory/inventory.logic.ts');
    const items = [0.1, 0.2].map((sold, i) => ({ productId: `p${i}`, unit: 'kg', date: '2026-10-04', startQuantity: 1, currentQuantity: 0.3, remaining: 0.3, sold, revenue: sold, realizedProfit: sold, stockSellValue: sold, stockBuyValue: sold, potentialProfit: sold }));
    for (const total of [aggregateInventory(items), aggregateInventoryForRange(items)]) {
      assert.equal(total.totalSold, 0.3);
      assert.equal(total.totalRevenue, 0.3);
      assert.equal(total.totalProfit, 0.3);
      assert.deepEqual(plain(total.quantities.sold), { dona: 0, kg: 0.3 });
    }
  });
}
