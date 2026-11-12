// DTO JSON explícito para schemas HTTP: Date vira ISO-8601, como no transporte.
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export function wire<T>(value: T): Wire<T> {
  return JSON.parse(JSON.stringify(value)) as Wire<T>;
}
