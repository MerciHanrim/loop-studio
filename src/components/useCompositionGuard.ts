import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

/**
 * Issue #300 — an Enter that only commits an input-method composition (Hangul,
 * kana, pinyin) must not submit the form the field is in. A password field
 * shows this as soon as it is revealed, because a text field takes the input
 * method that a password field does not.
 *
 * Three signals, any of which means "this Enter belongs to the input method":
 *   - a composition this field has seen start and not yet end
 *     (`compositionstart` / `compositionend`, tracked here);
 *   - `isComposing` on the key event;
 *   - key code 229: Safari ends the composition BEFORE the keydown that
 *     committed it, so by then the first two already say "not composing".
 *
 * Spread the returned handlers on the <input>. The form's own `onSubmit` needs
 * no change: an Enter that is prevented here never reaches implicit submission.
 */
export function useCompositionGuard() {
  const composing = useRef(false)
  return {
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) e.preventDefault()
    },
  }
}
