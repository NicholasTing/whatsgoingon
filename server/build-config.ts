import { mkdirSync, writeFileSync } from "node:fs";
import { loadBoard } from "./config.ts";

const board = loadBoard(process.env.SERVICES_CONFIG ?? "services.json");
mkdirSync("dist", { recursive: true });
writeFileSync("dist/board.json", JSON.stringify(board, null, 2) + "\n");
