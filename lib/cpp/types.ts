// Serializable snapshot types produced by the interpreter and drawn by the UI

export type SnapVal =
  | { k: 'prim'; text: string; uninit?: boolean; str?: boolean }
  | { k: 'ptr'; text: string; target?: number | null; null?: boolean; uninit?: boolean; dangling?: boolean; pastEnd?: boolean; outOfScope?: boolean }
  | { k: 'ref'; target: number | null }
  | { k: 'struct'; fields: SnapVar[] }
  | { k: 'array'; elems: SnapVar[]; vector?: boolean };

export interface SnapVar {
  id: number;
  name: string;
  type: string;
  addr: string;
  val: SnapVal;
  born: number;
}

export interface SnapFrame {
  id: number;
  name: string;
  line: number;
  vars: SnapVar[];
  global?: boolean;
}

export interface SnapHeap {
  id: number;
  type: string;
  addr: string;
  val: SnapVal;
  alive: boolean;
  leaked: boolean;
  born: number;
  diedAt?: number;
  isArray: boolean;
}

export type SnapKind = 'start' | 'step' | 'call' | 'return' | 'end' | 'error' | 'input';

export interface Snapshot {
  kind: SnapKind;
  line: number;
  note: string;
  events: string[];
  frames: SnapFrame[];
  heap: SnapHeap[];
  out: string;
  error?: string;
}

export interface RunResult {
  snaps: Snapshot[];
  parseError?: { msg: string; line: number };
}
