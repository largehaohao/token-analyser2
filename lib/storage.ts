import type { RateSnapshot } from './analysis';

const STORAGE_KEY = 'tokenscope.preferences.v1';

export interface Preferences {
  customRates: RateSnapshot[];
  currency: 'usd' | 'credits';
}

const defaults: Preferences = { customRates: [], currency: 'usd' };

function validRate(value: unknown): value is RateSnapshot {
  if (!value || typeof value !== 'object') return false;
  const rate = value as Partial<RateSnapshot>;
  return (
    typeof rate.id === 'string' &&
    (rate.provider === 'codex' || rate.provider === 'claude' || rate.provider === 'unknown') &&
    typeof rate.modelPattern === 'string' &&
    typeof rate.source === 'string' &&
    typeof rate.checkedDate === 'string' &&
    typeof rate.applicability === 'string' &&
    rate.kind === 'custom'
  );
}

export function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return { ...defaults };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...defaults };
    const record = value as Partial<Preferences>;
    const customRates = Array.isArray(record.customRates)
      ? record.customRates.filter(validRate).slice(0, 50)
      : [];
    return {
      customRates,
      currency: record.currency === 'credits' ? 'credits' : 'usd',
    };
  } catch {
    return { ...defaults };
  }
}

export function savePreferences(preferences: Preferences): void {
  if (typeof window === 'undefined') return;
  const safe: Preferences = {
    currency: preferences.currency === 'credits' ? 'credits' : 'usd',
    customRates: preferences.customRates.filter(validRate).slice(0, 50),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // Storage can be disabled in private browsing; the session remains usable.
  }
}

export function clearSessionOnly(): void {
  // Raw events and analysis results intentionally never enter localStorage.
  // This named seam makes the explicit exit action auditable.
}

