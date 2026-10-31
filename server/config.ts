import { readFileSync } from "node:fs";
import { boardSchema, defaultBoard } from "../shared/board.ts";
import { providers } from "./catalog.ts";
import { publicUrl } from "./http.ts";

export function loadBoard(file: string) {
  const board = boardSchema.parse({
    ...defaultBoard(),
    monitors: JSON.parse(readFileSync(file, "utf8")),
  });
  for (const monitor of board.monitors) {
    if (monitor.custom) publicUrl(monitor.custom.url);
    else if (!providers.some((provider) => provider.id === monitor.id))
      throw new Error(
        `Unknown service "${monitor.id}" in ${file}. Use an ID from server/catalog.ts.`,
      );
  }
  return board;
}
