// Zod schemas (runtime validation) for every operation. Types are intentionally
// not re-exported from "./generated/types" because orval generates colliding
// names between zod schemas (e.g. `GetXxxParams` for path params) and the
// matching TypeScript type aliases for the same operation. Consumers needing
// types should derive them via `z.infer<typeof Schema>` from this barrel, or
// import directly from "@workspace/api-zod/generated/types/<file>".
export * from "./generated/api";
