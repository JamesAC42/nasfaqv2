const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSettlementSupplies } = require('../src/services/settlement');

test('computeSettlementSupplies guarantees supply constraint', async (t) => {
  await t.test('normal emission case', () => {
    const result = computeSettlementSupplies({
      maxSupply: 10000,
      circulatingSupply: 5000,
      treasurySupply: 5000,
      emissionApplied: 100,
    });

    assert.equal(result.circulatingSupplyEnd, 5100);
    assert.equal(result.treasurySupplyEnd, 4900);
    assert.ok(
      result.circulatingSupplyEnd + result.treasurySupplyEnd <= 10000,
      'supply constraint must hold'
    );
  });

  await t.test('float precision edge case - sum exceeds max by float dust', () => {
    const circulatingSupply = 5908.212364593251;
    const treasurySupply = 4091.787635406751;
    const maxSupply = 10000;

    assert.ok(
      circulatingSupply + treasurySupply > maxSupply,
      'precondition: raw float sum exceeds max (this is the bug scenario)'
    );

    const result = computeSettlementSupplies({
      maxSupply,
      circulatingSupply,
      treasurySupply,
      emissionApplied: 0,
    });

    assert.ok(
      result.circulatingSupplyEnd + result.treasurySupplyEnd <= maxSupply,
      'supply constraint must hold even with float precision edge case'
    );
    assert.equal(
      result.circulatingSupplyEnd + result.treasurySupplyEnd,
      maxSupply,
      'supplies should sum exactly to max'
    );
  });

  await t.test('derived treasury always satisfies constraint regardless of input', () => {
    const testCases = [
      { maxSupply: 10000, circulatingSupply: 5000.0000000001, treasurySupply: 5000, emissionApplied: 0 },
      { maxSupply: 10000, circulatingSupply: 9999.9999999999, treasurySupply: 0.0000000002, emissionApplied: 0 },
      { maxSupply: 10000, circulatingSupply: 0.0000000001, treasurySupply: 10000, emissionApplied: 0.0000000001 },
      { maxSupply: 1e10, circulatingSupply: 5e9 + 0.123456789, treasurySupply: 5e9 - 0.123456788, emissionApplied: 100.5 },
    ];

    for (const tc of testCases) {
      const result = computeSettlementSupplies(tc);
      assert.ok(
        result.circulatingSupplyEnd + result.treasurySupplyEnd <= tc.maxSupply,
        `constraint must hold for maxSupply=${tc.maxSupply}`
      );
      assert.ok(result.treasurySupplyEnd >= 0, 'treasury must not go negative');
    }
  });

  await t.test('emission that would exceed max supply is clamped', () => {
    const result = computeSettlementSupplies({
      maxSupply: 10000,
      circulatingSupply: 9900,
      treasurySupply: 100,
      emissionApplied: 200,
    });

    assert.equal(result.circulatingSupplyEnd, 10000);
    assert.equal(result.treasurySupplyEnd, 0);
    assert.ok(
      result.circulatingSupplyEnd + result.treasurySupplyEnd <= 10000,
      'supply constraint must hold'
    );
  });

  await t.test('zero emission preserves supplies', () => {
    const result = computeSettlementSupplies({
      maxSupply: 10000,
      circulatingSupply: 6000,
      treasurySupply: 4000,
      emissionApplied: 0,
    });

    assert.equal(result.circulatingSupplyEnd, 6000);
    assert.equal(result.treasurySupplyEnd, 4000);
  });

  await t.test('fractional supplies with float precision', () => {
    const result = computeSettlementSupplies({
      maxSupply: 10000,
      circulatingSupply: 3333.333333333333,
      treasurySupply: 6666.666666666667,
      emissionApplied: 0.1,
    });

    assert.ok(
      result.circulatingSupplyEnd + result.treasurySupplyEnd <= 10000,
      'supply constraint must hold with fractional values'
    );
  });

  await t.test('accumulated float errors across many emissions', () => {
    let circulatingSupply = 1000;
    let treasurySupply = 9000;
    const maxSupply = 10000;

    for (let i = 0; i < 1000; i++) {
      const emissionApplied = 0.1 + Math.random() * 0.001;
      const result = computeSettlementSupplies({
        maxSupply,
        circulatingSupply,
        treasurySupply,
        emissionApplied,
      });

      assert.ok(
        result.circulatingSupplyEnd + result.treasurySupplyEnd <= maxSupply,
        `supply constraint must hold after iteration ${i}`
      );

      circulatingSupply = result.circulatingSupplyEnd;
      treasurySupply = result.treasurySupplyEnd;
    }
  });
});
