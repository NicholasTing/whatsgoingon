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

test("new boards start with Midnight and legacy boards receive the same dark appearance", () => {
  assert.equal(defaultBoard().appearance.mode, "dark");
  assert.deepEqual(
    defaultBoard().appearance,
    presets.find((preset) => preset.name === "Midnight")?.appearance,
  );
  const { appearance, ...legacy } = defaultBoard();
  const board = readBoard({ ...legacy, name: "My original board" });
  assert.equal(board.name, "My original board");
  assert.deepEqual(board.monitors, legacy.monitors);
  assert.deepEqual(board.appearance, defaultAppearance);
});

test("saved and shared light or custom appearances keep their chosen colours", () => {
  const light = presets[0].appearance;
  for (const appearance of [light, { ...light, accent: "#204482" }]) {
    const board = { ...defaultBoard(), appearance };
    assert.deepEqual(readBoard(board).appearance, appearance);
    assert.deepEqual(boardFromHash(shareBoard(board))?.appearance, appearance);
  }
});

test("appearance round trips through sharing and rejects unsafe or unreadable imports", () => {
  const board = { ...defaultBoard(), appearance: presets[2].appearance };
  assert.deepEqual(
    boardFromHash(shareBoard(board))?.appearance,
    board.appearance,
  );
  for (const accent of ["red", "#123", "url(https://example.com)"]) {
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
      appearance: { ...presets[0].appearance, accent: "#ffffff" },
    }),
  );
  assert.throws(() =>
    readBoard({
      ...board,
      appearance: { ...board.appearance, outage: "#19212e" },
    }),
  );
});
