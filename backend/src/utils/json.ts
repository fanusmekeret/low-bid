/** JSON replacer that turns bigint into string so responses never lose precision. */
export function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
