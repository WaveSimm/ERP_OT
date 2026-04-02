export type CheckState = "NOT_STARTED" | "CHECKED_IN" | "ON_BREAK" | "CHECKED_OUT";
export type CheckAction = "CHECK_IN" | "BREAK_OUT" | "BREAK_IN" | "CHECK_OUT";

const VALID_TRANSITIONS: Record<CheckState, CheckAction[]> = {
  NOT_STARTED: ["CHECK_IN"],
  CHECKED_IN: ["BREAK_OUT", "CHECK_OUT"],
  ON_BREAK: ["BREAK_IN"],
  CHECKED_OUT: [],
};

const NEXT_STATE: Record<string, CheckState> = {
  "NOT_STARTED:CHECK_IN": "CHECKED_IN",
  "CHECKED_IN:BREAK_OUT": "ON_BREAK",
  "ON_BREAK:BREAK_IN": "CHECKED_IN",
  "CHECKED_IN:CHECK_OUT": "CHECKED_OUT",
};

export function transition(current: CheckState, action: CheckAction): CheckState {
  if (!VALID_TRANSITIONS[current].includes(action)) {
    throw new Error(`상태 '${current}'에서 '${action}' 동작은 허용되지 않습니다.`);
  }
  return NEXT_STATE[`${current}:${action}`]!;
}

export function canTransition(current: CheckState, action: CheckAction): boolean {
  return VALID_TRANSITIONS[current].includes(action);
}
