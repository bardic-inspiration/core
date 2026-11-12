// The format's value types: what a field, parameter, or variable may hold.
// One parser (`parseType`) and one mapping to CEL type names (`celType`), so
// the compiler's static checks and the runtime's conversions cannot disagree.

export type ValueType =
  | { k: 'int' | 'number' | 'bool' | 'string' | 'seat' | 'cell' }
  | { k: 'enum'; name: string }
  | { k: 'ref'; kind: string }
  | { k: 'list'; of: ValueType }
  | { k: 'map'; key: ValueType; val: ValueType };

const SCALARS = new Set(['int', 'number', 'bool', 'string', 'seat', 'cell']);

/** Names a ruleset may not give a kind or enum: the scalar types and CEL's own type names. */
export const RESERVED_TYPE_NAMES = new Set([
  ...SCALARS, 'list', 'map', 'double', 'uint', 'bytes', 'dyn', 'null', 'type', 'timestamp', 'duration',
]);

export interface TypeNames {
  enums: ReadonlySet<string>;
  kinds: ReadonlySet<string>;
}

/** Parses `int`, `list<cell>`, `map<ability,int>`, a kind name, or an enum name. Throws on anything else. */
export function parseType(text: string, names: TypeNames): ValueType {
  const source = text.replace(/\s+/g, '');
  const list = /^list<(.+)>$/.exec(source);
  if (list) return { k: 'list', of: parseType(list[1], names) };
  const map = /^map<([^,<>]+),(.+)>$/.exec(source);
  if (map) {
    const key = parseType(map[1], names);
    if (key.k !== 'string' && key.k !== 'enum' && key.k !== 'seat') {
      throw new Error(`map key type "${map[1]}" must be string, seat, or an enum`);
    }
    return { k: 'map', key, val: parseType(map[2], names) };
  }
  if (SCALARS.has(source)) return { k: source as 'int' };
  if (names.enums.has(source)) return { k: 'enum', name: source };
  if (names.kinds.has(source)) return { k: 'ref', kind: source };
  throw new Error(`unknown type "${text}"`);
}

/** The CEL type an expression of this value type has. */
export function celType(type: ValueType): string {
  switch (type.k) {
    case 'int': return 'int';
    case 'number': return 'double';
    case 'bool': return 'bool';
    case 'string': case 'seat': case 'enum': return 'string';
    case 'cell': return 'Cell';
    case 'ref': return `kind.${type.kind}`;
    case 'list': return `list<${celType(type.of)}>`;
    case 'map': return `map<string, ${celType(type.val)}>`;
  }
}

export function showType(type: ValueType): string {
  switch (type.k) {
    case 'enum': return type.name;
    case 'ref': return type.kind;
    case 'list': return `list<${showType(type.of)}>`;
    case 'map': return `map<${showType(type.key)},${showType(type.val)}>`;
    default: return type.k;
  }
}

/**
 * True when an expression the checker typed as `actual` may be used where
 * `expected` is wanted. An empty list literal types as `list<T>`; a `dyn`
 * anywhere is refused, since it would escape the static checks.
 */
export function celAssignable(actual: string, expected: string): boolean {
  const a = actual.replace(/\s+/g, '');
  const e = expected.replace(/\s+/g, '');
  if (a === e) return true;
  return a === 'list<T>' && e.startsWith('list<');
}
