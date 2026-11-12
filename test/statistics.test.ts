import assert from "node:assert/strict";
import { test } from "node:test";
import { regression, summary } from "../src/modules/analytics/statistics.js";
import { retryDelay, toCsv } from "../src/modules/jobs/service.js";

test("estatísticas vazias e conhecidas", () => {
  assert.equal(summary([]).media, null);
  assert.deepEqual(summary([1, 2, 3]), {
    amostras: 3,
    media: 2,
    mediana: 2,
    desvioPadrao: Math.sqrt(2 / 3),
    maximo: 3,
  });
  assert.equal(summary([1, 4]).mediana, 2.5);
  assert.equal(summary([7]).desvioPadrao, 0);
});
test("MQO recupera reta conhecida e rejeita amostras insuficientes/idades constantes", () => {
  assert.deepEqual(
    regression([
      [0, 1],
      [1, 0.5],
      [2, 0],
    ]),
    { slope: -0.5, intercept: 1, r2: 1 },
  );
  assert.equal(
    regression([
      [0, 1],
      [1, 0],
    ]),
    null,
  );
  assert.equal(
    regression([
      [1, 0],
      [1, 1],
      [1, 2],
    ]),
    null,
  );
  assert.equal(
    regression([
      [0, 1],
      [1, 1],
      [2, 1],
    ])?.r2,
    null,
  );
});
test("retry exponencial e CSV escapam aspas, quebras, acentos e fórmulas", () => {
  assert.deepEqual([1, 2, 3].map(retryDelay), [5_000, 10_000, 20_000]);
  const csv = toCsv({
    valor: '=HYPERLINK("x")',
    texto: "ação\nlinha",
    itens: [1, null],
  });
  assert.ok(csv.startsWith("\uFEFFcaminho,valor\r\n"));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"itens.0","1"'));
  assert.ok(csv.includes('"texto","ação\nlinha"'));
});
