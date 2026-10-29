const KEY_PRESSED = 0;
const KEY_RELEASED = 1;
const KEY_REPEATED = 2;

const KEY_CODES = {
    KeyA: 0x04, KeyB: 0x05, KeyC: 0x06, KeyD: 0x07,
    KeyE: 0x08, KeyF: 0x09, KeyG: 0x0a, KeyH: 0x0b,
    KeyI: 0x0c, KeyJ: 0x0d, KeyK: 0x0e, KeyL: 0x0f,
    KeyM: 0x10, KeyN: 0x11, KeyO: 0x12, KeyP: 0x13,
    KeyQ: 0x14, KeyR: 0x15, KeyS: 0x16, KeyT: 0x17,
    KeyU: 0x18, KeyV: 0x19, KeyW: 0x1a, KeyX: 0x1b,
    KeyY: 0x1c, KeyZ: 0x1d,

    Digit1: 0x1e, Digit2: 0x1f, Digit3: 0x20, Digit4: 0x21,
    Digit5: 0x22, Digit6: 0x23, Digit7: 0x24, Digit8: 0x25,
    Digit9: 0x26, Digit0: 0x27,

    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b,
    Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
    BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31,
    Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,

    F1: 0x3a, F2: 0x3b, F3: 0x3c, F4: 0x3d,
    F5: 0x3e, F6: 0x3f, F7: 0x40, F8: 0x41,
    F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45,

    Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c,
    End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f,
    ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,

    ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2,
    MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5,
    AltRight: 0xe6, MetaRight: 0xe7,
};

const MOD_SHIFT = 1;
const MOD_CTRL = 1 << 1;
const MOD_META = 1 << 2;
const MOD_ALT = 1 << 3;
const MOD_CAPS = 1 << 4;


class KeyboardDevice {
    buffer = new RingBuffer(4096);

    constructor() {
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
    }

    onKeyDown = event => {
        this.feed(event.repeat ? KEY_REPEATED : KEY_PRESSED, KEY_CODES[event.code],
            (MOD_SHIFT * event.shiftKey) |
            (MOD_ALT * event.altKey) |
            (MOD_CTRL * event.ctrlKey) |
            (MOD_META * event.metaKey) |
            (MOD_CAPS * event.getModifierState("CapsLock"))
        );
    }
    onKeyUp = event => {
        this.feed(KEY_RELEASED, KEY_CODES[event.code],
            (MOD_SHIFT * event.shiftKey) |
            (MOD_ALT * event.altKey) |
            (MOD_CTRL * event.ctrlKey) |
            (MOD_META * event.metaKey) |
            (MOD_CAPS * event.getModifierState("CapsLock"))
        );
    }
    close() {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
    }

    feed(type, code, mods) {
        if (code === undefined) return;
        this.buffer.push(type, code, mods);
    }

    write() {
        return -1;
    }

    read(count = 1) {
        count = Math.max(0, Math.trunc(count));

        const bytes = [];
        while (bytes.length < count && this.buffer.length > 0) {
            bytes.push(this.buffer.shift());
        }

        return new Uint8Array(bytes);
    }
}
