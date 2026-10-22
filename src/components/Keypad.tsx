import type { MouseEvent } from 'react';
import './Keypad.css';

interface KeypadKey {
  digit: string;
  letters?: string;
}

const KEYS: KeypadKey[] = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
];

interface KeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}

// Tapping a keypad button would normally steal focus from the phone field,
// which blurs it — and a blurred field can't report an accurate caret
// position. Preventing default on mousedown keeps focus (and the caret)
// exactly where the person left it in the number, so a tap always edits
// at the right spot instead of falling back to "append at the end".
function keepInputFocused(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

export default function Keypad({ onDigit, onBackspace, onClear }: KeypadProps) {
  return (
    <div className="keypad" role="group" aria-label="Teclado numérico">
      {KEYS.map((key) => (
        <button
          key={key.digit}
          type="button"
          className="keypad__key"
          onMouseDown={keepInputFocused}
          onClick={() => onDigit(key.digit)}
        >
          <span className="keypad__digit">{key.digit}</span>
          {key.letters && <span className="keypad__letters">{key.letters}</span>}
        </button>
      ))}

      <button
        type="button"
        className="keypad__key keypad__key--utility"
        onMouseDown={keepInputFocused}
        onClick={onClear}
        aria-label="Limpar número"
      >
        <span className="keypad__digit">*</span>
      </button>

      <button
        type="button"
        className="keypad__key"
        onMouseDown={keepInputFocused}
        onClick={() => onDigit('0')}
      >
        <span className="keypad__digit">0</span>
        <span className="keypad__letters">+</span>
      </button>

      <button
        type="button"
        className="keypad__key keypad__key--utility"
        onMouseDown={keepInputFocused}
        onClick={onBackspace}
        aria-label="Apagar último número"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="keypad__backspace-icon">
          <path
            d="M9.5 6h9A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9L4 12l5.5-6Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M11 10.5 15 14.5M15 10.5 11 14.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
