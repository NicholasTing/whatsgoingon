import assert from "node:assert/strict";
import test from "node:test";
import {
  boardFromHash,
  defaultBoard,
  readBoard,
  shareBoard,
} from "../shared/board.ts";

test("boards do not need a name", () => {
  assert.equal(defaultBoard().name, "");
  assert.equal(readBoard({ version: 1, monitors: [] }).name, "");
  assert.equal(readBoard({ ...defaultBoard(), name: "   " }).name, "");
  assert.equal(boardFromHash(shareBoard(defaultBoard()))?.name, "");
});

test("legacy placeholder names are removed without changing the board", () => {
  const board = {
    ...defaultBoard(),
    name: "My status board",
    notifications: true,
    monitors: [{ id: "claude", componentIds: ["api"], group: "AI" }],
  };

  assert.deepEqual(readBoard(board), { ...board, name: "" });
});

test("custom names survive imported and shared boards", () => {
  const board = { ...defaultBoard(), name: "Operations", notifications: true };

  assert.deepEqual(readBoard(JSON.parse(JSON.stringify(board))), board);
  assert.deepEqual(boardFromHash(shareBoard(board)), {
    ...board,
    notifications: false,
  });
});

test("optional names still enforce their type and length", () => {
  assert.throws(() => readBoard({ ...defaultBoard(), name: 42 }));
  assert.throws(() => readBoard({ ...defaultBoard(), name: "x".repeat(81) }));
});
