import type { ChangeEvent, KeyboardEvent } from 'react';
import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { formatPhoneNumber, onlyDigits, sanitizeLocalPhoneInput } from '../utils/phone';
import { DEFAULT_COUNTRY_CODE } from '../utils/phone';
import './PhoneInput.css';

interface PhoneInputProps {
  /** Always a plain digit string — the mask (space, hyphen) is display-only. */
  value: string;
  onChange: (digits: string) => void;
  error?: string | null;
  countryCode?: string;
}

export interface PhoneInputHandle {
  insertDigit: (digit: string) => void;
  backspace: () => void;
  clear: () => void;
}

/**
 * Counts how many digits sit before `displayIndex` in a masked string —
 * i.e. converts a caret position in the *displayed* text (which includes
 * the fixed " " and "-" mask characters) into a caret position among the
 * *digits only*. This is the number everything else in this component is
 * built around: as long as we always reason in "digit index" terms and
 * only convert to/from display-string index at the boundary (reading the
 * DOM caret in, writing it back out), the mask characters can never be
 * caught in the middle of an edit — they're just skipped over.
 */
function digitIndexFromDisplayIndex(display: string, displayIndex: number): number {
  return display.slice(0, displayIndex).replace(/\D/g, '').length;
}

/** The inverse: where in the (newly formatted) display string does the
 * caret belong, given it should sit right after `digitIndex` digits? */
function displayIndexFromDigitIndex(display: string, digitIndex: number): number {
  if (digitIndex <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    if (/\d/.test(display[i])) {
      seen++;
      if (seen === digitIndex) return i + 1;
    }
  }
  return display.length;
}

const PhoneInput = forwardRef<PhoneInputHandle, PhoneInputProps>(function PhoneInput(
  { value, onChange, error, countryCode = DEFAULT_COUNTRY_CODE },
  forwardedRef
) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaretDigitIndex = useRef<number | null>(null);

  const display = formatPhoneNumber(value);

  function applyDigits(nextDigits: string, caretDigitIndex: number) {
    const sanitized = sanitizeLocalPhoneInput(nextDigits);
    pendingCaretDigitIndex.current = Math.min(caretDigitIndex, sanitized.length);
    onChange(sanitized);
  }

  /**
   * Backspace and Delete are handled entirely ourselves (via
   * preventDefault) instead of letting the browser edit the masked text
   * directly. That's what makes the mask characters truly fixed: the
   * native editor never gets a chance to remove or shift the space/hyphen,
   * because it never touches the DOM value for these two keys at all.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    event.preventDefault();

    const input = event.currentTarget;
    const domStart = input.selectionStart ?? display.length;
    const domEnd = input.selectionEnd ?? domStart;
    const startDigitIdx = digitIndexFromDisplayIndex(display, domStart);
    const endDigitIdx = digitIndexFromDisplayIndex(display, domEnd);

    if (startDigitIdx !== endDigitIdx) {
      // A range was selected: either key just deletes that range.
      applyDigits(value.slice(0, startDigitIdx) + value.slice(endDigitIdx), startDigitIdx);
      return;
    }

    if (event.key === 'Backspace') {
      if (startDigitIdx === 0) return; // nothing before the caret
      applyDigits(value.slice(0, startDigitIdx - 1) + value.slice(startDigitIdx), startDigitIdx - 1);
    } else {
      if (startDigitIdx >= value.length) return; // nothing after the caret
      applyDigits(value.slice(0, startDigitIdx) + value.slice(startDigitIdx + 1), startDigitIdx);
    }
  }

  /**
   * Everything that isn't Backspace/Delete (typing a digit, pasting, …)
   * is allowed to hit the DOM normally, then reconciled here: we read
   * back whatever the browser produced, strip every non-digit character
   * (which throws away any mask character the edit happened to land
   * next to), and figure out the caret's digit-position from how many
   * digits preceded it in that raw, not-yet-reformatted string.
   */
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const rawValue = event.target.value;
    const caretPosition = event.target.selectionStart ?? rawValue.length;
    const digitsBeforeCaret = onlyDigits(rawValue.slice(0, caretPosition)).length;
    applyDigits(onlyDigits(rawValue), digitsBeforeCaret);
  }

  useImperativeHandle(forwardedRef, () => ({
    insertDigit(digit: string) {
      const input = inputRef.current;
      const hasFocus = document.activeElement === input;
      const domStart = hasFocus ? (input?.selectionStart ?? display.length) : display.length;
      const domEnd = hasFocus ? (input?.selectionEnd ?? domStart) : domStart;
      const startDigitIdx = digitIndexFromDisplayIndex(display, domStart);
      const endDigitIdx = digitIndexFromDisplayIndex(display, domEnd);

      const nextDigits = value.slice(0, startDigitIdx) + digit + value.slice(endDigitIdx);
      applyDigits(nextDigits, startDigitIdx + 1);
    },

    backspace() {
      const input = inputRef.current;
      const hasFocus = document.activeElement === input;
      const domStart = hasFocus ? (input?.selectionStart ?? display.length) : display.length;
      const domEnd = hasFocus ? (input?.selectionEnd ?? domStart) : domStart;
      const startDigitIdx = digitIndexFromDisplayIndex(display, domStart);
      const endDigitIdx = digitIndexFromDisplayIndex(display, domEnd);

      if (startDigitIdx !== endDigitIdx) {
        applyDigits(value.slice(0, startDigitIdx) + value.slice(endDigitIdx), startDigitIdx);
        return;
      }
      if (startDigitIdx === 0) return;
      applyDigits(value.slice(0, startDigitIdx - 1) + value.slice(startDigitIdx), startDigitIdx - 1);
    },

    clear() {
      applyDigits('', 0);
    },
  }));

  useLayoutEffect(() => {
    const input = inputRef.current;
    const digitIndex = pendingCaretDigitIndex.current;
    if (!input || digitIndex === null) return;
    pendingCaretDigitIndex.current = null;
    const caretPosition = displayIndexFromDigitIndex(display, digitIndex);
    input.setSelectionRange(caretPosition, caretPosition);
  }, [display]);

  return (
    <div className="phone-input">
      <label className="phone-input__label" htmlFor={inputId}>
        Número do cliente
      </label>
      <div className={`phone-input__readout${error ? ' phone-input__readout--error' : ''}`}>
        <span className="phone-input__country" aria-label={`Código do país +${countryCode}`}>
          +{countryCode}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          className="phone-input__field"
          type="tel"
          // "none" keeps the native mobile keyboard from popping up when
          // this field is tapped — the round keypad below is the intended
          // way to type. The field is still focusable and tappable, so the
          // caret can be positioned by touch to edit in the middle.
          inputMode="none"
          autoComplete="tel-national"
          placeholder="44 99999-9999"
          value={display}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} className="phone-input__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

export default PhoneInput;
