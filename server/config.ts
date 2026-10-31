import { readFileSync } from "node:fs";
import { z } from "zod";
import { boardSchema, defaultBoard, monitorSchema } from "../shared/board.ts";
import { providers } from "./catalog.ts";
import { publicUrl } from "./http.ts";

export function loadBoard(file: string) {
  const services = z
    .array(monitorSchema.extend({ enabled: z.boolean().default(true) }).strict())
    .parse(JSON.parse(readFileSync(file, "utf8")));
  const board = boardSchema.parse({
    ...defaultBoard(),
    monitors: services,
  });
  for (const monitor of board.monitors) {
    if (monitor.custom) publicUrl(monitor.custom.url);
    else if (!providers.some((provider) => provider.id === monitor.id))
      throw new Error(
        `Unknown service "${monitor.id}" in ${file}. Use an ID from server/catalog.ts.`,
      );
  }
  board.monitors = board.monitors.filter((_, index) => services[index].enabled);
  return board;
}
