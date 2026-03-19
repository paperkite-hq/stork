import { mkdirSync } from "node:fs";
import { openDatabase } from "./db.js";

const DATA_DIR = process.env.STORK_DATA_DIR || "./data";
mkdirSync(DATA_DIR, { recursive: true });

console.log("Running database migrations...");
const db = openDatabase();
console.log("Database ready.");
db.close();
