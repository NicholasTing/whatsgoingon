import test from "node:test";
import assert from "node:assert/strict";
import {
  appearanceSchema,
  appearanceStyle,
  contrast,
  defaultAppearance,
  presets,
} from "../shared/appearance.ts";
import {
  boardFromHash,
  defaultBoard,
  readBoard,
  shareBoard,
} from "../shared/board.ts";

test("colour contrast follows known ratios and every preset is readable", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#ffffff"), 1);
  for (const { appearance } of presets) {
    assert.deepEqual(appearanceSchema.parse(appearance), appearance);
    assert.ok(
      contrast(appearance.accent, appearanceStyle(appearance)["--on-accent"]) >=
        4.5,
    );
  }
});

test("legacy boards keep their monitors and receive the default appearance", () => {
  const { appearance, ...legacy } = defaultBoard();
  const board = readBoard({ ...legacy, name: "My original board" });
  assert.equal(board.name, "My original board");
  assert.deepEqual(board.monitors, legacy.monitors);
  assert.deepEqual(board.appearance, defaultAppearance);
});

test("appearance round trips through sharing and rejects unsafe or unreadable imports", () => {
  const board = { ...defaultBoard(), appearance: presets[2].appearance };
  assert.deepEqual(
    boardFromHash(shareBoard(board))?.appearance,
    board.appearance,
  );
  for (const accent of ["#19212e", "red", "#123", "url(https://example.com)"]) {
    assert.throws(() =>
      readBoard({
        ...defaultBoard(),
        appearance: { ...defaultAppearance, accent },
      }),
    );
  }
  assert.throws(() =>
    readBoard({
      ...board,
      appearance: { ...board.appearance, outage: "#19212e" },
    }),
  );
});


test("fresh and legacy boards default to dark while explicit appearances survive", () => {
  assert.equal(defaultBoard().appearance.mode, "dark");
  const { appearance, ...legacy } = defaultBoard();
  assert.equal(readBoard(legacy).appearance.mode, "dark");
  for (const { appearance } of presets) {
    const board = readBoard({ ...legacy, appearance });
    assert.deepEqual(board.appearance, appearance);
    assert.deepEqual(boardFromHash(shareBoard(board))?.appearance, appearance);
  }
});
